/**
 * Pipeline : la colonne vertébrale de corrélation.
 * Chaque transition est observable (log JSON / audit / métriques) et rejette
 * immédiatement tout texte libre, signature invalide ou violation de politique.
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

/** Erreurs discriminées par leur origine pour router retry vs DLQ. */
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
  /** npubs d'agents autorisés SANS signature (normalisés hex, via cfg.allowedUnsignedRoles). */
  allowedUnsignedRolesHex: string[];
}

export interface InboundCommandEnvelope {
  /** Event Nostr signé (kind 9) ou envelope synthétique provenant du POST direct. */
  eventId: string;
  /** npub/hex de l'auteur (pour RBAC). */
  authorPubkey: string;
  /** Content string (JSON sérialisé ou texte brut). */
  content: string;
  /** Correlation id fourni par l'appelant (sinon nouveau UUID). */
  correlationId?: string;
  /** Canal Buzz cible pour le message retour. */
  channelUuid: string;
  /** true SEULEMENT si la signature Nostr de l'event a été vérifiée en amont. */
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

  log.info({ step: 'pipeline.enter', actor: 'bridge' }, 'Commande reçue');

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
      log.warn({ step: 'pipeline.retry', code: pe.code, err: pe.message }, 'Erreur transient, on laisse l\'upstream retry');
      throw pe;
    }
    // Chemin mort : enfile et retourne DLQ outcome.
    await deps.dlq.enqueue({
      commandId: env.eventId,
      correlationId,
      reason: pe.message,
      payload: rawOf(env),
      attempts: 1,
    });
    log.error({ step: 'pipeline.dlq', code: pe.code, err: pe.message }, 'Commande DLQ');
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
  // 1) Schéma strict
  const raw = parseContent(env.content);
  const parsed = validateCommand(raw);
  if (!parsed.ok) {
    const msg = parsed.errors.join('; ');
    await safeAudit(deps, correlationId, 'command.schema_invalid', { errors: parsed.errors });
    return deny(correlationId, env, `schema.invalid: ${msg}`);
  }
  const command: Command = parsed.command;
  const commandId = commandIdOfEnv(env);
  log.info({ step: 'pipeline.schema_ok', command_type: command.type }, 'Commande validée par schéma');

  // 2) Idempotence PRE-policy : une commande déjà consommée doit retourner l'outcome
  //    dédié 'consumed' (200 idempotent côté appelant), pas un deny de politique.
  //    On lit commandes_consommees et on court-circuite sans effet.
  if (await deps.repo.isCommandConsumed(commandId)) {
    await safeAudit(deps, correlationId, 'command.idempotent_refuse_precheck', { command_id: commandId });
    return { correlationId, outcome: 'consumed', reason: 'idempotence:commande_deja_consommee', commandId, returnsToChannel: env.channelUuid };
  }

  // 3) Rôle de l'auteur. La vérification de signature Nostr elle-même se fait en amont :
  //    - sur un événement relay (BuzzAdapter.parseInboundEvent → verifyEvent)
  //    - ou sur la route /commands via verifySignedEvent quand l'appelant fournit l'event signé.
  //    Mal signé ou auteur hors liste CEO ⇒ deny.
  const signed = env.signed === true;
  const role: Role = resolveRole(env.authorPubkey, deps.ceoPubkeysHex, deps.allowedUnsignedRolesHex, signed);

  // 3b) Anti-forgery dur : un npub CEO SANS signature vérifiée est refusé net,
  //     quelle que soit l'allowlist (sinon n'importe qui forgerait le CEO).
  if (!signed && deps.ceoPubkeysHex.includes(safeNormalizeHex(env.authorPubkey))) {
    await safeAudit(deps, correlationId, 'command.auth_denied', { reason: 'rbac:ceo_sans_signature' });
    return deny(correlationId, env, 'rbac:ceo_sans_signature');
  }
  // Ouverture autonomie §6B : le rôle 'agent-sinistres' ne vient JAMAIS d'un
  // author_pubkey auto-déclaré — uniquement de l'allowlist agents ou de la
  // signature (vérifiée en amont côté BuzzAdapter/HTTP).

  // 3) Kill-switch : toute exécution autonome est bloquée sauf killswitch.deactivate.
  const killSwitch = await deps.repo.getKillSwitch();
  const inLock = killSwitch !== null && killSwitch.actif;
  if (inLock && command.type !== 'agent.killswitch.deactivate') {
    await safeAudit(deps, correlationId, 'command.killswitch_blocked', { actif_par: killSwitch?.active_par ?? null });
    throw new PipelineError('killswitch.blocked', 'kill-switch actif : exécution refusée', correlationId);
  }

  // 4) Évaluation de politique
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
  log.info({ step: 'pipeline.policy_ok', role }, 'Politique autorisée');

  // 5) Idempotence : insertion atomique ; 0 ligne → déjà consommée.
  const isConsumed = await markConsumed(deps, commandId, correlationId, command);
  if (!isConsumed) {
    await safeAudit(deps, correlationId, 'command.idempotent_refuse', { command_id: commandId });
    return { correlationId, outcome: 'consumed', reason: 'idempotence:commande_deja_consommee', commandId, returnsToChannel: env.channelUuid };
  }

  // 6) Audit immuable avant effet
  const { hash } = await appendAudit(deps.repo, {
    correlationId,
    source: PIPELINE_SOURCE,
    action: `command.${command.type}`,
    payload: { command_id: commandId, role, author: env.authorPubkey, command },
  });

  // 7) Effet métier en transaction Postgres
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
        // Lecture seule : pas d'écriture métier ici.
        return { report: 'demande_recue', periode: command.periode };
      default: {
        const _never: never = command;
        throw new Error(`type non géré: ${String(_never)}`);
      }
    }
  });

  // 7b) Marquer l'approbation résolue si applicable
  if (command.type === 'claim.settlement.approve' || command.type === 'claim.settlement.reject') {
    await deps.repo.decideApprobation(correlationId, command.approved_by, command.reason, command.type === 'claim.settlement.approve').catch(() => undefined);
  }

  // 8) Message retour vers Buzz (ou NullCollab si fallback)
  const replyText = renderOutboundText(command, correlationId, effect);
  const posted = await deps.adapter.postMessage(env.channelUuid, replyText, correlationId).catch(() => ({ eventId: `local-${Date.now()}` }));
  log.info({ step: 'pipeline.executed', event_id: posted.eventId }, 'Commande exécutée');
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
  // Un texte libre n'est pas une commande : il est refusé par le schéma.
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

function commandIdOfEnv(env: InboundCommandEnvelope): string {
  // Le hash du content (et non l'event.id) stabilise l'idempotence côté multi-origine.
  return createHash('sha256').update(env.content, 'utf8').digest('hex');
}

function claimIdOf(command: Command): string {
  if (command.type === 'claim.settlement.approve' || command.type === 'claim.settlement.reject') return command.claim_id;
  return '';
}

function resolveRole(author: string, ceoList: string[], unsignedAllowlist: string[], signed: boolean): Role {
  const normalized = safeNormalizeHex(author);
  // Un auteur CEO n'est ceo QUE si l'event signé a été vérifié (le deny dur
  // « ceo_sans_signature » est appliqué en amont dans runPipeline).
  if (signed && ceoList.includes(normalized)) return 'ceo';
  // Phase 1 (signature Nostr absente) : un agent Hermes de l'allowlist reçoit
  // le rôle agent-sinistres — jamais le rôle ceo (aucun npub ceo n'y a droit).
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
  // Si l'objet existe déjà comme approbation, on la relie au cycle de vie.
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
    deps.logger.warn({ err: err instanceof Error ? err.message : String(err), action }, 'audit append échoué');
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
      return `[ok] ${head} killswitch=actif par=${command.approved_by}`;
    case 'agent.killswitch.deactivate':
      return `[ok] ${head} killswitch=inactif par=${command.approved_by}`;
    case 'finance.report.request':
      return `[ok] ${head} rapport demandé periode=${command.periode}`;
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
