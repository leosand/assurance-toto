/**
 * Hermes agent loop: one runTask = a bounded conversation (max 6 iterations).
 *
 * Sequence: system prompt (role + skills + rules "always a tool call,
 * structured JSON, no PII") → anonymized task → ollama.chat (tools filtered
 * by the allowlist) → tool call execution (deny-by-default) → if a tool
 * produces a candidateCommand: minimal validation + POST bridge /commands
 * (author AGENT_NPUB, fresh or provided correlation_id) → memoire_agents write
 * (learning). The LLM recommends, the bridge decides.
 *
 * Per-action guardrails: kill-switch, allowlist, PII anonymization on input
 * and a final scrub on any text going out to the LLM.
 */
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { HermesConfig } from '../config.js';
import type { DbClient } from '../db/client.js';
import type { OllamaClient, ChatMessage, ToolCall } from '../llm/ollama.js';
import type { BridgeClient, BridgePostResult } from '../bridge/client.js';
import type { KillSwitch } from '../security/killswitch.js';
import type { Allowlist } from '../security/allowlist.js';
import { isAllowed } from '../security/allowlist.js';
import type { Anonymizer } from '../privacy/anonymize.js';
import { assertNoPii, finalScrub } from '../privacy/anonymize.js';
import type { Skill } from '../skills/loader.js';
import type { ToolRegistry, ToolExecution } from '../tools/tools.js';

export const MAX_ITERATIONS = 6;

export interface TaskInput {
  title: string;
  description: string;
  correlation_id?: string | undefined;
}

export interface ToolCallRecord {
  name: string;
  ok: boolean;
  result: unknown;
}

export interface TaskResult {
  correlation_id: string;
  agent: string;
  toolCalls: ToolCallRecord[];
  /** Result of the POST /commands (decision) or /approvals (escalation) to the bridge. */
  command?: { posted: BridgePostResult };
  /** Structured fallback when the LLM answers without a tool call. */
  fallbackText?: string;
  summary: string;
  stoppedByKillSwitch: boolean;
}

export interface AgentDeps {
  cfg: HermesConfig;
  db: DbClient;
  ollama: OllamaClient;
  bridge: BridgeClient;
  killSwitch: KillSwitch;
  allowlist: Allowlist;
  anonymizer: Anonymizer;
  tools: ToolRegistry;
  skills: Skill[];
  logger: Logger;
  randomId?: () => string;
}

export interface HermesAgent {
  runTask(task: TaskInput): Promise<TaskResult>;
}

// ---------- system prompt ----------

function buildSystemPrompt(cfg: HermesConfig, skills: Skill[], toolNames: string[]): string {
  const lines: string[] = [
    `You are the "${cfg.role}" agent of Assurance Toto (department "${cfg.departement}").`,
    ``,
    `STRICT RULES:`,
    `1. ALWAYS answer with a tool call. Never free text unless no tool is relevant.`,
    `2. Structured JSON output only, via tools. No prose.`,
    `3. NO personal data (PII) in your reasoning, arguments or answers.`,
    `4. You NEVER directly modify business data. You can only recommend via the recommander_reglement tool; the actual settlement is applied by the bridge after policy/approval.`,
    `5. Available tools are: ${toolNames.join(', ')}.`,
    ``,
  ];
  for (const skill of skills) {
    lines.push(`SKILL "${skill.name}" :`);
    if (skill.description.length > 0) lines.push(`Description : ${skill.description}`);
    if (skill.toolsAllowed.length > 0) lines.push(`Preferred tools: ${skill.toolsAllowed.join(', ')}`);
    lines.push(skill.systemTemplate.trim(), ``);
  }
  return lines.join('\n');
}

function summarize(
  toolRecords: ToolCallRecord[],
  fallback: string,
  command: BridgePostResult | undefined,
): string {
  if (toolRecords.length === 0) {
    return fallback.length > 0
      ? `No tool called — LLM text answer returned as fallback.`
      : `No tool called and no answer.`;
  }
  const names = toolRecords.map((r) => `${r.name}:${r.ok ? 'ok' : 'err'}`).join(', ');
  const cmd =
    command === undefined
      ? 'no command issued'
      : `bridge command ${command.ok ? 'accepted' : 'denied'} (HTTP ${command.httpStatus})`;
  return `Tools executed [${names}]; ${cmd}.`;
}

// ---------- agent ----------

export function createAgent(deps: AgentDeps): HermesAgent {
  const randomId = deps.randomId ?? ((): string => randomUUID());
  const log = deps.logger;

  async function runTask(task: TaskInput): Promise<TaskResult> {
    const correlationId = task.correlation_id ?? randomId();
    const scoped = log.child({ correlation_id: correlationId, action: 'runTask' });

    // Kill-switch: hard denial before any autonomous action.
    if (await deps.killSwitch.isActive()) {
      scoped.warn({ title: task.title }, 'killswitch active — task denied');
      return {
        correlation_id: correlationId,
        agent: deps.cfg.role,
        toolCalls: [],
        summary: 'Stopped: kill-switch active.',
        stoppedByKillSwitch: true,
      };
    }

    // Task anonymization before any send to the LLM.
    const safeTitle = await deps.anonymizer.anonymize(task.title);
    const safeDescription = await deps.anonymizer.anonymize(task.description);

    const toolSchemas = deps.tools.schemasFor(deps.allowlist);
    const toolNames = toolSchemas.map((t) => t.function.name);
    const systemPrompt = buildSystemPrompt(deps.cfg, deps.skills, toolNames);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Task: ${safeTitle}\n\n${safeDescription}`,
      },
    ];

    const records: ToolCallRecord[] = [];
    let candidateCommand: import('../bridge/client.js').BridgeCommand | null = null;
    let pendingApproval: import('../bridge/client.js').ApprobationInput | null = null;
    let fallbackText = '';

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      // Kill-switch re-check before EVERY autonomous iteration.
      if (await deps.killSwitch.isActive()) {
        scoped.warn({ iteration }, 'killswitch activated mid-task — clean stop');
        return {
          correlation_id: correlationId,
          agent: deps.cfg.role,
          toolCalls: records,
          summary: 'Stopped mid-way: kill-switch activated.',
          stoppedByKillSwitch: true,
        };
      }

      let response: Awaited<ReturnType<OllamaClient['chat']>>;
      try {
        response = await deps.ollama.chat(messages, toolSchemas);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        scoped.error({ iteration, err: msg }, 'ollama chat failure');
        break;
      }

      // Structured fallback: the LLM emitted no tool call.
      if (response.toolCalls.length === 0) {
        fallbackText = response.text;
        scoped.info({ iteration }, 'llm: no tool call — structured fallback');
        break;
      }

      // Adds the assistant message (PII-free) to the conversation.
      messages.push({
        role: 'assistant',
        content: response.text,
      });

      let madeProgress = false;
      for (const call of response.toolCalls) {
        const execution = await executeOne(call, deps, scoped);
        records.push({ name: call.name, ok: execution.ok, result: execution.result });
        if (execution.candidateCommand !== undefined) {
          candidateCommand = execution.candidateCommand;
        }
        if (execution.pendingApproval !== undefined) {
          pendingApproval = { ...execution.pendingApproval, correlation_id: correlationId };
        }
        madeProgress = madeProgress || execution.ok;

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(
            typeof execution.result === 'string' ? execution.result : execution.result,
          ).slice(0, 4_000),
        });
      }

      // A candidate command or pending escalation was produced: no point looping.
      if (candidateCommand !== null || pendingApproval !== null) break;
      if (!madeProgress) break;
    }

    // ---------- POST to bridge: autonomous command OR CEO escalation ----------
    let commandResult: BridgePostResult | undefined;
    if (pendingApproval !== null) {
      // Settlement > threshold: NEVER auto-approve — a 'en_attente' approval
      // is created on the bridge side (the decision stays human, CEO).
      if (await deps.killSwitch.isActive()) {
        scoped.warn('killswitch active — escalation NOT posted to bridge');
      } else {
        commandResult = await deps.bridge.createApprobation(pendingApproval);
        scoped.info(
          { ok: commandResult.ok, httpStatus: commandResult.httpStatus, claim_id: pendingApproval.claim_id },
          'CEO escalation posted to bridge (en_attente approval)',
        );
      }
    } else if (candidateCommand !== null) {
      // kill-switch once more just before the outward action.
      if (await deps.killSwitch.isActive()) {
        scoped.warn('killswitch active — command NOT sent to bridge');
      } else {
        const scrubbed = scrubCandidate(candidateCommand);
        commandResult = await deps.bridge.postCommand(scrubbed, correlationId);
        scoped.info(
          { ok: commandResult.ok, httpStatus: commandResult.httpStatus, command: scrubbed.type },
          'candidate command posted to bridge',
        );
      }
    }

    // ---------- learning: memoire_agents (only direct write) ----------
    await storeLearning(deps, correlationId, task.title, records, commandResult);

    const stopped = false;
    const summary = summarize(records, fallbackText, commandResult);
    return {
      correlation_id: correlationId,
      agent: deps.cfg.role,
      toolCalls: records,
      ...(commandResult !== undefined ? { command: { posted: commandResult } } : {}),
      ...(fallbackText.length > 0 ? { fallbackText } : {}),
      summary,
      stoppedByKillSwitch: stopped,
    };
  }

  return { runTask };
}

// ---------- helpers internes ----------

async function executeOne(
  call: ToolCall,
  deps: AgentDeps,
  scoped: Logger,
): Promise<ToolExecution> {
  // Deny-by-default: never executed if not listed (or unknown to the registry).
  if (!deps.tools.has(call.name)) {
    scoped.warn({ tool: call.name }, 'tool unknown to registry — denied');
    return { tool: call.name, ok: false, result: { error: 'unknown tool' } };
  }
  if (!isAllowed(deps.allowlist, call.name)) {
    scoped.warn({ tool: call.name }, 'tool denied by allowlist');
    return { tool: call.name, ok: false, result: { error: `tool not allowed: ${call.name}` } };
  }

  // LLM arguments must not carry PII toward outputs.
  const argsJson = JSON.stringify(call.arguments);
  const args = assertNoPii(argsJson)
    ? (JSON.parse(finalScrub(argsJson)) as Record<string, unknown>)
    : call.arguments;

  return deps.tools.execute(call.name, args);
}

/** Final scrub on the textual fields of the candidate command before sending. */
function scrubCandidate(
  command: import('../bridge/client.js').BridgeCommand,
): import('../bridge/client.js').BridgeCommand {
  const out: Record<string, unknown> = { ...command };
  if (typeof out['reason'] === 'string' && assertNoPii(out['reason'])) {
    out['reason'] = finalScrub(out['reason']);
  }
  return out as import('../bridge/client.js').BridgeCommand;
}

async function storeLearning(
  deps: AgentDeps,
  correlationId: string,
  title: string,
  records: ToolCallRecord[],
  command: BridgePostResult | undefined,
): Promise<void> {
  // Never the raw content: we learn the PATTERN (tool names + status),
  // not the business data.
  const contenu =
    `Task "${finalScrub(title).slice(0, 120)}" — ` +
    `tools: ${records.map((r) => `${r.name}:${r.ok ? 'ok' : 'err'}`).join(', ') || 'none'}; ` +
    (command !== undefined ? `bridge: HTTP ${command.httpStatus}` : `no command.`);
  const embedding = await deps.ollama.embed(contenu);
  await deps.db.insertMemoire({
    departement: deps.cfg.departement,
    nature: 'apprentissage_tache',
    contenu,
    correlationId,
    ...(embedding !== null ? { embedding } : {}),
    partage: deps.cfg.role === 'orchestrateur',
  });
}
