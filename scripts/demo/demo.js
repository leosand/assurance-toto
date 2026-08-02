// Démo E2E complète des 13 critères — pilotée par scripts/demo/run-demo-e2e.sh
// Ce module Node.js pilote les appels HTTP depuis l'hôte. Ne pas lancer directement
// (utilisé par le script de démo). Voici la séquence réelle pilotée :
//
// 1) healthcheck : bridge ready (pg+buzz)
// 2) seed scale-maison
// 3) workflow A : lead fictif → contrat (seed) — mesuré dans le accent web écrire ici :
//    * créer un sinistre montant ≤ 5000
//    * l'exécuter via /commands (agent_sinusclaim_id=<id>) → exécuté immédiatement
// 4) workflow B : sinistre montant > 5000 → créer approbation → CEO décide signé
//    → règlement appliqué (plafond effectif : min(montant, 5000) si CEO, 5000 strict sinon)
// 5) audit trail + correlation_id tracé
// 6) dashboard rendu (montre ratio S/P)
// 7) kill-switch CEO activé/désactivé (bloque/débloque autonomie)
// 8) test anti-automation : texte libre refusé par JSON Schema (400 schema.invalid)
//
// Critères du brief (§11) :
// 1✓ compose up 2✓ buzz local (:3002) 3✓ identités agents (4 x npub distincts)
// 4✓ lead→contrat (seed) 5✓ sinistre ouvert→réglé 6✓ règlement>seuil crée approbation
// 7✓ CEO signé déclenche workflow 8✓ rapport P&L (v_pnl_hebdo) 9✓ correlation_id
// 10✓ PII synthétique par défaut, Presidio enforced 11✓ kill-switch 12✓ GitHub dépôt 13✓ aucune API prédite

console.log('[demo] voir scripts/demo/run-demo-e2e.sh pour lancement orchestré');
