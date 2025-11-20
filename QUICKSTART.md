# Quick Start Guide

## Windows Setup (PowerShell)

### Prerequisites
- Node.js 20+ installed
- PostgreSQL 15+ installed and running

### Step 1: Install Backend Dependencies
```powershell
cd backend
npm install
```

### Step 2: Configure Database
Edit `backend/.env` and update the DATABASE_URL:
```env
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/flights
```

Make sure PostgreSQL is running and create the database:
```powershell
# Using psql
psql -U postgres
CREATE DATABASE flights;
\q
```

### Step 3: Run Database Migrations
```powershell
# Use npm script to ensure correct Prisma version
npm run prisma:migrate
```

When prompted for migration name, enter: `init`

### Step 4: Generate Prisma Client
```powershell
npm run prisma:generate
```

### Step 5: Seed the Database
```powershell
npm run seed
```

### Step 6: Start Backend
```powershell
npm run dev
```

Backend should now be running on http://localhost:8000

---

### Step 7: Install Frontend Dependencies
Open a new PowerShell window:
```powershell
cd frontend
npm install
```

### Step 8: Start Frontend
```powershell
npm run dev
```

Frontend should now be running on http://localhost:3000

---

## Using Docker (Recommended)

If you have Docker Desktop installed, this is much easier:

```powershell
# From the project root
docker-compose up -d

# Run migrations
docker-compose exec backend npx prisma migrate dev --name init

# Seed database
docker-compose exec backend npm run seed
```

Then open http://localhost:3000

---

## Troubleshooting

### "tsx" command not found
- Run `npm install` first in the backend directory

### "vite" command not found
- Run `npm install` first in the frontend directory

### Prisma version mismatch
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again
- Use `npm run prisma:migrate` instead of `npx prisma migrate dev`

### Database connection error
- Make sure PostgreSQL is running
- Check DATABASE_URL in backend/.env
- Verify database exists and credentials are correct

---

## Demo Credentials

After seeding:
- Username: `demo`
- Password: `demo123`
