# ---------------------------------------------------------------------------
# Agent ORCHESTRATEUR — instance du runtime Hermes (agents/_runtime).
# Build context = racine du repo assurance-toto (pour accéder à agents/_runtime).
#   docker build -f agents/sales/Dockerfile -t assurance-toto/agent-sales .
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /build
COPY agents/_runtime/package.json agents/_runtime/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY agents/_runtime/tsconfig.json ./
COPY agents/_runtime/src ./src
RUN npm run build

FROM node:20-alpine AS runtime
RUN addgroup -S hermes && adduser -S hermes -G hermes
WORKDIR /app
ENV NODE_ENV=production
COPY agents/_runtime/package.json agents/_runtime/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=hermes:hermes /build/dist ./dist

# Config + skills du département.
COPY --chown=hermes:hermes agents/sales/hermes.config.json /home/hermes/hermes.config.json
COPY --chown=hermes:hermes agents/sales/mcp-allowlist.json /home/hermes/mcp-allowlist.json
COPY --chown=hermes:hermes agents/sales/skills/ /workspace/skills/
RUN chown -R hermes:hermes /workspace

USER hermes
ENV AGENT_ROLE=sales \
    MEMORY_DEPARTEMENT=sales \
    SKILLS_DIR=/workspace/skills \
    HERMES_ALLOWLIST_PATH=/home/hermes/mcp-allowlist.json

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
