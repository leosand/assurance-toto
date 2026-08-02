const { finalizeEvent, getPublicKey } = require('nostr-tools/pure');
const RELAY_SK=process.argv[2], CEO_PK=process.argv[3], C3=process.argv[4];
const sk = Buffer.from(RELAY_SK, 'hex');
const cmd = { type:'claim.settlement.approve', claim_id:'61', max_amount_eur:8200, reason:'Règlement complexe validé par le CEO après analyse (démo)', approved_by: CEO_PK, requested_at:'2026-08-02T15:40:00Z' };
const ev = finalizeEvent({ kind:9, created_at: Math.floor(Date.now()/1000), tags:[['h','11111111-1111-1111-1111-111111111111']], content: JSON.stringify(cmd) }, sk);
process.stdout.write(JSON.stringify({ correlation_id: C3, author_pubkey: getPublicKey(sk), command: cmd, event: ev }));
