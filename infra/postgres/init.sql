-- init.sql — Initial Assurance Toto schema (lite version)
-- Executed automatically by PostgreSQL on the container's first startup.

-- ==================== CLIENTS ====================
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE,
  telephone VARCHAR(20),
  adresse TEXT,
  date_naissance DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== CONTRATS ====================
CREATE TABLE IF NOT EXISTS contrats (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  type_contrat VARCHAR(50) NOT NULL,  -- auto, habitation, sante, vie
  numero VARCHAR(30) UNIQUE NOT NULL,
  date_debut DATE NOT NULL,
  date_fin DATE,
  prime_annuelle NUMERIC(10,2),
  statut VARCHAR(20) DEFAULT 'actif', -- actif, suspendu, resilie
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== SINISTRES (claims) ====================
CREATE TABLE IF NOT EXISTS sinistres (
  id SERIAL PRIMARY KEY,
  contrat_id INTEGER NOT NULL REFERENCES contrats(id),
  date_sinistre DATE NOT NULL,
  description TEXT,
  montant_estime NUMERIC(12,2),
  montant_regle NUMERIC(12,2) DEFAULT 0,
  statut VARCHAR(30) DEFAULT 'ouvert', -- ouvert, en_cours, regle, refuse, contentieux
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== AGENTS LOG ====================
CREATE TABLE IF NOT EXISTS agent_actions (
  id SERIAL PRIMARY KEY,
  agent_role VARCHAR(50) NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for frequent queries
CREATE INDEX IF NOT EXISTS idx_contrats_client ON contrats(client_id);
CREATE INDEX IF NOT EXISTS idx_contrats_statut ON contrats(statut);
CREATE INDEX IF NOT EXISTS idx_sinistres_contrat ON sinistres(contrat_id);
CREATE INDEX IF NOT EXISTS idx_sinistres_statut ON sinistres(statut);
