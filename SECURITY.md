# Security — Assurance Toto (Compliance-oriented by design)

## Official positioning (mandatory in every client demo)

> **This is NOT an ACPR/RGPD-certified production system.** It is a **technical and commercial demo** — built on production-transposable principles, hosted locally, on 100% synthetic data — **sandbox ready**, never **real data**. **Not certified ACPR/RGPD.**

## 1. Threat model

| Threat | Source | Impact | Mitigation implemented |
|---|---|---|---|
| **Unauthorized execution** of a sensitive command (claim settlement, kill-switch, pricing modification) | Injection/prompt-injection from a Buzz conversation, or a non-whitelisted npub, or a stray Hermes cycle | Financial loss, fraud, forced processing chain | **Bridge policy enforcement**: RBAC + ABAC, hardened amount thresholds, verified Nostr signature + strict schema, idempotency (`commandes_consommees` UNIQUE) |
| **Uncontrolled autonomy** of agents | Skill loop without supervision, brute force on `POST /commands` | Irreversible bad decisions (> threshold settlements) | **CEO kill-switch**: single row `kill_switch.actif=true`, stops all execution before any autonomous action; `BRIDGE_REQUIRE_SIGNED_COMMANDS=true` in PROD (CEO signs every decision); `HERMES_ESCALATION_THRESHOLD_EUR` default 5,000 € (human approval required above) |
| **PII in prompts/logs** | Personal details sent to the LLM or Buzz | Personal data breach (identifiers, clarity on an RGPD transaction) | **Presidio**: before every LLM/prompt/Buzz published message; regex fallback if down; `logger` suppresses sensitive fields |
| **Compromised Nostr keys** | Private key leak (nsec) in logs/git | Identity spoofing, falsification/audit-log tampering | `.env.buzz` (chmod 600, gitignored), easy rotation via `bootstrap-buzz.sh`, `relay signature validation`; no private key in the Docker image; `git filter-repo` recommended on a real breach |
| **Unstructured command generation** | Prompt injection from free Buzz text | Uncontrolled execution | **Strict JSON Schema** (`additionalProperties:false`) — free text is **never** executed (rejected at the deepest level) |
| **Replay attack** | Same command sent repeatedly | Double settlement, double P&L deduction | `commandes_consommees` UNIQUE (content hash) — re-send locks `idempotent → 200 consumed` |
| **Man-in-the-middle Buzz↔Bridge** | Modification during command/business-effect dispatch | Falsified actions | Buzz: NIP-98 Nostr header `<base64-signed>` (sender identity cryptographically validated); bridge verifies hours + Nostr Authorization header |

## 2. Applied structured security

### Authentication & Authorization
- **Nostr identities** (npub/nsec Schnorr) 1 per human operator + 1 per level-1 agent (CEO + 4 MVP agents in lite mode): `buzz-admin add-member` per pubkey => relayization (ACL role member / owner / bot).
- **CEO = whitelisted** (`BRIDGE_CEOPUBKEYS`) — `POST /approvals/.../decide` and `POST /killswitch` **explicitly require** (signed CEO if `BRIDGE_REQUIRE_SIGNED_COMMANDS=true`, otherwise whitelisted npub not prompt-injectable in public messages).
- **Autonomous agents** = dedicated npubs (`BRIDGE_ALLOWED_UNSIGNED_ROLES`): **unsigned = demo local organization mode** (PROD = disabled), every action `authorize()`.
- **Role enforcement** enforced by `policy.evaluate()` autonomous priority! The bridge refuses to deliberate without legalizing the decisions.

### Confidentiality (PII/LLM)
- **Every text entity to the LLM** goes through `Presidio /analyze + /anonymize` — regex fallback if Presidio down; never raw PII in LLM input.
- Structured `pino` logs: no password/secret/PII; keys = `***present***`
- MCP tools whitelisted **per department** (corresponding visible Hermes roles: defendants). SearXNG / MailHog isolated net-external.

### Integrity & Audit
**Hash-chain append-only audit**:
- each `audit_log` entry contains: `seq` unique, `correlation_id`, `payload` (JSONB), `prev_hash` = SHA-256(prev_hash + payload); `prev_hash` chain trigger
- `verifyAuditChain()` mode exposes altered (verify function + DB)
- `prev_hash=0` initial DB acceptance; effective root = `first written entry on new gid` initialize associated cluster
- `GET /audit/verify` exposes verification result + seq_max

**Atomic idempotency**: `commandes_consommees` UNIQUE + `markConsumed()` (audit declined when consumed).

**Append-only P&L**: `pnl_ledger` UPDATE/DELETE trigger rejected.

### Mandatory Human Control
- Emergency kill-switch: `POST /killswitch` (CEO signed) → `kill_switch.actif=true` → **all autonomous execution refused** except `killswitch.deactivate` (CEO signed).
- Full `claim.settlement.approve` cycle suspended by kill-switch: as soon as active = `killswitch.actif`: execution blocked
- +underwriting pricing exception reserved for the CEO
- **Timing**: `started+<TTL>` = `approved`/`auto-expired` on overrun (`APPROVAL_TTL_MINUTES` default 7 days).

### Secret management

- **Prohibition**: private keys in git, changelog, logs, docker images
- **Practice**: storage in `.env.buzz` (chmod 600) + files `.env` and `BUZZ_RELAY_PRIVATE_KEY`, `BUZZ_RELAY_DIGEST`, `BUZZ_KEYS` temporary lineage then rotation on compromise
- **Optional Vault**: Infiscial/Vault (Phase 3)

### Docker network segmentation
| Network | Content | Access |
|---|---|---|
| net-core | Postgres, Redis | Bridge + LLM prescriptive |
| net-dept | Bridge, Gitea, Hermes agents | Internal API |
| net-external | MailHog, SearXNG, Presidio | +controlled exposure of business agents to the web |

## 3. Anonymization (by default, synthetic data)

- Faker `fr_FR` (custom seeds = `42`)
- Every client datum is name, email, phone, address, date_naissance, immatriculation… real numbers none — synthetic
- Buzz (cockpit) = **pipeline supporting messages**, not a firm data source
- Product **explicitly** reserved for `"DEMO"` (data inventory + potentially invited clients)

## 4. Incident procedure (if compromise detected)

- **CEO kill-switch**: `POST /killswitch {active:true}` CEO signature (`POST /killswitch` bridge direct bypass if needed)
- **Audit**: `GET /audit/verify` = alteration detected ⇒ `first corrupted entry` accused
- **Rotation**: `scripts/init-agents-env.sh` + composite stack restart; new keys nothing follows
- **Contain**: journalize `audit_log` + `commandes_consommees` via tar backup (PG schema) then Buzz npub rotation: ≈ 1 repo commits + add-member **only** manual
- **Review**: cycle analysis (pino logs + timeline dashboard `correlation_id` abaxial)

## 5. Explicit validation (provided for client trust)

- **13 brief §11 requirements accepted** (cf. `tasks.md`, verifiable results)
- **47+19 green tests (existing bidirectional tests)**: `tsc 0 error`, `vitest 47/47 bridge`, `19/19 runtime`
- **E2E opponents DB real**: Postgres v2 schema (PGVector + Memo + append-only triggers)
- **Agent workflow E2E**: auto-settlement ≤ 5000; escalate for >5000; signed CEO decision triggers execution; idempotency (replay refused); kill-switch active; audit trail unchanged.
- **Numbers**: net result **€35,680** over 117 weeks, 200 premiums, 46 settlements, ratio ≈ 70%

## 6. What this demo is NOT

- ❌ ACPR certified
- ❌ Regulated hosting
- ❌ Processes real personal data
- ❌ "Production ready"
- ❌ Solutions for regulated promoters or complex

---

## Security contact

- **Security contact**: responsable-projet@assurance-toto.local
- **Bug Bounty escalation**: internal bug-tracker => switch to dashboard
- **Updates**: this document is reviewed by compliance before every structural change
