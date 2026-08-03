# Interface — ORCHESTRATOR Agent

Instance of the Hermes runtime (`agents/_runtime`), role `orchestrateur`.
Coordinates the other agents; produces **no direct business effect**.

## Inputs
- `POST /task` `{ "title": string, "description": string, "correlation_id"?: uuid }`
- Autonomous mode (optional): `AUTONOMY_INTERVAL_SECONDS > 0` → the agent proposes tasks periodically (gated by kill-switch).
- `GET /healthz`, `GET /readyz` (pg + ollama).

## Authorized internal tools (mcp-allowlist.json)
`lire_sinistre`, `lire_client`, `lire_contrat`, `calculer_prime`, `evaluer_risque`, `qualifier_lead`, `recommander_reglement`, `requeter_pnl`, `consulter_memoire` — all **read-only** except `recommander_reglement`, which only produces a candidate command.

## MCP (via gateway)
`mcp-postgres` (read-only), `bridge` (POST /commands).

## Outputs
`TaskResult` `{ correlation_id, agent, toolCalls[], command?, fallbackText?, summary, stoppedByKillSwitch }`.
- `toolCalls[]` = log of executed tools (name, ok, result).
- `command` = result of `POST {BRIDGE_URL}/commands` if a recommendation was issued.

## Correlation contract
- `correlation_id` provided > otherwise a fresh UUID generated at start.
- Propagated: pino logs, bridge POST, `memoire_agents` entry.
- Makes it possible to follow the full cycle `task → tool → bridge command → approval`.

## Security
Kill-switch checked before each autonomous action and before any bridge POST. Deny-by-default allowlist.
