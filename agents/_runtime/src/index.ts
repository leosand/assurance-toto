/**
 * Entrypoint : build runtime (env), start HTTP server, graceful shutdown.
 * SIGTERM/SIGINT → stop the server then close pg. Exit 0.
 */
import { buildRuntime } from './composition.js';
import { startServer } from './server.js';

async function main(): Promise<void> {
  const runtime = await buildRuntime();
  const handle = await startServer(runtime);

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    runtime.logger.info({ action: 'shutdown', signal }, 'graceful shutdown in progress');
    try {
      handle.stopAutonomy();
      await handle.close();
      await runtime.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // Dernier recours : log brut sans framework.
  console.error('fatal startup:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
