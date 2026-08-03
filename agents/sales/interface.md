# Interface — SALES Agent

Instance of the Hermes runtime, role `sales`. Prospecting, lead qualification, indicative car quotes.
**NEVER recommends a settlement** (out of scope).

## Inputs
- `POST /task` `{ "title", "description", "correlation_id"? }` — e.g. "qualify lead #42", "compute a quote".
- `GET /healthz`, `GET /readyz`.

## Authorized internal tools
`qualifier_lead`, `calculer_prime`, `lire_client`, `lire_contrat`, `consulter_memoire`.

## MCP (via gateway)
`mcp-postgres` (read-only), `searxng` (web search), `mailhog` (inbound emails).

## Outputs
Structured `TaskResult`. A `qualifier_lead` call returns `{ score: 0..1, decision: "qualifie"|"perdu" }`.
`calculer_prime` returns `{ prime_annuelle_eur, base_eur, facteurs }` (indicative — the final rate falls under Underwriting).

## Correlation contract
`correlation_id` propagated to logs and `memoire_agents`. No business writes.

## Confidentiality
All PII (email/phone from prospecting) is anonymized BEFORE LLM processing.
