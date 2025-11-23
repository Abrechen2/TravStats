# TravStats - Flight Tracking Web Application

A full-stack flight tracking application that allows users to log, visualize, and analyze their flight history. Built with React, TypeScript, Node.js, Express, PostgreSQL with PostGIS, and Docker.

## Features

- **Flight Management**: Add, edit, and delete flights with detailed information (airline, flight number, aircraft type, departure/arrival airports and times)
- **Interactive Map**: Visualize all flights on a Leaflet map with curved arc routes representing great circle paths
- **Statistics Dashboard**: View comprehensive statistics including:
  - Total flights, distance, and flight time
  - Breakdown by airline and status
  - Top routes analysis
- **Filtering**: Filter flights by airline, flight number, date range, and status
- **Export**: Export flight data as CSV or GeoJSON
- **Authentication**: Secure user authentication with JWT
- **Responsive UI**: Clean, modern interface built with Tailwind CSS

## Technology Stack

### Frontend
- React 18 with TypeScript
- Vite (build tool)
- React Router (routing)
- Zustand (state management)
- Tailwind CSS (styling)
- Leaflet & React-Leaflet (maps)
- Axios (HTTP client)
- React Hook Form & Zod (form validation)
- date-fns (date formatting)

### Backend
- Node.js 20 with TypeScript
- Express (web framework)
- Prisma (ORM)
- PostgreSQL 15 with PostGIS (database)
- JWT (authentication)
- Bcrypt (password hashing)
- Zod (validation)
- Jest & Supertest (testing)

### DevOps
- Docker & Docker Compose
- Multi-stage Dockerfiles for optimized builds
- Nginx (production web server)

## Project Structure

```
TravStats/
├── backend/              # Node.js/Express backend
│   ├── prisma/          # Database schema and migrations
│   ├── src/
│   │   ├── __tests__/   # Test files
│   │   ├── middleware/  # Express middleware
│   │   ├── routes/      # API routes
│   │   ├── schemas/     # Zod validation schemas
│   │   ├── utils/       # Utility functions
│   │   ├── db.ts        # Prisma client
│   │   ├── index.ts     # Main server file
│   │   └── seed.ts      # Database seeding script
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/            # React/Vite frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   ├── lib/         # API client
│   │   ├── store/       # Zustand stores
│   │   ├── types/       # TypeScript types
│   │   ├── App.tsx      # Main app component
│   │   ├── main.tsx     # Entry point
│   │   └── index.css    # Global styles
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml   # Docker Compose configuration
└── README.md

```

## Getting Started

### Prerequisites

- Docker and Docker Compose installed
- OR Node.js 20+ and PostgreSQL 15+ (for local development without Docker)

### Quick Start with Docker

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd TravStats
   ```

2. **Start all services**
   ```bash
   docker-compose up -d
   ```

   This will start:
   - PostgreSQL database on port 5432
   - Backend API on port 8000
   - Frontend on port 3000

3. **Run database migrations and seed data**
   ```bash
   # Run migrations
   docker-compose exec backend npx prisma migrate dev

   # Seed sample data
   docker-compose exec backend npm run seed
   ```

4. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - Demo credentials:
     - Username: `demo`
     - Password: `demo123`

### Local Development Setup

#### Backend

```bash
cd backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Update DATABASE_URL in .env to point to your PostgreSQL instance

# Run migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Seed database
npm run seed

# Start development server
npm run dev
```

#### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run dev
```

## Environment Variables

### Backend (.env)

```env
# Database
DATABASE_URL=postgresql://flights:example@localhost:5432/flights

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d

# Server
NODE_ENV=development
PORT=8000

# CORS
CORS_ORIGIN=http://localhost:3000
```

### Frontend (.env)

```env
VITE_API_URL=http://localhost:8000
```

## API Documentation

### Authentication

#### Register
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "username": "string",
  "password": "string"
}
```

#### Login
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "string",
  "password": "string"
}
```

### Flights

All flight endpoints require authentication (Bearer token).

#### Create Flight
```http
POST /api/v1/flights
Authorization: Bearer <token>
Content-Type: application/json

{
  "airline": "Lufthansa",
  "flightNumber": "LH123",
  "callsign": "DLH123",
  "aircraft": "A320",
  "departure": {
    "icao": "EDDF",
    "iata": "FRA",
    "name": "Frankfurt Airport",
    "lat": 50.0379,
    "lon": 8.5622
  },
  "arrival": {
    "icao": "EGLL",
    "iata": "LHR",
    "name": "London Heathrow",
    "lat": 51.4700,
    "lon": -0.4543
  },
  "departureTime": "2025-11-20T08:00:00Z",
  "arrivalTime": "2025-11-20T09:30:00Z",
  "status": "scheduled",
  "notes": "optional"
}
```

#### Get Flights
```http
GET /api/v1/flights?airline=Lufthansa&status=flown&limit=50
Authorization: Bearer <token>
```

#### Get Flights as GeoJSON
```http
GET /api/v1/flights/geo?fromDate=2025-01-01T00:00:00Z
Authorization: Bearer <token>
```

#### Get Single Flight
```http
GET /api/v1/flights/:id
Authorization: Bearer <token>
```

#### Update Flight
```http
PUT /api/v1/flights/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "flown"
}
```

#### Delete Flight
```http
DELETE /api/v1/flights/:id
Authorization: Bearer <token>
```

### Statistics

#### Get Summary
```http
GET /api/v1/stats/summary?fromDate=2025-01-01T00:00:00Z&toDate=2025-12-31T23:59:59Z
Authorization: Bearer <token>
```

#### Get Top Routes
```http
GET /api/v1/stats/routes?limit=10
Authorization: Bearer <token>
```

## Testing

### Backend Tests

```bash
cd backend
npm test
```

## Database Schema

### Users Table
- id (UUID, primary key)
- username (unique)
- password_hash
- created_at

### Flights Table
- id (UUID, primary key)
- user_id (foreign key)
- airline
- flight_number
- callsign
- aircraft
- dep_icao, dep_iata, dep_name, dep_lat, dep_lon
- arr_icao, arr_iata, arr_name, arr_lat, arr_lon
- departure_time
- arrival_time
- status (scheduled, flown, cancelled)
- notes
- created_at

## Map Visualization

The application uses Leaflet to display flights on an interactive map. Flight routes are drawn as curved arcs using great circle interpolation, which represents the shortest path between two points on a sphere (Earth).

The arc calculation uses the backend's geo utility functions that implement the Haversine formula and great circle interpolation to generate smooth, accurate flight paths.

## Production Deployment

1. Update environment variables with production values
2. Set strong JWT_SECRET
3. Configure CORS_ORIGIN to your production domain
4. Build and deploy using Docker:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

5. Set up reverse proxy (nginx) with SSL/TLS certificates
6. Configure database backups
7. Set up monitoring and logging

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.

---

Built with ❤️ using modern web technologies
