# @assurance-toto/hermes-runtime

Runtime **Hermes Agent** — le « cerveau » réutilisable dont chaque agent métier
(orchestrateur, sales, souscription, sinistres-contentieux) est une instance
configurée. TypeScript / Node 20, strict/no-any, **zéro API payante**, LLM **local
Ollama uniquement**.

## Principe

Le LLM local **décide et recommande** ; il n'écrit jamais en dur d'affaires. La
boucle transforme la recommandation structurée en **commande typée** et la POSTE
au bridge `buzz-hermes-bridge` (`POST /commands`), qui applique politique,
idempotence, audit et effets transactionnels. L'agent n'écrit directement que
dans `memoire_agents` (son apprentissage), et lit en read-only.

```
tâche ──► anonymize(PII) ──► Ollama /api/chat (tools filtrés par allowlist)
                                  │ tool_calls
                                  ▼
                     registre d'outils (read-only DB / calculs / mémoire)
                                  │ recommander_reglement
                                  ▼
                  candidateCommand claim.settlement.approve
                                  │ (kill-switch OK ?)
                                  ▼
              POST {BRIDGE_URL}/commands {command, author_pubkey, correlation_id}
```

## Modules

| Fichier | Rôle |
|---|---|
| `src/config.ts` | Env → `HermesConfig` (AGENT_ROLE, OLLAMA_*, DATABASE_URL, BRIDGE_URL, …) |
| `src/security/killswitch.ts` | Sonde `kill_switch` (cache ≤ 2 s), gate avant chaque action |
| `src/security/allowlist.ts` | Allowlist JSON par agent, **deny-by-default** |
| `src/privacy/anonymize.ts` | Presidio `/analyze`+`/anonymize`, fallback regex (email/tel/IBAN/NIR), `assertNoPii` |
| `src/llm/ollama.ts` | `chat(tools)` natif + `embed()` 768 dims, timeout + 1 retry |
| `src/tools/tools.ts` | Registre : lire_sinistre/client/contrat, calculer_prime, evaluer_risque, qualifier_lead, recommander_reglement, requeter_pnl, consulter_memoire |
| `src/runtime/agent.ts` | Boucle bornée (≤ 6 itérations), prompt système, POST bridge, mémoire |
| `src/skills/loader.ts` | Charge `*.md` (frontmatter) depuis SKILLS_DIR |
| `src/composition.ts` | Composition root (prod + seams de test) |
| `src/server.ts` | fastify : /healthz, /readyz, POST /task, mode autonome (optionnel) |
| `src/index.ts` | Entrypoint + graceful shutdown |

## Contrat bridge (assumption validée sur `buzz-hermes-bridge/src/http/server.ts`)

```jsonc
POST {BRIDGE_URL}/commands
{
  "command":        { /* validé par ajv — cf. commands/schemas.ts */ },
  "author_pubkey":  "<AGENT_NPUB>",
  "correlation_id": "<uuid>"        // optionnel mais toujours fourni par le runtime
}
```

`recommander_reglement` génère une commande `claim.settlement.approve` conforme à
`claimSettlementApprove` : `{type, claim_id, max_amount_eur, reason, approved_by, requested_at(date-time)}`.

## Variables d'environnement

Voir `src/config.ts`. Défauts docker-compose : `OLLAMA_HOST=http://host.docker.internal:11434`,
`BRIDGE_URL=http://buzz-hermes-bridge:3100`, `PRESIDIO_URL=http://presidio-analyzer:3000`,
`DATABASE_URL=postgres://postgres:postgres@postgres:5432/assurance_toto`,
`SKILLS_DIR=/workspace/skills`, `HERMES_ESCALATION_THRESHOLD_EUR=5000`,
`AUTONOMY_INTERVAL_SECONDS=0` (autonomie coupée par défaut).

## Développement

```bash
npm install
npm run build   # tsc strict — doit passer
npm test        # vitest, 16 tests hermétiques (aucun réseau/pg/docker)
npm start       # nécessite Postgres + Ollama réels
```

## Tests

Vitest, tout mocké via seams (db/ollama/bridge/anonymizer). Couvre : parsing et
exécution d'un tool call, POST bridge avec correlation_id, allowlist deny-by-default,
kill-switch (refus + cache + fail-closed), anonymisation PII (regex fallback +
Presidio), fallback structuré sans tool_calls. Aucun accès réseau ou base réelle.
