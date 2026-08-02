/**
 * Serveur HTTP minimal (fastify) de l'agent :
 *  - GET  /healthz  → ok
 *  - GET  /readyz   → ping pg + ollama
 *  - POST /task     → { title, description, correlation_id? } déclenche runTask
 *
 * Mode autonome optionnel : si AUTONOMY_INTERVAL_SECONDS > 0, un timer demande
 * périodiquement à l'agent de PROPOSER et traiter des tâches. Chaque tick est
 * gated par le kill-switch (dans runTask) et arrêté proprement au shutdown.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import type { Runtime } from './composition.js';
import type { TaskInput } from './runtime/agent.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ServerHandle {
  app: FastifyInstance;
  port: number;
  stopAutonomy(): void;
  close(): Promise<void>;
}

/** Validation manuelle minimale du corps POST /task (zéro dépendance schéma). */
function parseTaskBody(raw: unknown):
  | { ok: true; value: TaskInput }
  | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body non-objet' };
  }
  const o = raw as Record<string, unknown>;
  const title = o['title'];
  const description = o['description'];
  const correlationId = o['correlation_id'];
  if (typeof title !== 'string' || title.trim().length === 0 || title.length > 500) {
    return { ok: false, error: "'title' requis (string ≤ 500)" };
  }
  if (typeof description !== 'string' || description.trim().length === 0 || description.length > 8_000) {
    return { ok: false, error: "'description' requise (string ≤ 8000)" };
  }
  if (correlationId !== undefined) {
    if (typeof correlationId !== 'string' || !UUID_RE.test(correlationId)) {
      return { ok: false, error: "'correlation_id' doit être un UUID" };
    }
  }
  return {
    ok: true,
    value: {
      title: title.trim().slice(0, 500),
      description: description.trim().slice(0, 8_000),
      ...(typeof correlationId === 'string' ? { correlation_id: correlationId } : {}),
    },
  };
}

export async function startServer(runtime: Runtime): Promise<ServerHandle> {
  const { cfg, logger, agent } = runtime;
  const app = Fastify({ logger: false, disableRequestLogging: true });

  app.get('/healthz', async () => ({ status: 'ok', agent: cfg.role }));

  app.get('/readyz', async (_req, reply) => {
    let ollamaOk = false;
    try {
      const emb = await runtime.readiness.ollama.embed('ping');
      ollamaOk = emb !== null;
    } catch {
      ollamaOk = false;
    }
    const pgOk = await runtime.readiness.db.ping();
    const ok = pgOk && ollamaOk;
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ready' : 'not_ready',
      pg: pgOk ? 'ok' : 'down',
      ollama: ollamaOk ? 'ok' : 'down',
    });
  });

  app.post('/task', async (req, reply) => {
    const parsed = parseTaskBody(req.body);
    if (!parsed.ok) {
      return reply.code(400).send({ ok: false, error: 'body.invalid', detail: parsed.error });
    }
    logger.info({ action: 'http.task' }, 'tâche reçue');
    const result = await agent.runTask(parsed.value);
    const code = result.stoppedByKillSwitch ? 409 : 200;
    return reply.code(code).send({ ok: !result.stoppedByKillSwitch, result });
  });

  // ---------- mode autonome ----------
  let autonomyTimer: NodeJS.Timeout | null = null;
  const intervalSec = cfg.autonomyIntervalSeconds;
  if (intervalSec > 0) {
    logger.info(
      { action: 'autonomy.enabled', interval_s: intervalSec, role: cfg.role },
      'mode autonome activé',
    );
    autonomyTimer = setInterval(() => {
      void (async () => {
        try {
          await agent.runTask({
            title: 'proposition-autonome',
            description:
              'Mode autonome : propose la prochaine tâche pertinente pour ton département et traite-la.',
          });
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'tick autonome en erreur',
          );
        }
      })();
    }, intervalSec * 1_000);
    autonomyTimer.unref();
  }

  await app.listen({ host: '0.0.0.0', port: cfg.port });
  logger.info({ action: 'http.listening', port: cfg.port, role: cfg.role }, 'agent Hermes à l’écoute');

  return {
    app,
    port: cfg.port,
    stopAutonomy() {
      if (autonomyTimer !== null) clearInterval(autonomyTimer);
    },
    async close() {
      if (autonomyTimer !== null) clearInterval(autonomyTimer);
      await app.close();
    },
  };
}
