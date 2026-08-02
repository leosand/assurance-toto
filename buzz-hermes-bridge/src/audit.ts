/**
 * Audit append-only hash-chained: sha256(prev_hash + canonicalJson(payload)).
 * Canonique = clés triées, déterministe, JSON.stringify ordinaire.
 */
import { createHash } from 'node:crypto';
import type { Repository, Tx } from './db/repository.js';
import { stableStringify } from './commands/schemas.js';

export interface AuditEntry {
  correlationId: string;
  source: string;
  action: string;
  payload: unknown;
}

export function computeAuditHash(prevHash: string, payload: unknown): string {
  const canonical = stableStringify(payload ?? {});
  return createHash('sha256').update(prevHash + canonical, 'utf8').digest('hex');
}

/** Append d'un entry ; on suppose enqueue sérialisé (verrou app-level). */
export async function appendAudit(repo: Repository, entry: AuditEntry): Promise<{ hash: string; prevHash: string }> {
  const prevHash = await readLastHash(repo);
  const hash = computeAuditHash(prevHash, entry.payload);
  await repo.appendAudit(entry.correlationId, entry.source, entry.action, entry.payload ?? {}, hash, prevHash);
  return { hash, prevHash };
}

async function readLastHash(repo: Repository): Promise<string> {
  // Le repo expose un accès "dernier hash" via une requête dédiée côté pg.
  // En mémoire, le repo de test peut le fournir, mais on passe par l'API commune :
  // on lit la dernière entrée via inTransaction (aucune écriture) pour rester agnostique.
  const prev: string[] = [];
  await repo.inTransaction(async (tx: Tx) => {
    const r = await tx.query<{ hash: string }>(
      "SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1",
      [],
    );
    if (r.rows[0] !== undefined) prev.push(String(r.rows[0].hash));
    return undefined;
  });
  return prev[0] ?? '';
}

/** Vérification hors-ligne : re-chaîne complète. */
export async function verifyAuditChain(repo: Repository): Promise<{ ok: boolean; brokenAt?: number; reason?: string }> {
  const rows: { seq: number; prev_hash: string | null; hash: string; payload: string }[] = [];
  await repo.inTransaction(async (tx: Tx) => {
    const r = await tx.query<{ seq: string; prev_hash: string | null; hash: string; payload: unknown }>(
      'SELECT seq::text AS seq, prev_hash, hash, payload::text AS payload FROM audit_log ORDER BY seq ASC',
      [],
    );
    for (const row of r.rows) {
      rows.push({
        seq: Number(row.seq),
        prev_hash: row.prev_hash,
        hash: row.hash,
        payload: typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload),
      });
    }
    return undefined;
  });

  let prev = '';
  for (const row of rows) {
    const expectedPrev = prev;
    const parsed = parseJson(row.payload);
    const expectedHash = computeAuditHash(expectedPrev, parsed);
    if ((row.prev_hash ?? '') !== expectedPrev) {
      return { ok: false, brokenAt: row.seq, reason: 'prev_hash mismatch' };
    }
    if (row.hash !== expectedHash) {
      return { ok: false, brokenAt: row.seq, reason: 'hash mismatch (payload altéré ?)' };
    }
    prev = row.hash;
  }
  return { ok: true };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
