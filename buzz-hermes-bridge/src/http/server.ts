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

// ---------- Zod validation des entrées HTTP ----------
const HttpCommandBodySchema = z.object({
  command: z.unknown(), // le contenu JSON de la commande (sera validé par ajv)
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

// Escalade agent → CEO : création d'une approbation 'en_attente' (brief §6B).
// Un règlement au-dessus du seuil ne s'auto-approuve pas : l'agent crée ici la
// demande qui apparaît dans GET /approvals (dashboard CEO).
const HttpApprobationCreateSchema = z.object({
  type: z.literal('claim.settlement.approve'),
  claim_id: z.string().min(1).max(64),
  montant_eur: z.number().positive(),
  reason: z.string().min(1).max(500),
  requested_by: z.string().min(1).max(128),
  correlation_id: z.string().uuid(),
});

// Usine async (pour pouvoir brancher Redis conditionnellement à la construction).
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
  // Allowlist agents non-signés normalisée en hex (anti-forgery : un npub CEO
  // listé ici serait de toute façon refusé par la règle rbac:ceo_sans_signature).
  const allowedUnsignedRolesHex = cfg.allowedUnsignedRoles.map((p) => {
    try {
      return normalizePubkey(p);
    } catch {
      return p;
    }
  });

  const deps: PipelineDeps = { repo, adapter, dlq, metrics, logger, cfg, ceoPubkeysHex, allowedUnsignedRolesHex };

  app.get('/healthz', () => ({ status: 'ok' }));

  // ---------- Cockpit CEO (ADR-002 — cockpit lean, 100 % lecture Postgres) ----------
  const ceoPubkeyForm = cfg.bridgeCeoPubkeys[0] ?? '';

  // Les formulaires HTML du cockpit postent en application/x-www-form-urlencoded :
  // on les recopie dans body AVANT les handlers JSON (zod), sans ajouter de plugin.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(String(body))) obj[k] = v;
    done(null, obj);
  });

  const wantsHtml = (accept: string | undefined): boolean => (accept ?? '').includes('text/html');
  const toBool = (v: unknown): unknown => (v === 'true' ? true : v === 'false' ? false : v);

  // DÉMO : la page elle-même est la surface de décision CEO. En production,
  // /decide et /killswitch exigent un event Nostr signé (cf. bloc anti-forgery).
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
        .code(200) // cockpit démo : jamais de 500, un message clair suffit
        .header('content-type', 'text/html; charset=utf-8')
        .send('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>Cockpit indisponible</title></head><body style="font-family:sans-serif;background:#0e1116;color:#dbe2ec;padding:40px"><h1>Cockpit indisponible</h1><p>La base de données ne répond pas. Réessaie dans quelques secondes.</p></body></html>');
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

  // Escalade agent → CEO (brief §6B) : crée une demande 'en_attente' visible
  // dans GET /approvals. Réservé aux npubs connus (CEO OU agents allowlistés) —
  // un inconnu ne peut pas spammer la file d'approbation. La signature n'est pas
  // exigée : on crée une DEMANDE, pas une décision (celle-ci exige le CEO).
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

    // Si l'appelant joint un event Nostr signé (kind 9), on vérifie la signature et on
    // substitue l'autorité = pubkey signée. Sans event, on fonctionne en mode démo/doc :
    // la RBAC reste appliquée côté politique (npubs CEO en config) sur author_pubkey.
    const signed = body.event !== undefined;
    if (body.event !== undefined) {
      const check = verifySignedEventForCommand(body.event as SignedEventInput, validated.command);
      if (!check.ok) return reply.code(401).send({ ok: false, error: 'signature.invalid', reason: check.reason });
      body.author_pubkey = check.authorHex;
    }

    // requireSignedCommands (PROD) : les actions à effet réservées au CEO
    // (reject, pricing exception, kill-switch) exigent une signature Nostr.
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

    // Identité CEO : si un event signé est fourni il l'emporte ; sinon on exige un npub whitelisté.
    let decidedBy = body.decided_by;
    if (body.event !== undefined) {
      const signed = body.event as SignedEventInput;
      // Vérifie seulement la signature (décision humaine libre de son contenu).
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
      if (html) return reply.redirect(`/dashboard?correlation_id=${encodeURIComponent(params.correlationId)}&msg=${encodeURIComponent('Décision refusée : déjà traitée ou introuvable')}`);
      return reply.code(409).send({ ok: false, error: 'already_decided_or_missing' });
    }

    // §6B : toute approbation 'approuve' sur 'claim.settlement.approve' exécute
    // immédiatement le règlement effectif (nouveau correlation_id lié).
    if (body.approve && updated.type === 'claim.settlement.approve' && updated.montant_eur !== null) {
      const cmd: Command = {
        type: 'claim.settlement.approve',
        claim_id: updated.claim_id ?? updated.correlation_id,
        max_amount_eur: Number(updated.montant_eur),
        reason: `Exécution après approbation CEO « ${body.reason.slice(0, 100)} »`,
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
      const verdict = body.approve ? 'approuvée' : 'refusée';
      return reply.redirect(`/dashboard?correlation_id=${encodeURIComponent(params.correlationId)}&msg=${encodeURIComponent(`Demande ${verdict}`)}`);
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
      return reply.redirect(`/dashboard?msg=${encodeURIComponent(body.active ? 'Kill-switch ACTIVÉ' : 'Kill-switch désactivé')}`);
    }
    return reply.send({ ok: true, actif: body.active });
  });

  app.get('/dlq', async () => ({ entries: await dlq.list(50) }));

  app.get('/audit/verify', async () => verifyAuditChain(repo));

  return app;
}

function defaultChannel(cfg: BridgeConfig): string {
  // Channel dédié par défaut : constante du bridge (canal de statut des commandes).
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
  // Redis optionnel : en démo sans Redis on reste en mémoire.
  void cfg;
  logger.info('DLQ in-memory (Redis non branché dans cette build)');
  return new MemoryDlq();
}
