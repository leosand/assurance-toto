/**
 * Composition root: config → infra seams → pipeline → HTTP.
 * Graceful shutdown (SIGTERM/SIGINT): close server, pg pool, DLQ/Redis.
 */
import pino from 'pino';
import { loadConfig, safeConfig, buzzConfigured } from './config.js';
import { buildServer } from './http/server.js';

async function main(): Promise<void> {
  const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
  const cfg = loadConfig();
  logger.info({ config: safeConfig(cfg) }, 'boot buzz-hermes-bridge');

  const app = await buildServer(cfg);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown');
    try {
      await app.close();
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'close http failed');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const addr = await app.listen({ port: cfg.port, host: '0.0.0.0' });
  logger.info({ addr, buzz: buzzConfigured(cfg) ? 'configured' : 'null-adapter' }, `listening on ${addr}`);
}

main().catch((err) => {
  // Boot failures must be loud.
  console.error('fatal boot error', err);
  process.exit(1);
});
