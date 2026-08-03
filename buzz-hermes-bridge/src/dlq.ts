/**
 * Dead-letter queue: non-retryable commands or commands exhausting attempts.
 * Transport = Redis stream `dlq:commands` (or in-memory in tests without Redis).
 */
import type { Redis } from 'ioredis';

export interface DlqEntry {
  commandId: string;
  correlationId: string;
  reason: string;
  payload: unknown;
  attempts: number;
  enqueuedAt: string;
}

export interface DlqSink {
  enqueue(entry: Omit<DlqEntry, 'enqueuedAt'>): Promise<void>;
  list(limit?: number): Promise<DlqEntry[]>;
  close(): Promise<void>;
}

// Redis Streams (XADD) — behavior depends on ioredis.
export class RedisDlq implements DlqSink {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async enqueue(entry: Omit<DlqEntry, 'enqueuedAt'>): Promise<void> {
    await this.redis.xadd(
      'dlq:commands',
      '*',
      'commandId',
      entry.commandId,
      'correlationId',
      entry.correlationId,
      'reason',
      entry.reason,
      'payload',
      JSON.stringify(entry.payload ?? {}),
      'attempts',
      String(entry.attempts),
      'enqueuedAt',
      new Date().toISOString(),
    );
  }

  async list(limit = 50): Promise<DlqEntry[]> {
    const rows = await this.redis.xrevrange('dlq:commands', '+', '-', 'COUNT', limit);
    return rows.map(([, fields]) => {
      const f = fieldsToObject(fields);
      return {
        commandId: f['commandId'] ?? '',
        correlationId: f['correlationId'] ?? '',
        reason: f['reason'] ?? '',
        payload: parseJsonSafe(f['payload'] ?? '{}'),
        attempts: Number(f['attempts'] ?? '0'),
        enqueuedAt: f['enqueuedAt'] ?? '',
      };
    });
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}

// In-memory (tests / demo without Redis).
export class MemoryDlq implements DlqSink {
  private readonly entries: DlqEntry[] = [];

  async enqueue(entry: Omit<DlqEntry, 'enqueuedAt'>): Promise<void> {
    this.entries.push({ ...entry, enqueuedAt: new Date().toISOString() });
  }

  async list(limit = 50): Promise<DlqEntry[]> {
    return this.entries.slice(-limit).reverse();
  }

  async close(): Promise<void> {
    this.entries.length = 0;
  }
}

function fieldsToObject(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const k = fields[i];
    const v = fields[i + 1];
    if (k !== undefined && v !== undefined) out[k] = v;
  }
  return out;
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
