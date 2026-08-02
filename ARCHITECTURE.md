# Architecture — Assurance Toto (Hermes + Buzz + Postgres/PGVector)

> Version 0.1.0 — 2026-08-02 · Mermaid + flux d'événements + boundaries de sécurité

## Vue d'ensemble

```mermaid
flowchart LR
  CEO[CEO / Ops humain] -->|commandes structurées + signature Nostr| BuzzWeb[Buzz Web :3002]
  CEO -->|"décision confirmée (CEO pubkey signé)"| BuzzWeb
  BuzzWeb --> BuzzRelay[Buzz Relay :8080<br/>NIP-29 channels, audit chain]

  BuzzRelay -->|"POST /events · REST/NIP-98"| Bridge[BUZZ-HERMES-BRIDGE :3100]
  Bridge -->|"claim.settlement.approve<br/>approbations.create<br/>killswitch agent.killswitch.*"| BRouter

  subgraph BridgeInternals[Politique coverage]
    BJS[JSON Schema strict<br/>additionalProperties:false]
    BPol[Policy.evaluate<br/>RBAC/ABAC, 7 règles]
    BId[Idempotence<br/>commandes_consommees UNIQUE]
    BAu[Audit chain<br/>SHA-256 prev_hash]
    BSec[BRIDGE_REQUIRE_SIGNED_COMMANDS<br/>mode PROD = true]
    BKill[Kill switch<br/>global bloque autonomie]
  end
  Bridge --> BRouter{Router}
  BRouter -->|règle métier respecte chaîne| BJS
  BRouter -->|allow/deny| BPol
  BRouter -->|déjà consumée ?| BId
  BPol -->|si autorisé| BEffects

  subgraph BEffects[Effets métier (transactionnel)]
    PG[(Postgres 16 + PGVector<br/>sinistres, contrats, clients, pnl_ledger, audit_log)]
    PgVector["PGVector<br/>oisillons 768 dims<br/>memoire_agents"]
  end
  BEffects --> BEffectsChain[UPDATE sinistres<br/>INSERT pnl_ledger (APPEND-ONLY)<br/>INSERT audit_log<br/>UPDATE approbations]
  BEffectsChain --> PG
  Bridge --> PG

  subgraph Agents[Flotte Hermes agents (runtime TS maison)]
    Orc[Orchestrateur]
    Sales[Sales/Acquisition]
    Souscription[Souscription/Risque]
    Sinistres[Sinistres & Contentieux]
    HR[Finance<br/>Support<br/>Marketing<br/>Conformité/Sécu]
  end
  BRouter -->|"lance skill métier"| Agents
  Agents -->|"POST /commands<br/>(commandes autorisées, npub authentifié)"| Bridge
  Agents -->|"embedding nomic-embed<br/>(9.4  → memoire_agents)"| PgVector
  Agents -->|"tool calling<br/>Ollama qwen4:e4b/16k<br/>Germa vision=mandatory anon"| OllamaWindows[(Ollama<br/>hôte Windows<br/>localhost:11434)]
  PgVector -.-> Postgres
```

## Confiance (Trust boundaries)

| Zone | Contenu | Modèle menacé | Mitigation |
|---|---|---|---|
| Buzz↔Bridge | Events Nostr signés, API REST NIP-98/WS NIP-42 | Agent interne corrompu | Validateur Nostr (kind 27235), deny-by-default |
| Bridge↔Agents | Commandes structurées typées | Exécution non autorisée | BRIDGE_POLICY + idempotence + kill-switch |
| Bridge↔Postgres | Effets transactionnels métier | Injection SQL, corruption état | Préparé statements + ON CONFLICT, append-only triggers, hash chain |
| Agents↔LLM | Prompts/retours Ollama | Hallucinations, PII | Presidio anonymisation, sortie JSON strict, garde-fou skill |
| Agents↔MCP tools | SearXNG, MailHog, Gitea | Escalade de privilèges | allowlist MCP (dept-specific), least privilege |

## Séquence d'autorisation (§6B)

```
1. Sinistre déclaré    → Postgres (`sinistres.statut='ouvert'`)
2. Agent sinistres    → recommandation (claim.settlement.approve)
                       → denied si montant > seuil
                       → crée `approbations('en_attente')` (POST /approvals)
3. Dashboard/Buzz      → notification dans #approbations-ceo
4. CEO décide         → POST /approvals/:correlation_id/decide
                        + event Nostr signé (signature verifiée)
                        + decided_by = pubkey CEO whitelisté
                        + reason explicite
5. Bridge             → décision validée (403 unless CEO wlist)
                        → audited, chaînage `claim.settlement.approve`
                        → nouveau correlation_id
                        → policy.evaluate re-check (montant vs plafond)
                        → idempotence (commandes_consommees)
                        → transaction settlement P&L `approbations.approuve`
                        → mise à jour `sinistres.statut='regle'`
                        → publication Buzz (kind 9 avec correlation_id)
6. Audit complet       → hash chain (prev_hash → hash) prouvant immutabilité
```

Ordre strict :
1. Auto-approbation : uniquement **si montant ≤ 5000 €** (`BRIDGEESCALATION_THRESHOLD_EUR`), `BRIDGE_ALLOWED_UNSIGNED_ROLES` (npub dépôt Hermes validé), `sinistre` existe et statut=ouvert/en_traitement, déjà pas de compliance block, idempotent.
2. CEO approuve : **toi + sigged event** (`ceo[n].pubkey`), décisif motif, idempotent via `commandes_consommees`, politique min(plafond demandé, seuil, montant sinistre).
3. Audit trail : immédiatement avant effet `audit_log.prev_hash → sha256(prev_hash+payload)`.

## Politique anti-foncée (7 règles)

Sous le compte portal `POST /commands` :

1. **Schema invalid** : contre les structures non conformes (AJV with `additionalProperties:false`).
2. **Buxtobre libre** : texte = schéma parse échoue → refus frontal (pas examiné comme command).
3. **Signature invalide** (`kind 27235`) → return Forbidden.
4. **Role inconnu** : npub absent des listes autorisées.
5. **CEO-sans-signature** : `BRIDGE_REQUIRE_SIGNED_COMMANDS=true` et action réservée CEO non signée → deny.
6. **Compliance locked** : `sinistre.compliance_bloque = true` → deny.
7. **Idempotence violée** : `command_id` (hash content/command) déjà dans `commandes_consommees`.
8. **Threshold exceed + role agent** : `montant > seuil` et rôle ≠ ceo → deny.
9. **Statut invalide** : sinistre pas dans état ouvert/en_traitement (ou refuse/cloture si reject).
10. **Montant mismatch** : `montant_eur > plafond_effectif` (민ceo peut demander plus que le goal-check `max_amount_eur`).

## Sécurité des clés

- générées par `buzz-admin generate-key` (Schnorr Nostr)
- stockées dans `.env.buzz` fichiers (chmod 600) dans Git Bash
- buz-admin add-member les ajoute au relay workspace
- ne pas publier `buz_admin` ni `BUZZ_PRIVATE_KEY` publiquement

## Observabilité

- **logs pino** JSON structurés : level,time,pid,hostname,correlation_id,step,actor,msg
- **Prometheus** : `/metrics` (gauges, histogram, default registry)
- **health** : `/healthz` (process healthy) / `/readyz` (pg + buzz connectivity)
- **audit** : `/audit/verify` (chaine hash vérifiable) — tamper détection immédiate

## Limites réelles (démo, pas production)

- Buzz : c'est une image `ghcr.io/block/buzz:main` immutable (pas de fork en cours)
- Buzz n'a pas d'approbation native (🚧 WF-08) : on les gère **au niveau bridge** (choix config compatible jusqu'à ce que WF-08 soit stable)
- Ollama : 7B/8B = modèles satisfaisance absolue + gardez en-garde (Skills designed to keep outputs structurées JSON)
- `BRIDGE_REQUIRE_SIGNED_COMMANDS=false` en démo (compréhensibilité du cycle) — PROD = true

---

**Ce diagramme avec `docs/NETWORKING.md`** rendent la vision technique des boundaries + flux opérationnels.