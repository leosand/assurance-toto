/**
 * Composition root : câble Db / Ollama / Bridge / Sécurité / Privacy / Skills,
 * expose createAgentFrom() pour les tests (seams injectées) et buildRuntime()
 * pour la prod (env réel).
 */
import { join } from 'node:path';
import type { Logger } from 'pino';
import { loadConfig, type HermesConfig } from './config.js';
import { makeLogger } from './logger.js';
import { PgDbClient, type DbClient } from './db/client.js';
import { createOllamaClient, type OllamaClient } from './llm/ollama.js';
import { createBridgeClient, type BridgeClient } from './bridge/client.js';
import { KillSwitch } from './security/killswitch.js';
import { loadAllowlist, type Allowlist, type AllowlistFile } from './security/allowlist.js';
import { createAllowlist } from './security/allowlist.js';
import { createAnonymizer, type Anonymizer } from './privacy/anonymize.js';
import { loadSkills, type Skill } from './skills/loader.js';
import { createToolRegistry, type ToolRegistry } from './tools/tools.js';
import { createAgent, type HermesAgent, type AgentDeps } from './runtime/agent.js';

export interface Runtime {
  cfg: HermesConfig;
  logger: Logger;
  agent: HermesAgent;
  readiness: { db: DbClient; ollama: OllamaClient; bridge: BridgeClient };
  close(): Promise<void>;
}

/** Construit l'agent à partir de seams injectées (tests/démo). */
export function createAgentFrom(
  cfg: HermesConfig,
  logger: Logger,
  seams: Pick<AgentDeps, 'db' | 'ollama' | 'bridge' | 'anonymizer'> & {
    allowlist: AllowlistFile | Allowlist;
    skills: Skill[];
    randomId?: () => string;
  },
): { agent: HermesAgent; tools: ToolRegistry; killSwitch: KillSwitch; allowlist: Allowlist } {
  const allowlist: Allowlist =
    'tools' in seams.allowlist && seams.allowlist.tools instanceof Set
      ? (seams.allowlist as Allowlist)
      : createAllowlist(seams.allowlist as AllowlistFile);
  const killSwitch = new KillSwitch(seams.db, logger);
  const tools = createToolRegistry({
    db: seams.db,
    ollama: seams.ollama,
    anonymizer: seams.anonymizer,
    logger,
    departement: cfg.departement,
    agentNpub: cfg.agentNpub,
    escalationThresholdEur: cfg.escalationThresholdEur,
  });
  const agent = createAgent({
    cfg,
    db: seams.db,
    ollama: seams.ollama,
    bridge: seams.bridge,
    killSwitch,
    allowlist,
    anonymizer: seams.anonymizer,
    tools,
    skills: seams.skills,
    logger,
    ...(seams.randomId !== undefined ? { randomId: seams.randomId } : {}),
  });
  return { agent, tools, killSwitch, allowlist };
}

/** Runtime de production : pg réel, ollama local, bridge réel. */
export async function buildRuntime(source: NodeJS.ProcessEnv = process.env): Promise<Runtime> {
  const cfg = loadConfig(source);
  const logger = makeLogger(cfg);

  const db = new PgDbClient(cfg.databaseUrl);
  const ollama = createOllamaClient({
    host: cfg.ollamaHost,
    model: cfg.model,
    embedModel: cfg.ollamaEmbedModel,
    logger,
  });
  const bridge = createBridgeClient({
    bridgeUrl: cfg.bridgeUrl,
    authorPubkey: cfg.agentNpub,
    logger,
  });
  const anonymizer = createAnonymizer({ presidioUrl: cfg.presidioUrl, logger });

  const allowlistPath =
    source['HERMES_ALLOWLIST_PATH'] ?? join(process.cwd(), 'mcp-allowlist.json');
  const allowlist = await loadAllowlist(allowlistPath);
  logger.info(
    { action: 'startup.allowlist', tools: [...allowlist.tools] },
    'allowlist agent chargée',
  );

  const skills = await loadSkills(cfg.skillsDir, logger);

  const { agent } = createAgentFrom(cfg, logger, {
    db,
    ollama,
    bridge,
    anonymizer,
    allowlist,
    skills,
  });

  return {
    cfg,
    logger,
    agent,
    readiness: { db, ollama, bridge },
    async close() {
      await db.close();
    },
  };
}
