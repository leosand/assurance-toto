/**
 * Config centralisée du runtime Hermes : tout vient de l'env, défauts locaux sains.
 * Jamais journalisée en clair (AGENT_NSEC n'apparaît dans aucun log).
 */

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface HermesConfig {
  role: string;
  departement: string;
  model: string;
  ollamaHost: string;
  ollamaEmbedModel: string;
  databaseUrl: string;
  redisUrl: string;
  bridgeUrl: string;
  mcpGatewayUrl: string;
  presidioUrl: string;
  agentNsec: string;
  agentNpub: string;
  skillsDir: string;
  escalationThresholdEur: number;
  port: number;
  autonomyIntervalSeconds: number;
  logLevel: LogLevel;
}

function readEnv(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = source[name];
  return v === undefined || v === '' ? undefined : v;
}

function readInt(source: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = readEnv(source, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

const LOG_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

export function loadConfig(source: NodeJS.ProcessEnv = process.env): HermesConfig {
  const role = readEnv(source, 'AGENT_ROLE') ?? 'orchestrateur';
  const level = readEnv(source, 'LOG_LEVEL') ?? 'info';
  return {
    role,
    departement: readEnv(source, 'MEMORY_DEPARTEMENT') ?? role,
    model: readEnv(source, 'OLLAMA_MODEL') ?? 'gemma4:e4b',
    ollamaHost: readEnv(source, 'OLLAMA_HOST') ?? 'http://host.docker.internal:11434',
    ollamaEmbedModel: readEnv(source, 'OLLAMA_EMBED_MODEL') ?? 'nomic-embed-text',
    databaseUrl:
      readEnv(source, 'DATABASE_URL') ?? 'postgres://postgres:postgres@localhost:5432/assurance_toto',
    redisUrl: readEnv(source, 'REDIS_URL') ?? 'redis://localhost:6379',
    bridgeUrl: readEnv(source, 'BRIDGE_URL') ?? 'http://buzz-hermes-bridge:3100',
    mcpGatewayUrl: readEnv(source, 'MCP_GATEWAY_URL') ?? 'http://mcp-gateway:3200',
    presidioUrl: readEnv(source, 'PRESIDIO_URL') ?? 'http://presidio-analyzer:3000',
    agentNsec: readEnv(source, 'AGENT_NSEC') ?? '',
    agentNpub: readEnv(source, 'AGENT_NPUB') ?? '',
    skillsDir: readEnv(source, 'SKILLS_DIR') ?? '/workspace/skills',
    escalationThresholdEur: readInt(source, 'HERMES_ESCALATION_THRESHOLD_EUR', 5000),
    port: readInt(source, 'PORT', 4000),
    autonomyIntervalSeconds: readInt(source, 'AUTONOMY_INTERVAL_SECONDS', 0),
    logLevel: LOG_LEVELS.includes(level as LogLevel) ? (level as LogLevel) : 'info',
  };
}
