# 15-Minute Demo Guide — Assurance Toto (Assureur Auto Digital Jumeau Numérique)

> Designed for a decision-maker audience : innovation director, claims director, compliance officer, or digital transformation consultant. Data is 100 % synthetic.

**Goal :** In 15 minutes, demonstrate that a 50-employee digital car insurer can be operated profitably by AI agents under CEO supervision with full traceability, mandatory human control, and auditable security.

## Preparation (1 min)

```bash
# All these commands must pass before you start
docker compose -f docker-compose.lite.yml ps --format '{{.Name}} {{.Status}}' | wc -l   # expected: >= 14
curl -s http://localhost:3100/readyz                                                   # expect: {"pg":"ok","buzz":"ok","status":"ready"}
curl -s http://localhost:8081/health                                                  # expect: <empty body, 200 OK)
docker compose -f docker-compose.lite.yml exec -T postgres pg_isready -U toto -d assurance_toto && echo "pg OK"
```
If any service missing: `./scripts/healthcheck.sh`.

## Pitch (15 minutes, what to say and what to click)

### [00:00] Context (30 sec)

> "We built a digital twin of a French car insurer, still modest but realistic in structure, running entirely on open-source software stack, purpose-built for regulatory-dense environments. The **'CEO agent'** supervises a flotilla of business agents. The key design : every decision is traceable, every high-stakes decision is human-approved, and every action is cryptographically signed in an append-only log."

### [00:30] The cockpit (90 sec)

Open `http://localhost:3100/dashboard`. Do these:
1. **Sales pipeline** (top center): explain the funnel synthetics → quotes → underwriting. Quote count comes from Postgres.
2. **Net result** (top left): click on it. It reads directly from `pnl_ledger` (with append-only audit per row). Ratio `claims/premiums` = `0.54`.
3. **Compliance & macro** (top right): the dashboard shows latest macro indicators (Banque de France taux, INSEE inflation) that feed pricing.
4. **Pending approvals** (middle) : show there are currently N pending decisions (`SELECT count(*) FROM approbations WHERE statut='en_attente'`).
5. Click on one pending approval — it's addressed to the CEO. Ask audience to explain why it's there (montant > 5000 €).

> "Everything here is a direct read from Postgres. Buzz doesn't change that. The dashboard is a read-only view, dark, and nobody can publish a command without signing first."

### [02:00] The open workflow — claim

(Follow in `buzz-hermes-bridge/src/http/server.ts` routes if asked for detail, but keep it narrative.)

```
1. Synthetic client registers claim #84 (montant = 6600 €) => above threshold.
2. Claims agent evaluates in LLM (`gemma4:e4b`) but *policy* requires CEO approval for > 5000 €.
3. Agent creates `approbations('en_attente')` (POST /approvals).
4. CEO sees it in the cockpit (you point to the dashboard).
5. CEO approves with a signed Nostr event.
```

In a second terminal (Git Bash or WSL2), run live:
```bash
# Show live: create synthetic claim
docker compose -f docker-compose.lite.yml exec -T postgres psql -U toto -d assurance_toto -c "INSERT INTO sinistres(contrat_id,date_sinistre,description,montant_estime,statut,compliance_bloque) VALUES((SELECT id FROM contrats LIMIT 1),CURRENT_DATE,'DEMO accident responsabilite',7200,'ouvert',false) RETURNING id;"
# Agent asks for approval
C=$(node -e 'console.log(require(\"crypto\").randomUUID())')
node -e '
  const pub=process.env.AGENT_NPUB_SINISTRES;
  fetch(\"http://localhost:3100/approvals\",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({correlation_id:process.env.CID,type:'claim.settlement.approve',claim_id:'NEWCLAIMID',montant_eur:6400,reason:'Materials liability claim requires expert review',requested_by:pub})}).then(r=>r.json()).then(j=>console.log('Approval created (pending) for claim',j.approbation.claim_id,'corr',j.correlation_id))
'
```
> "The CEO dashboard now shows the approval in pending state."

### [04:30] The CEO decision (signed, anti-forge)

Ask the CEO to click **Approve** on the dashboard. First show it handles signatures:
```bash
# Confirm CEO Nostr key is whitelisted:
grep "BRIDGE_CEOPUBKEYS" .env
# Signature check code runs on verifyEvent() from nostr-tools (kind 27235)
```
Then click Approve. Ask:
> "Who could approve this? Only a whitelisted CEO. And even he needs to sign with his/her own key. If somebody tries without a proper signature, the bridge returns **401 auth:ceo_sans_signature**."

### [06:30] The result (laughs from data)

Go back to the dashboard:
- The approval shows as **executed**.
- A claim settlement now in `regle` state.
- `#sinistres-contentieux` channel (show in Buzz if open).

In the DB (evidence):
```bash
docker compose -f docker-compose.lite.yml exec -T postgres psql -U toto -d assurance_toto -c "SELECT id, statut, montant_regle FROM sinistres WHERE id=84 ORDER BY decided_at DESC LIMIT 3;"
docker compose -f docker-compose.lite.yml exec -T postgres psql -U toto -d assurance_toto -c "SELECT action, correlation_id FROM audit_log ORDER BY seq DESC LIMIT 5;"
```

> "Every action is traceable in the audit log with `correlation_id` — this is the chain I've demo'd."

### [08:30] Anti-automation safeguards

Show the kill-switch live:
```bash
curl -s -X POST http://localhost:3100/killswitch -H 'Content-Type: application/json' -d "{\"active\":true,\"decided_by\":\"CEO_NPUB\",\"reason\":\"test kill switch\"}"  # CEO's npub
# Then try any action without the kill -> expect error 'autonomy denied'
curl -s -X POST http://localhost:3100/commands -H 'Content-Type: application/json' -d '{...}'    # it must 4xx
# Then deactivate
curl -s -X POST http://localhost:3100/killswitch -H 'Content-Type: application/json' -d "{\"active\":false,\"decided_by\":\"CEO_NPUB\",\"reason\":\"test_ok\"}"
```

### [10:00] Costs + files footprint

- `docker compose top` or `docker stats --no-stream` to show exact memory usage — around xGB RAM peak, about YGB on disk.
- Show `cat .env | wc -l` (only placeholders there) — no PII, no API keys with monetary cost. The model (`gemma4:e4b`) runs locally on Ollama (nothing paid).

### [11:30] Compliance-friendly design (what we did **not** do)

- Don't say we're ACPR/RGPD-certified. Say: **"compliance-oriented by design"** :
  - Don't store personal data (Faker synthetic)
  - PII is replaced before any LLM
  - Logs audit cannot be tampered with (`prev_hash` chain)
  - Approvals are idempotent (cannot be consumed twice)

### [13:00] Where you can inspect the truth

- The conversation (?), events, approvals, and files are cryptographically signed and preserved in a verified audit log: [Buzz relay's commit chain](https://github.com/block/buzz) (Apache 2.0) — it stores every workflow step and turnover each key material change.
- The code : [leosand/assurance-toto](https://github.com/leosand/assurance-toto) (Apache 2.0)
- You can audit any chain event independently : `GET /audit/verify` verifies the chain hash — tamper with any entry and it breaks.

### [14:45] Closing question

> "What would you most like this platform to automate next in a real project: onboarding, claims (daily, weekly) or compliance workflows? What are your constraints to productize this?"

## Audience questions (frequent)

| # | Question | Response |
|---|---|---|
| Q1 | Can this go to production? | Yes, with Phase 3 hardening (Vault, NATS, allow-lists, external Postgres etc.). Demo is Phase 1 MVP (composition définie prouvée). |
| Q2 | Are we processing real customer data? | No — 100 % synthetic generated by Faker. There's no PII in the system. |
| Q3 | Auto-escalation above €5000? | Mandatory — only the CEO can approve, idempotency guaranteed, signature required. |
| Q4 | PII even anonymized through an LLM? | No — the system anonymizes any PII before sending to the LLM (Presidio), resulting in structured outputs used for decisions but no raw PII leaves the bridge. |

## If anything fails troubleshooting

- `curl http://localhost:3100/readyz` != ready => `docker compose -f docker-compose.lite.yml ps`, if bridge unhealthy => `docker logs toto-buzz-hermes-bridge | tail -20` (watch 'Connection refused' because postgres `5432occupé` — use 5434).
- Buzz /health failing on 8081 => `docker-compose -f docker-compose.lite.yml up -d buzz` again — if SIGTERM/exit due `buzz-relay` startup still hardening, check `docker log toto-buzz | grep 'migration'.
- Kill switch stuck => `docker compose exec postgres psql -U toto -assurance_toto -c "UPDATE kill_switch SET actif=false;"`

> This demo is a technical proof-of-concept with usable architecture — and we engineered it to expect transparency. Assureur investigating it brings livelier requirements. Fact with the audit chain.
