/**
 * Boucle agent Hermes : un runTask = conversation bornée (max 6 itérations).
 *
 * Séquence : prompt système (rôle + skills + règles "toujours un tool call,
 * JSON structuré, aucune PII") → tâche anonymisée → ollama.chat (tools filtrés
 * par l'allowlist) → exécution des tool calls (deny-by-default) → si un outil
 * produit une candidateCommand : validation minimale + POST bridge /commands
 * (author AGENT_NPUB, correlation_id frais ou fourni) → écriture mémoire_agents
 * (apprentissage). Le LLM recommande, le bridge dispose.
 *
 * Garde-fous par action : kill-switch, allowlist, anonymisation PII en entrée
 * et dernier masquage sur tout texte sortant vers le LLM.
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
  /** Résultat du POST /commands (decision) ou /approvals (escalade) au bridge. */
  command?: { posted: BridgePostResult };
  /** Fallback structuré quand le LLM répond sans tool call. */
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

// ---------- prompt système ----------

function buildSystemPrompt(cfg: HermesConfig, skills: Skill[], toolNames: string[]): string {
  const lines: string[] = [
    `Tu es l'agent "${cfg.role}" d'Assurance Toto (département "${cfg.departement}").`,
    ``,
    `RÈGLES STRICTES :`,
    `1. Réponds TOUJOURS par un appel d'outil (tool call). Jamais de texte libre sauf si aucun outil n'est pertinent.`,
    `2. Sortie structurée JSON uniquement via les outils. Pas de prose.`,
    `3. AUCUNE donnée personnelle (PII) dans tes raisonnements, arguments ou réponses.`,
    `4. Tu NE MODIFIES JAMAIS directement les données métier. Tu peux seulement recommander via l'outil recommander_reglement ; le règlement réel est appliqué par le bridge après politique/approbation.`,
    `5. Les outils disponibles sont : ${toolNames.join(', ')}.`,
    ``,
  ];
  for (const skill of skills) {
    lines.push(`SKILL "${skill.name}" :`);
    if (skill.description.length > 0) lines.push(`Description : ${skill.description}`);
    if (skill.toolsAllowed.length > 0) lines.push(`Outils privilégiés : ${skill.toolsAllowed.join(', ')}`);
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
      ? `Aucun outil appelé — réponse texte du LLM retournée en fallback.`
      : `Aucun outil appelé et aucune réponse.`;
  }
  const names = toolRecords.map((r) => `${r.name}:${r.ok ? 'ok' : 'err'}`).join(', ');
  const cmd =
    command === undefined
      ? 'aucune commande émise'
      : `commande bridge ${command.ok ? 'acceptée' : 'refusée'} (HTTP ${command.httpStatus})`;
  return `Outils exécutés [${names}] ; ${cmd}.`;
}

// ---------- agent ----------

export function createAgent(deps: AgentDeps): HermesAgent {
  const randomId = deps.randomId ?? ((): string => randomUUID());
  const log = deps.logger;

  async function runTask(task: TaskInput): Promise<TaskResult> {
    const correlationId = task.correlation_id ?? randomId();
    const scoped = log.child({ correlation_id: correlationId, action: 'runTask' });

    // Kill-switch : refus net avant toute action autonome.
    if (await deps.killSwitch.isActive()) {
      scoped.warn({ title: task.title }, 'killswitch actif — tâche refusée');
      return {
        correlation_id: correlationId,
        agent: deps.cfg.role,
        toolCalls: [],
        summary: 'Arrêté : kill-switch actif.',
        stoppedByKillSwitch: true,
      };
    }

    // Anonymisation de la tâche avant tout envoi au LLM.
    const safeTitle = await deps.anonymizer.anonymize(task.title);
    const safeDescription = await deps.anonymizer.anonymize(task.description);

    const toolSchemas = deps.tools.schemasFor(deps.allowlist);
    const toolNames = toolSchemas.map((t) => t.function.name);
    const systemPrompt = buildSystemPrompt(deps.cfg, deps.skills, toolNames);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Tâche : ${safeTitle}\n\n${safeDescription}`,
      },
    ];

    const records: ToolCallRecord[] = [];
    let candidateCommand: import('../bridge/client.js').BridgeCommand | null = null;
    let pendingApproval: import('../bridge/client.js').ApprobationInput | null = null;
    let fallbackText = '';

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      // Re-vérification du kill-switch avant CHAQUE itération autonome.
      if (await deps.killSwitch.isActive()) {
        scoped.warn({ iteration }, 'killswitch activé en cours de tâche — arrêt propre');
        return {
          correlation_id: correlationId,
          agent: deps.cfg.role,
          toolCalls: records,
          summary: 'Arrêté en cours de route : kill-switch activé.',
          stoppedByKillSwitch: true,
        };
      }

      let response: Awaited<ReturnType<OllamaClient['chat']>>;
      try {
        response = await deps.ollama.chat(messages, toolSchemas);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        scoped.error({ iteration, err: msg }, 'échec ollama chat');
        break;
      }

      // Fallback structuré : le LLM n'a émis aucun tool call.
      if (response.toolCalls.length === 0) {
        fallbackText = response.text;
        scoped.info({ iteration }, 'llm: pas de tool call — fallback structuré');
        break;
      }

      // Ajoute le message assistant (sans PII) à la conversation.
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

      // Une commande candidate ou une escalade pendante a été produite : inutile de boucler.
      if (candidateCommand !== null || pendingApproval !== null) break;
      if (!madeProgress) break;
    }

    // ---------- POST au bridge : commande autonome OU escalade CEO ----------
    let commandResult: BridgePostResult | undefined;
    if (pendingApproval !== null) {
      // Règlement > seuil : JAMAIS d'auto-approve — on crée l'approbation
      // 'en_attente' côté bridge (la décision reste humaine CEO).
      if (await deps.killSwitch.isActive()) {
        scoped.warn('killswitch actif — escalade NON postée au bridge');
      } else {
        commandResult = await deps.bridge.createApprobation(pendingApproval);
        scoped.info(
          { ok: commandResult.ok, httpStatus: commandResult.httpStatus, claim_id: pendingApproval.claim_id },
          'escalade CEO postée au bridge (approbation en_attente)',
        );
      }
    } else if (candidateCommand !== null) {
      // kill-switch encore une fois juste avant l'action outward.
      if (await deps.killSwitch.isActive()) {
        scoped.warn('killswitch actif — commande NON envoyée au bridge');
      } else {
        const scrubbed = scrubCandidate(candidateCommand);
        commandResult = await deps.bridge.postCommand(scrubbed, correlationId);
        scoped.info(
          { ok: commandResult.ok, httpStatus: commandResult.httpStatus, command: scrubbed.type },
          'candidate command postée au bridge',
        );
      }
    }

    // ---------- apprentissage : memoire_agents (seule écriture directe) ----------
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
  // Deny-by-default : jamais exécuté si non listé (ou inconnu du registre).
  if (!deps.tools.has(call.name)) {
    scoped.warn({ tool: call.name }, 'outil inconnu du registre — refusé');
    return { tool: call.name, ok: false, result: { error: 'outil inconnu' } };
  }
  if (!isAllowed(deps.allowlist, call.name)) {
    scoped.warn({ tool: call.name }, 'outil refusé par allowlist');
    return { tool: call.name, ok: false, result: { error: `outil non autorisé: ${call.name}` } };
  }

  // Les arguments LLM ne doivent pas véhiculer de PII vers les sorties.
  const argsJson = JSON.stringify(call.arguments);
  const args = assertNoPii(argsJson)
    ? (JSON.parse(finalScrub(argsJson)) as Record<string, unknown>)
    : call.arguments;

  return deps.tools.execute(call.name, args);
}

/** Dernier scrub sur les champs textuels de la commande candidate avant envoi. */
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
  // Jamais le contenu brut : on apprend le PATTERN (noms d'outils + statut),
  // pas les données métier.
  const contenu =
    `Tâche «${finalScrub(title).slice(0, 120)}» — ` +
    `outils: ${records.map((r) => `${r.name}:${r.ok ? 'ok' : 'err'}`).join(', ') || 'aucun'} ; ` +
    (command !== undefined ? `bridge: HTTP ${command.httpStatus}` : `pas de commande.`);
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
