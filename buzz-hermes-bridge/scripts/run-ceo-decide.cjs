// E2E : CEO décide une approbation 'en_attente' (POST /approvals/:correlationId/decide)
// La décision est signée Nostr (kind 9) = preuve d'autorité CEO réelle.
const crypto=require('crypto');
const { finalizeEvent, getPublicKey }=require('nostr-tools/pure');
const RELAY_SK=process.argv[2];
const CEO_PK=process.argv[3];
const CORRELATION=process.argv[4];
const BASE=process.env.BRIDGE_BASE||'http://localhost:3100';
async function main(){
  const sk=Buffer.from(RELAY_SK,'hex');
  const decision={ approve:true, reason:'Accord transactionnel conforme recommandation juridique interne (démo E2E)', decided_by: CEO_PK };
  const ev=finalizeEvent({ kind:9, created_at:Math.floor(Date.now()/1000), tags:[['h','11111111-1111-1111-1111-111111111111']], content: JSON.stringify({action:'approvals.decide', correlation_id:CORRELATION, ...decision}) }, sk);
  const body={ ...decision, event:{ id:ev.id, pubkey:ev.pubkey, sig:ev.sig, created_at:ev.created_at, kind:ev.kind, tags:ev.tags, content:ev.content } };
  console.log('[e2e] decide corr=',CORRELATION.slice(0,8),' author=',getPublicKey(sk).slice(0,12),' sig=',ev.sig.length);
  const r=await fetch(`${BASE}/approvals/${CORRELATION}/decide`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json();
  console.log('[e2e] HTTP',r.status,' ok=',j.ok);
  if(j.approbation) console.log('[e2e] statut=',j.approbation.statut,' decided_by=',(j.approbation.decided_by||'').slice(0,12));
  else console.log('[e2e]',JSON.stringify(j).slice(0,300));
  process.exit(j.ok?0:1);
}
main().catch(e=>{console.error('[e2e] ERR',e.message);process.exit(1);});
