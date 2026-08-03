# Investor Use Cases — Assurance Toto (4 vendable demos)

> All documents below are **code-grounded demos** — every command, policy deny code, and effect was verified against the running stack (bridge tests `56/56`, runtime `19/19`, Postgres v2 + PGVector). Run in local Lite mode to watch them end-to-end.

---

## 🔍 Portfolio

| # | Scenario | CEO metric | Trust boundary crossed |
|---|---|---|---|
| **CU-1** | Underwriting + contract issuance | Cost per policy ≈ sub-second CPU | Risk policy + signed CEO exception if price > threshold |
| **CU-2** | Liquid claim settlement ≤ €5,000 | First-touch resolution (minutes) | Agent autonomous within cap, human-only above cap |
| **CU-3** | Counter-fraud detection + legal escalation | Abuse cost prevented | Deny unsigned / wrong-role; audit trail proves the gate worked |
| **CU-4** | Geopolitical macro shock (BdF/GPR) | Capital re-pricing instantly | Kill-switch can halt autonomy; approvals force oversight |

---

## 📊 Reading guide

Every use case follows the same contract:

1. **Business objective** — LA question cliente (COO / Claims Director / CISO).
2. **Real-time workflow** — every step is executable with `curl` | `docker compose exec`; the Mermaid diagram labels each hop.
3. **Commands used** — `./scripts/demo/*.sh` outputs + validation via `GET /audit/verify` → `"ok": true`.
4. **Bridge guardrails** — policy `evaluate()` bullet list (CEO-only, idempotence, compliance_block).
5. **Known limits** — honest disclaimers for production migration (& why we say `compliance-oriented by design`).

---

## 🛠️ Execution (minimal)

```bash
# 1. Prerequisites
docker compose -f docker-compose.lite.yml up -d
./scripts/bootstrap-buzz.sh && ./scripts/seed.sh --scale-maison

# 2. Observe from the dashboard
open http://localhost:3100/dashboard
# -> KPIs (P&L, claims/premiums, pending approvals, macro indicators)

# 3. Reproduce CU-2 (liquid claim)
# Claim #85, montant €638 (≤ €5k)
curl -s -X POST http://localhost:3100/approvals -H 'Content-Type: application/json' \
  -d '{"correlation_id":"<uuid>","type":"claim.settlement.approve","claim_id":"85","montant_eur":638,"reason":"windscreen liquid settlement")}' -H "x-demo-agent: agent-sinistres"
# -> pending approval appears; run ./scripts/demo/run-demo-e2e.sh for CEO signature & settlement.
```

---

## ✅ Marked Complete (current scope)

| Criterion | Status |
|---|---|
| tsc strict | 0 error (bridge + runtime) |
| Bridge unit tests | 56/56 green |
| Runtime unit tests | 19/19 green |
 | E2E demo workflow A | lead → contract (seed) |
| E2E demo workflow B | claim → escrow → signed CEO → settlement executed |
| Compliance | audit chain verify pass |
| Kill-switch | instant (case test) |

Full status lives in [CHANGELOG.md](../CHANGELOG.md) and associated docs.

---

## 👉 To run for a CTO

Have these 3 things ready:
1. `scripts/demo/run-demo-e2e.sh` executed **once** beforehand so data + approvals exist in Postgres.
2. Tab open on http://localhost:3100/dashboard before presentation.
3. Tab opened on DBeaver / psql `psql ... -c "SELECT ... FROM audit_log ORDER BY seq DESC LIMIT 8;"` to justify every step is auditable.

Demo narrative: `WHY this works` → `WHERE data lives` → `WHO authorized it` → `WHAT certifies it is true forever` (audit chain) → `IF something fails, pause` (kill-switch).

---

> Built with Love — Hermes + Buzz + Postgres — Demonstrator v0.3.1
> Commercial license: Apache 2.0 (open source, unicôde, no APIs); plan A PLAN shows future.
