# @assurance-toto/hermes-runtime

**Hermes Agent** runtime — the reusable "brain" of which each business agent
(orchestrateur, sales, souscription, sinistres-contentieux) is a configured
instance. TypeScript / Node 20, strict/no-any, **zero paid APIs**, **local
Ollama only** LLM.

## Principle

The local LLM **decides and recommends**; it never writes business data
directly. The loop turns the structured recommendation into a **typed command**
and POSTs it to the `buzz-hermes-bridge` bridge (`POST /commands`), which
applies policy, idempotency, audit and transactional effects. The agent writes
directly only to `memoire_agents` (its learning), and reads in read-only mode.

```
task ──► anonymize(PII) ──► Ollama /api/chat (tools filtered by allowlist)
          │  tool_calls
          ▼
        tool registry (read-only DB / computations / memory)
          │  recommander_reglement
          ▼
        candidateCommand claim.settlement.approve
          │  (kill-switch OK ?)
          ▼
        POST {BRIDGE_URL}/commands  {command, author_pubkey, correlation_id}
```

## Modules

| File | Role |
|---|---|
| `src/config.ts` | Env → `HermesConfig` (AGENT_ROLE, OLLAMA_*, DATABASE_URL, BRIDGE_URL, …) |
| `src/security/killswitch.ts` | `kill_switch` probe (cache ≤ 2 s), gate before each action |
| `src/security/allowlist.ts` | Per-agent JSON allowlist, **deny-by-default** |
| `src/privacy/anonymize.ts` | Presidio `/analyze`+`/anonymize`, regex fallback (email/tel/IBAN/NIR), `assertNoPii` |
| `src/llm/ollama.ts` | Native `chat(tools)` + `embed()` 768 dims, timeout + 1 retry |
| `src/tools/tools.ts` | Registry: lire_sinistre/client/contrat, calculer_prime, evaluer_risque, qualifier_lead, recommander_reglement, requeter_pnl, consulter_memoire |
| `src/runtime/agent.ts` | Bounded loop (≤ 6 iterations), system prompt, bridge POST, memory |
| `src/skills/loader.ts` | Loads `*.md` (frontmatter) from SKILLS_DIR |
| `src/composition.ts` | Composition root (prod + test seams) |
| `src/server.ts` | fastify: /healthz, /readyz, POST /task, autonomous mode (optional) |
| `src/index.ts` | Entrypoint + graceful shutdown |

## Bridge contract (assumption validated against `buzz-hermes-bridge/src/http/server.ts`)

```jsonc
POST {BRIDGE_URL}/commands
{
  "command":        { /* validated by ajv — cf. commands/schemas.ts */ },
  "author_pubkey":  "<AGENT_NPUB>",
  "correlation_id": "<uuid>"    // optional but always provided by the runtime
}
```

`recommander_reglement` generates a `claim.settlement.approve` command conforming to
`claimSettlementApprove`: `{type, claim_id, max_amount_eur, reason, approved_by, requested_at(date-time)}`.

## Environment variables

See `src/config.ts`. docker-compose defaults: `OLLAMA_HOST=http://host.docker.internal:11434`,
`BRIDGE_URL=http://buzz-hermes-bridge:3100`, `PRESIDIO_URL=http://presidio-analyzer:3000`,
`DATABASE_URL=postgres://postgres:postgres@postgres:5432/assurance_toto`,
`SKILLS_DIR=/workspace/skills`, `HERMES_ESCALATION_THRESHOLD_EUR=5000`,
`AUTONOMY_INTERVAL_SECONDS=0` (autonomy off by default).

## Development

```bash
npm install
npm run build    # tsc strict — must pass
npm test         # vitest, 16 hermetic tests (no network/pg/docker)
npm start        # requires real Postgres + Ollama
```

## Tests

Vitest, everything mocked via seams (db/ollama/bridge/anonymizer). Covers: parsing
and execution of a tool call, bridge POST with correlation_id, deny-by-default
allowlist, kill-switch (refusal + cache + fail-closed), PII anonymization (regex
fallback + Presidio), structured fallback without tool_calls. No network or real
database access.
