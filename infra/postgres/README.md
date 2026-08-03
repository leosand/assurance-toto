# PostgreSQL Infra — Assurance Toto

PostgreSQL is **the structural source of truth** of the digital twin. The TypeScript runtime
« Hermes » and the « buzz-hermes-bridge » (Fastify) read and write this database.

## Files

| File | Role |
|---|---|
| `init.sql` | v1 schema (clients, contrats, sinistres, agent_actions) — unchanged. |
| `init_extensions.sql` | Extensions: `vector` (pgvector) and `pgcrypto` (`gen_random_uuid()`). To run **before** `schema_v2.sql`. |
| `schema_v2.sql` | v2 schema (new tables, append-only triggers, metric views). Idempotent (`IF NOT EXISTS` / `OR REPLACE`). |
| `seed_faker.py` | 100% synthetic data generator (Faker `fr_FR`, deterministic). |

**Execution order:** `init_extensions.sql` → `init.sql` → `schema_v2.sql`.
The mount in `docker-entrypoint-initdb.d` (compose) is a separate ticket.

> ⚠️ **pgvector prerequisite**: the `embedding vector(768)` column and the HNSW index
> require the `vector` extension, which is missing from the `postgres:16-alpine` image. Use
> the `pgvector/pgvector:pg16` image for the postgres service.

## v2 tables

### `approbations`
Human approval queue for agent actions (e.g. `claim.settlement.approve`).
One approval per `correlation_id` (`UNIQUE`). Lifecycle:
`en_attente` → `approuve` | `refuse` | `expire` (CHECK constraint).
`decided_by` / `decided_at` / `reason` are only filled in at decision time.

### `commandes_consommees`
Idempotency registry: `command_id` (PK) consumed exactly once.
The bridge does `INSERT ... ON CONFLICT (command_id) DO NOTHING` and skips processing
if the command already exists.

### `pnl_ledger` — **APPEND-ONLY**
P&L accounting journal. `BEFORE UPDATE OR DELETE` trigger rejects any
modification: any correction is done via **contra-entry** (reverse entry).

**Sign convention: positive RECEIPTS, negative CHARGES.**

| category | Sign | Example |
|---|---|---|
| `prime` | `+` | Annual premium collected |
| `reglement` | `−` | Settlement of a claim |
| `provision` | `−` | Provision allocation (open/ongoing/litigation claim) |
| `frais` | `−` | Acquisition and management fees |
| `marketing` | `−` | Marketing expenses |

Net result = `SUM(montant)`. The metric views rely on this convention.

### `memoire_agents`
Long-term agent memory: `contenu` (text) + `embedding vector(768)`.
768 dimensions = output of `ollama nomic-embed-text`. The agent computes the embedding
on the application side (Ollama call), inserts it with the content, then retrieves
nearby memories by cosine similarity:
`ORDER BY embedding <=> $1 LIMIT k` (the `vector_cosine_ops` HNSW index accelerates
 this query). `partage = true` makes the memory visible to other departments;
 otherwise filter by `departement`.

### `audit_log` — **APPEND-ONLY, hash-chained**
Tamper-evident audit journal: each row carries `hash = sha256(prev_hash || payload)`,
computed **on the application side** (Hermes / bridge) at INSERT time. Trigger
identical to `pnl_ledger`: UPDATE/DELETE rejected. Integrity verification
consists of replaying the chain on ascending `seq`.

### `kill_switch`
Global emergency stop for agents. Exactly **one row** (`CHECK (id = 1)`),
pre-inserted with `actif = false`. Agents must read `actif` before any
action; `active_par` / `active_le` track who pressed the button.

### `macro_indicateurs`
Macro-economic indicators injected into the agent context:
`taux_bdf`, `inflation_insee`, `gpr` (CHECK constraint), with `periode` and `source`.

## Metric views (dashboard)

- **`v_pnl_hebdo`**: net result per ISO week (`date_trunc('week')`) and
  department, with columns `primes`, `reglements`, `provisions`, `frais`,
  `marketing`, `resultat_net`.
- **`v_ratio_sinistralite`**: claims ratio S/P per department =
  `|SUM(reglement + provision)| / SUM(prime)` (charges being negative).
  `NULLIF` protects against division by zero (`NULL` ratio if no premium).

## Seeding

```bash
# From the project root (docker + compose network required)
./scripts/seed-data.sh            # coherent demo portfolio (--scale-maison)
./scripts/seed-data.sh large    # 5000 clients / 3000 contracts / 800 claims
```

`--scale-maison` generates ~120 clients, 200 contracts, 60 claims (realistic statuses:
~70 % settled), rescales amounts to a claims ratio of exactly 70 % (65-75 % band), writes the
ledger (premiums +, fees − 10 %, settlements/provisions −), 3 `macro_indicateurs` rows and
guarantees the `kill_switch` row.

The seeder is **deterministic** (`Faker.seed(42)` + `random.seed(42)`): two runs
produce the same data. Connection via `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`
(defaults `localhost:5432`, `postgres`/`postgres`, base `assurance_toto`).

Direct usage outside docker:

```bash
pip install psycopg2-binary faker
PGDATABASE=assurance_toto python infra/postgres/seed_faker.py --scale-maison
```
