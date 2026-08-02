# syntax=docker/dockerfile:1

# ---- Build stage -------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
# Install from manifest+lockfile only (reproducible), then copy sources.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

# ---- Runtime stage -----------------------------------------------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Non-root runtime user (no secrets baked in the image; env injected at run time).
RUN addgroup -S bridge && adduser -S bridge -G bridge
COPY --from=build --chown=bridge:bridge /app/node_modules ./node_modules
COPY --from=build --chown=bridge:bridge /app/dist ./dist
COPY --chown=bridge:bridge package.json ./
USER bridge
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3100/healthz >/dev/null 2>&1 || exit 1
CMD ["node", "dist/server.js"]
