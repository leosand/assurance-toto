/**
 * Pipeline: the correlation backbone.
 * Every transition is observable (JSON log / audit / metrics) and rejects
 * immediately any free text, invalid signature or policy violation.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { CollabAdapter } from './collab/CollabAdapter.js';
import { validateCommand, type Command } from './commands/schemas.js';
import { appendAudit } from './audit.js';
import { evaluate, type PolicyDecision, type Role } from './policy/policy.js';
import type { Repository, PolicyContext, ApprobationRow, Tx } from './db/repository.js';
import { settleClaimEffect } from './db/repository.js';
import type { DlqSink } from './dlq.js';
import { normalizePubkey } from './identity/keys.js';
import type { Metrics } from './metrics/metrics.js';
import type { BridgeConfig } from './config.js';

export const PIPELINE_SOURCE = 'buzz-hermes-bridge';
export const MAX_ATTEMPTS_TRANSIENT = 3;

/** Errors discriminated by their origin to route retry vs DLQ. */
export class PipelineError extends Error {
  constructor(
    readonly code:
      | 'schema.invalid'
      | 'signature.invalid'
      | 'policy.denied'
      | 'idempotence.consumed'
      | 'killswitch.blocked'
      | 'db.unavailable'
      | 'collab.unavailable'
      | 'effect.failed',
    message: string,
    readonly correlationId: string,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export interface PipelineDeps {
  repo: Repository;
  adapter: CollabAdapter;
  dlq: DlqSink;
  metrics: Metrics;
  logger: Logger;
  cfg: BridgeConfig;
  ceoPubkeysHex: string[];
  /** npubs of agents authorized WITHOUT signature (hex-normalized, via cfg.allowedUnsignedRoles). */
  allowedUnsignedRolesHex: string[];
}

export interface InboundCommandEnvelope {
  /** Signed Nostr event (kind 9) or synthetic envelope from direct POST. */
  eventId: string;
  /** npub/hex of the author (for RBAC). */
  authorPubkey: string;
  /** Content string (serialized JSON or raw text). */
  content: string;
  /** Correlation id provided by the caller (otherwise a new UUID). */
  correlationId?: string;
  /** Target Buzz channel for the return message. */
  channelUuid: string;
  /** true ONLY if the event Nostr signature was verified upstream. */
  signed?: boolean;
}

export interface PipelineResult {
  correlationId: string;
  outcome: 'executed' | 'denied' | 'consumed' | 'dlq';
  reason: string;
  commandId: string;
  auditHash?: string;
  effect?: Record<string, unknown>;
  returnsToChannel?: string;
}

export async function processInboundCommand(deps: PipelineDeps, env: InboundCommandEnvelope): Promise<PipelineResult> {
  const correlationId = env.correlationId ?? randomUUID();
  const log = deps.logger.child({ correlation_id: correlationId, command_id: env.eventId, author: env.authorPubkey });
  const startedAt = process.hrtime.bigint();

  log.info({ step: 'pipeline.enter', actor: 'bridge' }, 'Command received');

  try {
    const outcome = await runPipeline(deps, env, correlationId, log);
    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e9;
    deps.metrics.commandsProcessed.observe({ result: outcome.outcome }, elapsed);
    return outcome;
  } catch (err) {
    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e9;
    deps.metrics.commandsProcessed.observe({ result: 'error' }, elapsed);
    const pe = toPipelineError(err, correlationId);
    if (pe.retryable) {
      log.warn({ step: 'pipeline.retry', code: pe.code, err: pe.message }, 'Transient error, leaving upstream to retry');
      throw pe;
    }
    // Dead end path: enqueue and return DLQ outcome.
    await deps.dlq.enqueue({
      commandId: env.eventId,
      correlationId,
      reason: pe.message,
      payload: rawOf(env),
      attempts: 1,
    });
    log.error({ step: 'pipeline.dlq', code: pe.code, err: pe.message }, 'Command DLQ');
    await safeAudit(deps, correlationId, 'command.dlq', { code: pe.code, reason: pe.message });
    return { correlationId, outcome: 'dlq', reason: pe.message, commandId: commandIdOfEnv(env), returnsToChannel: env.channelUuid };
  }
}

async function runPipeline(
  deps: PipelineDeps,
  env: InboundCommandEnvelope,
  correlationId: string,
  log: Logger,
): Promise<PipelineResult> {
  // 1) Strict schema
  const raw = parseContent(env.content);
  const parsed = validateCommand(raw);
  if (!parsed.ok) {
    const msg = parsed.errors.join('; ');
    await safeAudit(deps, correlationId, 'command.schema_invalid', { errors: parsed.errors });
    return deny(correlationId, env, `schema.invalid: ${msg}`);
  }
  const command: Command = parsed.command;
  const commandId = commandIdOfEnv(env);
  log.info({ step: 'pipeline.schema_ok', command_type: command.type }, 'Command validated by schema');

  // 2) Idempotence PRE-policy: an already-consumed command returns the
  //    dedicated 'consumed' outcome (idempotent 200 on the caller side), not a policy deny.
  //    We read commandes_consommees and short-circuit with no effect.
  if (await deps.repo.isCommandConsumed(commandId)) {
    await safeAudit(deps, correlationId, 'command.idempotent_refuse_precheck', { command_id: commandId });
    return { correlationId, outcome: 'consumed', reason: 'idempotence:commande_deja_consommee', commandId, returnsToChannel: env.channelUuid };
  }

  // 3) Author role. The Nostr signature verification itself happens upstream:
  //    - on a relay event (BuzzAdapter.parseInboundEvent → verifyEvent)
  //    - or on the /commands route via verifySignedEventForCommand when the caller provides the signed event.
  //    Badly signed or author outside the CEO list ⇒ deny.
  const signed = env.signed === true;
  const role: Role = resolveRole(env.authorPubkey, deps.ceoPubkeysHex, deps.allowedUnsignedRolesHex, signed);

  // 3b) Hard anti-forgery: a CEO npub WITHOUT a verified signature is refused outright,
  //     whatever the allowlist (otherwise anyone could forge the CEO).
  if (!signed && deps.ceoPubkeysHex.includes(safeNormalizeHex(env.authorPubkey))) {
    await safeAudit(deps, correlationId, 'command.auth_denied', { reason: 'rbac:ceo_sans_signature' });
    return deny(correlationId, env, 'rbac:ceo_sans_signature');
  }
  // Autonomy opening §6B: the 'agent-sinistres' role NEVER comes from a
  // self-declared author_pubkey — only from the agent allowlist or the
  // signature (verified upstream on the BuzzAdapter/HTTP side).

  // 3) Kill-switch: any autonomous execution is blocked except killswitch.deactivate.
  const killSwitch = await deps.repo.getKillSwitch();
  const inLock = killSwitch !== null && killSwitch.actif;
  if (inLock && command.type !== 'agent.killswitch.deactivate') {
    await safeAudit(deps, correlationId, 'command.killswitch_blocked', { actif_par: killSwitch?.active_par ?? null });
    throw new PipelineError('killswitch.blocked', 'kill-switch active: execution refused', correlationId);
  }

  // 4) Policy evaluation
  const ctx: PolicyContext = {
    killSwitch,
    sinistre: command.type.startsWith('claim.') ? await deps.repo.findSinistre(claimIdOf(command)) : null,
    commandConsumed: await deps.repo.isCommandConsumed(commandId),
    approbation: null,
    thresholdEur: deps.cfg.claimSettlementThresholdEur,
  };
  const policy: PolicyDecision = evaluate({ cmd: command, ctx, role });
  if (!policy.allow) {
    await safeAudit(deps, correlationId, 'command.policy_denied', { reason: policy.reason, role });
    return deny(correlationId, env, policy.reason);
  }
  log.info({ step: 'pipeline.policy_ok', role }, 'Policy allowed');

  // 5) Idempotence: atomic insert; 0 row → already consumed.
  const isConsumed = await markConsumed(deps, commandId, correlationId, command);
  if (!isConsumed) {
    await safeAudit(deps, correlationId, 'command.idempotent_refuse', { command_id: commandId });
    return { correlationId, outcome: 'consumed', reason: 'idempotence:commande_deja_consommee', commandId, returnsToChannel: env.channelUuid };
  }

  // 6) Immutable audit before effect
  const { hash } = await appendAudit(deps.repo, {
    correlationId,
    source: PIPELINE_SOURCE,
    action: `command.${command.type}`,
    payload: { command_id: commandId, role, author: env.authorPubkey, command },
  });

  // 7) Business effect inside a Postgres transaction
  const effect = await deps.repo.inTransaction(async (tx: Tx) => {
    switch (command.type) {
      case 'claim.settlement.approve':
        return settleClaimEffect(tx, command, correlationId, deps.cfg.claimSettlementThresholdEur);
      case 'claim.settlement.reject':
        await tx.query("UPDATE sinistres SET statut = 'refuse' WHERE id = $1", [command.claim_id]);
        await tx.query(`UPDATE approbations SET statut='refuse', decided_at=NOW() WHERE correlation_id=$1`, [correlationId]);
        return { settled: false };
      case 'agent.killswitch.activate':
        await tx.query(`INSERT INTO kill_switch (id, actif, active_par, active_le) VALUES (1, true, $1, NOW()) ON CONFLICT (id) DO UPDATE SET actif=true, active_par=$1, active_le=NOW()`, [command.approved_by]);
        return { killswitch: 'actif' };
      case 'agent.killswitch.deactivate':
        await tx.query(`UPDATE kill_switch SET actif=false, active_par=$1, active_le=NOW() WHERE id=1`, [command.approved_by]);
        return { killswitch: 'inactif' };
      case 'policy.pricing.exception.approve':
        await tx.query(`INSERT INTO approbations (correlation_id, type, statut, montant_eur, decided_by, reason, decided_at) VALUES ($1,$2,'approuve',$3,$4,$5,NOW()) ON CONFLICT (correlation_id) DO NOTHING`, [correlationId, command.type, command.new_prime_eur, command.approved_by, command.reason]);
        return { pricing: 'exception_appliquee', prime: command.new_prime_eur };
      case 'finance.report.request':
        // Read-only: no business write here.
        return { report: 'demande_recue', periode: command.periode };
      default: {
        const _never: never = command;
        throw new Error(`unhandled type: ${String(_never)}`);
      }
    }
  });

  // 7b) Mark the approval as resolved when applicable
  if (command.type === 'claim.settlement.approve' || command.type === 'claim.settlement.reject') {
    await deps.repo.decideApprobation(correlationId, command.approved_by, command.reason, command.type === 'claim.settlement.approve').catch(() => undefined);
  }

  // 8) Return message to Buzz (or NullCollab on fallback)
  const replyText = renderOutboundText(command, correlationId, effect);
  const posted = await deps.adapter.postMessage(env.channelUuid, replyText, correlationId).catch(() => ({ eventId: `local-${Date.now()}` }));
  log.info({ step: 'pipeline.executed', event_id: posted.eventId }, 'Command executed');
  await safeAudit(deps, correlationId, 'command.executed', { effect, event_id: posted.eventId });

  return {
    correlationId,
    outcome: 'executed',
    reason: 'ok',
    commandId,
    auditHash: hash,
    effect: effect as Record<string, unknown>,
    returnsToChannel: env.channelUuid,
  };

  function deny(correlationId2: string, env2: InboundCommandEnvelope, reason: string): PipelineResult {
    return { correlationId: correlationId2, outcome: 'denied', reason, commandId: commandIdOfEnv(env2), returnsToChannel: env2.channelUuid };
  }
}

// ---------- helpers internes ----------
function parseContent(content: string): unknown {
  // Free text is not a command: it is rejected by the schema.
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

function commandIdOfEnv(env: InboundCommandEnvelope): string {
  // The content hash (not the event.id) stabilises idempotence across multiple origins.
  return createHash('sha256').update(env.content, 'utf8').digest('hex');
}

function claimIdOf(command: Command): string {
  if (command.type === 'claim.settlement.approve' || command.type === 'claim.settlement.reject') return command.claim_id;
  return '';
}

function resolveRole(author: string, ceoList: string[], unsignedAllowlist: string[], signed: boolean): Role {
  const normalized = safeNormalizeHex(author);
  // A CEO author is ceo ONLY if the signed event was verified (the hard
  // "ceo_sans_signature" deny is applied upstream in runPipeline).
  if (signed && ceoList.includes(normalized)) return 'ceo';
  // Phase 1 (Nostr signature absent): a Hermes agent from the allowlist gets
  // the agent-sinistres role — never the ceo role (no ceo npub is eligible).
  if (!signed && unsignedAllowlist.includes(normalized)) return 'agent-sinistres';
  return 'inconnu';
}

function safeNormalizeHex(input: string): string {
  try {
    return normalizePubkey(input);
  } catch {
    return input.toLowerCase();
  }
}

async function markConsumed(deps: PipelineDeps, commandId: string, correlationId: string, command: Command): Promise<boolean> {
  const rows = await deps.repo.inTransaction(async (tx: Tx) => {
    const r = await tx.query<{ n: string }>(
      `WITH ins AS (
         INSERT INTO commandes_consommees (command_id, correlation_id)
         VALUES ($1, $2::uuid) ON CONFLICT DO NOTHING
         RETURNING 1
       )
       SELECT count(*)::text AS n FROM ins`,
      [commandId, correlationId],
    );
    return Number(r.rows[0]?.n ?? '0');
  });
  if (rows === 0) return false;
  // If the object already exists as an approval, link it to the lifecycle.
  if (command.type.startsWith('claim.')) {
    await deps.repo.inTransaction(async (tx: Tx) => {
      await tx.query(
        `INSERT INTO approbations (correlation_id, type, claim_id, montant_eur, requested_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (correlation_id) DO NOTHING`,
        [correlationId, command.type, claimIdOf(command), command.type === 'claim.settlement.approve' ? command.max_amount_eur : null, command.approved_by],
      );
    });
  }
  return true;
}

async function safeAudit(deps: PipelineDeps, correlationId: string, action: string, payload: unknown): Promise<void> {
  try {
    await appendAudit(deps.repo, { correlationId, source: PIPELINE_SOURCE, action, payload });
  } catch (err) {
    deps.logger.warn({ err: err instanceof Error ? err.message : String(err), action }, 'audit append failed');
  }
}

function renderOutboundText(command: Command, correlationId: string, effect: unknown): string {
  const head = `correlation_id=${correlationId}`;
  switch (command.type) {
    case 'claim.settlement.approve': {
      const e = effect as { montant?: number };
      return `[ok] ${head} reglement claim=${command.claim_id} montant=${e.montant ?? 'n/a'}`;
    }
    case 'claim.settlement.reject':
      return `[ok] ${head} rejet claim=${command.claim_id}`;
    case 'policy.pricing.exception.approve':
      return `[ok] ${head} pricing exception contrat=${command.contrat_id} prime=${command.new_prime_eur}`;
    case 'agent.killswitch.activate':
      return `[ok] ${head} killswitch=active by=${command.approved_by}`;
    case 'agent.killswitch.deactivate':
      return `[ok] ${head} killswitch=inactive by=${command.approved_by}`;
    case 'finance.report.request':
      return `[ok] ${head} report requested period=${command.periode}`;
    default: {
      const _never: never = command;
      return `[ok] ${head} ${String(_never)}`;
    }
  }
}

function toPipelineError(err: unknown, correlationId: string): PipelineError {
  if (err instanceof PipelineError) return err;
  if (err instanceof Error && /ETIMEDOUT|ECONNREFUSED|ECONNRESET|57P|08P/.test(err.message)) {
    return new PipelineError('db.unavailable', err.message, correlationId, true);
  }
  return new PipelineError('effect.failed', err instanceof Error ? err.message : String(err), correlationId);
}

function rawOf(env: InboundCommandEnvelope): unknown {
  return { eventId: env.eventId, authorPubkey: env.authorPubkey, content: env.content, channelUuid: env.channelUuid };
}

export { markConsumed, parseContent };
