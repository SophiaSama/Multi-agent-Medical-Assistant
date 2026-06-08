# syntax=docker/dockerfile:1

# ── Stage 1: Build (frontend + backend bundle) ────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Public, build-time-inlined values for the Vite frontend (vite.config.ts `define`).
# These are NOT secrets: the Maps key is domain-restricted and the Supabase anon
# key is RLS-safe. Never pass SUPABASE_SECRET_API_KEY / SERVICE_ROLE_KEY here.
ARG GOOGLE_MAPS_PLATFORM_KEY=""
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV GOOGLE_MAPS_PLATFORM_KEY=$GOOGLE_MAPS_PLATFORM_KEY \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Install full deps (devDependencies needed for vite/esbuild/tsc) with a cached store.
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Build: vite build -> dist/ (frontend), esbuild -> dist/server.cjs (backend)
COPY . .
RUN npm run build

# ── Optional: Integration test runner ─────────────────────────────────────────
# Reuses the builder layer (full devDependencies + source, incl. tsx and the
# tests/ JSONL cases). Run via the `test` profile in docker-compose; it executes
# the LLM-as-judge suite against a running server (BASE_URL set in compose).
FROM builder AS tester
ENV NODE_ENV=test
CMD ["npm", "run", "test:integration"]

# ── Stage 2: Production dependencies only ─────────────────────────────────────
# server.cjs is bundled with --packages=external, so runtime needs node_modules.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist          ./dist
COPY package.json ./

# Run as the built-in non-root `node` user (UID 1000).
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "dist/server.cjs"]
