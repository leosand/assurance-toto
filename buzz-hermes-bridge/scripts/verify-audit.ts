#!/usr/bin/env node
/**
 * Vérifie la chaîne d'audit (scripts/verify-audit.ts).
 * Usage: tsx scripts/verify-audit.ts  (requiert DATABASE_URL)
 */
import { loadConfig } from '../src/config.js';
import { PgRepository } from '../src/db/repository.js';
import { verifyAuditChain } from '../src/audit.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const repo = new PgRepository(cfg);
  try {
    const res = await verifyAuditChain(repo);
    if (res.ok) {
      console.log('[verify-audit] chaîne intègre ✔');
    } else {
      console.error(`[verify-audit] RUPTURE à seq=${res.brokenAt ?? '?'} (${res.reason ?? 'inconnu'})`);
      process.exitCode = 2;
    }
  } finally {
    await repo.close();
  }
}

void main();
