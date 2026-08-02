-- init_extensions.sql — Extensions PostgreSQL requises par le schéma v2
-- Exécuté AVANT init.sql / schema_v2.sql (préfixe 00- dans docker-entrypoint-initdb.d).
-- NOTE : requiert l'image pgvector/pgvector:pg16 (l'image postgres:16-alpine
-- ne fournit pas l'extension vector). Le câblage compose est un ticket séparé.

-- pgvector : embeddings 768 dims (ollama nomic-embed-text) pour memoire_agents
CREATE EXTENSION IF NOT EXISTS vector;

-- pgcrypto : gen_random_uuid() (idempotence, approbations, memoire_agents)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
