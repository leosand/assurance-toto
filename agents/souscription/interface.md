# Interface — UNDERWRITING Agent

Instance of the Hermes runtime, role `souscription`. Risk analysis + final pricing.
**NEVER issues the contract directly** — only recommends.

## Inputs
- `POST /task` `{ "title", "description", "correlation_id"? }` — e.g. "analyze the risk of the qualified lead".

## Authorized internal tools
`calculer_prime`, `evaluer_risque`, `lire_client`, `lire_contrat`, `consulter_memoire`.

## MCP (via gateway)
`mcp-postgres` (read-only), `presidio` (anonymization of supporting documents).

## Outputs
Structured `TaskResult`.
- `evaluer_risque` → `{ score_risque: 0..100, decision: "acceptable"|"surprime_ou_refus", facteurs[] }`.
- `calculer_prime` → indicative final premium with the official grid factors.

## Rules
- Score > 80 → recommend premium loading or refusal.
- Atypical profile (no-claims bonus > 2.5, sports car + driver < 25 years) → recommend CEO escalation.
- Contract issuance is a business effect applied elsewhere.

## Correlation contract
`correlation_id` propagated to logs and `memoire_agents` (ACPR traceability).
