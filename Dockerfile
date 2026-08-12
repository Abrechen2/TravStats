# TravStats - Combined Frontend + Backend Dockerfile
# This creates a single container with both the web UI and API

# Version argument (pass via: docker build --build-arg VERSION=$(cat backend/VERSION) .)
ARG VERSION=0.0.0-dev

# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 30000 \
    && npm config set fetch-retry-maxtimeout 300000 \
    && npm ci

COPY frontend/ ./
# Build without VITE_API_URL - frontend will use relative path /api/v1
ENV VITE_API_URL=
RUN npm run build

# Stage 2: Build Backend
FROM node:22-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/package*.json ./
COPY backend/prisma ./prisma/
# bcrypt downloads a prebuilt binary from a GitHub release and falls back to
# compiling from source when that fails. The fallback needs python3 and a
# toolchain, which node:22-alpine does not carry — so a flaky CDN became a hard
# build failure: measured 2026-08-12, one request in three for
# bcrypt_lib-v5.1.1-napi-v3-linux-x64-musl.tar.gz ended in a socket hang up.
# 2.6.0-beta.7 lost that roll; 2.5.2-rc.4 an hour earlier had won it. npm's
# fetch-retries below do not cover node-pre-gyp's own download, so they never
# helped. These packages make the documented fallback actually work. They live
# in the builder stage and never reach the production image.
RUN apk add --no-cache python3 make g++
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 30000 \
    && npm config set fetch-retry-maxtimeout 300000 \
    && npm ci

COPY backend/ ./
RUN rm -rf dist
RUN npx prisma generate
RUN npm run build

# Stage 3: Production - Combined Container
# Pinned to bookworm-slim so apt sources are deterministic.
FROM node:22-bookworm-slim AS production

# Re-declare ARG so it's available in this stage
ARG VERSION=0.0.0-dev

# OCI image labels
LABEL org.opencontainers.image.title="TravStats"
LABEL org.opencontainers.image.description="Personal flight tracking and statistics"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.source="https://github.com/Abrechen2/TravStats"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install nginx, supervisor, and runtime dependencies.
# Security: apt-get upgrade pulls the latest Debian security patches on top
# of the base image (closes CVEs that accumulate between base-image rebuilds).
RUN apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    openssl \
    ca-certificates \
    wget \
    netcat-openbsd \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Setup Backend
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 30000 \
    && npm config set fetch-retry-maxtimeout 300000 \
    && npm ci --only=production
COPY --from=backend-builder /app/backend/dist ./dist
# tsc compiles .ts files only — non-TS assets (CSV seed data) need an
# explicit copy so seedPortsFromCSV / seedShipsFromCSV find them at
# dist/seedData/*.csv. Without this, both seeders silently skip with
# `csv_missing` on first boot, leaving the cruise/ferry domain unable
# to resolve port + ship references.
COPY --from=backend-builder /app/backend/src/seedData ./dist/seedData
# schematicRouter resolves the fine land-mask via __dirname relative to
# its compiled location (dist/services/...), landing at /app/backend/data/.
# Without this copy, /api/v1/cruises/geometry(/batch) returns 500 with
# ENOENT on every request, so cruise paths never render on the globe.
COPY backend/data/land-mask.bin ./data/land-mask.bin
# Vendored Eurostat marnet shipping-lane graph used by the marnet
# pathfinder (services/marnet/marnetGraph.ts). 1.6 MB GeoJSON, ~6 k
# nodes / ~7.6 k edges. Without this file the marnet router throws
# ENOENT on first call and every cruise leg falls back to the coarse
# 1° A*, which cuts across narrow Baltic and Adriatic straits.
COPY backend/data/marnet/marnet.geojson ./data/marnet/marnet.geojson
# Vendored airline logos (soaring-symbols, MIT) — the KEYLESS DEFAULT tier of
# the logo chain (services/airlineLogo/vendoredLogos.ts), resolved via __dirname
# from dist/services/... to /app/backend/data/airline-logos. 1.4 MB, 93 airlines.
# Without this copy the tier silently disappears in production and every logo
# falls through to the external Daisycon hotlink — the exact regression this
# feature exists to remove. It fails soft (a warn, not a crash), so nothing but
# this comment will tell you.
COPY backend/data/airline-logos ./data/airline-logos
# Vendored OpenFlights airline + aircraft seed data (data/openflights/*.dat),
# consumed by the boot seeders (seedAirlinesFromData / seedAircraftFromData).
# Without these the airline/aircraft tables seed empty and the logo lookup
# degrades to placeholders.
COPY backend/data/openflights/airlines.dat ./data/openflights/airlines.dat
COPY backend/data/openflights/planes.dat ./data/openflights/planes.dat
# Bundle one-shot maintenance scripts (e.g. backfillRouteDistance.ts) into
# the production image so the `docker exec TravStats npx tsx
# /app/backend/scripts/<name>.ts` workflow advertised in the CHANGELOG
# actually resolves. These are not part of the running app; they exist
# only for the operator to invoke explicitly on demand.
COPY backend/scripts ./scripts
RUN npx prisma generate

# Write VERSION file for runtime version reporting.
# Uses the build-arg (1.0.0, 1.0.0-rc.6, …) so RC / prerelease images
# surface their suffix in Admin → System-Info and the About page,
# rather than the "base" version stored in backend/VERSION.
RUN echo "${VERSION}" > ./VERSION

# Setup Frontend (nginx will serve these files)
WORKDIR /app/frontend
COPY --from=frontend-builder /app/frontend/dist ./dist

# Nginx configuration (Debian uses sites-available)
COPY nginx-combined.conf /etc/nginx/sites-available/default
RUN rm -f /etc/nginx/sites-enabled/default && \
    ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Supervisor configuration (Debian uses conf.d)
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
# Fix line endings (CRLF -> LF) and make executable
RUN sed -i 's/\r$//' /docker-entrypoint.sh && \
    chmod +x /docker-entrypoint.sh

# Boot-race wrapper: nginx waits for backend /health before serving.
# See scripts/wait-then-nginx.sh for the why and the env knobs.
COPY scripts/wait-then-nginx.sh /app/scripts/wait-then-nginx.sh
RUN sed -i 's/\r$//' /app/scripts/wait-then-nginx.sh && \
    chmod +x /app/scripts/wait-then-nginx.sh

# Create data directory for persistent config (logs, secrets, backups, …)
# Secrets live at /app/data/secrets — one mounted volume covers everything.
# The subdirectory gets 0700 so it's not world-readable even if someone
# overrides the parent mode from the host.
RUN mkdir -p /app/data/logs /app/data/secrets && \
    mkdir -p /var/log/supervisor /var/log/nginx /var/lib/nginx && \
    chown -R www-data:www-data /var/log/nginx /var/lib/nginx && \
    chown -R node:node /app && \
    chmod -R 755 /app/data && \
    chmod 700 /app/data/secrets

# Single volume — data, logs, backups, secrets all live underneath /app/data
VOLUME ["/app/data"]

EXPOSE 80

# 180s start-period covers the longest observed boot path:
# Prisma generate (~5s) + migrate deploy (~10s) + closed-airport
# backfill (~30s) + airport-seed first install (~90s) + Express
# listen (~3s) + the wait-then-nginx poll loop (~2s).
HEALTHCHECK --interval=30s --timeout=3s --start-period=180s \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
