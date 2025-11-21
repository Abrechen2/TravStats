# TravStats - Combined Frontend + Backend Dockerfile
# This creates a single container with both the web UI and API

# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend
FROM node:20-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN npm ci

COPY backend/ ./
RUN npx prisma generate
RUN npm run build

# Stage 3: Production - Combined Container
FROM node:20-alpine AS production

WORKDIR /app

# Install nginx and supervisor
RUN apk add --no-cache nginx supervisor

# Setup Backend
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN npm ci --only=production
COPY --from=backend-builder /app/backend/dist ./dist
RUN npx prisma generate

# Setup Frontend (nginx will serve these files)
WORKDIR /app/frontend
COPY --from=frontend-builder /app/frontend/dist ./dist

# Nginx configuration
COPY nginx-combined.conf /etc/nginx/http.d/default.conf

# Supervisor configuration (manages both nginx and node)
COPY supervisord.conf /etc/supervisord.conf

# Startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directory for persistent config (JWT secret, etc.)
RUN mkdir -p /app/data && \
    mkdir -p /var/lib/nginx/tmp /var/log/supervisor /run/nginx && \
    chown -R nginx:nginx /var/lib/nginx /var/log/nginx /run/nginx && \
    chown -R node:node /app

# Volume for persistent data (JWT secret, future configs)
VOLUME ["/app/data"]

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
