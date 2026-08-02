// E2E test : le CEO signe une décision Nostr (kind 9) réglant un sinistre > seuil.
// Usage: node scripts/run-ceo-e2e.cjs <RELAY_SK_hex64> <CEO_PK_hex64>
const crypto = require('crypto');
const { finalizeEvent, getPublicKey } = require('nostr-tools/pure');
const RELAY_SK = process.argv[2];
const CEO_PK   = process.argv[3];
const BASE     = process.env.BRIDGE_BASE || 'http://localhost:3100';

async function main() {
  const correlation_id = crypto.randomUUID();
  const cmd = {
    type: 'claim.settlement.approve',
    claim_id: '61',
    max_amount_eur: 8200,
    reason: 'Règlement complexe validé par le CEO après analyse (démo E2E)',
    approved_by: CEO_PK,
    requested_at: new Date().toISOString(),
  };
  const sk = Buffer.from(RELAY_SK, 'hex');
  const ev = finalizeEvent({
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', '11111111-1111-1111-1111-111111111111']],
    content: JSON.stringify(cmd),
  }, sk);
  console.log('[e2e] correlation_id:', correlation_id);
  console.log('[e2e] author (relay pubkey):', getPublicKey(sk));
  console.log('[e2e] signature length:', ev.sig.length);

  const r = await fetch(`${BASE}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: cmd, author_pubkey: getPublicKey(sk), event: ev, correlation_id }),
  });
  const j = await r.json();
  console.log('[e2e] HTTP', r.status, 'ok=', j.ok);
  if (j.result) console.log('[e2e] outcome=', j.result.outcome, '| reason=', j.result.reason);
  process.exit(j.ok ? 0 : 1);
}
main().catch((e) => { console.error('[e2e] ERR', e.message); process.exit(1); });
