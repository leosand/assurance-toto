/**
 * Client Ollama local — zéro API payante.
 *
 * `chat` : POST /api/chat { model, messages, tools?, stream:false }.
 * Le modèle (gemma4:e4b) émet `message.tool_calls[{function:{name, arguments}}]`
 * où `arguments` est un OBJET JSON. Un appel sans tool_calls est un fallback
 * structuré (texte libre), jamais un crash.
 *
 * `embed` : POST /api/embeddings { model, prompt } → number[768].
 *
 * Timeout + 1 retry. Les erreurs ne contiennent JAMAIS de contenu utilisateur (PII).
 */
import type { Logger } from 'pino';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  toolCalls: ToolCall[];
  /** Fallback structuré : le modèle n'a pas appelé d'outil et a répondu en texte. */
  text: string;
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaClientOptions {
  host: string;
  model: string;
  embedModel: string;
  logger: Logger;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export interface OllamaClient {
  chat(messages: ChatMessage[], tools: OllamaTool[]): Promise<ChatResponse>;
  embed(text: string): Promise<number[] | null>;
}

interface OllamaChatWire {
  message?: {
    content?: string;
    tool_calls?: Array<{
      function?: { name?: unknown; arguments?: unknown };
    }>;
  };
}

interface OllamaEmbedWire {
  embedding?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson<T>(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const resp = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    throw new OllamaError(`ollama HTTP ${resp.status}`, undefined);
  }
  return (await resp.json()) as T;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  label: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ action: `${label}.retry` }, 'appel ollama échoué — 1 retry');
    try {
      await sleep(500);
      return await fn();
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      // Jamais de contenu utilisateur dans le message d'erreur.
      throw new OllamaError(`ollama ${label} en échec après retry : ${msg}`, err2);
    }
  }
}

export function createOllamaClient(opts: OllamaClientOptions): OllamaClient {
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const host = opts.host.replace(/\/$/, '');

  return {
    async chat(messages: ChatMessage[], tools: OllamaTool[]): Promise<ChatResponse> {
      const payload: Record<string, unknown> = {
        model: opts.model,
        messages,
        stream: false,
      };
      if (tools.length > 0) payload['tools'] = tools;

      const wire = await withRetry(
        () => postJson<OllamaChatWire>(fetchFn, `${host}/api/chat`, payload, timeoutMs),
        opts.logger,
        'chat',
      );

      const msg = wire.message ?? {};
      const rawCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const toolCalls: ToolCall[] = [];
      rawCalls.forEach((call, idx) => {
        const fn = call.function;
        const name = fn?.name;
        if (typeof name !== 'string' || name.length === 0) return;
        // `arguments` DOIT être un objet JSON (fallback gracieux sinon).
        let args: Record<string, unknown> = {};
        if (
          typeof fn?.arguments === 'object' &&
          fn.arguments !== null &&
          !Array.isArray(fn.arguments)
        ) {
          args = fn.arguments as Record<string, unknown>;
        } else if (typeof fn?.arguments === 'string') {
          try {
            const parsed: unknown = JSON.parse(fn.arguments);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            // arguments illisibles → objet vide, l'outil validera/schèmera.
          }
        }
        toolCalls.push({ id: `call-${idx}`, name, arguments: args });
      });

      return {
        toolCalls,
        text: typeof msg.content === 'string' ? msg.content : '',
      };
    },

    /**
     * Embeddings (768 dims attendues avec nomic-embed-text).
     * Best-effort : échec/embedding absent → null (jamais de throw vers la boucle).
     */
    async embed(text: string): Promise<number[] | null> {
      try {
        const wire = await postJson<OllamaEmbedWire>(
          fetchFn,
          `${host}/api/embeddings`,
          { model: opts.embedModel, prompt: text },
          timeoutMs,
        );
        const emb = wire.embedding;
        if (!Array.isArray(emb) || emb.some((v) => typeof v !== 'number')) {
          opts.logger.warn({ action: 'embed.invalid' }, 'embedding invalide retourné par ollama');
          return null;
        }
        return emb as number[];
      } catch {
        opts.logger.warn({ action: 'embed.unavailable' }, 'embeddings ollama injoignables');
        return null;
      }
    },
  };
}

export class OllamaError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'OllamaError';
  }
}
