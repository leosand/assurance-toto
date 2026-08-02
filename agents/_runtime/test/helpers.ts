/**
 * Helpers de test : seams en mémoire (aucun réseau, aucun pg, aucun Ollama réel).
 */
import pino, { type Logger } from 'pino';
import type { HermesConfig } from '../src/config.js';
import type { DbClient, DbQuery, MemoireEntry } from '../src/db/client.js';
import type { OllamaClient, ChatResponse } from '../src/llm/ollama.js';
import type { BridgeClient, BridgePostResult } from '../src/bridge/client.js';
import type { Anonymizer } from '../src/privacy/anonymize.js';
import { fallbackMask } from '../src/privacy/anonymize.js';
import { createAllowlist } from '../src/security/allowlist.js';
import { createAgentFrom } from '../src/composition.js';
import type { HermesAgent } from '../src/runtime/agent.js';
import type { QueryResultRow } from 'pg';

export function testConfig(overrides: Partial<HermesConfig> = {}): HermesConfig {
  return {
    role: 'sinistres-contentieux',
    departement: 'sinistres-contentieux',
    model: 'gemma4:e4b',
    ollamaHost: 'http://stub:11434',
    ollamaEmbedModel: 'nomic-embed-text',
    databaseUrl: 'postgres://stub',
    redisUrl: 'redis://stub',
    bridgeUrl: 'http://bridge-stub:3100',
    mcpGatewayUrl: 'http://gateway-stub:3200',
    presidioUrl: 'http://presidio-stub:3000',
    agentNsec: '',
    agentNpub: 'npub1agenttest',
    skillsDir: '/nonexistent',
    escalationThresholdEur: 5000,
    port: 0,
    autonomyIntervalSeconds: 0,
    logLevel: 'fatal',
    ...overrides,
  };
}

export function silentLogger(): Logger {
  return pino({ level: 'silent' });
}

// ---------- DbClient en mémoire ----------

export interface MemoryDbOptions {
  killSwitchActive?: boolean;
  queryHandler?: ((sql: string, params: unknown[]) => DbQuery<QueryResultRow>) | undefined;
}

export function makeMemoryDb(opts: MemoryDbOptions = {}): {
  db: DbClient;
  memoire: Array<{ departement: string; nature: string; contenu: string; correlationId?: string | undefined }>;
} {
  const memoire: Array<{ departement: string; nature: string; contenu: string; correlationId?: string | undefined }> = [];
  const db: DbClient = {
    async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<DbQuery<T>> {
      if (sql.includes('kill_switch')) {
        return {
          rows: [{ actif: opts.killSwitchActive === true }] as unknown as T[],
          rowCount: 1,
        };
      }
      if (opts.queryHandler !== undefined) {
        return opts.queryHandler(sql, params) as DbQuery<T>;
      }
      return { rows: [], rowCount: 0 };
    },
    async searchMemoire(): Promise<MemoireEntry[]> {
      return [];
    },
    async insertMemoire(entry): Promise<string | null> {
      memoire.push({ ...entry });
      return 'mem-stub-id';
    },
    async ping(): Promise<boolean> {
      return true;
    },
    async close(): Promise<void> {},
  };
  return { db, memoire };
}

// ---------- Ollama stubbé ----------

export function makeStubOllama(chatResponses: ChatResponse[]): { ollama: OllamaClient; calls: number } {
  let calls = 0;
  const ollama: OllamaClient = {
    async chat(): Promise<ChatResponse> {
      const resp = chatResponses[Math.min(calls, chatResponses.length - 1)];
      calls += 1;
      if (resp === undefined || resp === null) return { toolCalls: [], text: '' };
      // Après épuisement des réponses définies, retombe sur un fallback propre
      // (aucune répétition de la dernière réponse, ce qui bouclerait).
      if (calls > chatResponses.length) return { toolCalls: [], text: 'fallback' };
      return resp;
    },
    async embed(text: string): Promise<number[] | null> {
      void text;
      return new Array<number>(768).fill(0.01);
    },
  };
  return { ollama, get calls() { return calls; } };
}

// ---------- Bridge stubbé (capture les POST) ----------

export interface BridgeCapture {
  command: Record<string, unknown>;
  author_pubkey: string;
  correlation_id: string;
}

export function makeStubBridge(outcome: string = 'applied'): {
  bridge: BridgeClient;
  posted: BridgeCapture[];
  approvals: Array<Record<string, unknown>>;
} {
  const posted: BridgeCapture[] = [];
  const approvals: Array<Record<string, unknown>> = [];
  const bridge: BridgeClient = {
    async postCommand(command, correlationId): Promise<BridgePostResult> {
      posted.push({
        command: command as unknown as Record<string, unknown>,
        author_pubkey: '',
        correlation_id: correlationId,
      });
      return { ok: true, httpStatus: 200, body: { outcome } };
    },
    async createApprobation(input): Promise<BridgePostResult> {
      approvals.push({ ...input, statut: 'en_attente' });
      return { ok: true, httpStatus: 200, body: { outcome: 'pending', statut: 'en_attente' } };
    },
    async ping(): Promise<boolean> {
      return true;
    },
  };
  return { bridge, posted, approvals };
}

// ---------- Anonymizer stubbé (stub regex local, pas de réseau) ----------

export function makeRegexAnonymizer(): Anonymizer {
  return {
    async anonymize(text: string): Promise<string> {
      return fallbackMask(text).text;
    },
  };
}

export function makePassthroughAnonymizer(): Anonymizer {
  return {
    async anonymize(text: string): Promise<string> {
      return text;
    },
  };
}

// ---------- Assemblage ----------

export interface AgentHarnessOpts {
  role?: string;
  tools?: string[];
  chatResponses: ChatResponse[];
  killSwitchActive?: boolean;
 BridgeOutcome?: string;
}

export interface AgentHarness {
  agent: HermesAgent;
  posted: BridgeCapture[];
  approvals: Array<Record<string, unknown>>;
  memoire: Array<{ departement: string; nature: string; contenu: string }>;
}

export function makeHarness(opts: AgentHarnessOpts): AgentHarness {
  const cfg = testConfig({
    ...(opts.role !== undefined ? { role: opts.role, departement: opts.role } : {}),
  });
  const { db, memoire } = makeMemoryDb({ killSwitchActive: opts.killSwitchActive === true });
  const { ollama } = makeStubOllama(opts.chatResponses);
  const { bridge, posted, approvals } = makeStubBridge(opts.BridgeOutcome ?? 'applied');
  const allowlist = createAllowlist({ tools: opts.tools ?? [] });
  const { agent } = createAgentFrom(cfg, silentLogger(), {
    db,
    ollama,
    bridge,
    anonymizer: makeRegexAnonymizer(),
    allowlist,
    skills: [],
  });
  return { agent, posted, approvals, memoire };
}
