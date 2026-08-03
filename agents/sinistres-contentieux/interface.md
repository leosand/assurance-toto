# Interface — CLAIMS & LITIGATION Agent

Instance of the Hermes runtime, role `sinistres-contentieux`. Declaration, estimation, negotiation, **settlement recommendation**.

## Inputs
- `POST /task` `{ "title", "description", "correlation_id"? }` — e.g. "process the declaration of claim 128".

## Authorized internal tools
`lire_sinistre`, `lire_client`, `lire_contrat`, `recommander_reglement`, `consulter_memoire`.

## MCP (via gateway)
`mcp-postgres` (read-only), `mailhog` (simulated correspondence with third parties), `presidio` (anonymization of third-party data).

## Outputs
Structured `TaskResult`.
- `lire_sinistre/client/contrat` → read-only data.
- `recommander_reglement` → produces a **candidate command** `claim.settlement.approve`
  `{ type, claim_id, max_amount_eur, reason, approved_by, requested_at }` which is POSTed to the bridge
  (`POST {BRIDGE_URL}/commands` `{ command, author_pubkey, correlation_id }`).
  The bridge validates (ajv schema), applies the policy (kill-switch, `CLAIM_SETTLEMENT_THRESHOLD_EUR` threshold),
  creates a CEO approval if necessary, INSERTS into `pnl_ledger` and updates `sinistres` —
  **the agent never writes these tables directly**.

## Escalation
Amount > `HERMES_ESCALATION_THRESHOLD_EUR` (default €5,000) → `escalation_ceo: true` in the recommendation; no finalization without CEO approval via the bridge.

## Correlation contract
Fresh or provided `correlation_id`; propagated to the bridge POST (bridge-side idempotency) and to `memoire_agents`.

## Confidentiality
Third-party personal data is systematically anonymized before any processing or storage.
