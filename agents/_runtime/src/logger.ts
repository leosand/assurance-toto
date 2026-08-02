import pino, { type Logger } from 'pino';
import type { HermesConfig } from './config.js';

/**
 * Logger pino structuré : correlation_id, agent, action.
 * Jamais de contenu utilisateur brut (risque PII) dans les champs de log.
 */
export function makeLogger(cfg: HermesConfig): Logger {
  const logger = pino({
    level: cfg.logLevel,
    base: { component: 'hermes-runtime' },
    redact: {
      paths: ['content', 'payload.description', 'contenu', '*.contenu', '*.content'],
      censor: '[redacted]',
    },
    serializers: { err: pino.stdSerializers.err },
  });
  return logger.child({ agent: cfg.role });
}
