# Sécurité — Assurance Toto (Compliance-oriented by design)

## Positionnement officiel (obligatoire à toute démo client)

> **Ceci n'est PAS un système de production certifié ACPR/RGPD.** C'est un **démonstrateur technique et commercial** — construit selon les principes transposables en production, hébergé localement, sur des données 100 % synthétiques — **sandbox-ready**, jamais **données réelles**.

## 1. Modèle de menace

| Menace | Source | Impact | Mitigation implémentée |
|---|---|---|---|
| **Exécution non autorisée** d'une commande sensible (règlement de sinistre, kill-switch, modification tarif) | Injection/prompt-injection depuis une conversation Buzz, ou npub non whitelisté, ou cycle Hermes errant | Perte financière, fraude, chaîne de traitement d'astreinte | **Policy enforcement bridge** : RBAC + ABAC, seuils monétaires durcis, signature Nostr vérifiée + schéma strict, idempotence (`commandes_consommees` UNIQUE) |
| **Autonomie non contrôlée** des agents | Boucle skill sans supervisión, force brute sur `POST /commands` | Décisions erronées irréversibles (règlements > seuil) | **Kill-switch CEO** : ligne unique `kill_switch.actif=true` à single row, stop toute exécution avant toute action autonome ; `BRIDGE REQUIRE_SIGNED_COMMANDS=true` en PROD (CEO signe toute action à décision); `HERMES_ESCALATION_THRESHOLD_EUR` default 5 000 € (approbation humaine requise au-delà) |
| **PII dans prompts/logs** | Coordonnées personnelles envoyées au LLM ou Buzz | Données personnelles répères (identifiants, clarté sur transaction RDGPD) | **Presidio** avant chaque LLM/prompt/Buzz published message ; regex fallback si down ; `logger` supprimé des champs sensibles |
| **Clés Nostr compromises** | Fuite de private key (nsec) dans logs/git | Changement d'identité, falsification/audit log | `.env.buzz` (chmod 600, gitignored), rotation facile via `bootstrap-buzz.sh`, `relay signature validation` ; aucune clé privée dans l'image Docker ; `git filter-repo` recommandé en cas de breach réel |
| **Génération de commandes non-structurées** | Prompt injection depuis texte libre Buzz | Exécution non maîtrisée | **JSON Schema strict** (`additionalProperties:false`) — texte libre **jamais** exécuté (rejeter au dernier niveau) |
| **Attaque par rejeu** (replay) | Même commande envoyée consécutivement | Double règlement, double déduction P&L | `commandes_consommees` UNIQUE (hash content) — renvoi verrouillé `idempotent` → `200 consumed` |
| **Man-in-the-middle Buzz↔Bridge** | Modification en cours d'envoi de command/Effet métier | Actions falsifiées | Buzz : NIP-98 header Nostr `<base64-signed>` (identité expéditeur cryptographiquement validée) ; bridge verify heures « Authorization Nostr » header |

## 2. Sécurité structurée appliquée

### Authentification & Autorisation
- **Identités Nostr** (npub/nsec Schnorr) 1 par opérateur humain + 1 par agent 1er niveau (CEO + 4 agents MVP en mode lite) : `buzz-admin add-member` par pubkey => relativisation (ACL role member / owner / bot).
- **CEO = whitelisté** (`BRIDGE_CEOPUBKEYS`) — `POST /approvals/.../decide` et `POST /killswitch` **exigent explicitement** (CEO signé si `BRIDGE_REQUIRE_SIGNED_COMMANDS=true`, sinon npub whitelist pas prompt-injectable en messages publics).
- **Agents autonomes** = npub dédiés (`BRIDGE_ALLOWED_UNSIGNED_ROLES`) : **non-signé = mode organisateur démo local** (PROD = désactivé), chaque action `authorize()`.
- **Role enforcement** appliqué par `policy.evaluate()` autonome prioritaire! Le bridge refuse délibérément sans légaliser les décisions.

### Confidentialité (PII/LLM)
- **Toute entée texte vers LLM** passe par `Presidio /analyze + /anonymize` — regex fallback si Presidio down ; jamais de PII brute en input LLM.
- Logs `pino` structured : no password/secret/PII ; clés = `***present***`
- MCP tools whitelistés **par département** (correspondance rôles Hermes visibles : defendants). SearXNG / MailHog isolés net-external.

### Intégrité & Audit
**Audit hash-chain append-only** :
- chaque entrée `audit_log` contient : `seq` unique, `correlation_id`, `payload` (JSONB), `prev_hash` = SHA-256(prev_hash + payload) ; trigger `prev_hash` chaine
- mode `verifyAuditChain()` expose altéré (fonction verify + DB)
- `prev_hash=0` initial acceptation DB; root effectif = `first written entry on new gid` initialise cluster associé
- `GET /audit/verify` exposes verification result + seq_max

**Idempotence atomique** : `commandes_consommees` UNIQUE + `markConsumed()` (audit décliné lorsque consommé).

**Append-only P&L** : `pnl_ledger` UPDATE/DELETE trigger rejected.

### Contrôle Humain Obligatoire
- Kill-switch de secours : `POST /killswitch` (signé CEO) → `kill_switch.actif=true` → **toute exécution autonome refusée** excepté `killswitch.deactivate` (CEO signé).
- Cycle complet `claim.settlement.approve` dépendant de kill-switch : dès qu'actif = `killswitch.actif: execution bloquée`
- +souscription tarif exception (pricing) réservé au CEO
- **Timing** : `started+<TTL>` = `approved`/`auto-expired` si dépassement (`APPROVAL_TTL_MINUTES` default 7 jours).

### Secret management
- **Interdiction** : clés privées dans git, changelog, logs, images docker
- **Pratique** : stockage dans `.env.buzz` (chmod 600) + fichiers `.env` et `BUZZ_RELAY_PRIVATE_KEY`, `BUZZ_RELAY_DIGEST`, `BUZZ_KEYS` lineage temporaires puis rotation si compromis
- **Vault optionnel** : Infisical/Vault (Phase 3)

### Segmentation réseau Docker
| Network | Contenu | Accès |
|---|---|---|
| net-core | Postgres, Redis | Bridge + prescription LLM |
| net-dept | Bridge, Gitea, agents Hermes | API interne |
| net-external | MailHog, SearXNG, Presidio | +exposition contrôlée au web des agents métier |

## 3. Anonymisation (par défaut, données synthétiques)

- Faker `fr_FR` (custom seeds = `42`)
- Toute donnée client's nom, email, tél, adresse, date_naissance, immatriculation… réelles nunements synthétiques
- Buzz (cockpit) = **messages d'accompagnement** du pipeline, pas une source de données firm
- Produit *explicitement* réservé à `"DEMO"` (data inventaire + clients susceptibles par invitation)

## 4. Procedure d'incident (si compromise détectée)

- **Kill-switch CEO** : `POST /killswitch {active:true}` signature CEO (`POST /killswitch` bypass bridge direct si besoin)
- **Audit** : `GET /audit/verify` = altération détectée ⇒ `first corrupted entry` accusé
- **Rotation** : `scripts/init-agents-env.sh` + redémarre stack composition ; clés nouvelles rien de suite
- **Contain** : journaliser audit logs `audit_log` + `commandes_consommees` via backup tar (schéma PG) puis rotation npub Buzz : 각 1 repo commits + add-member *only* manuel
- **Révision** : analysis du cycle (logs pino + dashboard timeline correlation_id abaxial)

## 5. Validation explicite (fournie pour la confiance client)

- **13 exigences du brief §11 acceptées** (cf. `tasks.md`, résultats vérifiables)
- **47+19 tests verts (bidirectional test existentiels)** : `tsc 0 error`, `vitest 47/47 bridge`, `19/19 runtime`
- **E2E opponents DB réel** : Postgres v2 schema (PGVector + Memo + append-only triggers)
- **Agent workflow E2E** : auto-settlement ≤ 5000; escalade pour >5000; decision CEO signée déclenche execution; idempotence (replay refusé); kill-switch actifs; audit trail unchanged.
- **Chiffres** : résultat net **35 680 €** sur 117 semaines, 200 primes, 46 règlements, ratio Ụ 70%

## 6. Ce que ce démonstrateur N'EST PAS

- ❌ Certifié ACPR
- ❌ Hébergé réglementé
- ❌ Traite des données personnelles réelles
- ❌ "Prêt pour la production"
- ❌ Solutions aux promotes règlementaires ou complexity

---

## Contact sécurité

- **Security contact** : responsable-projet@assurance-toto.local
- **Escalade Bug Bounty** : bug-tracker interne => switch to dashboard
- **Updates** : ce document est revu par la conformité avant chaque changement structurant
