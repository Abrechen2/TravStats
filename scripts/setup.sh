#!/bin/bash
# TravStats Self-Hosted Setup Script
# Easy one-command setup for your own instance

set -e  # Exit on error

echo "🏠 TravStats Self-Hosted Setup"
echo "================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found."
    read -p "Install Docker? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "📦 Installing Docker..."
        curl -fsSL https://get.docker.com | sh
        echo "✅ Docker installed"
    else
        echo "⚠️  Docker is required. Please install it manually and run this script again."
        exit 1
    fi
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose not found."
    echo "⚠️  Please install Docker Compose and run this script again."
    exit 1
fi

COMPOSE_CMD="docker-compose"
if ! command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker compose"
fi

echo "✅ Docker is installed"
echo ""

# Get instance name
read -p "Instance name (e.g., 'Smith Family', default: 'TravStats'): " INSTANCE_NAME
INSTANCE_NAME=${INSTANCE_NAME:-TravStats}

# Generate secrets
echo "🔑 Generating secure secrets..."
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)
echo "✅ Secrets generated"

# Create backend .env file
echo "📝 Creating configuration..."
cat > backend/.env <<EOF
# Self-Hosting Configuration
INSTANCE_NAME=$INSTANCE_NAME
ALLOW_REGISTRATION=true
MAX_USERS=10

# Database
DATABASE_URL=postgresql://flights:$DB_PASSWORD@db:5432/flights

# Security
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d
NODE_ENV=production
COOKIE_SECURE=false

# Server
PORT=8000
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# Optional APIs (leave empty if not needed)
AIRLABS_API_KEY=
EOF

# Create frontend .env file
cat > frontend/.env <<EOF
VITE_API_URL=http://localhost:8000
EOF

echo "✅ Configuration created"
echo ""

# Start Docker services
echo "🚀 Starting services..."
$COMPOSE_CMD up -d

echo "⏳ Waiting for database to be ready..."
sleep 10

# Run database migrations
echo "🗃️  Setting up database..."
$COMPOSE_CMD exec backend npx prisma migrate deploy || {
    echo "⚠️  Migration failed. Trying to generate Prisma client first..."
    $COMPOSE_CMD exec backend npx prisma generate
    $COMPOSE_CMD exec backend npx prisma migrate deploy
}

# Seed airports (optional but recommended)
echo "🌍 Seeding airport database..."
$COMPOSE_CMD exec backend npm run seed:airports:csv || echo "⚠️  Airport seeding failed (non-critical)"

# Seed achievements
echo "🏆 Seeding achievements..."
# Achievements are core features defined in code, not seeded from database
# They are automatically ensured when needed via ensureAchievements() function

echo ""
echo "✅ Setup complete!"
echo "================================"
echo ""
echo "📍 Access TravStats at:"
echo "   Frontend: http://localhost:3000"
echo "   Backend API: http://localhost:8000"
echo ""
echo "👤 Next steps:"
echo "   1. Open http://localhost:3000 in your browser"
echo "   2. Create your admin account (first user)"
echo "   3. Invite family/friends via Admin Panel"
echo ""
echo "💡 Configuration:"
echo "   Instance: $INSTANCE_NAME"
echo "   Max users: 10 (recommended)"
echo "   Registration: Enabled (consider disabling after setup)"
echo ""
echo "📖 For remote access options (VPN, Tailscale, domain):"
echo "   See README.md deployment section"
echo ""
echo "🔐 Security reminders:"
echo "   - Your JWT secret has been generated securely"
echo "   - Change database password if exposing to internet"
echo "   - Enable HTTPS if using a public domain"
echo "   - Run backups regularly: ./scripts/backup.sh"
echo ""
