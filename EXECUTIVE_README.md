# Executive Guide — Assurance Toto Operations

This document provides the key commands and checkpoints an executive needs to supervise and demonstrate the digital twin.

## Quick Status Check

```bash
# Full stack health (must all be healthy)
./scripts/healthcheck.sh

# Live dashboard
open http://localhost:3100/dashboard
```

*The dashboard reflects live data from Postgres (not cached).* It shows:
- Net result and weekly P&L
- Underwriting ratio (claims / premiums)
- Pending CEO approvals (what awaits your decision)
- Agent activity telemetry
- Macro indicators (rates, inflation, GPR)

## Demo Scenario (Cheat Sheet)

1. Open dashboard → verify net gain is positive.
2. Introduce a synthetic claim above the approval threshold (> €5,000). This triggers enterprise to demand an approval (pending approval ingráfico in the dashboard).
3. In Buzz, a CEO approval is queued → approve via the dashboard action (signed Nostr transaction).
4. The settlement executes automatically; the dashboard shows the change in liability. 
5. Confidence check: review `audit_log` entry with correlation_id — immutable hash chain.

## Governance Switches (CEO Power Tools)

| Action | Endpoint | Safety |
|---|---|---|
| **Approve settlement above €5000** | `POST /approvals/:correlationId/decide` | Requires valid CEO key sig |
| **Reject claim** | `POST /approvals/:corrId/decide` (approve=false) | CEO only |
| **Freeze autonomy** (kill-switch) | `POST /killswitch` | CEO only; blocks all agents immediately |

> ⚠️ For production deployments: always enable `BRIDGE_REQUIRE_SIGNED_COMMANDS=true`. At that point, every sensitive decision requires an explicit Nostr signature — no unsigned impulse possible.

## Access URLs

| System | URL |
|---|---|
| Executive Dashboard | http://localhost:3100/dashboard |
| Workspace Buzz | http://localhost:3002 |
| Bridge API (health) | http://localhost:3100/readyz |
| Gitea / Git server | http://localhost:3000 |

## Verifying Auditability

```bash
# Check that audit chain is intact
curl -s http://localhost:3100/audit/verify

# Inspect a specific incident (correlation ID from dashboard)
docker compose -f docker-compose.lite.yml exec -T postgres psql -U $PG_USER -d $PG_DB -c "SELECT seq, source, action FROM audit_log WHERE correlation_id='<id>';"
```

## Useful Operational Commands

Restart the orchestrator agent:
```bash
docker compose -f docker-compose.lite.yml restart agent-orchestrateur
```

Export sector logs for record keeping:
```bash
docker logs --since="24h" toto-buzz-hermes-bridge > ./logs/bridge-$(date +%F).log
```

## Where to look for risk controls

- **`infra/postgres/init.sql`** — schema with global constraints (kill switch, approval state).
- **`buzz-hermes-bridge/src/policy.ts`** — decision logic: roles, limits, allowed actions.
- All channels and identities centralized in Buzz (signed). Never modify `.env.buzz` manually without approval.