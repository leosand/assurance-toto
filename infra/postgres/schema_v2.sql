-- schema_v2.sql — Schéma v2 Assurance Toto : approbations, idempotence,
-- ledger P&L, mémoire agents (embeddings), audit append-only, kill-switch,
-- macro-indicateurs, vues métriques dashboard.
-- PRÉREQUIS : exécuter init_extensions.sql AVANT ce fichier (vector, pgcrypto).
-- Toutes les créations sont idempotentes (IF NOT EXISTS / OR REPLACE).

-- ==================== APPROBATIONS HUMAINES ====================
-- Une approbation par correlation_id (ex. validation d'un règlement sinistre).
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

-- ==================== IDEMPOTENCE DES COMMANDES ====================
-- Une commande d'approbation consommée exactement une fois.
CREATE TABLE IF NOT EXISTS commandes_consommees (
    command_id     TEXT PRIMARY KEY,
    correlation_id UUID,
    consomme_le    TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== LEDGER P&L (APPEND-ONLY) ====================
-- Convention de signe : RECETTES positives (prime), CHARGES négatives
-- (provision, reglement, frais, marketing). Résultat net = SUM(montant).
CREATE TABLE IF NOT EXISTS pnl_ledger (
    id             BIGSERIAL PRIMARY KEY,
    correlation_id UUID,
    departement    TEXT NOT NULL,           -- ex. 'auto', 'sinistres-contentieux', 'finance'
    categorie      TEXT NOT NULL
                   CHECK (categorie IN ('prime', 'provision', 'reglement', 'frais', 'marketing')),
    montant        NUMERIC(14,2) NOT NULL,  -- signé, voir convention ci-dessus
    description    TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pnl_ledger_departement ON pnl_ledger(departement);
CREATE INDEX IF NOT EXISTS idx_pnl_ledger_categorie ON pnl_ledger(categorie);
CREATE INDEX IF NOT EXISTS idx_pnl_ledger_created_at ON pnl_ledger(created_at);

-- ==================== MÉMOIRE AGENTS (EMBEDDINGS) ====================
-- embedding 768 dims = ollama nomic-embed-text.
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
-- Index HNSW : requiert pgvector >= 0.5.0 (fourni par pgvector/pgvector:pg16 récent).
CREATE INDEX IF NOT EXISTS idx_memoire_agents_embedding
    ON memoire_agents USING hnsw (embedding vector_cosine_ops);

-- ==================== AUDIT LOG (HASH-CHAINÉ, APPEND-ONLY) ====================
-- Chaînage : hash = sha256(prev_hash || payload), calculé côté applicatif
-- (Hermes / buzz-hermes-bridge). INSERT-only imposé par trigger.
CREATE TABLE IF NOT EXISTS audit_log (
    seq            BIGSERIAL PRIMARY KEY,
    correlation_id UUID,
    source         TEXT NOT NULL,           -- ex. 'hermes', 'buzz-hermes-bridge'
    action         TEXT NOT NULL,
    payload        JSONB,
    prev_hash      TEXT,
    hash           TEXT NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation ON audit_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_source ON audit_log(source);

-- ==================== APPEND-ONLY : REJET UPDATE/DELETE ====================
CREATE OR REPLACE FUNCTION reject_update_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Table % est append-only : UPDATE/DELETE interdits', TG_TABLE_NAME;
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

-- ==================== KILL-SWITCH GLOBAL ====================
CREATE TABLE IF NOT EXISTS kill_switch (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    actif      BOOLEAN NOT NULL DEFAULT false,
    active_par TEXT,
    active_le  TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO kill_switch (id, actif) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- ==================== MACRO-INDICATEURS ====================
CREATE TABLE IF NOT EXISTS macro_indicateurs (
    id         SERIAL PRIMARY KEY,
    indicateur TEXT NOT NULL CHECK (indicateur IN ('taux_bdf', 'inflation_insee', 'gpr')),
    valeur     NUMERIC,
    periode    TEXT,
    source     TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_macro_indicateurs_indicateur ON macro_indicateurs(indicateur);

-- ==================== VUES MÉTRIQUES DASHBOARD ====================
-- Résultat net hebdomadaire (semaine ISO = date_trunc('week')) par département.
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

-- Ratio de sinistralité S/P par département : (règlements + provisions) / primes.
-- Les charges étant négatives dans le ledger, on prend leur valeur absolue.
-- NULLIF protège contre la division par zéro.
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

-- ==================== COLONNES PONT V1<->V2 (sinistres) ====================
-- Le bridge/policy travaillent en EUR via `montant_eur` (plafond règlement) et
-- `compliance_bloque` (blocage conformité). On ajoute ces colonnes aux sinistres
-- v1, en les maintenant cohérentes avec montant_estime/montant_regle.
ALTER TABLE sinistres ADD COLUMN IF NOT EXISTS montant_eur NUMERIC(12,2);
ALTER TABLE sinistres ADD COLUMN IF NOT EXISTS compliance_bloque BOOLEAN NOT NULL DEFAULT false;
-- Backfill : règle métier — montant de référence = réglé si positif sinon estimé.
UPDATE sinistres SET montant_eur = COALESCE(NULLIF(montant_regle,0), NULLIF(montant_estime,0), 0)
 WHERE montant_eur IS NULL OR montant_eur = 0;
-- Garde le pont synchronisé à chaque écriture v1 (réglé positif sinon estimé).
-- NULLIF(...,0) car DEFAULT 0 sur montant_regle court-circuiterait le COALESCE.
CREATE OR REPLACE FUNCTION sync_sinistre_montant_eur() RETURNS trigger AS $$
BEGIN
  NEW.montant_eur := COALESCE(NULLIF(NEW.montant_regle,0), NULLIF(NEW.montant_estime,0), 0);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_sinistre_montant ON sinistres;
CREATE TRIGGER trg_sync_sinistre_montant BEFORE INSERT OR UPDATE ON sinistres
  FOR EACH ROW EXECUTE FUNCTION sync_sinistre_montant_eur();
