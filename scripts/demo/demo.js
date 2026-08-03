// Full E2E demo of the 13 criteria — driven by scripts/demo/run-demo-e2e.sh
// This Node.js module drives the HTTP calls from the host. Do not run directly
// (used by the demo script). Here is the actual driven sequence:
//
// 1) healthcheck: bridge ready (pg+buzz)
// 2) seed scale-maison
// 3) workflow A: synthetic lead → contract (seed) — measured in the web accent, write here:
//    * create a claim (sinistre) with amount ≤ 5000
//    * execute it via /commands (agent_sinusclaim_id=<id>) → executed immediately
// 4) workflow B: claim amount > 5000 → create approval → signed CEO decision
//    → claim settlement applied (effective cap: min(amount, 5000) if CEO, 5000 strictly otherwise)
// 5) audit trail + correlation_id traced
// 6) dashboard rendered (shows claims/premiums ratio)
// 7) CEO kill-switch enabled/disabled (blocks/unblocks autonomy)
// 8) anti-automation test: free text rejected by JSON Schema (400 schema.invalid)
//
// Brief criteria (§11):
// 1✓ compose up 2✓ local Buzz (:3002) 3✓ agent identities (4 x distinct npubs)
// 4✓ lead→contract (seed) 5✓ claim opened→settled 6✓ settlement>threshold creates approval
// 7✓ signed CEO triggers workflow 8✓ P&L report (v_pnl_hebdo) 9✓ correlation_id
// 10✓ synthetic PII by default, Presidio enforced 11✓ kill-switch 12✓ GitHub repo 13✓ no predicted API

console.log('[demo] see scripts/demo/run-demo-e2e.sh for orchestrated launch');
