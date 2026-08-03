/**
 * Postgres access layer. Narrow seam: all business queries live here,
 * never in the agent loop or the tools. Tests inject an in-memory
 * implementation — no real pg required outside prod.
 *
 * Hard rule: Hermes agents DO NOT MODIFY business data.
 * Allowed writes: `memoire_agents` only (own learning).
 * Every transactional effect goes through the bridge (POST /commands).
 */
import { Pool, type QueryResultRow } from 'pg';

export interface DbQuery<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  rowCount: number;
}

export interface MemoireEntry {
  id: string;
  nature: string;
  contenu: string;
  correlation_id: string | null;
  created_at: string;
  score: number;
}

export interface DbClient {
  query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<DbQuery<T>>;
  searchMemoire(
    departement: string,
    embedding: number[],
    limit: number,
  ): Promise<MemoireEntry[]>;
  insertMemoire(entry: {
    departement: string;
    nature: string;
    contenu: string;
    correlationId?: string | undefined;
    embedding?: number[] | undefined;
    partage?: boolean;
  }): Promise<string | null>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export class PgDbClient implements DbClient {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
  }

  async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<DbQuery<T>> {
    const r = await this.pool.query<T>(sql, params);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  }

  async searchMemoire(
    departement: string,
    embedding: number[],
    limit: number,
  ): Promise<MemoireEntry[]> {
    // pgvector cosine similarity: department memory + shared memory.
    const r = await this.pool.query<MemoireEntry>(
      `SELECT id::text, nature, contenu, correlation_id::text, created_at::text,
              1 - (embedding <=> $1::vector) AS score
       FROM memoire_agents
       WHERE (departement = $2 OR partage = true) AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vectorLiteral(embedding), departement, limit],
    );
    return r.rows;
  }

  async insertMemoire(entry: {
    departement: string;
    nature: string;
    contenu: string;
    correlationId?: string | undefined;
    embedding?: number[] | undefined;
    partage?: boolean;
  }): Promise<string | null> {
    try {
      const r = await this.pool.query<{ id: string }>(
        `INSERT INTO memoire_agents (departement, nature, contenu, correlation_id, embedding, partage)
         VALUES ($1, $2, $3, $4, $5::vector, $6)
         RETURNING id::text`,
        [
          entry.departement,
          entry.nature,
          entry.contenu,
          entry.correlationId ?? null,
          entry.embedding !== undefined ? vectorLiteral(entry.embedding) : null,
          entry.partage ?? false,
        ],
      );
      return r.rows[0]?.id ?? null;
    } catch {
      // Memory is best-effort: its failure must never block the task.
      return null;
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
