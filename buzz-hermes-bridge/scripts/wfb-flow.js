// Workflow B E2E : agent demande → CEO approuve → règlement exécuté (§6B)
const { finalizeEvent, getPublicKey } = require('nostr-tools/pure');
const crypto = require('crypto');
const [RELAY_SK, CEO_PK, SIN_PK] = process.argv.slice(2);
const BASE = 'http://localhost:3100';

async function post(path, body) {
  const r = await fetch(BASE+path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}

async function main() {
  const CID = crypto.randomUUID();
  const appr = await post('/approvals',{correlation_id:CID,type:'claim.settlement.approve',claim_id:'66',montant_eur:6600,reason:'Collision vehicule/tiers — expertise externe requise',requested_by:SIN_PK});
  console.log('[1] approve_create ok=',appr.ok,'statut=',appr.approbation?.statut);

  const sk=Buffer.from(RELAY_SK,'hex');
  const core={approve:true,reason:'Accord transactionnel validé par le CEO (démo E2E)'};
  const ev=finalizeEvent({kind:9,created_at:Math.floor(Date.now()/1000),tags:[['h','11111111-1111-1111-1111-111111111111']],content:JSON.stringify({action:'approvals.decide',correlation_id:CID,...core})},sk);
  const body={...core,decided_by:CEO_PK,event:{id:ev.id,pubkey:ev.pubkey,sig:ev.sig,created_at:ev.created_at,kind:ev.kind,tags:ev.tags,content:ev.content}};
  const dec=await post(`/approvals/${CID}/decide`,body);
  console.log('[2] decide ok=',dec.ok,' statut=',dec.approbation?.statut,' execution=',dec.approbation?.execution);
  process.exit(dec.ok?0:1);
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
