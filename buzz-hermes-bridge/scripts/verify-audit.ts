#!/usr/bin/env node
/**
 * Verifies the audit chain (scripts/verify-audit.ts).
 * Usage: tsx scripts/verify-audit.ts  (requires DATABASE_URL)
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
      console.log('[verify-audit] chain intact ✔');
    } else {
      console.error(`[verify-audit] CHAIN BREAK at seq=${res.brokenAt ?? '?'} (${res.reason ?? 'unknown'})`);
      process.exitCode = 2;
    }
  } finally {
    await repo.close();
  }
}

void main();
