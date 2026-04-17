# TravStats - Combined Frontend + Backend Dockerfile
# This creates a single container with both the web UI and API

# Version argument (pass via: docker build --build-arg VERSION=$(cat backend/VERSION) .)
ARG VERSION=0.0.0-dev

# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder

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
FROM node:20-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 30000 \
    && npm config set fetch-retry-maxtimeout 300000 \
    && npm ci

COPY backend/ ./
RUN rm -rf dist
RUN npx prisma generate
RUN npm run build

# Stage 3: Production - Combined Container
FROM node:20-slim AS production

# Re-declare ARG so it's available in this stage
ARG VERSION=0.0.0-dev

# OCI image labels
LABEL org.opencontainers.image.title="TravStats"
LABEL org.opencontainers.image.description="Personal flight tracking and statistics"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.source="https://github.com/Abrechen2/TravStats"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install nginx, supervisor, and runtime dependencies
RUN apt-get update && apt-get install -y \
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

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
