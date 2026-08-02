# ---------------------------------------------------------------------------
# Hermes Agent runtime — image de base partagée par tous les agents départementaux.
# Multi-stage : build TS → runtime Node 20 alpine non-root.
# Les Dockerfiles départementaux (agents/<dept>/Dockerfile) partent de celle-ci
# et n'ajoutent que la config + skills du département.
# ---------------------------------------------------------------------------

# ---- Stage 1 : build TypeScript ----
FROM node:20-alpine AS build
WORKDIR /build
COPY agents/_runtime/package.json agents/_runtime/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY agents/_runtime/tsconfig.json ./
COPY agents/_runtime/src ./src
COPY agents/_runtime/vitest.config.ts ./
COPY agents/_runtime/test ./test
RUN npm run build

# ---- Stage 2 : runtime production (non-root) ----
FROM node:20-alpine AS runtime

# Utilisateur non-root dédié.
RUN addgroup -S hermes && adduser -S hermes -G hermes

WORKDIR /app
ENV NODE_ENV=production

# Dépendances de prod seulement.
COPY agents/_runtime/package.json agents/_runtime/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Code compilé.
COPY --from=build --chown=hermes:hermes /build/dist ./dist

# Point de montage des skills (surchargé par chaque département via SKILLS_DIR).
RUN mkdir -p /workspace/skills && chown -R hermes:hermes /workspace

USER hermes

# Santé : /healthz exposé par le serveur fastify.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 4000

# L'agent est paramétré par AGENT_ROLE (env) au runtime.
CMD ["node", "dist/index.js"]
