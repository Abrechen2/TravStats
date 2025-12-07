# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install Python and build dependencies for training
RUN apk add --no-cache \
    python3 \
    py3-pip \
    build-base \
    python3-dev \
    g++ \
    make \
    && ln -sf python3 /usr/bin/python

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --only=production

# Install Python dependencies for training
COPY requirements-training.txt ./
RUN pip3 install --no-cache-dir -r requirements-training.txt || echo "Warning: Some Python packages may not be available"

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy training scripts
COPY --from=builder /app/src/scripts/trainLora.py ./dist/scripts/trainLora.py

# Generate Prisma client
RUN npx prisma generate

# Expose port
EXPOSE 8000

# Start application
CMD ["npm", "start"]

# Development stage
FROM node:20-alpine AS development

# Install Python for development
RUN apk add --no-cache \
    python3 \
    py3-pip \
    build-base \
    python3-dev \
    g++ \
    make \
    && ln -sf python3 /usr/bin/python

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy prisma schema
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Install Python dependencies for training
COPY requirements-training.txt ./
RUN pip3 install --no-cache-dir -r requirements-training.txt || echo "Warning: Some Python packages may not be available"

# Copy training scripts (for development)
COPY src/scripts/trainLora.py ./src/scripts/trainLora.py

# Expose port
EXPOSE 8000

# Start development server
CMD ["npm", "run", "dev"]
