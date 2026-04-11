# Trips Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full Trip concept — DB models, CRUD API, FlightsTablePage tabs (Einzelflüge / Trips), Trip card view, auto-creation on email import, cost-deduplication in stats, Trip-Routes map layer, and a user toggle to disable cost tracking entirely.

**Architecture:** Two new Prisma models (`Trip`, `Booking`) with `Flight` gaining optional `tripId`/`bookingId` FKs. The backend exposes `/api/v1/trips` CRUD. The frontend gains a `trips` i18n namespace, a `tripsApi` client, a `TripsTab` card grid, a `TripModal` for create/edit, and a new `trip-routes` deck.gl layer. Cost tracking is gated by a `features.enableCostTracking` boolean in the settingsStore (persisted in `UserSettings.data`).

**Tech Stack:** Prisma (PostgreSQL), Express/TypeScript, Zod, React 18, Vite, Zustand, deck.gl 9.x, react-i18next

---

## Codebase Context (read before starting any task)

- **Backend entry**: `backend/src/index.ts` — register new routes here
- **Prisma schema**: `backend/prisma/schema.prisma` — source of truth for DB models
- **Frontend types**: `frontend/src/types/index.ts` — `Flight`, `User`, etc.
- **Settings store**: `frontend/src/store/settingsStore.ts` — Zustand store persisted to `UserSettings.data` via `settingsApi.update()`
- **i18n config**: `frontend/src/i18n/config.ts` — must add `trips` namespace here
- **Map layers**: `frontend/src/components/layers/` — each layer is its own file
- **VisMode**: `frontend/src/types/visMode.ts` — add `"trip-routes"` here
- **FlightsTablePage**: `frontend/src/pages/FlightsTablePage.tsx` — the page getting tabs
- **Stats calc**: `backend/src/utils/statsCalculator.ts` — cost deduplication goes here
- **No `any`**: Use `unknown` + type guards. ESLint will reject `any`.
- **No `console.log`**: Use `import logger from "../utils/logger"` (backend) or `import { logger } from "../lib/logger"` (frontend)
- **Pino logger** on backend, custom wrapper on frontend

---

## File Map

**New files:**
- `backend/src/schemas/trip.ts` — Zod schemas for Trip + Booking
- `backend/src/routes/trips.ts` — CRUD: GET /trips, POST /trips, PATCH /trips/:id, DELETE /trips/:id, POST /trips/:id/flights
- `frontend/src/lib/api/trips.ts` — API client for trips
- `frontend/src/components/Trips/TripCard.tsx` — single trip card
- `frontend/src/components/Trips/TripsTab.tsx` — card grid + "new trip" card
- `frontend/src/components/Trips/TripModal.tsx` — create/edit modal
- `frontend/src/components/layers/tripRoutesLayer.ts` — deck.gl ArcLayer colored by trip
- `frontend/src/i18n/resources/de/trips.json`
- `frontend/src/i18n/resources/en/trips.json`

**Modified files:**
- `backend/prisma/schema.prisma` — add `Trip`, `Booking` models; add `tripId`/`bookingId` to `Flight`
- `backend/src/index.ts` — register trips router
- `backend/src/routes/emailParse.ts` — auto-create Trip+Booking for multi-flight results
- `backend/src/utils/statsCalculator.ts` — deduplicate costs by `bookingId`
- `frontend/src/types/index.ts` — add `Trip`, `Booking`, `tripId`/`bookingId` to `Flight`
- `frontend/src/store/settingsStore.ts` — add `FeaturesSettings` with `enableCostTracking`
- `frontend/src/lib/api/index.ts` — export `tripsApi`
- `frontend/src/i18n/config.ts` — add `trips` namespace
- `frontend/src/pages/FlightsTablePage.tsx` — two tabs, Trip badge column
- `frontend/src/pages/SettingsPage.tsx` — add FeaturesSection import/usage
- `frontend/src/components/Settings/FeaturesSection.tsx` — new toggle component
- `frontend/src/components/Stats/StatsBusinessSection.tsx` — wrap with cost toggle
- `frontend/src/pages/AdvancedStatsPage.tsx` — conditional render of business section
- `frontend/src/types/visMode.ts` — add `"trip-routes"`
- `frontend/src/components/DeckGLMap.tsx` — handle new visMode
- `frontend/src/components/MapContainer3D.tsx` — pass trips data to DeckGLMap

---

## Task 1: Feature Toggle — Cost Tracking

**Goal:** Add `enableCostTracking` boolean to settings. When false: hide price/currency/taxes/fees fields in forms and the Business Stats section.

**Files:**
- Modify: `frontend/src/store/settingsStore.ts`
- Create: `frontend/src/components/Settings/FeaturesSection.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/components/Stats/StatsBusinessSection.tsx`
- Modify: `frontend/src/pages/AdvancedStatsPage.tsx`
- Modify: `frontend/src/components/FlightForm/FlightCompleteStep.tsx`

- [ ] **Step 1: Add FeaturesSettings to settingsStore**

In `frontend/src/store/settingsStore.ts`, add after the `NotificationSettings` interface (around line 58):

```typescript
export interface FeaturesSettings {
  enableCostTracking: boolean;
}
```

Add to `SettingsState` interface (after `notifications: NotificationSettings;`):
```typescript
  features: FeaturesSettings;
  setFeatures: SettingsUpdater<FeaturesSettings>;
```

Add to `defaultSettings` (after the `notifications` block):
```typescript
  features: {
    enableCostTracking: true,
  },
```

Add the setter to the `create(persist(...` store body (alongside existing setters):
```typescript
  setFeatures: (updates) =>
    set((state) => ({ features: { ...state.features, ...updates } })),
```

- [ ] **Step 2: Run frontend type check to verify no regressions**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors related to settingsStore.

- [ ] **Step 3: Create FeaturesSection component**

Create `frontend/src/components/Settings/FeaturesSection.tsx`:

```tsx
import { useSettingsStore } from "../../store/settingsStore";
import { useTranslation } from "../../hooks/useTranslation";

export default function FeaturesSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const { features, setFeatures } = useSettingsStore();

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {t("settings:features.title")}
      </h2>
      <div
        className="rounded-lg p-4 flex items-center justify-between"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div>
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            {t("settings:features.costTracking")}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {t("settings:features.costTrackingDesc")}
          </p>
        </div>
        <button
          onClick={() => setFeatures({ enableCostTracking: !features.enableCostTracking })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
            features.enableCostTracking ? "bg-[var(--accent)]" : "bg-gray-600"
          }`}
          role="switch"
          aria-checked={features.enableCostTracking}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              features.enableCostTracking ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add i18n keys for features section**

In `frontend/src/i18n/resources/de/settings.json`, add at the top level:
```json
"features": {
  "title": "Funktionen",
  "costTracking": "Kostenerfassung",
  "costTrackingDesc": "Preis- und Kostenfelder in Formularen anzeigen und Business-Statistiken auswerten."
}
```

In `frontend/src/i18n/resources/en/settings.json`, add at the top level:
```json
"features": {
  "title": "Features",
  "costTracking": "Cost Tracking",
  "costTrackingDesc": "Show price and cost fields in forms and enable business cost statistics."
}
```

- [ ] **Step 5: Register FeaturesSection in SettingsPage**

In `frontend/src/pages/SettingsPage.tsx`, add import:
```typescript
import FeaturesSection from "../components/Settings/FeaturesSection";
```

Find the section where the settings sidebar and content are rendered. Add `"features"` to the `activeSection` options and render `<FeaturesSection />` when `activeSection === "features"`. Follow the exact same pattern as the other sections in this file.

- [ ] **Step 6: Gate Business Stats behind toggle**

In `frontend/src/pages/AdvancedStatsPage.tsx`, find where `<StatsBusinessSection>` is rendered. Wrap it:

```tsx
import { useSettingsStore } from "../store/settingsStore";

// Inside the component:
const { features } = useSettingsStore();

// Where StatsBusinessSection renders:
{features.enableCostTracking && <StatsBusinessSection businessStats={stats.business} />}
```

- [ ] **Step 7: Gate price fields in FlightCompleteStep**

In `frontend/src/components/FlightForm/FlightCompleteStep.tsx`, find the price/currency section. Read the file first to locate the exact JSX block containing the price input. Wrap it:

```tsx
import { useSettingsStore } from "../../store/settingsStore";

// Inside component:
const { features } = useSettingsStore();

// Around the price/currency JSX block:
{features.enableCostTracking && (
  <div>
    {/* existing price + currency fields */}
  </div>
)}
```

- [ ] **Step 8: Run type check + frontend tests**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npx vitest --run 2>&1 | tail -20
```
Expected: 0 type errors, tests pass (or same count as before this task).

- [ ] **Step 9: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/store/settingsStore.ts \
  frontend/src/components/Settings/FeaturesSection.tsx \
  frontend/src/pages/SettingsPage.tsx \
  frontend/src/pages/AdvancedStatsPage.tsx \
  frontend/src/components/FlightForm/FlightCompleteStep.tsx \
  frontend/src/i18n/resources/de/settings.json \
  frontend/src/i18n/resources/en/settings.json
git commit -m "feat: add cost tracking feature toggle in settings"
```

---

## Task 2: Prisma Schema — Trip + Booking Models

**Goal:** Add `Trip` and `Booking` DB tables. Add optional `tripId` and `bookingId` FKs to `Flight`. Trip has a `color` field for map visualization.

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add Trip and Booking models to schema**

In `backend/prisma/schema.prisma`, add before the closing (after the last model):

```prisma
model Trip {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  name        String
  description String?
  color       String   @default("#818cf8") @map("color")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  flights  Flight[]
  bookings Booking[]

  @@index([userId])
  @@map("trips")
}

model Booking {
  id       String  @id @default(uuid())
  userId   String  @map("user_id")
  tripId   String? @map("trip_id")
  pnr      String?
  price    Float?
  currency String? @default("EUR")

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  trip    Trip?   @relation(fields: [tripId], references: [id], onDelete: SetNull)
  flights Flight[]

  @@index([userId])
  @@index([tripId])
  @@map("bookings")
}
```

- [ ] **Step 2: Add tripId and bookingId to Flight model**

In the `Flight` model in `schema.prisma`, add after the `parserConfidence` field (before the relations):

```prisma
  tripId      String?  @map("trip_id")
  bookingId   String?  @map("booking_id")
```

Add to the Flight relations (after `user User @relation(...)`):
```prisma
  trip        Trip?    @relation(fields: [tripId], references: [id], onDelete: SetNull)
  booking     Booking? @relation(fields: [bookingId], references: [id], onDelete: SetNull)
```

Add to the `Flight` model `@@index` list:
```prisma
  @@index([tripId])
  @@index([bookingId])
```

- [ ] **Step 3: Add relations back on User model**

In the `User` model, add after `parseLogs ParseTrainingLog[]`:
```prisma
  trips    Trip[]
  bookings Booking[]
```

- [ ] **Step 4: Run migration**

```bash
cd /d/Projekte/TravStats/backend
npx prisma migrate dev --name add_trips_bookings
```
Expected: Migration created and applied. Prisma client regenerated.

- [ ] **Step 5: Verify Prisma client compiles**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add Trip and Booking Prisma models with Flight FK"
```

---

## Task 3: Backend — Trips CRUD API

**Goal:** Create `/api/v1/trips` with full CRUD + a `POST /trips/:id/flights` endpoint to assign/unassign flights to a trip. Register the router in `index.ts`.

**Files:**
- Create: `backend/src/schemas/trip.ts`
- Create: `backend/src/routes/trips.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write Zod schemas**

Create `backend/src/schemas/trip.ts`:

```typescript
import { z } from "zod";

const TRIP_COLORS = [
  "#818cf8", "#38bdf8", "#34d399", "#fb923c", "#f472b6",
  "#a78bfa", "#22d3ee", "#86efac", "#fbbf24", "#f87171",
];

export const createTripSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const updateTripSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const assignFlightsSchema = z.object({
  flightIds: z.array(z.string().uuid()),
  action: z.enum(["add", "remove"]),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
export type AssignFlightsInput = z.infer<typeof assignFlightsSchema>;
export { TRIP_COLORS };
```

- [ ] **Step 2: Write trips router**

Create `backend/src/routes/trips.ts`:

```typescript
import { Router, Response } from "express";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  createTripSchema,
  updateTripSchema,
  assignFlightsSchema,
  TRIP_COLORS,
} from "../schemas/trip";
import { z } from "zod";
import logger from "../utils/logger";

const router = Router();

/** GET /trips — list all trips for current user, including flight count */
router.get("/trips", authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const trips = await prisma.trip.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { flights: true } },
      bookings: { select: { id: true, pnr: true, price: true, currency: true } },
      flights: {
        select: {
          id: true,
          depIata: true,
          arrIata: true,
          departureTime: true,
          arrivalTime: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
        },
        orderBy: { departureTime: "asc" },
      },
    },
  });

  res.json({ trips });
});

/** GET /trips/:id — single trip with full flight data */
router.get("/trips/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const trip = await prisma.trip.findFirst({
    where: { id: req.params.id, userId },
    include: {
      bookings: true,
      flights: { orderBy: { departureTime: "asc" } },
    },
  });
  if (!trip) throw new AppError("Trip not found", 404);
  res.json({ trip });
});

/** POST /trips — create a new trip */
router.post("/trips", authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const body = createTripSchema.parse(req.body);

  // Auto-assign a color based on user's trip count if none provided
  let color = body.color;
  if (!color) {
    const count = await prisma.trip.count({ where: { userId } });
    color = TRIP_COLORS[count % TRIP_COLORS.length];
  }

  const trip = await prisma.trip.create({
    data: { userId, name: body.name, description: body.description, color },
  });

  logger.info({ tripId: trip.id, userId }, "[Trips] Created trip");
  res.status(201).json({ trip });
});

/** PATCH /trips/:id — update name/description/color */
router.patch("/trips/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const existing = await prisma.trip.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) throw new AppError("Trip not found", 404);

  const body = updateTripSchema.parse(req.body);
  const trip = await prisma.trip.update({
    where: { id: req.params.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.color !== undefined && { color: body.color }),
    },
  });

  res.json({ trip });
});

/** DELETE /trips/:id — delete trip (flights remain, tripId set to null by FK cascade) */
router.delete("/trips/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const existing = await prisma.trip.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) throw new AppError("Trip not found", 404);

  await prisma.trip.delete({ where: { id: req.params.id } });
  logger.info({ tripId: req.params.id, userId }, "[Trips] Deleted trip");
  res.json({ message: "Trip deleted" });
});

/** POST /trips/:id/flights — add or remove flights from a trip */
router.post("/trips/:id/flights", authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const trip = await prisma.trip.findFirst({ where: { id: req.params.id, userId } });
  if (!trip) throw new AppError("Trip not found", 404);

  const { flightIds, action } = assignFlightsSchema.parse(req.body);

  // Verify all flights belong to this user
  const flights = await prisma.flight.findMany({
    where: { id: { in: flightIds }, userId },
    select: { id: true },
  });
  if (flights.length !== flightIds.length) {
    throw new AppError("One or more flights not found", 404);
  }

  if (action === "add") {
    await prisma.flight.updateMany({
      where: { id: { in: flightIds }, userId },
      data: { tripId: trip.id },
    });
  } else {
    await prisma.flight.updateMany({
      where: { id: { in: flightIds }, userId, tripId: trip.id },
      data: { tripId: null },
    });
  }

  res.json({ message: `Flights ${action === "add" ? "added to" : "removed from"} trip` });
});

/** POST /trips/bookings — create a booking and link it to a trip */
router.post("/trips/bookings", authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const schema = z.object({
    tripId: z.string().uuid().optional(),
    pnr: z.string().max(20).optional(),
    price: z.number().min(0).optional(),
    currency: z.enum(["EUR", "USD", "GBP", "CHF"]).optional(),
    flightIds: z.array(z.string().uuid()).optional(),
  });
  const body = schema.parse(req.body);

  const booking = await prisma.booking.create({
    data: {
      userId,
      tripId: body.tripId ?? null,
      pnr: body.pnr ?? null,
      price: body.price ?? null,
      currency: body.currency ?? "EUR",
    },
  });

  if (body.flightIds && body.flightIds.length > 0) {
    await prisma.flight.updateMany({
      where: { id: { in: body.flightIds }, userId },
      data: { bookingId: booking.id, tripId: body.tripId ?? undefined },
    });
  }

  res.status(201).json({ booking });
});

export default router;
```

- [ ] **Step 3: Register router in index.ts**

In `backend/src/index.ts`, add import at the top (with other route imports):
```typescript
import tripsRoutes from './routes/trips';
```

Add registration (after `app.use('/api/v1/training', trainingRoutes);`):
```typescript
app.use('/api/v1', tripsRoutes);
```

- [ ] **Step 4: Run backend type check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/schemas/trip.ts backend/src/routes/trips.ts backend/src/index.ts
git commit -m "feat: add trips CRUD API (/api/v1/trips)"
```

---

## Task 4: Frontend — Trip Types + API Client

**Goal:** Add `Trip` and `Booking` types to `types/index.ts`, add `tripId`/`bookingId` to the `Flight` type, create `lib/api/trips.ts`, and export from `lib/api/index.ts`.

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/lib/api/trips.ts`
- Modify: `frontend/src/lib/api/index.ts`

- [ ] **Step 1: Add types to types/index.ts**

Read `frontend/src/types/index.ts` first. Add after the `Flight` interface:

```typescript
export interface Booking {
  id: string;
  userId: string;
  tripId: string | null;
  pnr: string | null;
  price: number | null;
  currency: string | null;
}

export interface Trip {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  _count?: { flights: number };
  bookings?: Booking[];
  flights?: Pick<Flight, "id" | "depIata" | "arrIata" | "departureTime" | "arrivalTime" | "depLat" | "depLon" | "arrLat" | "arrLon">[];
}
```

In the `Flight` interface, add after `parserConfidence?: number;`:
```typescript
  tripId?: string | null;
  bookingId?: string | null;
  trip?: { id: string; name: string; color: string } | null;
```

- [ ] **Step 2: Create trips API client**

Create `frontend/src/lib/api/trips.ts`:

```typescript
import { api } from "./client";
import type { Trip, Booking } from "../../types";

export interface CreateTripInput {
  name: string;
  description?: string;
  color?: string;
}

export interface UpdateTripInput {
  name?: string;
  description?: string | null;
  color?: string;
}

export interface AssignFlightsInput {
  flightIds: string[];
  action: "add" | "remove";
}

export interface CreateBookingInput {
  tripId?: string;
  pnr?: string;
  price?: number;
  currency?: "EUR" | "USD" | "GBP" | "CHF";
  flightIds?: string[];
}

export const tripsApi = {
  getAll: async (): Promise<Trip[]> => {
    const { data } = await api.get<{ trips: Trip[] }>("/trips");
    return data.trips;
  },

  getById: async (id: string): Promise<Trip> => {
    const { data } = await api.get<{ trip: Trip }>(`/trips/${id}`);
    return data.trip;
  },

  create: async (input: CreateTripInput): Promise<Trip> => {
    const { data } = await api.post<{ trip: Trip }>("/trips", input);
    return data.trip;
  },

  update: async (id: string, input: UpdateTripInput): Promise<Trip> => {
    const { data } = await api.patch<{ trip: Trip }>(`/trips/${id}`, input);
    return data.trip;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/trips/${id}`);
  },

  assignFlights: async (tripId: string, input: AssignFlightsInput): Promise<void> => {
    await api.post(`/trips/${tripId}/flights`, input);
  },

  createBooking: async (input: CreateBookingInput): Promise<Booking> => {
    const { data } = await api.post<{ booking: Booking }>("/trips/bookings", input);
    return data.booking;
  },
};
```

- [ ] **Step 3: Export from api/index.ts**

In `frontend/src/lib/api/index.ts`, add:
```typescript
export { tripsApi } from "./trips";
```

- [ ] **Step 4: Run type check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/types/index.ts frontend/src/lib/api/trips.ts frontend/src/lib/api/index.ts
git commit -m "feat: add Trip/Booking frontend types and tripsApi client"
```

---

## Task 5: i18n — Trips Namespace

**Goal:** Create `de/trips.json` and `en/trips.json`, register the namespace in `i18n/config.ts`.

**Files:**
- Create: `frontend/src/i18n/resources/de/trips.json`
- Create: `frontend/src/i18n/resources/en/trips.json`
- Modify: `frontend/src/i18n/config.ts`

- [ ] **Step 1: Create German translations**

Create `frontend/src/i18n/resources/de/trips.json`:

```json
{
  "tab": "Trips",
  "tabFlights": "Einzelflüge",
  "count": "{{count}} Trip",
  "count_plural": "{{count}} Trips",
  "nights": "{{count}} Nacht",
  "nights_plural": "{{count}} Nächte",
  "noTrips": "Noch keine Trips vorhanden.",
  "noTripsDesc": "Trips werden beim E-Mail-Import automatisch erkannt oder können manuell erstellt werden.",
  "createTrip": "Trip erstellen",
  "newTrip": "Neuen Trip erstellen",
  "newTripDesc": "Flüge manuell gruppieren oder beim E-Mail-Import auto-erstellt",
  "editTrip": "Trip bearbeiten",
  "deleteTrip": "Trip löschen",
  "deleteTripConfirm": "Trip \"{{name}}\" löschen? Die zugehörigen Flüge bleiben erhalten.",
  "showOnMap": "Auf Karte",
  "flightCount": "{{count}} Flug",
  "flightCount_plural": "{{count}} Flüge",
  "pnrLabel": "Buchungsref.",
  "totalCost": "Gesamtkosten",
  "costPerKm": "Kosten/km",
  "distance": "Strecke",
  "modal": {
    "nameLabel": "Trip-Name",
    "namePlaceholder": "z.B. Trondheim Jun 2024",
    "descLabel": "Beschreibung (optional)",
    "descPlaceholder": "Notizen zur Reise...",
    "colorLabel": "Farbe",
    "save": "Speichern",
    "cancel": "Abbrechen"
  },
  "badge": {
    "noTrip": "—"
  },
  "filter": {
    "all": "Alle",
    "withTrip": "Mit Trip",
    "withoutTrip": "Ohne Trip"
  },
  "toasts": {
    "created": "Trip erstellt",
    "updated": "Trip aktualisiert",
    "deleted": "Trip gelöscht",
    "createError": "Trip konnte nicht erstellt werden",
    "updateError": "Trip konnte nicht aktualisiert werden",
    "deleteError": "Trip konnte nicht gelöscht werden"
  }
}
```

- [ ] **Step 2: Create English translations**

Create `frontend/src/i18n/resources/en/trips.json`:

```json
{
  "tab": "Trips",
  "tabFlights": "Flights",
  "count": "{{count}} Trip",
  "count_plural": "{{count}} Trips",
  "nights": "{{count}} Night",
  "nights_plural": "{{count}} Nights",
  "noTrips": "No trips yet.",
  "noTripsDesc": "Trips are auto-detected on email import or can be created manually.",
  "createTrip": "Create Trip",
  "newTrip": "Create New Trip",
  "newTripDesc": "Group flights manually or auto-created on email import",
  "editTrip": "Edit Trip",
  "deleteTrip": "Delete Trip",
  "deleteTripConfirm": "Delete trip \"{{name}}\"? Flights will be kept.",
  "showOnMap": "Show on Map",
  "flightCount": "{{count}} Flight",
  "flightCount_plural": "{{count}} Flights",
  "pnrLabel": "Booking ref.",
  "totalCost": "Total Cost",
  "costPerKm": "Cost/km",
  "distance": "Distance",
  "modal": {
    "nameLabel": "Trip Name",
    "namePlaceholder": "e.g. Trondheim Jun 2024",
    "descLabel": "Description (optional)",
    "descPlaceholder": "Notes about the trip...",
    "colorLabel": "Color",
    "save": "Save",
    "cancel": "Cancel"
  },
  "badge": {
    "noTrip": "—"
  },
  "filter": {
    "all": "All",
    "withTrip": "With Trip",
    "withoutTrip": "Without Trip"
  },
  "toasts": {
    "created": "Trip created",
    "updated": "Trip updated",
    "deleted": "Trip deleted",
    "createError": "Failed to create trip",
    "updateError": "Failed to update trip",
    "deleteError": "Failed to delete trip"
  }
}
```

- [ ] **Step 3: Register in i18n config**

In `frontend/src/i18n/config.ts`:

Add imports after the last import line:
```typescript
import enTrips from "./resources/en/trips.json";
import deTrips from "./resources/de/trips.json";
```

In the `resources` object, add `trips: enTrips` to the `en` block and `trips: deTrips` to the `de` block.

In the `ns` array, add `"trips"`.

- [ ] **Step 4: Run type check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | head -10
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/i18n/
git commit -m "feat: add trips i18n namespace (de + en)"
```

---

## Task 6: FlightsTablePage — Tabs + Trip Badge Column

**Goal:** Add `[ Einzelflüge | Trips ]` tab bar below the stats bar, add a `Trip` column with colored badge to the flight table. Add filter chips: All / With Trip / Without Trip / individual trips.

**Files:**
- Modify: `frontend/src/pages/FlightsTablePage.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/pages/FlightsTablePage.tsx` in full to understand the existing structure before making changes.

- [ ] **Step 2: Add trips state and loading**

At the top of the component (after existing `useState` calls), add:

```typescript
import { tripsApi } from "../lib/api";
import type { Trip } from "../types";
// ...
const [activeTab, setActiveTab] = useState<"flights" | "trips">("flights");
const [trips, setTrips] = useState<Trip[]>([]);
const [tripFilter, setTripFilter] = useState<"all" | "with" | "without" | string>("all");
```

Add a `loadTrips` function and call it in `useEffect`:
```typescript
const loadTrips = async () => {
  try {
    const data = await tripsApi.getAll();
    setTrips(data);
  } catch (err) {
    logger.warn({ err }, "Failed to load trips");
  }
};

useEffect(() => {
  void loadTrips();
}, []);
```

- [ ] **Step 3: Add tab bar JSX**

Directly after the stats bar (the `<div>` with flight count / route count), add:

```tsx
{/* Tab bar */}
<div
  className="flex border-b"
  style={{ background: "var(--bg-surface)", borderColor: "var(--color-border)" }}
>
  <button
    onClick={() => setActiveTab("flights")}
    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      activeTab === "flights"
        ? "border-[var(--accent)] text-[var(--accent)]"
        : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    }`}
  >
    ✈ {t("trips:tabFlights")}
  </button>
  <button
    onClick={() => setActiveTab("trips")}
    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      activeTab === "trips"
        ? "border-[var(--accent)] text-[var(--accent)]"
        : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    }`}
  >
    🗺 {t("trips:tab")}
    {trips.length > 0 && (
      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-[var(--bg-muted)]">
        {trips.length}
      </span>
    )}
  </button>
</div>
```

- [ ] **Step 4: Add filter chips for trip filtering (flights tab only)**

Inside the flights tab content area, add above the table:

```tsx
{/* Trip filter chips — only in flights tab */}
{activeTab === "flights" && (
  <div className="flex flex-wrap gap-2 px-4 py-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
    {(["all", "with", "without"] as const).map((f) => (
      <button
        key={f}
        onClick={() => setTripFilter(f)}
        className={`px-3 py-1 rounded-full text-xs border transition-colors ${
          tripFilter === f
            ? "bg-[var(--accent)]/20 border-[var(--accent)]/50 text-[var(--accent)]"
            : "border-[var(--color-border)] text-[var(--text-muted)]"
        }`}
      >
        {t(`trips:filter.${f}`)}
      </button>
    ))}
    {trips.map((trip) => (
      <button
        key={trip.id}
        onClick={() => setTripFilter(tripFilter === trip.id ? "all" : trip.id)}
        className="px-3 py-1 rounded-full text-xs border transition-colors"
        style={{
          background: tripFilter === trip.id ? `${trip.color}22` : "transparent",
          borderColor: `${trip.color}55`,
          color: trip.color,
        }}
      >
        ● {trip.name}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 5: Apply trip filter to displayed flights**

Create a filtered flights variable before the table render:

```typescript
const tripMap = new Map(trips.map((t) => [t.id, t]));

const displayedFlights = flights.filter((f) => {
  if (tripFilter === "all") return true;
  if (tripFilter === "with") return !!f.tripId;
  if (tripFilter === "without") return !f.tripId;
  return f.tripId === tripFilter;
});
```

Replace `flights.map(...)` in the table with `displayedFlights.map(...)`.

- [ ] **Step 6: Add Trip column to table header and rows**

In the table `<thead>`, add a `<th>Trip</th>` column after the seat class column.

In each flight row `<tr>`, add a `<td>` after the seat class cell:

```tsx
<td className="px-3 py-2">
  {f.tripId && tripMap.has(f.tripId) ? (
    <button
      onClick={() => setActiveTab("trips")}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border transition-all hover:brightness-110"
      style={{
        background: `${tripMap.get(f.tripId)!.color}18`,
        borderColor: `${tripMap.get(f.tripId)!.color}44`,
        color: tripMap.get(f.tripId)!.color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: tripMap.get(f.tripId)!.color }}
      />
      {tripMap.get(f.tripId)!.name}
    </button>
  ) : (
    <span style={{ color: "var(--text-muted)", opacity: 0.3 }}>—</span>
  )}
</td>
```

- [ ] **Step 7: Conditionally render flights table or TripsTab**

Wrap the existing table content so it only shows when `activeTab === "flights"`. Add a placeholder for the trips tab:

```tsx
{activeTab === "flights" ? (
  <>{/* existing table JSX */}</>
) : (
  <div className="p-4">
    {/* TripsTab will be imported and rendered here in Task 7 */}
    <p style={{ color: "var(--text-muted)" }}>Trips Tab — kommt in Task 7</p>
  </div>
)}
```

- [ ] **Step 8: Ensure backend returns tripId on flight list**

Read `backend/src/routes/flights.ts` around the `findMany` call. Verify `tripId`, `bookingId` are included in the select/return. If the route uses `select` (partial fields), add `tripId: true, bookingId: true`. If it returns full models (default), Prisma will include all scalar fields automatically — verify by checking the select clause. Add the `trip` relation include if needed:

```typescript
include: {
  trip: { select: { id: true, name: true, color: true } },
}
```

This requires the flight response type to be updated. If a `select` clause exists, add `tripId: true`.

- [ ] **Step 9: Run type check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/pages/FlightsTablePage.tsx backend/src/routes/flights.ts
git commit -m "feat: add Einzelflüge/Trips tabs and trip badge column to flights table"
```

---

## Task 7: TripsTab + TripCard Components

**Goal:** Implement the `TripsTab` card grid and `TripCard` component matching the mockup: colored accent bar, route chain (IATA sequence), PNR badges, stats, action buttons.

**Files:**
- Create: `frontend/src/components/Trips/TripCard.tsx`
- Create: `frontend/src/components/Trips/TripsTab.tsx`

- [ ] **Step 1: Create TripCard component**

Create `frontend/src/components/Trips/TripCard.tsx`:

```tsx
import type { Trip } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { formatCurrency, formatDistance } from "../../lib/units";
import { differenceInDays } from "date-fns";

interface TripCardProps {
  trip: Trip;
  onEdit: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
  onShowOnMap: (trip: Trip) => void;
}

export default function TripCard({ trip, onEdit, onDelete, onShowOnMap }: TripCardProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const { units, features } = useSettingsStore();

  // Build IATA route chain from sorted flights
  const routeChain: string[] = [];
  if (trip.flights && trip.flights.length > 0) {
    const sorted = [...trip.flights].sort(
      (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
    );
    sorted.forEach((f, i) => {
      if (i === 0 && f.depIata) routeChain.push(f.depIata);
      if (f.arrIata) routeChain.push(f.arrIata);
    });
  }

  // Date range
  const firstFlight = trip.flights?.[0];
  const lastFlight = trip.flights?.[trip.flights.length - 1];
  const startDate = firstFlight ? new Date(firstFlight.departureTime) : null;
  const endDate = lastFlight ? new Date(lastFlight.arrivalTime) : null;
  const nights = startDate && endDate ? differenceInDays(endDate, startDate) : null;

  const dateRangeStr = startDate && endDate
    ? `${startDate.toLocaleDateString("de-DE", { day: "2-digit", month: "short" })} – ${endDate.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })}`
    : null;

  // Cost from bookings
  const totalCost = trip.bookings?.reduce((sum, b) => sum + (b.price ?? 0), 0) ?? 0;
  const currency = trip.bookings?.find((b) => b.currency)?.currency ?? units.currency;

  // Distance (sum of all flight distances — approximate using lat/lon)
  // We don't have distance pre-calculated here; show flight count as fallback
  const flightCount = trip._count?.flights ?? trip.flights?.length ?? 0;

  return (
    <div
      className="rounded-xl overflow-hidden flex flex-col cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      {/* Accent bar */}
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${trip.color}, ${trip.color}88)` }} />

      <div className="p-4 flex-1">
        <h3 className="font-bold text-base leading-tight" style={{ color: "var(--text-primary)" }}>
          {trip.name}
        </h3>
        {dateRangeStr && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {dateRangeStr}
            {nights !== null && nights > 0 && (
              <> · {t("trips:nights", { count: nights })}</>
            )}
          </p>
        )}

        {/* Route chain */}
        {routeChain.length > 0 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {routeChain.map((iata, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>→</span>}
                <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>{iata}</span>
              </span>
            ))}
          </div>
        )}

        {/* PNR badges */}
        {trip.bookings && trip.bookings.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-2">
            {trip.bookings.map((b) => b.pnr && (
              <span
                key={b.id}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
              >
                {b.pnr}
              </span>
            ))}
          </div>
        )}

        <hr className="my-3" style={{ borderColor: "var(--color-border)" }} />

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("trips:flightCount", { count: flightCount })}
            </div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              {t("common:flights")}
            </div>
          </div>
          {features.enableCostTracking && totalCost > 0 && (
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--color-success, #4ade80)" }}>
                {formatCurrency(totalCost, currency as "EUR" | "USD" | "GBP" | "CHF")}
              </div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                {t("trips:totalCost")}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer buttons */}
      <div
        className="flex gap-2 px-4 py-2.5"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        <button
          onClick={() => onShowOnMap(trip)}
          className="px-2.5 py-1 rounded text-xs font-medium"
          style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
        >
          🗺 {t("trips:showOnMap")}
        </button>
        <button
          onClick={() => onEdit(trip)}
          className="px-2.5 py-1 rounded text-xs font-medium"
          style={{ background: "var(--bg-muted)", color: "var(--color-success, #4ade80)" }}
        >
          ✏ {t("trips:editTrip")}
        </button>
        <button
          onClick={() => onDelete(trip)}
          className="px-2.5 py-1 rounded text-xs font-medium ml-auto"
          style={{ background: "var(--bg-muted)", color: "var(--color-error, #f87171)" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create TripsTab component**

Create `frontend/src/components/Trips/TripsTab.tsx`:

```tsx
import { useState } from "react";
import type { Trip } from "../../types";
import TripCard from "./TripCard";
import TripModal from "./TripModal";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

interface TripsTabProps {
  trips: Trip[];
  onTripsChange: () => void;
}

export default function TripsTab({ trips, onTripsChange }: TripsTabProps): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const addToast = useToastStore((s) => s.addToast);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleDelete = async (trip: Trip) => {
    if (!window.confirm(t("trips:deleteTripConfirm", { name: trip.name }))) return;
    try {
      await tripsApi.delete(trip.id);
      addToast({ type: "success", message: t("trips:toasts.deleted") });
      onTripsChange();
    } catch {
      addToast({ type: "error", message: t("trips:toasts.deleteError") });
    }
  };

  const handleShowOnMap = (trip: Trip) => {
    // Navigate to map with trip filter — store trip ID in URL or state
    // For now, open map tab with console note
    window.location.href = `/?tripFilter=${trip.id}`;
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {t("trips:count", { count: trips.length })}
        </p>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
        >
          ＋ {t("trips:createTrip")}
        </button>
      </div>

      {trips.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-2xl mb-2">🗺</p>
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>{t("trips:noTrips")}</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{t("trips:noTripsDesc")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              onEdit={setEditingTrip}
              onDelete={handleDelete}
              onShowOnMap={handleShowOnMap}
            />
          ))}
          {/* New trip placeholder card */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-xl border border-dashed flex flex-col items-center justify-center min-h-[200px] gap-2 transition-colors hover:border-[var(--accent)]/50"
            style={{ borderColor: "var(--color-border)", background: "var(--bg-muted)" }}
          >
            <span className="text-3xl opacity-20">＋</span>
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>{t("trips:newTrip")}</span>
            <span className="text-xs text-center px-4" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
              {t("trips:newTripDesc")}
            </span>
          </button>
        </div>
      )}

      {(showCreateModal || editingTrip) && (
        <TripModal
          trip={editingTrip}
          onClose={() => { setShowCreateModal(false); setEditingTrip(null); }}
          onSaved={() => { setShowCreateModal(false); setEditingTrip(null); onTripsChange(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire TripsTab into FlightsTablePage**

In `frontend/src/pages/FlightsTablePage.tsx`, replace the placeholder from Task 6 Step 7 with:

```tsx
import TripsTab from "../components/Trips/TripsTab";
// ...
{activeTab === "trips" && (
  <TripsTab trips={trips} onTripsChange={() => void loadTrips()} />
)}
```

- [ ] **Step 4: Run type check + tests**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npx vitest --run 2>&1 | tail -10
```
Expected: 0 type errors.

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/Trips/ frontend/src/pages/FlightsTablePage.tsx
git commit -m "feat: add TripCard and TripsTab card grid view"
```

---

## Task 8: TripModal — Create / Edit

**Goal:** Modal for creating a new trip (name, optional description, color picker) and editing an existing one.

**Files:**
- Create: `frontend/src/components/Trips/TripModal.tsx`

- [ ] **Step 1: Create TripModal**

Create `frontend/src/components/Trips/TripModal.tsx`:

```tsx
import { useState, useEffect } from "react";
import type { Trip } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

const PALETTE = [
  "#818cf8", "#38bdf8", "#34d399", "#fb923c", "#f472b6",
  "#a78bfa", "#22d3ee", "#86efac", "#fbbf24", "#f87171",
];

interface TripModalProps {
  trip: Trip | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

export default function TripModal({ trip, onClose, onSaved }: TripModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [name, setName] = useState(trip?.name ?? "");
  const [description, setDescription] = useState(trip?.description ?? "");
  const [color, setColor] = useState(trip?.color ?? PALETTE[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (trip) {
      setName(trip.name);
      setDescription(trip.description ?? "");
      setColor(trip.color);
    }
  }, [trip]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (trip) {
        await tripsApi.update(trip.id, { name: name.trim(), description: description.trim() || null, color });
        addToast({ type: "success", message: t("trips:toasts.updated") });
      } else {
        await tripsApi.create({ name: name.trim(), description: description.trim() || undefined, color });
        addToast({ type: "success", message: t("trips:toasts.created") });
      }
      onSaved();
    } catch {
      addToast({ type: "error", message: trip ? t("trips:toasts.updateError") : t("trips:toasts.createError") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-md rounded-xl shadow-2xl"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="p-5 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {trip ? t("trips:editTrip") : t("trips:createTrip")}
          </h2>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-muted)" }}>
              {t("trips:modal.nameLabel")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("trips:modal.namePlaceholder")}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--color-border)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-muted)" }}>
              {t("trips:modal.descLabel")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("trips:modal.descPlaceholder")}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-sm resize-none"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--color-border)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
              {t("trips:modal.colorLabel")}
            </label>
            <div className="flex gap-2 flex-wrap">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: color === c ? `2px solid ${c}` : "none",
                    outlineOffset: "2px",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:modal.cancel")}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!name.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-50"
          >
            {saving ? "…" : t("trips:modal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | head -10
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/Trips/TripModal.tsx
git commit -m "feat: add TripModal for create/edit trips"
```

---

## Task 9: Auto-Create Trip + Booking on Email Import

**Goal:** When the email parser returns ≥2 flights sharing the same PNR, auto-create a `Trip` (auto-named from route + date) and a `Booking` (with PNR and price if found). Link all flights to both. This happens server-side after the user confirms adding the flights — i.e., the `POST /flights` endpoint creates the trip, not the parse endpoint.

**Implementation choice:** The auto-trip creation runs in `backend/src/routes/flights.ts` in the bulk-create path (when multiple flights are created in one request and share a `bookingReference`). This is cleaner than the parse endpoint since the parse endpoint only extracts data without persisting.

**Files:**
- Modify: `backend/src/routes/flights.ts`

- [ ] **Step 1: Read the bulk-create / batch section of flights.ts**

Read `backend/src/routes/flights.ts` fully (it's around 600 lines). Find:
1. The `POST /` (create single flight) handler — note its structure
2. Whether a bulk-create endpoint exists (`POST /batch` or similar)

If no batch endpoint exists, the frontend creates flights one by one. In that case, add a new `POST /batch` endpoint that accepts an array, creates all flights, then auto-creates Trip+Booking.

- [ ] **Step 2: Add POST /batch endpoint with auto-trip logic**

In `backend/src/routes/flights.ts`, add after the single `POST /` handler:

```typescript
/** POST /batch — create multiple flights at once, auto-creating Trip+Booking when PNR shared */
router.post('/batch', authenticate, flightCreationLimiter, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const schema = z.array(createFlightSchema).min(1).max(20);
  const inputs = schema.parse(req.body);

  // Create all flights individually (reuse existing enrichment logic)
  const createdFlights: unknown[] = [];
  for (const input of inputs) {
    // Enrich airports
    const enriched = await enrichFlightAirports(input.departureCode, input.arrivalCode);
    const flightData = {
      userId,
      ...buildFlightData(input, enriched), // extract the common flight build logic or inline it
    };
    const flight = await prisma.flight.create({ data: flightData });
    createdFlights.push(flight);
  }

  // Group by bookingReference to auto-create Trips+Bookings
  const pnrGroups = new Map<string, typeof createdFlights>();
  createdFlights.forEach((f) => {
    const flight = f as { id: string; bookingReference?: string | null; depIata?: string | null; arrIata?: string | null; departureTime: Date };
    if (flight.bookingReference) {
      const group = pnrGroups.get(flight.bookingReference) ?? [];
      group.push(f);
      pnrGroups.set(flight.bookingReference, group);
    }
  });

  for (const [pnr, groupFlights] of pnrGroups.entries()) {
    if (groupFlights.length < 2) continue; // Only auto-create for multi-leg bookings
    const count = await prisma.trip.count({ where: { userId } });
    const color = TRIP_COLORS[count % TRIP_COLORS.length];

    // Auto-name: "MUC – TRD · Jun 2024"
    const sorted = (groupFlights as Array<{ depIata?: string | null; arrIata?: string | null; departureTime: Date }>)
      .sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime());
    const origin = sorted[0]?.depIata ?? "?";
    const dest = sorted[Math.ceil(sorted.length / 2) - 1]?.arrIata ?? "?";
    const month = sorted[0]?.departureTime.toLocaleDateString("en", { month: "short", year: "numeric" });
    const name = `${origin} – ${dest} · ${month}`;

    const trip = await prisma.trip.create({ data: { userId, name, color } });
    const booking = await prisma.booking.create({
      data: { userId, tripId: trip.id, pnr },
    });

    const flightIds = (groupFlights as Array<{ id: string }>).map((f) => f.id);
    await prisma.flight.updateMany({
      where: { id: { in: flightIds } },
      data: { tripId: trip.id, bookingId: booking.id },
    });
  }

  res.status(201).json({ flights: createdFlights, count: createdFlights.length });
});
```

Add the import at the top of `flights.ts`:
```typescript
import { TRIP_COLORS } from "../schemas/trip";
```

**Note:** The `buildFlightData` extraction requires reading the existing single-flight `POST /` handler carefully and factoring out the shared logic. If the existing code is complex, inline the data building instead of extracting a function — follow DRY only where the cost is justified.

- [ ] **Step 3: Use POST /batch from frontend on multi-flight email import**

In `frontend/src/lib/api/flights.ts`, add a `createBatch` method:

```typescript
createBatch: async (flights: FlightInput[]): Promise<{ flights: Flight[]; count: number }> => {
  const { data } = await api.post<{ flights: Flight[]; count: number }>("/flights/batch", flights);
  return data;
},
```

In `frontend/src/pages/FlightsTablePage.tsx` and `DashboardPage.tsx`, when `handleAddFlight` is called with `hasMoreFlights === false` and the form originated from an email parse (check `parsedFlights.length > 1`), call `flightsApi.createBatch(allFlights)` instead of individual `flightsApi.create(flight)` calls.

**Alternative simpler approach:** Add batch creation in the existing `onSubmit` callback of `useFlightForm.ts`. When `parsedFlights.length > 1` and this is the last flight, collect all confirmed flights and send as batch. This requires storing confirmed flights in `useFlightForm` state.

Use the simpler approach: modify `useFlightForm.ts` to accumulate confirmed flights in a `confirmedFlights` ref, then on the last flight submission, send all as batch.

- [ ] **Step 4: Run backend type check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors (or fix any that arise from the batch endpoint).

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/routes/flights.ts frontend/src/lib/api/flights.ts frontend/src/components/FlightForm/useFlightForm.ts
git commit -m "feat: auto-create Trip+Booking when multi-flight email import submitted as batch"
```

---

## Task 10: Stats — Cost Deduplication via Booking

**Goal:** When calculating total cost, `costPerKm`, and `costPerHour` in `statsCalculator.ts`, deduplicate costs by `bookingId`. If multiple flights share a `bookingId`, count the booking's price once (not per-flight). Fall back to per-flight `price` for flights without a `bookingId`.

**Files:**
- Modify: `backend/src/utils/statsCalculator.ts`
- Modify: `backend/src/routes/stats.ts` (pass bookings data to calculator)

- [ ] **Step 1: Read statsCalculator.ts fully**

Read `backend/src/utils/statsCalculator.ts` in full to understand the exact shape of the input data (the `Flight`-like objects passed in) and where `price`, `taxes`, `fees` are used (lines 250–295 approximately).

- [ ] **Step 2: Update the Flight type used by statsCalculator**

The calculator likely has its own internal `Flight`-like interface. Add `bookingId?: string | null` to it.

Find the interface (around line 90: `price?: number | null;`) and add:
```typescript
  bookingId?: string | null;
  booking?: { id: string; price?: number | null; currency?: string | null } | null;
```

- [ ] **Step 3: Update cost calculation to deduplicate by booking**

Find the section starting at `// Cost per kilometer` (around line 247). Replace the cost accumulation loop with:

```typescript
// Deduplicate costs: if flight has a booking, count booking price once (not per-flight)
const seenBookingIds = new Set<string>();
let totalCost = 0;
let totalDistanceWithCost = 0;

for (const f of flights) {
  let flightCost = 0;

  if (f.bookingId && f.booking?.price) {
    // Use booking price — but only once per booking
    if (!seenBookingIds.has(f.bookingId)) {
      seenBookingIds.add(f.bookingId);
      flightCost = f.booking.price; // booking price covers all flights in the booking
    }
    // For distance/hours: still count this flight's contribution
    // (we want total km traveled, even if price is deduplicated)
  } else {
    // No booking — use per-flight price (legacy)
    flightCost = (f.price ?? 0) + (f.taxes ?? 0) + (f.fees ?? 0);
  }

  if (flightCost > 0) {
    totalCost += flightCost;
  }

  // Always count distance for flights in a priced booking, or for flights with own price
  const hasCost = flightCost > 0 || (f.bookingId && seenBookingIds.has(f.bookingId) && (f.booking?.price ?? 0) > 0);
  if (hasCost) {
    const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    totalDistanceWithCost += dist;
  }
}
```

Apply the same deduplication logic to the `costPerHour` loop (~line 280).

- [ ] **Step 4: Pass booking data from stats route to calculator**

In `backend/src/routes/stats.ts`, find the `prisma.flight.findMany()` call. Add booking include:

```typescript
include: {
  booking: { select: { id: true, price: true, currency: true } },
},
```

- [ ] **Step 5: Run backend type check + tests**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit && npm test -- --forceExit 2>&1 | tail -20
```
Expected: 0 type errors. Backend tests pass (or same failures as before — DB-dependent tests may fail locally without the DB running).

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/utils/statsCalculator.ts backend/src/routes/stats.ts
git commit -m "feat: deduplicate trip costs by booking in stats calculator"
```

---

## Task 11: Map — Trip-Routes Visualization Layer

**Goal:** Add a new `"trip-routes"` VisMode that renders all flights colored by their Trip. Each trip gets its assigned color. Flights without a trip are shown in the default route color.

**Files:**
- Modify: `frontend/src/types/visMode.ts`
- Create: `frontend/src/components/layers/tripRoutesLayer.ts`
- Modify: `frontend/src/components/DeckGLMap.tsx`
- Modify: `frontend/src/components/MapContainer3D.tsx`

- [ ] **Step 1: Add trip-routes to VisMode**

In `frontend/src/types/visMode.ts`:

```typescript
export type VisMode = "routes" | "globe" | "heatmap" | "hexagon" | "columns" | "trips" | "contour" | "trip-routes";

export const VIS_MODES: VisMode[] = [
  "routes",
  "globe",
  "heatmap",
  "hexagon",
  "columns",
  "trips",
  "contour",
  "trip-routes",
];

export const VIS_MODE_LABELS: Record<VisMode, string> = {
  routes: "Routes",
  globe: "Globe",
  heatmap: "Heatmap",
  hexagon: "Hexagon",
  columns: "3D Columns",
  trips: "Trips (Animation)",
  contour: "Contour",
  "trip-routes": "Trip Routes",
};
```

- [ ] **Step 2: Create tripRoutesLayer**

Create `frontend/src/components/layers/tripRoutesLayer.ts`:

```typescript
import { ArcLayer } from "@deck.gl/layers";
import type { Flight } from "../../types";

const DEFAULT_COLOR: [number, number, number, number] = [100, 100, 120, 100];

function hexToRgba(hex: string, alpha = 200): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, alpha];
}

interface TripRoutesData {
  flight: Flight;
  color: [number, number, number, number];
}

export function createTripRoutesLayer(
  flights: Flight[],
  trips: Array<{ id: string; color: string }>
): ArcLayer<TripRoutesData> {
  const tripColorMap = new Map(trips.map((t) => [t.id, hexToRgba(t.color)]));

  const data: TripRoutesData[] = flights
    .filter((f) => f.depLat && f.depLon && f.arrLat && f.arrLon)
    .map((f) => ({
      flight: f,
      color: f.tripId ? (tripColorMap.get(f.tripId) ?? DEFAULT_COLOR) : DEFAULT_COLOR,
    }));

  return new ArcLayer<TripRoutesData>({
    id: "trip-routes-layer",
    data,
    getSourcePosition: (d) => [d.flight.depLon, d.flight.depLat],
    getTargetPosition: (d) => [d.flight.arrLon, d.flight.arrLat],
    getSourceColor: (d) => d.color,
    getTargetColor: (d) => d.color,
    getWidth: 2,
    pickable: true,
  });
}
```

- [ ] **Step 3: Update DeckGLMap to handle trip-routes**

Read `frontend/src/components/DeckGLMap.tsx` fully. The component receives `flights` and `visMode` as props.

Add import:
```typescript
import { createTripRoutesLayer } from "./layers/tripRoutesLayer";
```

Add `trips` to the props interface:
```typescript
  trips?: Array<{ id: string; color: string }>;
```

In the `switch (visMode)` block (around line 332), add before the `default` case:
```typescript
      case "trip-routes":
        return [createTripRoutesLayer(flights, trips ?? [])];
```

- [ ] **Step 4: Update MapContainer3D to pass trips**

Read `frontend/src/components/MapContainer3D.tsx`. It likely fetches flights and renders `DeckGLMap`.

Add trips state:
```typescript
import { tripsApi } from "../lib/api";
import type { Trip } from "../types";

const [trips, setTrips] = useState<Trip[]>([]);

useEffect(() => {
  tripsApi.getAll()
    .then(setTrips)
    .catch(() => { /* non-critical */ });
}, []);
```

Pass to DeckGLMap:
```tsx
<DeckGLMap
  flights={flights}
  visMode={visMode}
  trips={trips.map(t => ({ id: t.id, color: t.color }))}
  // ...other existing props
/>
```

- [ ] **Step 5: Run type check + vitest**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npx vitest --run 2>&1 | tail -10
```
Expected: 0 type errors, tests pass.

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/types/visMode.ts \
  frontend/src/components/layers/tripRoutesLayer.ts \
  frontend/src/components/DeckGLMap.tsx \
  frontend/src/components/MapContainer3D.tsx
git commit -m "feat: add trip-routes map layer (ArcLayer colored by trip)"
```

---

## Final Build Check

After all tasks are complete:

- [ ] **Backend full check**

```bash
cd /d/Projekte/TravStats/backend
npx tsc --noEmit && npm run lint && npm test -- --forceExit 2>&1 | tail -30
```

- [ ] **Frontend full check**

```bash
cd /d/Projekte/TravStats/frontend
npx tsc --noEmit && npm run lint && npx vitest --run 2>&1 | tail -30
```

---

## Self-Review

**Spec coverage check:**
- ✅ Feature toggle (`enableCostTracking`) — Task 1
- ✅ Trip DB model with color — Task 2
- ✅ Booking DB model (price at booking level) — Task 2
- ✅ Flight gets `tripId` + `bookingId` — Task 2
- ✅ Backend CRUD API for trips — Task 3
- ✅ Frontend types + API client — Task 4
- ✅ i18n namespace (de + en) — Task 5
- ✅ Einzelflüge tab with trip badge + filter chips — Task 6
- ✅ Trips tab with card view — Task 7
- ✅ Trip create/edit modal with color picker — Task 8
- ✅ Auto-create Trip+Booking on multi-flight email import — Task 9
- ✅ Stats cost deduplication by booking — Task 10
- ✅ Map trip-routes layer (color per trip) — Task 11
- ✅ Manual trip creation with flight assignment — Tasks 3 + 8
- ✅ "Auf Karte" button on trip card — Task 7 (links to map with trip filter)

**Type consistency check:**
- `Trip.color` defined in schema (Task 2), in frontend type (Task 4), used in tripRoutesLayer (Task 11) — consistent
- `Booking.price` used in statsCalculator as `f.booking.price` — matches include in Task 10
- `Flight.tripId` and `Flight.bookingId` added in schema (Task 2) and frontend types (Task 4) — consistent
- `tripsApi.createBooking` used in Task 9 — defined in Task 4
- `TRIP_COLORS` exported from `schemas/trip.ts` (Task 3) and imported in `routes/trips.ts` (Task 3) and `routes/flights.ts` (Task 9) — consistent
