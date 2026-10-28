# syntax=docker/dockerfile:1

# ---- build: install everything, build the client (Vite) and the server (tsc) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

# ---- deps: production dependencies only (client deps are all devDependencies) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --include-workspace-root \
  && npm cache clean --force

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server/package.json ./server/
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/drizzle ./server/drizzle
COPY --from=build --chown=node:node /app/client/dist ./client/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
# Migrations (and the first-run demo seed) run inside the app before it starts listening.
CMD ["node", "server/dist/index.js"]
