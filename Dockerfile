# TravStats - Combined Frontend + Backend Dockerfile
# This creates a single container with both the web UI and API

# Version argument (pass via: docker build --build-arg VERSION=$(cat backend/VERSION) .)
ARG VERSION=0.0.0-dev

# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
# Build without VITE_API_URL - frontend will use relative path /api/v1
ENV VITE_API_URL=
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

# Install nginx, supervisor, Python, and other dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    openssl \
    ca-certificates \
    wget \
    netcat-openbsd \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Setup Backend
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN npm ci --only=production
COPY --from=backend-builder /app/backend/dist ./dist
RUN npx prisma generate

# Install Python dependencies for training (PyTorch, etc.)
# Install PyTorch CPU version first (works everywhere, GPU version can be installed later if needed)
RUN echo "[build] Installing PyTorch CPU version..." && \
    pip3 install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    echo "[build] Validating PyTorch installation..." && \
    python3 -c "import torch; print(f'PyTorch {torch.__version__} installed successfully')" || \
    (echo "[build] ❌ ERROR: PyTorch installation validation failed" && exit 1)

# Install other training dependencies
COPY backend/requirements-training.txt ./
RUN echo "[build] Installing other training dependencies..." && \
    pip3 install --no-cache-dir transformers>=4.35.0 peft>=0.6.0 datasets>=2.14.0 accelerate>=0.24.0 bitsandbytes>=0.41.0 && \
    echo "[build] Validating training dependencies..." && \
    python3 -c "import transformers; import peft; import datasets; import accelerate; print('All training dependencies installed successfully')" || \
    (echo "[build] ❌ ERROR: Training dependencies validation failed" && exit 1)

# Copy Python scripts (checkHardware.py and trainLora.py)
# Ensure scripts directory exists before copying
RUN mkdir -p ./dist/scripts
COPY --from=backend-builder /app/backend/src/scripts/checkHardware.py ./dist/scripts/checkHardware.py
COPY --from=backend-builder /app/backend/src/scripts/trainLora.py ./dist/scripts/trainLora.py
COPY --from=backend-builder /app/backend/src/scripts/checkTrainingData.py ./dist/scripts/checkTrainingData.py
COPY --from=backend-builder /app/backend/src/scripts/evalModel.py ./dist/scripts/evalModel.py
RUN chmod +x ./dist/scripts/*.py 2>/dev/null || true

# Copy VERSION file for runtime version reporting
COPY backend/VERSION ./VERSION

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

# Create data directory for persistent config (logs, etc.)
# Note: When /app/data is mounted as a volume, these permissions may be overridden by host
# Create separate secrets directory (NOT mounted) for JWT secret
RUN mkdir -p /app/data/logs && \
    mkdir -p /app/secrets && \
    mkdir -p /var/log/supervisor /var/log/nginx /var/lib/nginx && \
    chown -R www-data:www-data /var/log/nginx /var/lib/nginx && \
    chown -R node:node /app && \
    chmod -R 755 /app/data && \
    chmod 700 /app/secrets

# Volumes for persistent data and secrets
VOLUME ["/app/data", "/app/secrets"]

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
