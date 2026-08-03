# Architecture — Assurance Toto (Hermes + Buzz + Postgres/PGVector)

> Version 0.1.0 — 2026-08-02 · Mermaid + event flows + security boundaries

## Overview

```mermaid
flowchart LR
  CEO[CEO / Human Ops] -->|structured commands + Nostr signature| BuzzWeb[Buzz Web :3002]
  CEO -->|"confirmed decision (signed CEO pubkey)"| BuzzWeb
  BuzzWeb --> BuzzRelay[Buzz Relay :8080<br/>NIP-29 channels, audit chain]

  BuzzRelay -->|"POST /events · REST/NIP-98"| Bridge[BUZZ-HERMES-BRIDGE :3100]
  Bridge -->|"claim.settlement.approve<br/>approbations.create<br/>killswitch agent.killswitch.*"| BRouter

  subgraph BridgeInternals[Policy coverage]
    BJS[Strict JSON Schema<br/>additionalProperties:false]
    BPol[Policy.evaluate<br/>RBAC/ABAC, 7 rules]
    BId[Idempotency<br/>commandes_consommees UNIQUE]
    BAu[Audit chain<br/>SHA-256 prev_hash]
    BSec[BRIDGE_REQUIRE_SIGNED_COMMANDS<br/>PROD mode = true]
    BKill[Kill switch<br/>globally blocks autonomy]
  end
  Bridge --> BRouter{Router}
  BRouter -->|business rule respects chain| BJS
  BRouter -->|allow/deny| BPol
  BRouter -->|already consumed ?| BId
  BPol -->|if authorized| BEffects

  subgraph BEffects[Business effects (transactional)]
    PG[(Postgres 16 + PGVector<br/>sinistres, contrats, clients, pnl_ledger, audit_log)]
    PgVector["PGVector<br/>istillons 768 dims<br/>memoire_agents"]
  end
  BEffects --> BEffectsChain[UPDATE sinistres<br/>INSERT pnl_ledger (APPEND-ONLY)<br/>INSERT audit_log<br/>UPDATE approbations]
  BEffectsChain --> PG
  Bridge --> PG

  subgraph Agents[Hermes agent fleet (homegrown TS runtime)]
    Orc[Orchestrator]
    Sales[Sales/Acquisition]
    Souscription[Underwriting/Risk]
    Sinistres[Claims & Litigation]
    HR[Finance<br/>Support<br/>Marketing<br/>Compliance/Security]
  end
  BRouter -->|"launches business skill"| Agents
  Agents -->|"POST /commands<br/>(authorized commands, authenticated npub)"| Bridge
  Agents -->|"nomic-embed embedding<br/>(9.4 → memoire_agents)"| PgVector
  Agents -->|"tool calling<br/>Ollama qwen4:e4b/16k<br/>Germa vision=mandatory anon"| OllamaWindows[(Ollama<br/>Windows host<br/>localhost:11434)]
  PgVector -.-> Postgres
```

## Trust boundaries

| Zone | Content | Threat model | Mitigation |
|---|---|---|---|
| Buzz→Bridge | Signed Nostr events, REST API NIP-98/WS NIP-42 | Corrupted internal agent | Nostr validator (kind 27235), deny-by-default |
| Bridge→Agents | Typed structured commands | Unauthorized execution | BRIDGE_POLICY + idempotency + kill-switch |
| Bridge→Postgres | Transactional business effects | SQL injection, state corruption | Prepared statements + ON CONFLICT, append-only triggers, hash chain |
| Agents→LLM | Ollama prompts/returns | Hallucinations, PII | Presidio anonymization, strict JSON output, skill guardrails |
| Agents→MCP tools | SearXNG, MailHog, Gitea | Privilege escalation | MCP allowlist (dept-specific), least privilege |

## Authorization sequence (§6B)

```
1. Claim declared      → Postgres (`sinistres.statut='ouvert'`)
2. Claims agent        → recommendation (claim.settlement.approve)
                            → denied if amount > threshold
                            → creates `approbations('en_attente')` (POST /approvals)
3. Dashboard/Buzz      → notification in #approbations-ceo
4. CEO decides         → POST /approvals/:correlation_id/decide
                            + signed Nostr event (verified signature)
                            + decided_by = whitelisted CEO pubkey
                            + explicit reason
5. Bridge              → decision validated (403 unless CEO wlist)
                            → audited, chained `claim.settlement.approve`
                            → new correlation_id
                            → policy.evaluate re-check (amount vs ceiling)
                            → idempotency (commandes_consommees)
                            → P&L settlement transaction `approbations.approve`
                            → update `sinistres.statut='regle'`
                            → Buzz publication (kind 9 with correlation_id)
6. Full audit          → hash chain (prev_hash → hash) proving immutability
```

Strict order:
1. Auto-approval: only **if amount ≤ 5000 €** (`BRIDGEESCALATION_THRESHOLD_EUR`), `BRIDGE_ALLOWED_UNSIGNED_ROLES` (Hermes deposit npub validated), `sinistre` exists and statut=ouvert/en_traitement, no compliance block, idempotent.
2. CEO approve: **manual + signed event** (`ceo[n].pubkey`), decisive reason, idempotent via `commandes_consommees`, policy min(requested ceiling, threshold, claim amount).
3. Audit trail: immediately before effect `audit_log.prev_hash → sha256(prev_hash+payload)`.

## Anti-abuse policy (7 rules)

Under the portal endpoint `POST /commands`:

1. **Invalid schema**: against non-conforming structures (AJV with `additionalProperties:false`).
2. **Free textbox**: text = schema parse fails → frontal refusal (not examined as a command).
3. **Invalid signature**: (`kind 27235`) → return Forbidden.
4. **Unknown role**: npub absent from authorized lists.
5. **CEO-without-signature**: `BRIDGE_REQUIRE_SIGNED_COMMANDS=true` and CEO-reserved action unsigned → deny.
6. **Compliance locked**: `sinistre.compliance_bloque = true` → deny.
7. **Idempotency violated**: `command_id` (content/command hash) already in `commandes_consommees`.
8. **Threshold exceed + agent role**: `montant > seuil` and role ≠ ceo → deny.
9. **Invalid status**: claim not in ouvert/en_traitement state (or refuse/cloture if reject).
10. **Amount mismatch**: `montant_eur > plafond_effectif` (the CEO can request more than the `max_amount_eur` goal-check).

## Key security

- generated by `buzz-admin generate-key` (Schnorr Nostr)
- stored in `.env.buzz` files (chmod 600) in Git Bash
- buzz-admin add-member adds them to the relay workspace
- do not publish `buz_admin` or `BUZZ_PRIVATE_KEY` publicly

## Observability

- **pino logs** structured JSON: level,time,pid,hostname,correlation_id,step,actor,msg
- **Prometheus**: `/metrics` (gauges, histogram, default registry)
- **health**: `/healthz` (process healthy) / `/readyz` (pg + buzz connectivity)
- **audit**: `/audit/verify` (verifiable hash chain) — immediate tamper detection

## Real limits (demo, not production)

- Buzz: it is an immutable `ghcr.io/block/buzz:main` image (no fork in progress)
- Buzz has no native approval (see WF-08): they are managed **at the bridge level** (config choice compatible until WF-08 is stable)
- Ollama: 7B/8B = satisfactory-enough models + guardrails (skills designed to keep outputs structured JSON)
- `BRIDGE_REQUIRE_SIGNED_COMMANDS=false` in demo (cycle comprehensibility) — PROD = true

---

**This diagram with `docs/NETWORKING.md`** provides the technical vision of the boundaries + operational flows.
