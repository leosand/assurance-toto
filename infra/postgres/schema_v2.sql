-- schema_v2.sql — Assurance Toto v2 schema: approvals, idempotency,
-- P&L ledger, agent memory (embeddings), append-only audit, kill-switch,
-- macro indicators, dashboard metrics views.
-- PREREQUISITE: run init_extensions.sql BEFORE this file (vector, pgcrypto).
-- All creations are idempotent (IF NOT EXISTS / OR REPLACE).

-- ==================== HUMAN APPROVALS ====================
-- One approval per correlation_id (e.g. validation of a claim/sinistre settlement).
CREATE TABLE IF NOT EXISTS approbations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id UUID NOT NULL,
    type           TEXT NOT NULL,           -- ex. 'claim.settlement.approve'
    claim_id       TEXT,
    montant_eur    NUMERIC(12,2),
    statut         TEXT NOT NULL DEFAULT 'en_attente'
                   CHECK (statut IN ('en_attente', 'approuve', 'refuse', 'expire')),
    requested_by   TEXT,
    decided_by     TEXT,
    reason         TEXT,
    decided_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (correlation_id)
);
CREATE INDEX IF NOT EXISTS idx_approbations_statut ON approbations(statut);

-- ==================== COMMAND IDEMPOTENCY ====================
-- An approval command consumed exactly once.
CREATE TABLE IF NOT EXISTS commandes_consommees (
    command_id     TEXT PRIMARY KEY,
    correlation_id UUID,
    consomme_le    TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== P&L LEDGER (APPEND-ONLY) ====================
-- Sign convention: REVENUE positive (prime/premium), EXPENSES negative
-- (provision/reserves, reglement/settlement, frais/expenses, marketing). Net result = SUM(montant).
CREATE TABLE IF NOT EXISTS pnl_ledger (
    id             BIGSERIAL PRIMARY KEY,
    correlation_id UUID,
    departement    TEXT NOT NULL,           -- e.g. 'auto', 'sinistres-contentieux', 'finance'
    categorie      TEXT NOT NULL
                   CHECK (categorie IN ('prime', 'provision', 'reglement', 'frais', 'marketing')),
    montant        NUMERIC(14,2) NOT NULL,  -- signed, see convention above
    description    TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pnl_ledger_departement ON pnl_ledger(departement);
CREATE INDEX IF NOT EXISTS idx_pnl_ledger_categorie ON pnl_ledger(categorie);
CREATE INDEX IF NOT EXISTS idx_pnl_ledger_created_at ON pnl_ledger(created_at);

-- ==================== AGENT MEMORY (EMBEDDINGS) ====================
-- 768-dim embedding = ollama nomic-embed-text.
CREATE TABLE IF NOT EXISTS memoire_agents (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    departement    TEXT NOT NULL,
    nature         TEXT NOT NULL,
    contenu        TEXT NOT NULL,
    embedding      vector(768),
    correlation_id UUID,
    partage        BOOLEAN DEFAULT false,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memoire_agents_departement ON memoire_agents(departement);
CREATE INDEX IF NOT EXISTS idx_memoire_agents_partage ON memoire_agents(partage);
-- HNSW index: requires pgvector >= 0.5.0 (shipped by recent pgvector/pgvector:pg16).
CREATE INDEX IF NOT EXISTS idx_memoire_agents_embedding
    ON memoire_agents USING hnsw (embedding vector_cosine_ops);

-- ==================== AUDIT LOG (HASH-CHAINED, APPEND-ONLY) ====================
-- Chaining: hash = sha256(prev_hash || payload), computed on the application side
-- (Hermes / buzz-hermes-bridge). INSERT-only enforced by trigger.
CREATE TABLE IF NOT EXISTS audit_log (
    seq            BIGSERIAL PRIMARY KEY,
    correlation_id UUID,
    source         TEXT NOT NULL,           -- e.g. 'hermes', 'buzz-hermes-bridge'
    action         TEXT NOT NULL,
    payload        JSONB,
    prev_hash      TEXT,
    hash           TEXT NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation ON audit_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_source ON audit_log(source);

-- ==================== APPEND-ONLY: REJECT UPDATE/DELETE ====================
CREATE OR REPLACE FUNCTION reject_update_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Table % is append-only: UPDATE/DELETE forbidden', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pnl_ledger_append_only ON pnl_ledger;
CREATE TRIGGER trg_pnl_ledger_append_only
    BEFORE UPDATE OR DELETE ON pnl_ledger
    FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log;
CREATE TRIGGER trg_audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

-- ==================== GLOBAL KILL-SWITCH ====================
CREATE TABLE IF NOT EXISTS kill_switch (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    actif      BOOLEAN NOT NULL DEFAULT false,
    active_par TEXT,
    active_le  TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO kill_switch (id, actif) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- ==================== MACRO INDICATORS ====================
CREATE TABLE IF NOT EXISTS macro_indicateurs (
    id         SERIAL PRIMARY KEY,
    indicateur TEXT NOT NULL CHECK (indicateur IN ('taux_bdf', 'inflation_insee', 'gpr')),
    valeur     NUMERIC,
    periode    TEXT,
    source     TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_macro_indicateurs_indicateur ON macro_indicateurs(indicateur);

-- ==================== DASHBOARD METRICS VIEWS ====================
-- Weekly net result (ISO week = date_trunc('week')) per department.
CREATE OR REPLACE VIEW v_pnl_hebdo AS
SELECT
    date_trunc('week', created_at)::date AS semaine_iso,
    departement,
    SUM(montant) FILTER (WHERE categorie = 'prime')      AS primes,
    SUM(montant) FILTER (WHERE categorie = 'reglement')  AS reglements,
    SUM(montant) FILTER (WHERE categorie = 'provision')  AS provisions,
    SUM(montant) FILTER (WHERE categorie = 'frais')      AS frais,
    SUM(montant) FILTER (WHERE categorie = 'marketing')  AS marketing,
    SUM(montant)                                          AS resultat_net
FROM pnl_ledger
GROUP BY semaine_iso, departement
ORDER BY semaine_iso, departement;

-- Claims ratio S/P per department: (settlements + reserves) / premiums.
-- Expenses being negative in the ledger, their absolute value is used.
-- NULLIF protects against division by zero.
CREATE OR REPLACE VIEW v_ratio_sinistralite AS
SELECT
    departement,
    ROUND(
        ABS(COALESCE(SUM(montant) FILTER (WHERE categorie IN ('reglement', 'provision')), 0))
        / NULLIF(SUM(montant) FILTER (WHERE categorie = 'prime'), 0)
    , 4) AS ratio_sinistralite
FROM pnl_ledger
GROUP BY departement
ORDER BY departement;

-- ==================== V1<->V2 BRIDGE COLUMNS (sinistres/claims) ====================
-- The bridge/policy work in EUR via `montant_eur` (settlement cap) and
-- `compliance_bloque` (compliance block). These columns are added to the v1
-- sinistres, kept consistent with montant_estime/montant_regle.
ALTER TABLE sinistres ADD COLUMN IF NOT EXISTS montant_eur NUMERIC(12,2);
ALTER TABLE sinistres ADD COLUMN IF NOT EXISTS compliance_bloque BOOLEAN NOT NULL DEFAULT false;
-- Backfill: business rule — reference amount = settled if positive, else estimated.
UPDATE sinistres SET montant_eur = COALESCE(NULLIF(montant_regle,0), NULLIF(montant_estime,0), 0)
 WHERE montant_eur IS NULL OR montant_eur = 0;
-- Keeps the bridge synchronized on every v1 write (settled if positive, else estimated).
-- NULLIF(...,0) because DEFAULT 0 on montant_regle would short-circuit the COALESCE.
CREATE OR REPLACE FUNCTION sync_sinistre_montant_eur() RETURNS trigger AS $$
BEGIN
  NEW.montant_eur := COALESCE(NULLIF(NEW.montant_regle,0), NULLIF(NEW.montant_estime,0), 0);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_sinistre_montant ON sinistres;
CREATE TRIGGER trg_sync_sinistre_montant BEFORE INSERT OR UPDATE ON sinistres
  FOR EACH ROW EXECUTE FUNCTION sync_sinistre_montant_eur();
