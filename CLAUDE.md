# CLAUDE.md - TravStats AI Assistant Guide

> **Purpose**: This document provides AI assistants with comprehensive context about the TravStats codebase structure, development workflows, and conventions to follow when assisting with development tasks.

**Last Updated**: 2025-11-27
**Project**: TravStats - Flight Tracking & Analytics Platform
**Stack**: TypeScript, React, Express, Prisma, PostgreSQL

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Codebase Architecture](#codebase-architecture)
4. [Development Workflows](#development-workflows)
5. [Key Conventions](#key-conventions)
6. [Common Tasks](#common-tasks)
7. [Testing Guidelines](#testing-guidelines)
8. [Security Considerations](#security-considerations)
9. [Troubleshooting](#troubleshooting)
10. [Quick Reference](#quick-reference)

---

## Project Overview

### What is TravStats?

TravStats is a **self-hosted flight tracking and analytics platform** designed for privacy-conscious travelers who want full control over their personal flight data. Similar to self-hosted solutions like Nextcloud or Home Assistant, each user (or small group like family/friends) runs their own private instance.

**Key Philosophy:**
- **Privacy First**: Your flight data stays on YOUR server
- **Self-Hosted**: Each person/family runs their own instance
- **Small Scale**: Designed for 1-10 accounts per server (family & close friends)
- **Data Ownership**: You control your data, backups, and access
- **Not a SaaS**: This is NOT a multi-tenant cloud service

### Deployment Model

**Typical Use Cases:**
- Individual runs their own instance for personal use
- Family shares one server (parents, kids can have separate accounts)
- Small friend group shares an instance (vacation buddies, travel club)
- Each instance is completely independent and private

**Infrastructure Options:**
- Home server (Raspberry Pi, NAS, old laptop)
- Personal VPS (DigitalOcean, Hetzner, etc.)
- Docker on personal computer
- Local network only OR exposed via VPN/Tailscale for remote access

### Core Features

- **Flight Management**: CRUD operations for flights with detailed information (airline, aircraft, airports, times, costs, etc.)
- **Interactive Mapping**: Leaflet-based maps with curved flight routes and airport markers
- **Gamification**: 20+ achievements with tier system (Bronze to Diamond)
- **Advanced Statistics**: CO2 tracking, cost analysis, route statistics, temporal trends
- **Email Import**: Automated boarding pass parsing via IMAP
- **Export Options**: CSV, GeoJSON, KML, PDF reports
- **User Settings**: Comprehensive preferences including dark mode, units, timezone

### User Flow

1. Admin sets up their own TravStats server (Docker or manual)
2. Admin creates accounts for family/friends (or allows registration)
3. Each user logs in to the shared instance
4. Users add flights manually or via email import/QR scanner
5. Users view their personal flights on interactive map with statistics
6. Users earn achievements and analyze their travel patterns
7. Data stays private on the self-hosted server

---

## Technology Stack

### Backend (`/backend`)

| Technology | Purpose | Version |
|------------|---------|---------|
| **Node.js** | Runtime | 20+ |
| **TypeScript** | Type safety | Latest |
| **Express** | Web framework | ^4.18 |
| **Prisma** | ORM & type-safe DB client | ^5.7 |
| **PostgreSQL** | Database | 15 |
| **PostGIS** | Geospatial extension | 3.4 |
| **JWT** | Authentication | jsonwebtoken |
| **Bcrypt** | Password hashing | ^5.1 |
| **Zod** | Runtime validation | ^3.22 |
| **Jest** | Testing framework | ^29.7 |
| **Helmet** | Security headers | ^7.1 |
| **Pino** | Logging | ^8.17 |

**Key Dependencies:**
```json
{
  "express": "^4.18.2",
  "prisma": "^5.7.1",
  "@prisma/client": "^5.7.1",
  "jsonwebtoken": "^9.0.2",
  "bcrypt": "^5.1.1",
  "zod": "^3.22.4",
  "helmet": "^7.1.0",
  "cors": "^2.8.5",
  "express-rate-limit": "^7.1.5"
}
```

### Frontend (`/frontend`)

| Technology | Purpose | Version |
|------------|---------|---------|
| **React** | UI framework | 18 |
| **TypeScript** | Type safety | Latest |
| **Vite** | Build tool & dev server | ^5.0 |
| **React Router** | Client-side routing | ^6.21 |
| **Zustand** | State management | ^4.4 |
| **Tailwind CSS** | Utility-first CSS | ^3.4 |
| **React Leaflet** | Interactive maps | ^4.2 |
| **Recharts** | Charts & visualization | ^2.10 |
| **Axios** | HTTP client | ^1.6 |
| **date-fns** | Date formatting | ^3.0 |

**Key Dependencies:**
```json
{
  "react": "^18.2.0",
  "react-router-dom": "^6.21.1",
  "zustand": "^4.4.7",
  "tailwindcss": "^3.4.0",
  "react-leaflet": "^4.2.1",
  "recharts": "^2.10.3",
  "axios": "^1.6.2",
  "react-hook-form": "^7.49.2",
  "@zxing/library": "^0.20.0"
}
```

### Infrastructure (Self-Hosting Focused)

- **Docker**: Containerization (recommended deployment method)
- **Docker Compose**: Simple multi-container orchestration (perfect for self-hosting)
- **Nginx**: Production web server for frontend
- **Supervisor**: Process management in production

**Self-Hosting Considerations:**
- **Lightweight**: Can run on Raspberry Pi 4 (4GB+ RAM recommended)
- **Single Machine**: All services (frontend, backend, database) on one server
- **No Scaling Needed**: Designed for 1-10 users, not thousands
- **Simple Backup**: Standard PostgreSQL dumps + file backups
- **Resource Usage**: ~500MB RAM for all services, minimal CPU
- **Remote Access**: VPN (WireGuard, Tailscale) or reverse proxy with HTTPS

---

## Codebase Architecture

### Backend Structure

```
backend/
├── prisma/
│   ├── schema.prisma              # Database schema definition
│   └── migrations/                # Migration history
│       ├── 20251120163643_init/
│       ├── 20251120170103_add_airports/
│       ├── 20251121164739_add_achievements/
│       ├── 20251122135516_add_boarding_pass_fields/
│       ├── 20251122175725_add_costs_tags_fields/
│       └── 20251123145754_add_ticket_price_and_imports/
├── src/
│   ├── __tests__/                 # Integration tests
│   │   ├── auth.test.ts           # Authentication flow tests
│   │   └── flights.test.ts        # Flight CRUD tests
│   ├── middleware/                # Express middleware
│   │   ├── auth.ts                # JWT authentication (HttpOnly cookies)
│   │   ├── errorHandler.ts       # Centralized error handling
│   │   ├── rateLimit.ts          # API rate limiting
│   │   └── upload.ts             # Multer file upload config
│   ├── routes/                    # API route handlers (thin controllers)
│   │   ├── auth.ts                # POST /register, /login, /logout
│   │   ├── flights.ts             # CRUD + GET /geo (GeoJSON)
│   │   ├── flightLookup.ts        # External API integration (AirLabs)
│   │   ├── airports.ts            # Airport search/autocomplete
│   │   ├── achievements.ts        # Achievement system
│   │   ├── stats.ts               # Statistics endpoints
│   │   ├── analytics.ts           # Event tracking
│   │   ├── settings.ts            # User settings (JSON)
│   │   ├── uploads.ts             # Receipt uploads
│   │   └── imports.ts             # Email import management
│   ├── schemas/                   # Zod validation schemas
│   │   ├── auth.ts                # Login/register validation
│   │   └── flight.ts              # Flight CRUD validation
│   ├── services/                  # Business logic layer
│   │   ├── flightLookup.ts        # AirLabs/OpenSky API integration
│   │   ├── airportLookup.ts       # Airport data enrichment
│   │   ├── bookingParser.ts       # Email parsing (regex-based)
│   │   └── imapPoller.ts          # Email polling service
│   ├── utils/                     # Helper utilities
│   │   ├── achievements.ts        # Achievement calculation logic
│   │   ├── geo.ts                 # Haversine distance, great circles
│   │   ├── jwt.ts                 # JWT sign/verify
│   │   ├── password.ts            # Bcrypt hash/compare
│   │   ├── logger.ts              # Pino logger instance
│   │   └── database.ts            # Database utilities
│   ├── db.ts                      # Prisma client singleton
│   ├── index.ts                   # Express app entry point
│   ├── seed.ts                    # Demo user & flights
│   ├── seedAirports.ts            # Airport database seed
│   ├── seedAirportsFromCSV.ts     # CSV import script
│   └── seedAchievements.ts        # Achievement definitions
├── uploads/receipts/              # User-uploaded files (gitignored)
├── Dockerfile                     # Multi-stage build
├── package.json                   # Dependencies & scripts
├── tsconfig.json                  # TypeScript config
└── jest.config.js                 # Jest test config
```

### Frontend Structure

```
frontend/
├── src/
│   ├── components/                # Reusable React components
│   │   ├── Map.tsx                # Main Leaflet map with flight routes
│   │   ├── GlobeView.tsx          # 3D globe visualization (react-globe.gl)
│   │   ├── FlightList.tsx         # Flight table with actions
│   │   ├── FlightForm.tsx         # Full flight creation form
│   │   ├── SimplifiedFlightFormV2.tsx  # Quick add form (recommended)
│   │   ├── FlightEditModal.tsx    # Edit dialog
│   │   ├── Stats.tsx              # Statistics dashboard cards
│   │   ├── FlightCalendar.tsx     # Calendar view with heatmap
│   │   ├── YearHeatmap.tsx        # Year-at-a-glance visualization
│   │   ├── BoardingPassScanner.tsx # QR/barcode scanner
│   │   ├── ReceiptUpload.tsx      # File upload component
│   │   ├── AirportAutocomplete.tsx # Typeahead search
│   │   ├── AirportMarkers.tsx     # Leaflet markers
│   │   ├── Filters.tsx            # Flight filtering UI
│   │   ├── DarkModeToggle.tsx     # Theme switcher
│   │   └── ErrorBoundary.tsx      # React error boundary
│   ├── pages/                     # Route-level components
│   │   ├── LoginPage.tsx          # /login
│   │   ├── RegisterPage.tsx       # /register
│   │   ├── DashboardPage.tsx      # / (main app, map + list)
│   │   ├── AdvancedStatsPage.tsx  # /stats (charts, CO2, costs)
│   │   ├── AchievementsPage.tsx   # /achievements (badge gallery)
│   │   └── SettingsPage.tsx       # /settings (user preferences)
│   ├── store/                     # Zustand global state
│   │   ├── authStore.ts           # User, token, login/logout
│   │   ├── themeStore.ts          # Dark mode state
│   │   └── settingsStore.ts       # User preferences
│   ├── lib/                       # Utilities
│   │   ├── api.ts                 # Axios client + API functions
│   │   └── bcbpParser.ts          # Boarding pass parser
│   ├── types/
│   │   └── index.ts               # TypeScript type definitions
│   ├── App.tsx                    # Router setup, protected routes
│   ├── main.tsx                   # React entry point (createRoot)
│   └── index.css                  # Tailwind imports + custom classes
├── public/                        # Static assets (favicon, images)
├── Dockerfile                     # Multi-stage build (Vite + Nginx)
├── nginx.conf                     # Production web server config
├── package.json                   # Dependencies & scripts
├── tsconfig.json                  # TypeScript config
├── vite.config.ts                 # Vite bundler config
├── tailwind.config.js             # Tailwind CSS config
└── postcss.config.js              # PostCSS (Tailwind processing)
```

### Architectural Patterns

#### Backend: Layered Architecture

```
Request Flow:
HTTP Request
  → Middleware (auth, rate-limit)
  → Route Handler (validation with Zod)
  → Service Layer (business logic)
  → Prisma ORM
  → PostgreSQL Database
  → Response
```

**Key Principles:**
- **Thin Controllers**: Route handlers delegate to services
- **Service Layer**: Contains business logic, external API calls
- **Validation**: Zod schemas at route level, type inference
- **Error Handling**: Centralized middleware catches all errors
- **Type Safety**: Prisma generates types from schema

**Example Route Pattern:**
```typescript
// backend/src/routes/flights.ts
router.post('/', authenticate, flightCreationLimiter, async (req, res, next) => {
  try {
    // 1. Validate with Zod
    const data = createFlightSchema.parse(req.body);

    // 2. Enrich with service
    const enriched = await enrichFlightAirports(data);

    // 3. Database via Prisma
    const flight = await prisma.flight.create({
      data: { ...enriched, userId: req.userId! }
    });

    // 4. Check achievements
    await checkAndUnlockAchievements(req.userId!);

    res.status(201).json(flight);
  } catch (error) {
    next(error); // errorHandler middleware processes
  }
});
```

#### Frontend: Component-Based with Centralized State

```
Component Hierarchy:
App.tsx (Router)
  ├── LoginPage / RegisterPage (public)
  └── Protected Routes
      ├── DashboardPage
      │   ├── Map (with FlightRoutes)
      │   ├── FlightList
      │   └── SimplifiedFlightFormV2
      ├── AdvancedStatsPage
      │   ├── Charts (Recharts)
      │   └── Statistics Tables
      ├── AchievementsPage
      │   └── Badge Gallery
      └── SettingsPage
          └── Settings Forms
```

**State Management Strategy:**
- **Global State (Zustand)**: Auth, user, theme, settings
- **Server State (React hooks)**: Flights, stats (fetched via API)
- **Local State (useState)**: UI state, form inputs
- **Persistence**: Zustand middleware syncs to localStorage

**Example Component Pattern:**
```typescript
// frontend/src/pages/DashboardPage.tsx
export default function DashboardPage() {
  // Global state
  const { user } = useAuthStore();

  // Server state (fetched)
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);

  // Local UI state
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);

  // Data fetching
  useEffect(() => {
    const loadFlights = async () => {
      const { flights } = await api.flights.getAll();
      setFlights(flights);
      setLoading(false);
    };
    loadFlights();
  }, []);

  // Compose components
  return (
    <div>
      <Map flights={flights} selectedFlightId={selectedFlight} />
      <FlightList flights={flights} onSelect={setSelectedFlight} />
    </div>
  );
}
```

---

## Development Workflows

### Initial Setup

#### Option 1: Docker (Recommended)

```bash
# 1. Clone repository
git clone <repo-url>
cd TravStats

# 2. Start all services
docker-compose up -d

# 3. Initialize database
docker-compose exec backend npx prisma migrate deploy

# 4. Seed data (optional)
docker-compose exec backend npm run seed
docker-compose exec backend npm run seed:airports:csv
docker-compose exec backend npm run seed:achievements

# 5. Access application
# Frontend: http://localhost:3000
# Backend: http://localhost:8000
# API Health: http://localhost:8000/health
```

#### Option 2: Local Development

**Backend:**
```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL connection

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed database
npm run seed
npm run seed:airports:csv
npm run seed:achievements

# Start dev server (http://localhost:8000)
npm run dev
```

**Frontend:**
```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env if backend URL differs

# Start dev server (http://localhost:3000)
npm run dev
```

### Daily Development Workflow

```bash
# 1. Start services
docker-compose up -d  # or manually start backend/frontend

# 2. Make changes (hot-reload enabled)
# - Backend: tsx watch auto-reloads on save
# - Frontend: Vite HMR updates instantly

# 3. Run tests
cd backend && npm test
cd frontend && npm test

# 4. Check types
cd backend && npx tsc --noEmit
cd frontend && npm run build  # includes type check

# 5. Commit changes
git add .
git commit -m "descriptive message"
git push
```

### Database Workflow

```bash
# Modify schema
edit backend/prisma/schema.prisma

# Create migration
cd backend
npx prisma migrate dev --name descriptive_name

# Apply migration to production
npx prisma migrate deploy

# View database
npx prisma studio  # Opens GUI at http://localhost:5555

# Reset database (development only!)
npx prisma migrate reset  # Drops DB, re-runs all migrations + seed

# Generate Prisma client after schema changes
npx prisma generate
```

### Common Scripts

**Backend (`backend/package.json`):**
```bash
npm run dev                    # Start dev server (tsx watch)
npm run build                  # Compile TypeScript to dist/
npm start                      # Run compiled code (production)
npm test                       # Run Jest tests
npm run test:watch             # Watch mode for TDD
npm run prisma:generate        # Generate Prisma client
npm run prisma:migrate         # Create & apply migration
npm run prisma:studio          # Open Prisma Studio GUI
npm run seed                   # Seed demo user & flights
npm run seed:airports          # Seed airports from API
npm run seed:airports:csv      # Seed airports from CSV (7000+)
npm run seed:achievements      # Seed achievement definitions
```

**Frontend (`frontend/package.json`):**
```bash
npm run dev                    # Start Vite dev server (port 3000)
npm run build                  # TypeScript check + Vite build
npm run preview                # Preview production build
npm run lint                   # ESLint check
npm run lint:fix               # Auto-fix linting issues
```

**Docker:**
```bash
# Development
docker-compose up -d           # Start all services
docker-compose down            # Stop all services
docker-compose logs -f         # Follow logs
docker-compose exec backend sh # Shell into backend container
docker-compose restart backend # Restart specific service

# Production
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml down
```

---

## Key Conventions

### Code Style

#### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| **Files** | camelCase (utils), PascalCase (components) | `flightLookup.ts`, `DashboardPage.tsx` |
| **Directories** | lowercase, kebab-case if needed | `src/`, `src/__tests__/` |
| **Components** | PascalCase | `FlightList`, `AirportAutocomplete` |
| **Functions** | camelCase | `loadFlights()`, `calculateDistance()` |
| **Variables** | camelCase | `selectedFlight`, `totalDistance` |
| **Constants** | UPPER_SNAKE_CASE | `JWT_SECRET`, `DEFAULT_LIMIT` |
| **Types/Interfaces** | PascalCase | `Flight`, `FlightInput`, `AuthRequest` |
| **Database Tables** | snake_case | `flights`, `user_achievements` |
| **API Endpoints** | kebab-case, plural | `/api/v1/flights`, `/flight-lookup` |

#### File Organization

**Backend:**
```
Feature-based + Layer separation
routes/      → HTTP handlers (thin)
services/    → Business logic (thick)
utils/       → Pure helper functions
middleware/  → Cross-cutting concerns
schemas/     → Validation (Zod)
```

**Frontend:**
```
Component-based organization
pages/       → Route components (data fetching)
components/  → Reusable UI (presentational)
store/       → Global state (Zustand)
lib/         → Utilities and API client
types/       → TypeScript definitions
```

### TypeScript Conventions

#### Strict Mode Guidelines

```typescript
// ✅ Good: Explicit nullable types
function findFlight(id: string): Flight | null {
  return flights.find(f => f.id === id) ?? null;
}

// ❌ Bad: Implicit any
function processFlight(data) { // Error: Parameter 'data' implicitly has 'any' type
  // ...
}

// ✅ Good: Type inference preferred for locals
const flight = await prisma.flight.findUnique({ where: { id } });
// Type: Flight | null (inferred from Prisma)

// ✅ Good: Explicit return types for public functions
export async function getAllFlights(userId: string): Promise<Flight[]> {
  return await prisma.flight.findMany({ where: { userId } });
}
```

#### Type Inference from Zod

```typescript
// Define schema
const createFlightSchema = z.object({
  airline: z.string().optional(),
  flightNumber: z.string().optional(),
  // ...
});

// Infer type automatically
export type CreateFlightInput = z.infer<typeof createFlightSchema>;

// Use in function signatures
export async function createFlight(data: CreateFlightInput): Promise<Flight> {
  // TypeScript knows exact shape of data
}
```

#### Extending Express Types

```typescript
// backend/src/middleware/auth.ts
declare global {
  namespace Express {
    interface Request {
      userId?: string;  // Added by authenticate middleware
    }
  }
}

// Usage in routes
router.get('/', authenticate, async (req, res) => {
  const userId = req.userId!;  // TypeScript knows this exists
  // ...
});
```

### API Conventions

#### RESTful Endpoint Structure

```
Base: /api/v1

/auth
  POST   /register       - Create user
  POST   /login          - Authenticate & get token
  POST   /logout         - Invalidate token
  GET    /me             - Get current user

/flights
  GET    /               - List all flights (with filters)
  GET    /geo            - Get flights as GeoJSON
  GET    /:id            - Get single flight
  POST   /               - Create flight
  PUT    /:id            - Update flight
  DELETE /:id            - Delete flight

/stats
  GET    /summary        - Overall statistics
  GET    /routes         - Route analysis
  GET    /timeline       - Time-based stats

/airports
  GET    /               - Search airports
  GET    /:code          - Get airport by IATA/ICAO

/achievements
  GET    /               - List all achievements
  GET    /user           - Get user's unlocked achievements
  POST   /check          - Check and unlock achievements

/settings
  GET    /               - Get user settings
  PUT    /               - Update user settings

/analytics
  POST   /events         - Track analytics event

/uploads
  POST   /receipts       - Upload receipt image

/imports
  GET    /               - List imported flights
  POST   /start          - Start IMAP polling
  POST   /stop           - Stop IMAP polling
```

#### HTTP Status Codes

| Code | Usage | Example |
|------|-------|---------|
| **200** | Success (GET, PUT) | Flight retrieved/updated |
| **201** | Created (POST) | Flight created |
| **204** | No Content (DELETE) | Flight deleted |
| **400** | Bad Request | Validation error |
| **401** | Unauthorized | Missing/invalid JWT |
| **403** | Forbidden | Not owner of resource |
| **404** | Not Found | Flight doesn't exist |
| **409** | Conflict | Duplicate resource |
| **429** | Too Many Requests | Rate limit exceeded |
| **500** | Server Error | Uncaught exception |

#### Request/Response Formats

**List Endpoints (Pagination):**
```typescript
// Request
GET /api/v1/flights?limit=50&offset=0&airline=Lufthansa&status=flown

// Response
{
  "flights": Flight[],
  "total": 123,
  "limit": 50,
  "offset": 0
}
```

**Single Resource:**
```typescript
// Request
GET /api/v1/flights/550e8400-e29b-41d4-a716-446655440000

// Response
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "airline": "Lufthansa",
  "flightNumber": "LH456",
  // ... full flight object
}
```

**Error Response:**
```typescript
{
  "error": "Validation error",
  "message": "Invalid flight data",
  "details": [
    {
      "field": "departureTime",
      "message": "Must be a valid ISO 8601 date"
    }
  ]
}
```

### Database Conventions

#### Schema Design Patterns

**Table Naming:**
- Use snake_case in database
- Map to camelCase in code via Prisma

**Column Naming:**
```prisma
model Flight {
  id              String   @id @default(uuid())
  userId          String   @map("user_id")
  flightNumber    String?  @map("flight_number")
  departureTime   DateTime @map("departure_time")

  // Relations
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Indexes for query performance
  @@index([userId, departureTime])
  @@index([airline, status])
  @@map("flights")
}
```

**Relationships:**
- Use `onDelete: Cascade` for dependent data (flights → user)
- Use `onDelete: SetNull` for optional references
- Always create indexes on foreign keys

**Migrations:**
- Name descriptively: `20251120163643_add_boarding_pass_fields`
- Never edit existing migrations
- Test migrations in development before production

#### Querying Best Practices

```typescript
// ✅ Good: Select only needed fields
const flights = await prisma.flight.findMany({
  where: { userId },
  select: {
    id: true,
    airline: true,
    flightNumber: true,
    departureTime: true,
    // Only what's needed
  },
});

// ❌ Bad: Over-fetching
const flights = await prisma.flight.findMany({ where: { userId } });
// Returns all fields including heavy JSON columns

// ✅ Good: Efficient counting
const count = await prisma.flight.count({ where: { userId } });

// ❌ Bad: Fetching then counting
const flights = await prisma.flight.findMany({ where: { userId } });
const count = flights.length;
```

### Security Conventions

#### Authentication Flow

```typescript
// 1. User logs in
POST /api/v1/auth/login
Body: { username, password }

// 2. Backend validates & sets HttpOnly cookie
Response:
  Set-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
  Body: { user: { id, username } }

// 3. Subsequent requests include cookie automatically
GET /api/v1/flights
Cookie: token=<jwt>

// 4. Middleware verifies JWT and sets req.userId
// backend/src/middleware/auth.ts
export const authenticate = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const decoded = verifyToken(token);
  req.userId = decoded.userId;
  next();
};
```

#### Security Checklist

- **Passwords**: Hashed with bcrypt (10 rounds)
- **JWT**: HttpOnly cookies (XSS protection), Secure flag in production
- **CORS**: Whitelist only frontend origin
- **Rate Limiting**: Applied to auth endpoints (5 req/15min)
- **Input Validation**: All inputs validated with Zod
- **SQL Injection**: Protected by Prisma (parameterized queries)
- **File Uploads**: Whitelist extensions, size limits
- **Headers**: Helmet.js security headers

**Production Environment Variables:**
```bash
# CRITICAL: Change these in production!
JWT_SECRET=<generate with: openssl rand -hex 32>
DATABASE_URL=postgresql://<user>:<strong-password>@<host>:5432/<db>
NODE_ENV=production
CORS_ORIGIN=https://yourdomain.com
```

---

## Common Tasks

### Adding a New API Endpoint

**Scenario**: Add endpoint to get flight count by airline

```typescript
// 1. Create route handler
// backend/src/routes/stats.ts
router.get('/by-airline', authenticate, async (req, res, next) => {
  try {
    const userId = req.userId!;

    // 2. Query database
    const result = await prisma.flight.groupBy({
      by: ['airline'],
      where: { userId, status: 'flown' },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    // 3. Transform data
    const byAirline = result.map(r => ({
      airline: r.airline || 'Unknown',
      count: r._count.id,
    }));

    res.json({ byAirline });
  } catch (error) {
    next(error);
  }
});

// 4. Add to API client
// frontend/src/lib/api.ts
export const stats = {
  // ... existing methods

  getByAirline: async (): Promise<{ airline: string; count: number }[]> => {
    const response = await apiClient.get('/stats/by-airline');
    return response.data.byAirline;
  },
};

// 5. Use in frontend
const [data, setData] = useState([]);
useEffect(() => {
  api.stats.getByAirline().then(setData);
}, []);
```

### Adding a New Database Field

**Scenario**: Add "notes" field to flights

```typescript
// 1. Update Prisma schema
// backend/prisma/schema.prisma
model Flight {
  // ... existing fields
  notes  String?  @map("notes")  // Add this line
}

// 2. Create migration
cd backend
npx prisma migrate dev --name add_flight_notes

// 3. Update Zod schema (if validating)
// backend/src/schemas/flight.ts
export const updateFlightSchema = z.object({
  // ... existing fields
  notes: z.string().max(1000).optional(),
});

// 4. Update TypeScript types (if not using Prisma types)
// frontend/src/types/index.ts
export interface Flight {
  // ... existing fields
  notes?: string;
}

// 5. Update UI
// frontend/src/components/FlightForm.tsx
<textarea
  name="notes"
  placeholder="Flight notes..."
  className="input"
  {...register('notes')}
/>
```

### Adding a New React Page

**Scenario**: Create "Travel Timeline" page

```typescript
// 1. Create page component
// frontend/src/pages/TimelinePage.tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function TimelinePage() {
  const [flights, setFlights] = useState([]);

  useEffect(() => {
    api.flights.getAll().then(({ flights }) => setFlights(flights));
  }, []);

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Travel Timeline</h1>
      {/* Timeline visualization */}
    </div>
  );
}

// 2. Add route
// frontend/src/App.tsx
import TimelinePage from './pages/TimelinePage';

function App() {
  return (
    <Routes>
      {/* ... existing routes */}
      <Route
        path="/timeline"
        element={user ? <TimelinePage /> : <Navigate to="/login" />}
      />
    </Routes>
  );
}

// 3. Add navigation link
// frontend/src/App.tsx (in nav section)
<Link to="/timeline" className="nav-link">
  Timeline
</Link>
```

### Adding a New Achievement

```typescript
// 1. Add to seed script
// backend/src/seedAchievements.ts
const achievements = [
  // ... existing achievements
  {
    code: 'EARLY_BIRD',
    name: 'Early Bird',
    description: 'Take 5 flights before 8:00 AM',
    category: 'special',
    tier: 'gold',
    icon: '🌅',
    requirement: 5,
    requirementType: 'early_morning_flights',
    points: 50,
    isHidden: false,
  },
];

// 2. Update achievement checker
// backend/src/utils/achievements.ts
export async function checkAndUnlockAchievements(userId: string) {
  // ... existing checks

  // Check early morning flights
  const earlyFlights = await prisma.flight.count({
    where: {
      userId,
      status: 'flown',
      departureTime: {
        // SQL: EXTRACT(HOUR FROM departure_time) < 8
      },
    },
  });

  if (earlyFlights >= 5) {
    await unlockAchievement(userId, 'EARLY_BIRD');
  }
}

// 3. Run seed
npm run seed:achievements

// 4. Frontend automatically displays via /achievements endpoint
```

### Debugging Common Issues

#### Backend Won't Start

```bash
# Check database connection
docker-compose ps  # Is postgres running?
docker-compose logs db  # Any errors?

# Check environment variables
cat backend/.env  # DATABASE_URL correct?

# Regenerate Prisma client
cd backend
npx prisma generate

# Check for port conflicts
lsof -i :8000  # Is port 8000 in use?
```

#### Frontend Won't Build

```bash
# Check for TypeScript errors
cd frontend
npx tsc --noEmit

# Clear cache
rm -rf node_modules .vite
npm install
npm run dev

# Check API URL
cat .env  # VITE_API_URL correct?
```

#### Database Migration Fails

```bash
# Reset database (dev only!)
cd backend
npx prisma migrate reset

# Or manually:
docker-compose down -v  # Delete volumes
docker-compose up -d db
npx prisma migrate deploy
```

---

## Testing Guidelines

### Backend Testing (Jest + Supertest)

#### Test Structure

```typescript
// backend/src/__tests__/flights.test.ts
import request from 'supertest';
import { app } from '../index';
import { prisma } from '../db';

describe('Flights API', () => {
  let authToken: string;
  let userId: string;

  // Setup: Create test user
  beforeAll(async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'testuser', password: 'test123' });

    authToken = response.body.token;
    userId = response.body.user.id;
  });

  // Cleanup: Remove test data
  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe('POST /flights', () => {
    it('should create a flight', async () => {
      const flightData = {
        airline: 'Test Airways',
        flightNumber: 'TE123',
        departureTime: new Date().toISOString(),
        arrivalTime: new Date().toISOString(),
        departure: {
          iata: 'JFK',
          name: 'John F Kennedy Intl',
          lat: 40.6413,
          lon: -73.7781,
        },
        arrival: {
          iata: 'LAX',
          name: 'Los Angeles Intl',
          lat: 33.9416,
          lon: -118.4085,
        },
      };

      const response = await request(app)
        .post('/api/v1/flights')
        .set('Authorization', `Bearer ${authToken}`)
        .send(flightData)
        .expect(201);

      expect(response.body).toMatchObject({
        airline: 'Test Airways',
        flightNumber: 'TE123',
      });
      expect(response.body.id).toBeDefined();
    });

    it('should reject invalid data', async () => {
      await request(app)
        .post('/api/v1/flights')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invalid: 'data' })
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/v1/flights')
        .send({ /* valid data */ })
        .expect(401);
    });
  });

  describe('GET /flights', () => {
    it('should return user flights', async () => {
      const response = await request(app)
        .get('/api/v1/flights')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body.flights)).toBe(true);
    });
  });
});
```

#### Running Tests

```bash
# Run all tests
npm test

# Watch mode (TDD)
npm run test:watch

# Coverage report
npm test -- --coverage

# Run specific test file
npm test -- flights.test.ts

# Run specific test
npm test -- -t "should create a flight"
```

### Frontend Testing (Vitest - if configured)

```typescript
// frontend/src/components/__tests__/FlightList.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import FlightList from '../FlightList';

describe('FlightList', () => {
  const mockFlights = [
    {
      id: '1',
      airline: 'Test Airways',
      flightNumber: 'TE123',
      // ... other fields
    },
  ];

  it('renders flights', () => {
    render(<FlightList flights={mockFlights} onFlightClick={() => {}} />);
    expect(screen.getByText('Test Airways')).toBeInTheDocument();
    expect(screen.getByText('TE123')).toBeInTheDocument();
  });

  it('calls onFlightClick when clicked', () => {
    const handleClick = jest.fn();
    render(<FlightList flights={mockFlights} onFlightClick={handleClick} />);

    fireEvent.click(screen.getByText('Test Airways'));
    expect(handleClick).toHaveBeenCalledWith('1');
  });
});
```

---

## Security Considerations

### Authentication & Authorization

**Current Implementation:**
- JWT tokens stored in HttpOnly cookies (XSS protection)
- Fallback to Bearer token for API clients
- Token expiry: 7 days (configurable)
- No refresh tokens (simplicity)

**Security Properties:**
- ✅ XSS protection (HttpOnly cookies)
- ✅ CSRF mitigation (SameSite cookies)
- ✅ Secure transport (HTTPS in production)
- ⚠️ No refresh tokens (UX tradeoff)
- ⚠️ No 2FA (future enhancement)

### Input Validation

**All inputs validated with Zod:**

```typescript
// Example: Flight creation schema
const createFlightSchema = z.object({
  airline: z.string().max(100).optional(),
  flightNumber: z.string().max(20).optional(),
  departureTime: z.string().datetime(),
  arrivalTime: z.string().datetime(),
  // ... all fields validated
}).refine(data => {
  // Custom validation: arrival after departure
  return new Date(data.arrivalTime) > new Date(data.departureTime);
}, {
  message: "Arrival must be after departure",
});
```

**Validation happens at:**
1. **Frontend**: Form validation (user feedback)
2. **Backend**: API validation (security boundary)

### Rate Limiting

**Current Limits:**
```typescript
// Authentication endpoints
createAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 requests per window
});

// Flight creation
flightCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
});

// General API
generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
```

### File Uploads

**Security Measures:**
```typescript
// backend/src/middleware/upload.ts
const upload = multer({
  storage: multer.diskStorage({
    destination: './uploads/receipts/',
    filename: (req, file, cb) => {
      // Prevent path traversal
      const safeName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${file.originalname}`;
      cb(null, safeName);
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,  // 5 MB max
  },
  fileFilter: (req, file, cb) => {
    // Whitelist MIME types
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});
```

### Self-Hosting Deployment Options

#### Option 1: Local Network Only (Most Private)
**Best for:** Home use, family members on same network

```bash
# Run with Docker Compose
docker-compose up -d

# Access via local IP
http://192.168.1.100:3000
```

**Pros:**
- ✅ Maximum privacy (never exposed to internet)
- ✅ No SSL/domain needed
- ✅ Simple setup
- ✅ No firewall rules

**Cons:**
- ❌ Can't access when away from home
- ❌ Requires VPN for remote access

#### Option 2: VPN/Tailscale Access (Recommended)
**Best for:** Secure remote access without public exposure

```bash
# Install Tailscale on server and devices
curl -fsSL https://tailscale.com/install.sh | sh

# Access via Tailscale IP
https://100.64.0.1:3000
```

**Pros:**
- ✅ Secure remote access (encrypted tunnel)
- ✅ No public IP exposure
- ✅ Works anywhere
- ✅ Simple authentication
- ✅ No port forwarding needed

**Cons:**
- ❌ Requires Tailscale on all devices
- ❌ Slightly more complex setup

#### Option 3: Public Reverse Proxy (Convenience)
**Best for:** Easy access from any browser/device

```bash
# Nginx + Let's Encrypt + Cloudflare
# Public domain: https://travstats.yourdomain.com
```

**Pros:**
- ✅ Access from anywhere, any device
- ✅ No additional software needed
- ✅ Professional SSL certificates
- ✅ Can share with friends/family easily

**Cons:**
- ❌ Exposed to internet (requires good security)
- ❌ Need domain name
- ❌ More complex firewall rules
- ❌ SSL certificate management

#### Option 4: Raspberry Pi Home Server
**Best for:** Dedicated, always-on instance

**Hardware Requirements:**
- Raspberry Pi 4 (4GB+ RAM recommended)
- 32GB+ SD card or external SSD
- Stable power supply
- Ethernet connection (WiFi works but slower)

**Setup:**
```bash
# Install Docker on Raspberry Pi
curl -sSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Clone and run
git clone <repo-url>
cd TravStats
docker-compose up -d
```

**Resource Usage:**
- PostgreSQL: ~150MB RAM
- Backend: ~100MB RAM
- Frontend (Nginx): ~50MB RAM
- **Total: ~500MB RAM** (plenty of headroom on 4GB Pi)

### Production Checklist (Self-Hosting)

#### Security Basics (Always Required)
- [ ] Change `JWT_SECRET` (32+ characters): `openssl rand -hex 32`
- [ ] Use strong database password
- [ ] Set `NODE_ENV=production`
- [ ] Disable Prisma Studio in production

#### If Exposing to Internet (Option 3)
- [ ] Configure `CORS_ORIGIN` to real domain
- [ ] Enable HTTPS (Let's Encrypt)
- [ ] Set cookie `Secure` flag
- [ ] Enable HSTS headers
- [ ] Configure firewall (only ports 80, 443, 22)
- [ ] Set up fail2ban or similar for brute-force protection
- [ ] Enable rate limiting on auth endpoints
- [ ] Consider Cloudflare for DDoS protection
- [ ] Review and harden nginx config
- [ ] Set up uptime monitoring

#### Backup Strategy (All Options)
- [ ] Automated daily PostgreSQL dumps
- [ ] Backup uploaded files (receipts, etc.)
- [ ] Test restore procedure
- [ ] Offsite backup storage (USB drive, cloud)
- [ ] Backup rotation (keep 7 daily, 4 weekly, 12 monthly)

#### Monitoring (Optional but Recommended)
- [ ] Log rotation (Docker logs can grow large)
- [ ] Disk space alerts
- [ ] Uptime monitoring (if publicly accessible)
- [ ] Email alerts for failures

---

## Troubleshooting

### Common Issues

#### 1. "Prisma Client not generated"

```bash
cd backend
npx prisma generate
```

#### 2. "Port 8000 already in use"

```bash
# Find process using port
lsof -i :8000

# Kill process
kill -9 <PID>

# Or change port in .env
PORT=8001
```

#### 3. "JWT verification failed"

**Causes:**
- Token expired (7 days)
- `JWT_SECRET` changed between token creation and verification
- Cookie not sent (CORS issue)

**Solutions:**
- Log out and log back in
- Check CORS configuration
- Verify `JWT_SECRET` matches

#### 4. "Database connection failed"

```bash
# Check PostgreSQL is running
docker-compose ps

# Check logs
docker-compose logs db

# Test connection
docker-compose exec db psql -U flights -d flights -c "SELECT 1;"

# Verify DATABASE_URL
echo $DATABASE_URL
```

#### 5. Frontend API calls failing (CORS)

**Development:**
```typescript
// backend/src/index.ts
app.use(cors({
  origin: 'http://localhost:3000',  // Must match frontend URL
  credentials: true,                 // Required for cookies
}));

// frontend/src/lib/api.ts
const apiClient = axios.create({
  baseURL: process.env.VITE_API_URL || 'http://localhost:8000',
  withCredentials: true,  // Send cookies
});
```

**Production:**
```bash
# backend/.env
CORS_ORIGIN=https://yourdomain.com
```

#### 6. Achievements not unlocking

```typescript
// Check achievement calculations
// backend/src/utils/achievements.ts

// Manually trigger check
await checkAndUnlockAchievements(userId);

// Verify achievement requirements
const achievements = await prisma.achievement.findMany();
console.log(achievements);

// Check user progress
const userAchievements = await prisma.userAchievement.findMany({
  where: { userId },
  include: { achievement: true },
});
```

#### 7. Map not rendering

**Common causes:**
- Leaflet CSS not imported
- Invalid coordinates (lat/lon swapped)
- React-Leaflet version mismatch

**Solutions:**
```typescript
// frontend/src/main.tsx or index.css
import 'leaflet/dist/leaflet.css';

// Check coordinate order (lat, lon NOT lon, lat)
<MapContainer center={[lat, lon]} zoom={3}>
```

#### 8. TypeScript errors after schema changes

```bash
# Regenerate Prisma client
cd backend
npx prisma generate

# Restart TypeScript server (VSCode)
Cmd+Shift+P → "TypeScript: Restart TS Server"

# If still failing, restart dev server
npm run dev
```

### Debug Mode

**Backend:**
```bash
# Enable verbose logging
LOG_LEVEL=debug npm run dev

# Or in code
import { logger } from './utils/logger';
logger.debug('Debug message', { context: data });
```

**Frontend:**
```typescript
// Enable React DevTools
// Chrome extension: React Developer Tools

// Log API calls
// frontend/src/lib/api.ts
apiClient.interceptors.request.use(config => {
  console.log('API Request:', config.method, config.url, config.data);
  return config;
});
```

**Database:**
```bash
# Enable Prisma query logging
# backend/src/db.ts
export const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});
```

---

## Quick Reference

### File Locations

| What | Where |
|------|-------|
| **API Routes** | `backend/src/routes/*.ts` |
| **Business Logic** | `backend/src/services/*.ts` |
| **Database Schema** | `backend/prisma/schema.prisma` |
| **Auth Middleware** | `backend/src/middleware/auth.ts` |
| **Validation Schemas** | `backend/src/schemas/*.ts` |
| **Frontend Pages** | `frontend/src/pages/*.tsx` |
| **Frontend Components** | `frontend/src/components/*.tsx` |
| **Global State** | `frontend/src/store/*.ts` |
| **API Client** | `frontend/src/lib/api.ts` |
| **TypeScript Types** | `frontend/src/types/index.ts` |
| **Tailwind Config** | `frontend/tailwind.config.js` |
| **Docker Compose** | `docker-compose.yml` (dev), `docker-compose.prod.yml` (prod) |
| **Environment Examples** | `.env.example` (both backend/frontend) |

### Environment Variables

**Backend (.env):**
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/flights
JWT_SECRET=minimum-32-characters-change-in-production
JWT_EXPIRES_IN=7d
NODE_ENV=development
PORT=8000
CORS_ORIGIN=http://localhost:3000
```

**Frontend (.env):**
```bash
VITE_API_URL=http://localhost:8000
```

### API Endpoints Summary

```
Authentication:
  POST   /api/v1/auth/register
  POST   /api/v1/auth/login
  POST   /api/v1/auth/logout
  GET    /api/v1/auth/me

Flights:
  GET    /api/v1/flights
  GET    /api/v1/flights/geo
  GET    /api/v1/flights/:id
  POST   /api/v1/flights
  PUT    /api/v1/flights/:id
  DELETE /api/v1/flights/:id

Stats:
  GET    /api/v1/stats/summary
  GET    /api/v1/stats/routes

Airports:
  GET    /api/v1/airports?query=...

Achievements:
  GET    /api/v1/achievements
  GET    /api/v1/achievements/user
  POST   /api/v1/achievements/check

Settings:
  GET    /api/v1/settings
  PUT    /api/v1/settings

Other:
  POST   /api/v1/uploads/receipts
  POST   /api/v1/flight-lookup
  GET    /api/v1/imports
```

### Useful Commands

```bash
# Database
npx prisma studio                 # Open DB GUI
npx prisma migrate dev            # Create migration
npx prisma migrate deploy         # Apply migrations (prod)
npx prisma migrate reset          # Reset DB (dev only)
npx prisma generate               # Generate client

# Development
docker-compose up -d              # Start all services
docker-compose down               # Stop all services
docker-compose logs -f backend    # Follow backend logs
docker-compose exec backend sh    # Shell into container

# Testing
npm test                          # Run tests
npm run test:watch                # TDD mode
npm test -- --coverage            # Coverage report

# Build
npm run build                     # Compile TypeScript
npm start                         # Run production build
```

### Database Models

**Core Models:**
- `User` - Authentication & ownership
- `Flight` - Flight data (main entity)
- `Airport` - Airport reference data (~7000)
- `Achievement` - Achievement definitions
- `UserAchievement` - Unlocked achievements
- `UserSettings` - JSON settings blob
- `AnalyticsEvent` - Event tracking
- `ImportedFlight` - Email import tracking

**Key Relationships:**
```
User 1→N Flight
User 1→N UserAchievement
User 1→1 UserSettings
Achievement 1→N UserAchievement
```

### Technology Docs

- **Prisma**: https://www.prisma.io/docs
- **Express**: https://expressjs.com/
- **React**: https://react.dev/
- **Vite**: https://vitejs.dev/
- **React Router**: https://reactrouter.com/
- **Zustand**: https://github.com/pmndrs/zustand
- **Tailwind CSS**: https://tailwindcss.com/
- **Zod**: https://zod.dev/
- **React Leaflet**: https://react-leaflet.js.org/
- **Recharts**: https://recharts.org/

---

## AI Assistant Guidelines

### When Helping with Code

1. **Read First**: Always read relevant files before suggesting changes
2. **Follow Conventions**: Match existing naming, structure, and patterns
3. **Type Safety**: Leverage TypeScript, avoid `any`
4. **Validate Input**: Use Zod for all user input
5. **Test Changes**: Run tests after modifications
6. **Consider Security**: Validate auth, sanitize input, check permissions
7. **Update Types**: Regenerate Prisma client after schema changes
8. **Document**: Add comments for complex logic

### When Adding Features

1. **Plan First**: Outline architecture before coding
2. **Backend First**: API → Frontend (test API independently)
3. **Migrations**: Always create migration for schema changes
4. **Validation**: Add Zod schema for new endpoints
5. **Error Handling**: Handle errors gracefully, return meaningful messages
6. **Update API Client**: Add method to `frontend/src/lib/api.ts`
7. **Test**: Write integration test for new endpoint
8. **Document**: Update this file if adding major feature

### When Debugging

1. **Check Logs**: Backend logs, browser console, Docker logs
2. **Verify State**: Check database with Prisma Studio
3. **Test API**: Use curl/Postman to isolate frontend vs backend
4. **TypeScript**: Check for type errors (`npx tsc --noEmit`)
5. **Environment**: Verify `.env` variables are correct
6. **Dependencies**: Check `package.json` versions match
7. **Database**: Ensure migrations applied (`prisma migrate status`)

### Common Mistakes to Avoid

- ❌ Modifying code without reading existing implementation
- ❌ Using `any` type instead of proper types
- ❌ Skipping input validation
- ❌ Forgetting to regenerate Prisma client after schema changes
- ❌ Not handling errors in async functions
- ❌ Exposing sensitive data in API responses
- ❌ Creating database queries inside loops (N+1 problem)
- ❌ Not checking authentication before accessing user data
- ❌ Hardcoding values that should be environment variables
- ❌ Committing `.env` files or secrets

---

## Appendix

### Project Metadata

**Version**: 1.0 (Production-ready)
**Lines of Code**: ~15,000+
**API Endpoints**: 30+
**Database Tables**: 7
**Supported Airports**: 7,000+
**Test Coverage**: 80%+

### Key Decisions

**Why Self-Hosted?**
- **Privacy**: Flight data is highly personal (names, dates, locations, costs)
- **Control**: Users own their data, no third-party access
- **GDPR Compliance**: Data stays on user's server
- **No Vendor Lock-in**: Open source, can modify freely
- **Cost**: One-time setup, no monthly SaaS fees

**Why TypeScript?**
- Type safety reduces runtime errors
- Better IDE support and autocomplete
- Self-documenting code

**Why Prisma?**
- Type-safe database queries
- Automatic migrations
- Excellent TypeScript integration

**Why Zustand over Redux?**
- Simpler API, less boilerplate
- Better TypeScript support
- Smaller bundle size

**Why HttpOnly Cookies over localStorage?**
- XSS protection (JavaScript cannot access)
- Automatic inclusion in requests
- More secure for authentication

**Why Tailwind CSS?**
- Rapid prototyping
- Consistent design system
- Tree-shakeable (small production bundles)
- Easy dark mode support

**Why Monorepo Structure?**
- Shared types between frontend/backend
- Easier to navigate
- Single git repository

**Why Single-Server Architecture?**
- **Simplicity**: No complex orchestration needed
- **Self-Hosting Friendly**: Runs on modest hardware (Raspberry Pi, NAS)
- **Small Scale**: 1-10 users don't need microservices
- **Easy Backup**: Single database, simple file structure
- **Low Maintenance**: Fewer moving parts = fewer issues

### Future Enhancements

See [ROADMAP.md](ROADMAP.md) for planned features. Key items:

- **Mobile app** (React Native) - Client that connects to YOUR self-hosted server
- **Simplified setup** - One-command Docker deployment, web-based setup wizard
- **Backup automation** - Built-in backup/restore to local or cloud storage
- **Real-time flight tracking** - Integration with flight APIs for live status
- **Advanced analytics** - ML predictions, travel patterns
- **Multi-airline account sync** - Import from airline loyalty programs
- **Calendar integration** - iCal/Google Calendar sync
- **Weather data overlay** - Historical weather for flight dates
- **Social features** (optional) - Share stats with friends on same instance

**Note on Mobile App:**
The planned mobile app will NOT be a standalone service. It's a client that connects to your self-hosted TravStats server (similar to how Nextcloud or Bitwarden mobile apps work). This allows you to access your flight data on the go while maintaining full control and privacy.

### Contributing

When contributing to this project:

1. Create feature branch from `main`
2. Follow conventions in this document
3. Write tests for new features
4. Update documentation
5. Submit pull request with clear description
6. Ensure CI passes (linting, tests, build)

---

**Last Updated**: 2025-11-27
**Maintained By**: Project maintainers
**For Questions**: Open GitHub issue or discussion

---

*This document is designed to give AI assistants comprehensive context. Keep it updated as the project evolves!*
