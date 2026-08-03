import pino, { type Logger } from 'pino';
import type { HermesConfig } from './config.js';

/**
 * Structured pino logger: correlation_id, agent, action.
 * Never log raw user content (PII risk) in log fields.
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
