# Infra PostgreSQL — Assurance Toto

PostgreSQL est **la source de vérité structurelle** du jumeau numérique. Le runtime
TypeScript « Hermes » et le pont « buzz-hermes-bridge » (Fastify) lisent et écrivent
cette base.

## Fichiers

| Fichier | Rôle |
|---|---|
| `init.sql` | Schéma v1 (clients, contrats, sinistres, agent_actions) — inchangé. |
| `init_extensions.sql` | Extensions : `vector` (pgvector) et `pgcrypto` (`gen_random_uuid()`). À exécuter **avant** `schema_v2.sql`. |
| `schema_v2.sql` | Schéma v2 (nouvelles tables, triggers append-only, vues métriques). Idempotent (`IF NOT EXISTS` / `OR REPLACE`). |
| `seed_faker.py` | Générateur de données 100 % synthétiques (Faker `fr_FR`, déterministe). |

**Ordre d'exécution :** `init_extensions.sql` → `init.sql` → `schema_v2.sql`.
Le montage dans `docker-entrypoint-initdb.d` (compose) est un ticket séparé.

> ⚠️ **Prérequis pgvector** : la colonne `embedding vector(768)` et l'index HNSW
> exigent l'extension `vector`, absente de l'image `postgres:16-alpine`. Utiliser
> l'image `pgvector/pgvector:pg16` pour le service postgres.

## Tables v2

### `approbations`
File d'approbation humaine des actions agents (ex. `claim.settlement.approve`).
Une seule approbation par `correlation_id` (`UNIQUE`). Cycle de vie :
`en_attente` → `approuve` | `refuse` | `expire` (CHECK constraint).
`decided_by` / `decided_at` / `reason` ne sont renseignés qu'à la décision.

### `commandes_consommees`
Registre d'idempotence : `command_id` (PK) consommé exactement une fois.
Le bridge fait `INSERT ... ON CONFLICT (command_id) DO NOTHING` et saute le
traitement si la commande existe déjà.

### `pnl_ledger` — **APPEND-ONLY**
Journal comptable P&L. Trigger `BEFORE UPDATE OR DELETE` qui rejette toute
modification : toute correction se fait par **contre-écriture** (écriture inverse).

**Convention de signe : RECETTES positives, CHARGES négatives.**

| categorie | Signe | Exemple |
|---|---|---|
| `prime` | `+` | Prime annuelle encaissée |
| `reglement` | `−` | Règlement d'un sinistre |
| `provision` | `−` | Dotation aux provisions (sinistre ouvert/en cours/contentieux) |
| `frais` | `−` | Frais d'acquisition et de gestion |
| `marketing` | `−` | Dépenses marketing |

Résultat net = `SUM(montant)`. Les vues métriques reposent sur cette convention.

### `memoire_agents`
Mémoire long terme des agents : `contenu` (texte) + `embedding vector(768)`.
768 dimensions = sortie d'`ollama nomic-embed-text`. L'agent calcule l'embedding
côté applicatif (appel Ollama), l'insère avec le contenu, puis retrouve les
souvenirs proches par similarité cosinus :
`ORDER BY embedding <=> $1 LIMIT k` (l'index HNSW `vector_cosine_ops` accélère
cette requête). `partage = true` rend le souvenir visible des autres départements ;
sinon filtrer par `departement`.

### `audit_log` — **APPEND-ONLY, hash-chaîné**
Journal d'audit inviolable : chaque ligne porte `hash = sha256(prev_hash || payload)`,
calculé **côté applicatif** (Hermes / bridge) au moment de l'INSERT. Trigger
identique à `pnl_ledger` : UPDATE/DELETE rejetés. La vérification d'intégrité
reconsiste à rejouer la chaîne sur `seq` croissant.

### `kill_switch`
Arrêt d'urgence global des agents. Exactement **une ligne** (`CHECK (id = 1)`),
pré-insérée avec `actif = false`. Les agents doivent lire `actif` avant toute
action ; `active_par` / `active_le` tracent qui a appuyé sur le bouton.

### `macro_indicateurs`
Indicateurs macro-économiques injectés dans le contexte agents :
`taux_bdf`, `inflation_insee`, `gpr` (CHECK constraint), avec `periode` et `source`.

## Vues métriques (dashboard)

- **`v_pnl_hebdo`** : résultat net par semaine ISO (`date_trunc('week')`) et
  département, avec colonnes `primes`, `reglements`, `provisions`, `frais`,
  `marketing`, `resultat_net`.
- **`v_ratio_sinistralite`** : ratio S/P par département =
  `|SUM(reglement + provision)| / SUM(prime)` (les charges étant négatives).
  `NULLIF` protège la division par zéro (ratio `NULL` si aucune prime).

## Seeding

```bash
# Depuis la racine du projet (docker + réseau compose requis)
./scripts/seed-data.sh          # portefeuille démo cohérent (--scale-maison)
./scripts/seed-data.sh large    # 5000 clients / 3000 contrats / 800 sinistres
```

`--scale-maison` génère ~120 clients, 200 contrats, 60 sinistres (statuts
réalistes : ~70 % réglés), recale les montants pour un ratio de sinistralité
d'exactement 70 % (bande 65-75 %), écrit le ledger (primes +, frais −10 %,
règlements/provisions −), 3 lignes `macro_indicateurs` et garantit la ligne
`kill_switch`.

Le seeder est **déterministe** (`Faker.seed(42)` + `random.seed(42)`) : deux runs
produisent les mêmes données. Connexion via `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`
(défauts `localhost:5432`, `postgres`/`postgres`, base `assurance_toto`).

Usage direct hors docker :

```bash
pip install psycopg2-binary faker
PGDATABASE=assurance_toto python infra/postgres/seed_faker.py --scale-maison
```
