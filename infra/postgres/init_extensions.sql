-- init_extensions.sql — PostgreSQL extensions required by the v2 schema
-- Executed BEFORE init.sql / schema_v2.sql (00- prefix in docker-entrypoint-initdb.d).
-- NOTE: requires the pgvector/pgvector:pg16 image (the postgres:16-alpine image
-- does not ship the vector extension). The compose wiring is a separate ticket.

-- pgvector: 768-dim embeddings (ollama nomic-embed-text) for memoire_agents
CREATE EXTENSION IF NOT EXISTS vector;

-- pgcrypto: gen_random_uuid() (idempotence, approvals, memoire_agents)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
