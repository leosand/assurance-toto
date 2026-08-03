import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { verifyEvent } from 'nostr-tools/pure';
import type { VerifiedEvent } from 'nostr-tools/pure';
import type { BridgeConfig } from '../config.js';
import { makeCollabAdapter } from '../collab/BuzzAdapter.js';
import { PgRepository, type Repository } from '../db/repository.js';
import { MemoryDlq, RedisDlq, type DlqSink } from '../dlq.js';
import { makeMetrics } from '../metrics/metrics.js';
import { normalizePubkey } from '../identity/keys.js';
import { verifySignedEventForCommand, type SignedEventInput } from '../identity/verify.js';
import { validateCommand, type Command } from '../commands/schemas.js';
import { requiresCeo } from '../policy/policy.js';
import { processInboundCommand, type PipelineDeps, type PipelineResult, type InboundCommandEnvelope } from '../pipeline.js';
import { verifyAuditChain } from '../audit.js';
import { renderDashboard } from '../dashboard/dashboard.js';

// ---------- Zod validation of HTTP inputs ----------
const HttpCommandBodySchema = z.object({
  command: z.unknown(), // the JSON command content (will be validated by ajv)
  author_pubkey: z.string().min(1).max(128),
  event: z.object({
    id: z.string(),
    pubkey: z.string(),
    sig: z.string(),
    created_at: z.number(),
    kind: z.number(),
    tags: z.array(z.array(z.string())),
    content: z.string(),
  }).optional(),
  channel_uuid: z.string().uuid().optional(),
  correlation_id: z.string().uuid().optional(),
});

const HttpDecideBodySchema = z.object({
  approve: z.boolean(),
  reason: z.string().min(1).max(500),
  decided_by: z.string().min(1).max(128),
  event: z.object({
    id: z.string(),
    pubkey: z.string(),
    sig: z.string(),
    created_at: z.number(),
    kind: z.number(),
    tags: z.array(z.array(z.string())),
    content: z.string(),
  }).optional(),
});

const HttpKillswitchBodySchema = z.object({
  active: z.boolean(),
  decided_by: z.string().min(1).max(128),
  reason: z.string().max(500).optional().default(''),
});

// Agent → CEO escalation: creation of an 'en_attente' approval (brief §6B).
// A settlement above the threshold cannot self-approve: the agent creates here the
// request that appears in GET /approvals (CEO dashboard).
const HttpApprobationCreateSchema = z.object({
  type: z.literal('claim.settlement.approve'),
  claim_id: z.string().min(1).max(64),
  montant_eur: z.number().positive(),
  reason: z.string().min(1).max(500),
  requested_by: z.string().min(1).max(128),
  correlation_id: z.string().uuid(),
});

// Async factory (to be able to wire Redis conditionally at construction time).
export async function buildServer(cfg: BridgeConfig, overrides?: { repo?: Repository; dlq?: DlqSink }): Promise<FastifyInstance> {
  const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
  const app = Fastify({ logger: false });
  const repo = overrides?.repo ?? new PgRepository(cfg);
  const dlq = overrides?.dlq ?? makeDlq(cfg, logger);
  const adapter = makeCollabAdapter(cfg);
  const metrics = makeMetrics();
  const ceoPubkeysHex = cfg.bridgeCeoPubkeys.map((p) => {
    try {
      return normalizePubkey(p);
    } catch {
      return p;
    }
  });
  // Unsigned-agent allowlist normalized to hex (anti-forgery: a CEO npub
  // listed here would be denied anyway by the rbac:ceo_sans_signature rule).
  const allowedUnsignedRolesHex = cfg.allowedUnsignedRoles.map((p) => {
    try {
      return normalizePubkey(p);
    } catch {
      return p;
    }
  });

  const deps: PipelineDeps = { repo, adapter, dlq, metrics, logger, cfg, ceoPubkeysHex, allowedUnsignedRolesHex };

  // Human-friendly landing: `/` → CEO cockpit.
  app.get('/', async (_req, reply) => reply.redirect('/dashboard'));

  app.get('/healthz', () => ({ status: 'ok' }));

  // ---------- Cockpit CEO (ADR-002 — cockpit lean, 100 % lecture Postgres) ----------
  const ceoPubkeyForm = cfg.bridgeCeoPubkeys[0] ?? '';

  // Cockpit HTML forms post as application/x-www-form-urlencoded:
  // we copy them into body BEFORE the JSON handlers (zod), without adding a plugin.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(String(body))) obj[k] = v;
    done(null, obj);
  });

  const wantsHtml = (accept: string | undefined): boolean => (accept ?? '').includes('text/html');
  const toBool = (v: unknown): unknown => (v === 'true' ? true : v === 'false' ? false : v);

  // DEMO: the page itself is the CEO decision surface. In production,
  // /decide and /killswitch require a signed Nostr event (cf. anti-forgery block).
  app.get('/dashboard', async (req, reply) => {
    const q = req.query as { correlation_id?: string; msg?: string };
    try {
      const html = await renderDashboard({
        snapshot: () => repo.dashboardSnapshot(),
        ceoPubkey: ceoPubkeyForm,
        ...(q.correlation_id !== undefined && q.correlation_id !== '' ? { highlight: q.correlation_id } : {}),
        ...(q.msg !== undefined && q.msg !== '' ? { notice: q.msg } : {}),
      });
      return reply.header('content-type', 'text/html; charset=utf-8').send(html);
    } catch (err) {
      req.log.error({ err }, 'dashboard render failed');
      return reply
        .code(200) // demo cockpit: never a 500, a clear message is enough
        .header('content-type', 'text/html; charset=utf-8')
        .send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>Cockpit unavailable</title></head><body style="font-family:sans-serif;background:#0e1116;color:#dbe2ec;padding:40px"><h1>Cockpit unavailable</h1><p>The database did not respond. Please retry in a few seconds.</p></body></html>');
    }
  });

  app.get('/readyz', async (_req, reply) => {
    const [pgOk, adapterH] = await Promise.all([repo.ping(), adapter.health()]);
    const ok = pgOk && adapterH.ok;
    return reply.code(ok ? 200 : 503).send({
      pg: pgOk ? 'ok' : 'down',
      buzz: adapterH.ok ? 'ok' : adapterH.detail ?? 'down',
      status: ok ? 'ready' : 'not_ready',
    });
  });

  app.get('/metrics', async (_req, reply) => {
    return reply.header('content-type', metrics.registry.contentType).send(await metrics.registry.metrics());
  });

  app.get('/approvals', async () => {
    const rows = await repo.listApprovals('en_attente', 200);
    metrics.activeApprovals.set(rows.length);
    return { approvals: rows };
  });

  // Agent → CEO escalation (brief §6B): creates an 'en_attente' request visible
  // in GET /approvals. Restricted to known npubs (CEO OR allowlisted agents) —
  // a stranger cannot spam the approval queue. The signature is not
  // required: we create a REQUEST, not a decision (that one requires the CEO).
  app.post('/approvals', async (req, reply) => {
    const parsed = HttpApprobationCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'body.invalid', details: parsed.error.issues });
    const body = parsed.data;
    const requesterHex = safeNorm(body.requested_by);
    const connu = ceoPubkeysHex.includes(requesterHex) || allowedUnsignedRolesHex.includes(requesterHex);
    if (!connu) return reply.code(403).send({ ok: false, error: 'forbidden', reason: 'auteur_non_allowliste' });
    const row = await repo.createApprobation({
      correlationId: body.correlation_id,
      type: body.type,
      claimId: body.claim_id,
      montantEur: body.montant_eur,
      reason: body.reason,
      requestedBy: requesterHex,
    });
    return reply.send({ ok: true, approbation: row, correlation_id: body.correlation_id });
  });

  app.post('/commands', async (req, reply) => {
    const parsed = HttpCommandBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'body.invalid', details: parsed.error.issues });
    const body = parsed.data;

    const validated = validateCommand(body.command);
    if (!validated.ok) return reply.code(400).send({ ok: false, error: 'schema.invalid', details: validated.errors });

    // If the caller attaches a signed Nostr event (kind 9), we verify the signature and
    // substitute authority = signed pubkey. Without an event, we run in demo/doc mode:
    // RBAC stays applied at the policy layer (config CEO npubs) on author_pubkey.
    const signed = body.event !== undefined;
    if (body.event !== undefined) {
      const check = verifySignedEventForCommand(body.event as SignedEventInput, validated.command);
      if (!check.ok) return reply.code(401).send({ ok: false, error: 'signature.invalid', reason: check.reason });
      body.author_pubkey = check.authorHex;
    }

    // requireSignedCommands (PROD): the CEO-reserved effect actions
    // (reject, pricing exception, kill-switch) require a Nostr signature.
    if (cfg.requireSignedCommands && !signed && requiresCeo(validated.command.type)) {
      return reply.code(401).send({ ok: false, error: 'auth:ceo_sans_signature_valide' });
    }

    const env: InboundCommandEnvelope = {
      eventId: body.event !== undefined ? (body.event as SignedEventInput).id : `http-${randomUUID()}`,
      authorPubkey: body.author_pubkey,
      content: JSON.stringify(body.command),
      channelUuid: body.channel_uuid ?? defaultChannel(cfg),
      signed,
      ...(body.correlation_id !== undefined ? { correlationId: body.correlation_id } : {}),
    };
    const result: PipelineResult = await processInboundCommand(deps, env);
    return reply.send({ ok: result.outcome !== 'denied', result });
  });

  app.post('/approvals/:correlationId/decide', async (req, reply) => {
    const params = req.params as { correlationId: string };
    const html = wantsHtml(req.headers.accept);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (typeof raw['approve'] !== 'boolean') raw['approve'] = toBool(raw['approve']);
    const parsed = HttpDecideBodySchema.safeParse(raw);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'body.invalid', details: parsed.error.issues });
    const body = parsed.data;

    // CEO identity: if a signed event is provided it takes precedence; otherwise we require a whitelisted npub.
    let decidedBy = body.decided_by;
    if (body.event !== undefined) {
      const signed = body.event as SignedEventInput;
      // Only verifies the signature (human decision free-form content).
      try {
        if (!verifyEvent(signed as VerifiedEvent)) return reply.code(401).send({ ok: false, error: 'signature.invalid' });
        decidedBy = signed.pubkey.toLowerCase();
      } catch {
        return reply.code(401).send({ ok: false, error: 'signature.invalid' });
      }
    }
    const decidedHex = safeNorm(decidedBy);
    if (!ceoPubkeysHex.includes(decidedHex)) {
      return reply.code(403).send({ ok: false, error: 'forbidden', reason: 'decision_reservee_au_CEO' });
    }
    const updated = await repo.decideApprobation(params.correlationId, decidedHex, body.reason, body.approve);
    if (updated === null) {
      if (html) return reply.redirect(`/dashboard?correlation_id=${encodeURIComponent(params.correlationId)}&msg=${encodeURIComponent('Decision refused: already processed or not found')}`);
      return reply.code(409).send({ ok: false, error: 'already_decided_or_missing' });
    }

    // §6B: every 'approuve' approval on 'claim.settlement.approve' executes
    // the actual settlement immediately (linked new correlation_id).
    if (body.approve && updated.type === 'claim.settlement.approve' && updated.montant_eur !== null) {
      const cmd: Command = {
        type: 'claim.settlement.approve',
        claim_id: updated.claim_id ?? updated.correlation_id,
        max_amount_eur: Number(updated.montant_eur),
        reason: `Execution after CEO approval “ ${body.reason.slice(0, 100)} ”`,
        approved_by: decidedHex,
        requested_at: new Date().toISOString(),
      };
      const exec: PipelineResult = await processInboundCommand(deps, {
        eventId: `http-${randomUUID()}`,
        authorPubkey: decidedHex,
        content: JSON.stringify(cmd),
        channelUuid: defaultChannel(cfg),
        correlationId: params.correlationId,
        signed: true,
      });
      updated.execution = exec.outcome;
    }

    if (html) {
      const verdict = body.approve ? 'approved' : 'denied';
      return reply.redirect(`/dashboard?correlation_id=${encodeURIComponent(params.correlationId)}&msg=${encodeURIComponent(`Request ${verdict}`)}`);
    }
    return reply.send({ ok: true, approbation: updated });
  });

  app.post('/killswitch', async (req, reply) => {
    const html = wantsHtml(req.headers.accept);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (typeof raw['active'] !== 'boolean') raw['active'] = toBool(raw['active']);
    const parsed = HttpKillswitchBodySchema.safeParse(raw);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'body.invalid', details: parsed.error.issues });
    const body = parsed.data;
    const decidedHex = safeNorm(body.decided_by);
    if (!ceoPubkeysHex.includes(decidedHex)) {
      return reply.code(403).send({ ok: false, error: 'forbidden', reason: 'killswitch_reserve_au_CEO' });
    }
    await repo.setKillSwitch(body.active, decidedHex);
    await processInboundCommand(deps, {
      eventId: `http-${randomUUID()}`,
      authorPubkey: decidedHex,
      content: JSON.stringify({
        type: body.active ? 'agent.killswitch.activate' : 'agent.killswitch.deactivate',
        approved_by: decidedHex,
        reason: body.reason,
        requested_at: new Date().toISOString(),
      } satisfies Command),
      channelUuid: defaultChannel(cfg),
    });
    if (html) {
      return reply.redirect(`/dashboard?msg=${encodeURIComponent(body.active ? 'Kill-switch ACTIVATED' : 'Kill-switch deactivated')}`);
    }
    return reply.send({ ok: true, actif: body.active });
  });

  app.get('/dlq', async () => ({ entries: await dlq.list(50) }));

  app.get('/audit/verify', async () => verifyAuditChain(repo));

  return app;
}

function defaultChannel(cfg: BridgeConfig): string {
  // Default dedicated channel: bridge constant (command status channel).
  void cfg;
  return '00000000-0000-1000-8000-000000000001';
}

function safeNorm(input: string): string {
  try {
    return normalizePubkey(input);
  } catch {
    return input.toLowerCase();
  }
}

function makeDlq(cfg: BridgeConfig, logger: pino.Logger): DlqSink {
  // Optional Redis: in demo without Redis we stay in-memory.
  void cfg;
  logger.info('DLQ in-memory (Redis not wired in this build)');
  return new MemoryDlq();
}
