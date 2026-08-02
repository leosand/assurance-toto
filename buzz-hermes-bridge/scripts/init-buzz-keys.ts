#!/usr/bin/env node
/**
 * Génère les keypairs Nostr CEO + 8 agents dans `.env.buzz` (gitignored, chmod 600).
 * NE COMMITTE JAMAIS ce fichier. Voir docs/keychain.md pour la sauvegarde NIP-49.
 */
import { writeFileSync, existsSync, chmodSync } from 'node:fs';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { npubEncode, nsecEncode } from 'nostr-tools/nip19';

const ROLES = [
  'CEO',
  'agent-sales',
  'agent-souscription',
  'agent-sinistres',
  'agent-finance',
  'agent-conformite',
  'agent-hermes-orchestrator',
  'agent-ops',
  'agent-support',
] as const;

const OUT = new URL('../.env.buzz', import.meta.url);

if (existsSync(OUT)) {
  console.error(`[init-buzz-keys] ${OUT.pathname} existe déjà — supprime-le d\'abord si tu veux regénérer (clés perdues sinon).`);
  process.exit(1);
}

const lines: string[] = ['# GÉNÉRÉ PAR scripts/init-buzz-keys.ts — NE PAS COMMITTER (chmod 600)'];
const mapping: Record<string, { npub: string; nsec: string }> = {};

for (const role of ROLES) {
  const sk = generateSecretKey();
  const pkHex = getPublicKey(sk);
  lines.push(`${role.toUpperCase().replace(/-/g, '_')}_NSEC=${nsecEncode(sk)}`);
  lines.push(`${role.toUpperCase().replace(/-/g, '_')}_NPUB=${npubEncode(pkHex)}`);
  mapping[role] = { npub: npubEncode(pkHex), nsec: nsecEncode(sk) };
}

writeFileSync(OUT, lines.join('\n') + '\n', { mode: 0o600 });
try {
  chmodSync(OUT, 0o600);
} catch {
  // sur Windows le chmod est un no-op best-effort
}

console.log('[init-buzz-keys] mapping npub (à renseigner dans BRIDGE_CEOPUBKEYS + RBAC) :');
for (const [role, k] of Object.entries(mapping)) {
  console.log(`  ${role.padEnd(24)} ${k.npub}`);
}
console.log(`\n[init-buzz-keys] écrit ${OUT} (gitignored, mode 600). JAMAIS dans git.`);
console.log('[init-buzz-keys] Backup : chiffre ces nsec avec NIP-49 (passphrase) — voir docs/keychain.md');
