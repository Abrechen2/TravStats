# Immich Album Integration — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect their self-hosted Immich instance, link one or more Immich albums to a trip in either *link* (proxied, zero storage) or *import* (local copy) mode, and see those photos grouped in the trip gallery with a lightbox, cover-setting, re-sync and graceful degradation.

**Architecture:** A thin typed REST client (`immichClient.ts`) contains all knowledge of Immich's API so version drift stays in one file. A resolver (`immichResolver.ts`) mirrors the existing `apiKeyResolver.ts` User→Admin-Global→ENV priority and returns a decrypted `{ baseUrl, apiKey }`. Link-mode albums store **no photo rows** — the backend streams tiles from Immich through an ownership-checked proxy with browser-side caching. Import-mode albums download originals into the existing trip-photo directory and create normal `TripPhoto` rows tagged with `immichAssetId`, tracked by a DB-row progress job mirroring `airportSeedingService`.

**Tech Stack:** Express 4 + TypeScript (strict), Prisma + PostgreSQL, Zod, axios, Pino, Jest + supertest (backend); React + Vite + TypeScript, react-i18next, Vitest (frontend).

## Verified API facts (do not re-derive — these were checked against the live spec)

Fetched from `https://raw.githubusercontent.com/immich-app/immich/main/open-api/immich-openapi-specs.json` on 2026-07-09. **Immich OpenAPI version `3.0.1`.** This plan pins that version.

| Fact | Value |
|---|---|
| Auth header | `x-api-key: <key>` (security scheme `api_key`) |
| List albums | `GET /api/albums` → `AlbumResponseDto[]` |
| Album fields | `id`, `albumName`, `assetCount`, `albumThumbnailAssetId` (nullable uuid) |
| **`AlbumResponseDto` has NO `assets` array** | Album assets must come from search (below) |
| Album assets | `POST /api/search/metadata` body `{ albumIds:[id], withExif:true, page, size }` → `SearchResponseDto.assets` = `{ items: AssetResponseDto[], nextPage: string\|null, total, count }` |
| `size` bounds | 1..1000; `page` starts at **1**; paginate until `nextPage === null` |
| Asset fields | `id`, `type` (`IMAGE`/`VIDEO`), `fileCreatedAt`, `originalFileName`, `originalMimeType`, `exifInfo` |
| Exif fields | `latitude`, `longitude`, `fileSizeInByte` (all nullable) |
| Thumbnail/preview | `GET /api/assets/{id}/thumbnail?size=thumbnail\|preview` |
| Original | `GET /api/assets/{id}/original` (passing `size=original` to `/thumbnail` is **deprecated in v3**) |
| Size semantics | `thumbnail` = small grid tile (webp); `preview` = large lightbox image (jpeg) |
| Server version | `GET /api/server/version` → `{ major, minor, patch, prerelease }` — **no auth required** |
| Identity check | `GET /api/users/me` → `{ id, email, name, ... }` — requires auth |

**Consequence:** the spec's `getAlbum(albumId) → album with assets` (§4.2) does not exist in the current API. It is replaced by `listAlbumAssets(albumId)` built on `POST /search/metadata`.

## Deviations from the spec (decided here, deliberately)

1. **Import job progress needs a table.** Spec §4.4 says "tracked background job with progress" but the repo has **no job queue** (only `node-cron` schedulers). We mirror the established `AirportSeedingStatus` DB-row + polling pattern with a new `ImmichImportJob` model. This is an addition to spec §3.
2. **Album assets via `POST /search/metadata`** (see above).
3. **New route file, not `trips.ts`.** `backend/src/routes/trips.ts` is **823 lines** — already over the 800-line hard maximum. Every new Immich trip route goes in `backend/src/routes/immich/tripAlbums.ts`. `resolveTrip` is exported from `trips.ts` and reused.
4. **Proxy asset-membership check.** The proxy must verify the requested `assetId` actually belongs to the linked album (via the asset-list cache), not just that the user owns the trip. Without it the proxy is an arbitrary-asset reader for anyone who owns any trip.
5. **Storage location is already correct.** `getTripPhotoDir()` resolves to `backend/uploads/trip-photos`, which the Docker entrypoint symlinks to `/app/data/uploads/...` (commit `0ed9e9cc`). Imported copies therefore land on the data volume and in backups — no change needed.
6. **Phase A drops `searchByDateRange`.** It is only consumed by Phase B. YAGNI.

## Execution order

Tasks are **not** executed in heading order. `immichImport.ts` is a leaf module,
so it is built before the routes that consume it — that way no task has to ship a
stub with empty function bodies:

```
1 → 2 → 3 → 4 → 5 → 6 → 9 → 7 → 8 → 16 → 10 → 11 → 12 → 13 → 14 → 15
                        ↑   ↑   ↑    ↑
             import service │   │    └── routes exposing the service
                    trip↔album routes │
                          image proxy ┘
```

Task 16 lives in the file next to Task 9 (the service it exposes), not at the end.

## Global Constraints

- TypeScript `strict: true`. **`any` is FORBIDDEN** — use `unknown` + type guards.
- **Zod** for every request body / query at the system boundary. Schemas in `backend/src/schemas/`.
- **Pino logger only** — `import logger from "../utils/logger"`. No `console.log`.
- Async: always `async/await`, never `.then()`.
- Immutability: spread `{...obj, field: value}`, never in-place mutation.
- Error handling explicit at every level; never swallow silently.
- File size 200–400 lines ideal, **800 lines hard maximum**.
- Prettier: `printWidth 100`, `singleQuote: false` (backend `trips.ts` style is double-quoted).
- Code, comments, commit messages: **English**. UI copy: **German primary + English mirror, updated together** in `frontend/src/i18n/de.json` and `en.json`.
- **NEVER touch `backend/VERSION` or `CHANGELOG.md` on this branch** — owned by `/deploy` on `main`.
- Frontend `useTranslation` is imported from `"../hooks/useTranslation"` (project wrapper), not from `react-i18next`.
- Axios instances that hit our own API use `withCredentials: true` (JWT is an HttpOnly cookie).
- Migrations on this repo are **hand-written**, never `prisma migrate dev` (see Task 1).

## File Structure

**Backend — create**

| File | Responsibility |
|---|---|
| `backend/src/services/immich/types.ts` | Shared `ImmichConnection`, `ImmichAlbum`, `ImmichAsset`, `ImmichMode`, `ImmichAssetSize`, `ImmichError` |
| `backend/src/services/immich/immichClient.ts` | The only file that knows Immich's REST paths |
| `backend/src/services/immich/immichResolver.ts` | User→Admin→ENV connection + default-mode resolution |
| `backend/src/services/immich/immichAssetCache.ts` | 60 s in-memory TTL cache of album→assets |
| `backend/src/services/immich/immichImport.ts` | Download/re-sync pipeline + job status |
| `backend/src/schemas/immich.ts` | Zod: connection, link body, mode enum, asset-size enum, base-URL normaliser |
| `backend/src/routes/settings/immich.ts` | `GET/PUT /settings/immich`, `POST /settings/immich/test` |
| `backend/src/routes/admin/immich.ts` | `GET/PUT /admin/immich`, `POST /admin/immich/test` |
| `backend/src/routes/immich/tripAlbums.ts` | link / unlink / resync / list / assets |
| `backend/src/routes/immich/assetProxy.ts` | the streaming image proxy |
| `backend/prisma/migrations/20260709120000_immich_albums/migration.sql` | data model |

**Backend — modify**

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | `UserSettings` +3 fields, `AdminSettings` +2, new `TripImmichAlbum` + `ImmichImportJob`, `TripPhoto` +4, `Trip` +1 relation |
| `backend/src/routes/trips.ts` | `export` `resolveTrip`; extend `PATCH /trips/:id` cover handling |
| `backend/src/routes/settings/index.ts` | mount `/immich` |
| `backend/src/routes/admin/index.ts` | mount `/immich` |
| `backend/src/middleware/rateLimit.ts` | `+ immichProxyLimiter`, `+ immichImportLimiter` |
| `backend/src/config/constants.ts` | `+ IMMICH` limits block |
| `backend/src/index.ts` | mount `immichTripRoutes` under `/api/v1` |

**Frontend — create**

| File | Responsibility |
|---|---|
| `frontend/src/types/immich.ts` | `ImmichAlbumSummary`, `LinkedAlbum`, `ImmichAssetDto`, `ImmichConnectionStatus` |
| `frontend/src/lib/api/immich.ts` | `immichApi` client |
| `frontend/src/components/Settings/ImmichConnectionCard.tsx` | URL + key + defaultMode + test |
| `frontend/src/components/Trips/ImmichAlbumPicker.tsx` | album multi-select modal |
| `frontend/src/components/Trips/ImmichAlbumSection.tsx` | one gallery section per linked album |
| `frontend/src/components/Trips/PhotoLightbox.tsx` | extracted + upgraded lightbox |

**Frontend — modify**

| File | Change |
|---|---|
| `frontend/src/components/Trips/TripGallery.tsx` | grouped sections; delegate lightbox |
| `frontend/src/i18n/de.json`, `en.json` | `immich.*` keys (added per-task, never batched at the end) |

---

## Task 1: Data model + hand-written migration

**Why hand-written:** `backend/prisma/schema.prisma` has known drift vs. the migration history (NOT-NULL flips on `flights.has_live_tracking` and `user_settings.historical_enrichment_*`, plus DROP INDEX reconciliations). `prisma migrate dev` would bundle that drift into this migration and break prod. Precedent: `20260419120000_cruise_module`, `20260705120000_cruise_unresolved_port`. Write the SQL by hand; use `prisma generate` (never `migrate dev`) to refresh the client.

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260709120000_immich_albums/migration.sql`
- Test: `backend/src/__tests__/immichSchema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `TripImmichAlbum`, `ImmichImportJob`; fields `UserSettings.immichBaseUrl / immichApiKey / immichDefaultMode`, `AdminSettings.globalImmichBaseUrl / globalImmichApiKey`, `TripPhoto.immichAssetId / immichAlbumLinkId / lat / lon`, `Trip.immichAlbums`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/immichSchema.test.ts`. (Backend Jest needs a running PostgreSQL — see CLAUDE.md.)

```typescript
/**
 * Schema-level guarantees for the Immich data model:
 *  - a linked album cascades from its trip
 *  - imported photos cascade from their album link
 *  - (tripId, immichAssetId) is unique, but many NULLs coexist (manual uploads)
 */
import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import { prisma } from "../db";

const USER = "immich-schema-test-user";

// `User` requires `passwordHash` (not `password`) and has no `email` column.
async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `${USER}-${Date.now()}-${Math.random()}`, passwordHash: "x" },
  });
  return user.id;
}

describe("Immich schema", () => {
  let userId: string;

  beforeEach(async () => {
    userId = await makeUser();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: USER } } });
    await prisma.$disconnect();
  });

  it("cascades linked albums and imported photos when the trip is deleted", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Trip" } });
    const link = await prisma.tripImmichAlbum.create({
      data: { tripId: trip.id, immichAlbumId: "album-1", albumName: "Album 1", mode: "import" },
    });
    await prisma.tripPhoto.create({
      data: {
        tripId: trip.id,
        filename: "a.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 1,
        immichAssetId: "asset-1",
        immichAlbumLinkId: link.id,
        lat: 52.5,
        lon: 13.4,
      },
    });

    await prisma.trip.delete({ where: { id: trip.id } });

    expect(await prisma.tripImmichAlbum.count({ where: { id: link.id } })).toBe(0);
    expect(await prisma.tripPhoto.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it("rejects a duplicate immichAssetId within one trip but allows many manual uploads", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Trip" } });
    const base = { tripId: trip.id, filename: "a.jpg", mimetype: "image/jpeg", sizeBytes: 1 };

    await prisma.tripPhoto.create({ data: { ...base, immichAssetId: "dupe" } });
    await expect(
      prisma.tripPhoto.create({ data: { ...base, immichAssetId: "dupe" } }),
    ).rejects.toThrow();

    // NULL immichAssetId is not constrained — manual uploads stay unlimited.
    await prisma.tripPhoto.create({ data: base });
    await prisma.tripPhoto.create({ data: base });
    expect(await prisma.tripPhoto.count({ where: { tripId: trip.id, immichAssetId: null } })).toBe(2);
  });

  it("stores an import job keyed one-to-one to its album link", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Trip" } });
    const link = await prisma.tripImmichAlbum.create({
      data: { tripId: trip.id, immichAlbumId: "album-2", albumName: "Album 2", mode: "import" },
    });
    const job = await prisma.immichImportJob.create({
      data: { albumLinkId: link.id, status: "running", totalAssets: 10 },
    });
    expect(job.processedAssets).toBe(0);

    await prisma.tripImmichAlbum.delete({ where: { id: link.id } });
    expect(await prisma.immichImportJob.count({ where: { id: job.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichSchema.test.ts --forceExit`
Expected: FAIL — `Property 'tripImmichAlbum' does not exist on type 'PrismaClient'`.

- [ ] **Step 3: Extend `backend/prisma/schema.prisma`**

Add to `model UserSettings` (after the OpenSky block, before "Auto-update settings"):

```prisma
  // Immich connection (base URL plain, API key encrypted at application level)
  immichBaseUrl     String? @map("immich_base_url")
  immichApiKey      String? @map("immich_api_key")
  immichDefaultMode String  @default("link") @map("immich_default_mode")
```

Add to `model AdminSettings` (after the OpenSky block):

```prisma
  // Global Immich connection (base URL plain, API key encrypted)
  globalImmichBaseUrl String? @map("global_immich_base_url")
  globalImmichApiKey  String? @map("global_immich_api_key")
```

Add to `model Trip`, in the relations block next to `photos`:

```prisma
  immichAlbums   TripImmichAlbum[]
```

Replace `model TripPhoto` wholesale:

```prisma
model TripPhoto {
  id        String    @id @default(uuid())
  tripId    String    @map("trip_id")
  filename  String
  mimetype  String
  sizeBytes Int       @map("size_bytes")
  caption   String?
  takenAt   DateTime? @map("taken_at")
  sortIdx   Int       @default(0) @map("sort_idx")
  createdAt DateTime  @default(now()) @map("created_at")

  // Immich provenance — set only for photos imported from a linked album.
  immichAssetId     String? @map("immich_asset_id")
  immichAlbumLinkId String? @map("immich_album_link_id")

  // EXIF coordinates (Phase C map layer). Populated on Immich import;
  // best-effort for manual uploads.
  lat Float?
  lon Float?

  trip        Trip             @relation(fields: [tripId], references: [id], onDelete: Cascade)
  immichAlbum TripImmichAlbum? @relation(fields: [immichAlbumLinkId], references: [id], onDelete: Cascade)

  @@unique([tripId, immichAssetId])
  @@index([tripId])
  @@index([tripId, sortIdx])
  @@index([immichAlbumLinkId])
  @@map("trip_photos")
}
```

Append the two new models after `TripPhoto`:

```prisma
model TripImmichAlbum {
  id               String    @id @default(uuid())
  tripId           String    @map("trip_id")
  immichAlbumId    String    @map("immich_album_id")
  albumName        String    @map("album_name")
  assetCount       Int       @default(0) @map("asset_count")
  thumbnailAssetId String?   @map("thumbnail_asset_id")
  mode             String    @default("link")
  sortIdx          Int       @default(0) @map("sort_idx")
  lastSyncedAt     DateTime? @map("last_synced_at")
  createdAt        DateTime  @default(now()) @map("created_at")

  trip      Trip             @relation(fields: [tripId], references: [id], onDelete: Cascade)
  photos    TripPhoto[]
  importJob ImmichImportJob?

  @@unique([tripId, immichAlbumId])
  @@index([tripId])
  @@map("trip_immich_albums")
}

model ImmichImportJob {
  id              String    @id @default(uuid())
  albumLinkId     String    @unique @map("album_link_id")
  status          String    @default("pending") // pending | running | completed | failed
  totalAssets     Int       @default(0) @map("total_assets")
  processedAssets Int       @default(0) @map("processed_assets")
  failedAssets    Int       @default(0) @map("failed_assets")
  error           String?
  startedAt       DateTime? @map("started_at")
  completedAt     DateTime? @map("completed_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  albumLink TripImmichAlbum @relation(fields: [albumLinkId], references: [id], onDelete: Cascade)

  @@map("immich_import_jobs")
}
```

- [ ] **Step 4: Hand-write the migration**

Create `backend/prisma/migrations/20260709120000_immich_albums/migration.sql`:

```sql
-- Immich album integration, Phase A (#154).
--
-- Hand-written (not `prisma migrate dev`-generated) on purpose: the existing
-- schema has pre-existing drift vs. the migration history (see CLAUDE.md),
-- which `prisma migrate dev` would bundle into any new migration and break
-- prod on deploy. Everything below is additive — nullable columns, new
-- tables, new indexes. No existing row is rewritten.

-- Settings: per-user Immich connection + copy/link preference.
ALTER TABLE "user_settings" ADD COLUMN "immich_base_url" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "immich_api_key" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "immich_default_mode" TEXT NOT NULL DEFAULT 'link';

-- Settings: admin-global Immich connection (tier 2 of the resolver).
ALTER TABLE "admin_settings" ADD COLUMN "global_immich_base_url" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "global_immich_api_key" TEXT;

-- CreateTable
CREATE TABLE "trip_immich_albums" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "immich_album_id" TEXT NOT NULL,
    "album_name" TEXT NOT NULL,
    "asset_count" INTEGER NOT NULL DEFAULT 0,
    "thumbnail_asset_id" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'link',
    "sort_idx" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_immich_albums_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trip_immich_albums_trip_id_immich_album_id_key"
    ON "trip_immich_albums"("trip_id", "immich_album_id");
CREATE INDEX "trip_immich_albums_trip_id_idx" ON "trip_immich_albums"("trip_id");

ALTER TABLE "trip_immich_albums"
    ADD CONSTRAINT "trip_immich_albums_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "immich_import_jobs" (
    "id" TEXT NOT NULL,
    "album_link_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_assets" INTEGER NOT NULL DEFAULT 0,
    "processed_assets" INTEGER NOT NULL DEFAULT 0,
    "failed_assets" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "immich_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "immich_import_jobs_album_link_id_key"
    ON "immich_import_jobs"("album_link_id");

ALTER TABLE "immich_import_jobs"
    ADD CONSTRAINT "immich_import_jobs_album_link_id_fkey"
    FOREIGN KEY ("album_link_id") REFERENCES "trip_immich_albums"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Trip photos: Immich provenance + EXIF coordinates.
-- The (trip_id, immich_asset_id) unique index is what makes re-sync idempotent.
-- Postgres treats NULLs as distinct, so unlimited manual uploads still fit.
ALTER TABLE "trip_photos" ADD COLUMN "immich_asset_id" TEXT;
ALTER TABLE "trip_photos" ADD COLUMN "immich_album_link_id" TEXT;
ALTER TABLE "trip_photos" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "trip_photos" ADD COLUMN "lon" DOUBLE PRECISION;

CREATE UNIQUE INDEX "trip_photos_trip_id_immich_asset_id_key"
    ON "trip_photos"("trip_id", "immich_asset_id");
CREATE INDEX "trip_photos_immich_album_link_id_idx"
    ON "trip_photos"("immich_album_link_id");

ALTER TABLE "trip_photos"
    ADD CONSTRAINT "trip_photos_immich_album_link_id_fkey"
    FOREIGN KEY ("immich_album_link_id") REFERENCES "trip_immich_albums"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Apply the migration and regenerate the client**

Run against the dev database (never prod):

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  npx prisma migrate deploy
npx prisma generate
```

Expected: `1 migration found ... Applied`, then `Generated Prisma Client`.

If `prisma generate` fails on Windows with `EPERM: ... query_engine-windows.dll.node`, a backend process holds the DLL. Rename it and retry (see `CLAUDE.local.md`):

```bash
cd backend/node_modules/.prisma/client
mv query_engine-windows.dll.node query_engine-windows.dll.node.locked
cd ../../.. && npx prisma generate
rm node_modules/.prisma/client/query_engine-windows.dll.node.locked
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/immichSchema.test.ts --forceExit`
Expected: PASS — 3 tests.

- [ ] **Step 7: Verify no drift was smuggled in**

Run: `cd backend && npx prisma migrate status`
Expected: `Database schema is up to date!` — and `git diff backend/prisma/schema.prisma` shows **only** the Immich additions above, nothing about `has_live_tracking` or `historical_enrichment_*`.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260709120000_immich_albums backend/src/__tests__/immichSchema.test.ts
git commit -m "feat(immich): add data model for linked albums, imported photos and import jobs"
```

---

## Task 2: Shared types, Zod schemas and base-URL normalisation

**Files:**
- Create: `backend/src/services/immich/types.ts`
- Create: `backend/src/schemas/immich.ts`
- Test: `backend/src/__tests__/immichSchemas.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ImmichMode = "link" | "import"`
  - `type ImmichAssetSize = "thumbnail" | "preview" | "original"`
  - `interface ImmichConnection { baseUrl: string; apiKey: string; source: "user" | "global" | "env" }`
  - `interface ImmichAlbum { id: string; albumName: string; assetCount: number; thumbnailAssetId: string | null }`
  - `interface ImmichAsset { id: string; type: "IMAGE" | "VIDEO"; fileCreatedAt: string; originalFileName: string; mimeType: string; sizeBytes: number | null; lat: number | null; lon: number | null }`
  - `class ImmichError extends Error { kind: ImmichErrorKind; status?: number }`
  - `type ImmichErrorKind = "unreachable" | "auth" | "notFound" | "protocol"`
  - `function normalizeImmichBaseUrl(raw: string): string` (throws `ImmichError("protocol")`)
  - Zod: `immichConnectionSchema`, `immichTestSchema`, `linkAlbumsSchema`, `unlinkQuerySchema`, `assetSizeSchema`, `assetIdParamSchema`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/immichSchemas.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { normalizeImmichBaseUrl } from "../services/immich/types";
import { ImmichError } from "../services/immich/types";
import { linkAlbumsSchema, immichConnectionSchema, assetSizeSchema } from "../schemas/immich";

describe("normalizeImmichBaseUrl", () => {
  it("strips trailing slashes and keeps scheme + host + port", () => {
    expect(normalizeImmichBaseUrl("https://immich.home.lan/")).toBe("https://immich.home.lan");
    expect(normalizeImmichBaseUrl("http://192.168.1.5:2283//")).toBe("http://192.168.1.5:2283");
  });

  it("preserves a sub-path prefix (reverse-proxy installs)", () => {
    expect(normalizeImmichBaseUrl("https://home.lan/immich/")).toBe("https://home.lan/immich");
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => normalizeImmichBaseUrl("file:///etc/passwd")).toThrow(ImmichError);
    expect(() => normalizeImmichBaseUrl("ftp://host")).toThrow(ImmichError);
  });

  it("rejects unparseable input", () => {
    expect(() => normalizeImmichBaseUrl("not a url")).toThrow(ImmichError);
    expect(() => normalizeImmichBaseUrl("")).toThrow(ImmichError);
  });

  it("strips embedded credentials, query and hash", () => {
    expect(normalizeImmichBaseUrl("https://u:p@immich.lan/?a=1#x")).toBe("https://immich.lan");
  });
});

describe("immichConnectionSchema", () => {
  it("accepts a partial update", () => {
    expect(immichConnectionSchema.parse({ defaultMode: "import" })).toEqual({ defaultMode: "import" });
  });

  it("rejects an unknown mode", () => {
    expect(() => immichConnectionSchema.parse({ defaultMode: "copy" })).toThrow();
  });

  it("accepts an explicit null apiKey (clearing the key)", () => {
    expect(immichConnectionSchema.parse({ apiKey: null })).toEqual({ apiKey: null });
  });
});

describe("linkAlbumsSchema", () => {
  it("accepts a non-empty list of album+mode pairs", () => {
    const parsed = linkAlbumsSchema.parse({
      albums: [{ immichAlbumId: "a", mode: "link" }, { immichAlbumId: "b", mode: "import" }],
    });
    expect(parsed.albums).toHaveLength(2);
  });

  it("rejects an empty list", () => {
    expect(() => linkAlbumsSchema.parse({ albums: [] })).toThrow();
  });

  it("rejects more than 50 albums in one request", () => {
    const albums = Array.from({ length: 51 }, (_, i) => ({ immichAlbumId: `a${i}`, mode: "link" as const }));
    expect(() => linkAlbumsSchema.parse({ albums })).toThrow();
  });
});

describe("assetSizeSchema", () => {
  it("defaults to thumbnail", () => {
    expect(assetSizeSchema.parse(undefined)).toBe("thumbnail");
  });

  it("rejects an arbitrary size", () => {
    expect(() => assetSizeSchema.parse("huge")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichSchemas.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../services/immich/types'`.

- [ ] **Step 3: Write `backend/src/services/immich/types.ts`**

```typescript
/**
 * Shared vocabulary for the Immich integration.
 *
 * Everything that crosses a module boundary lives here so the client, the
 * resolver, the import pipeline and the routes agree on one set of names.
 */

/** How a linked album stores its photos. */
export type ImmichMode = "link" | "import";

/**
 * Which rendition of an asset to fetch. Immich serves `thumbnail` (small webp
 * grid tile) and `preview` (large jpeg) from `/assets/:id/thumbnail?size=`,
 * and the untouched file from `/assets/:id/original`.
 */
export type ImmichAssetSize = "thumbnail" | "preview" | "original";

/** Which settings tier supplied the connection. */
export type ImmichConnectionSource = "user" | "global" | "env";

export interface ImmichConnection {
  /** Normalised, no trailing slash, no credentials. */
  baseUrl: string;
  /** Decrypted. Never leaves the backend. */
  apiKey: string;
  source: ImmichConnectionSource;
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
}

export interface ImmichAsset {
  id: string;
  type: "IMAGE" | "VIDEO";
  /** ISO-8601. */
  fileCreatedAt: string;
  originalFileName: string;
  mimeType: string;
  /** From `exifInfo.fileSizeInByte` — null when Immich has no EXIF row yet. */
  sizeBytes: number | null;
  lat: number | null;
  lon: number | null;
}

/**
 * Why an Immich call failed. The route layer maps these onto HTTP status codes
 * and the UI maps them onto distinct messages ("bad URL" vs "bad key" vs
 * "unexpected response"), which is the whole point of separating them.
 */
export type ImmichErrorKind = "unreachable" | "auth" | "notFound" | "protocol";

export class ImmichError extends Error {
  public readonly kind: ImmichErrorKind;
  public readonly status?: number;

  constructor(kind: ImmichErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ImmichError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Validate and canonicalise a user-supplied Immich base URL.
 *
 * This is a security boundary, not cosmetics: the asset proxy builds every
 * upstream URL from this value, so it must be a plain http(s) origin with no
 * credentials, query or fragment. A sub-path is allowed (reverse-proxy
 * installs mount Immich under e.g. `/immich`).
 */
export function normalizeImmichBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ImmichError("protocol", "Immich URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ImmichError("protocol", "Immich URL must use http:// or https://");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
}
```

- [ ] **Step 4: Write `backend/src/schemas/immich.ts`**

```typescript
/**
 * Zod schemas for every Immich system boundary: settings writes, connection
 * tests, album linking, and the proxy's path/query parameters.
 */
import { z } from "zod";

export const immichModeSchema = z.enum(["link", "import"]);

/** Partial update — an omitted field is untouched, an explicit null clears it. */
export const immichConnectionSchema = z
  .object({
    baseUrl: z.string().min(1).max(500).nullable().optional(),
    apiKey: z.string().min(1).max(500).nullable().optional(),
    defaultMode: immichModeSchema.optional(),
  })
  .strict();

/** Test an ad-hoc pair before saving, or fall back to the stored connection. */
export const immichTestSchema = z
  .object({
    baseUrl: z.string().min(1).max(500).optional(),
    apiKey: z.string().min(1).max(500).optional(),
  })
  .strict();

export const linkAlbumsSchema = z
  .object({
    albums: z
      .array(
        z
          .object({
            immichAlbumId: z.string().min(1).max(100),
            mode: immichModeSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export const unlinkQuerySchema = z
  .object({
    deleteCopies: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .strict();

export const assetSizeSchema = z
  .enum(["thumbnail", "preview", "original"])
  .default("thumbnail");

export const assetIdParamSchema = z.string().uuid();

export type ImmichConnectionInput = z.infer<typeof immichConnectionSchema>;
export type ImmichTestInput = z.infer<typeof immichTestSchema>;
export type LinkAlbumsInput = z.infer<typeof linkAlbumsSchema>;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/immichSchemas.test.ts --forceExit`
Expected: PASS — 12 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `cd backend && npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/immich/types.ts backend/src/schemas/immich.ts backend/src/__tests__/immichSchemas.test.ts
git commit -m "feat(immich): add shared types, Zod schemas and base-URL normalisation"
```

---

## Task 3: Immich REST client

The single file that knows Immich's endpoints. Pinned to **OpenAPI 3.0.1** (see "Verified API facts"). Tested entirely against a mocked axios — no live Immich in CI.

**Files:**
- Create: `backend/src/services/immich/immichClient.ts`
- Test: `backend/src/__tests__/immichClient.test.ts`

**Interfaces:**
- Consumes: `ImmichConnection`, `ImmichAlbum`, `ImmichAsset`, `ImmichAssetSize`, `ImmichError` from `services/immich/types`.
- Produces:
  - `function createImmichClient(conn: ImmichConnection): ImmichClient`
  - `interface ImmichClient { getServerVersion(): Promise<string>; whoami(): Promise<ImmichIdentity>; listAlbums(): Promise<ImmichAlbum[]>; listAlbumAssets(albumId: string): Promise<ImmichAsset[]>; fetchAssetStream(assetId: string, size: ImmichAssetSize): Promise<ImmichAssetStream> }`
  - `interface ImmichAssetStream { stream: NodeJS.ReadableStream; contentType: string; contentLength: number | null }`
  - `interface ImmichIdentity { id: string; email: string; name: string }`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/immichClient.test.ts`:

```typescript
/**
 * The Immich client is the only place that knows Immich's REST shape, so these
 * tests pin that shape: paths, the x-api-key header, search-based album asset
 * listing with pagination, and the error taxonomy the UI depends on.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

import { createImmichClient } from "../services/immich/immichClient";
import { ImmichError, ImmichConnection } from "../services/immich/types";

const CONN: ImmichConnection = {
  baseUrl: "https://immich.lan",
  apiKey: "secret-key",
  source: "user",
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("getServerVersion", () => {
  it("GETs /api/server/version and formats it", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { major: 1, minor: 138, patch: 2 } });
    const version = await createImmichClient(CONN).getServerVersion();
    expect(version).toBe("1.138.2");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/server/version",
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } }),
    );
  });

  it("maps a connection refusal to kind=unreachable", async () => {
    mockedAxios.get.mockRejectedValueOnce({ isAxiosError: true, code: "ECONNREFUSED" });
    await expect(createImmichClient(CONN).getServerVersion()).rejects.toMatchObject({
      name: "ImmichError",
      kind: "unreachable",
    });
  });

  it("maps a non-JSON body to kind=protocol", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: "<html>login</html>" });
    await expect(createImmichClient(CONN).getServerVersion()).rejects.toMatchObject({
      kind: "protocol",
    });
  });
});

describe("whoami", () => {
  it("maps 401 to kind=auth", async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: {} },
    });
    await expect(createImmichClient(CONN).whoami()).rejects.toMatchObject({
      kind: "auth",
      status: 401,
    });
  });

  it("returns the identity on success", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { id: "u1", email: "a@b.c", name: "Ann", avatarColor: "red" },
    });
    await expect(createImmichClient(CONN).whoami()).resolves.toEqual({
      id: "u1",
      email: "a@b.c",
      name: "Ann",
    });
  });
});

describe("listAlbums", () => {
  it("GETs /api/albums and maps albumThumbnailAssetId to thumbnailAssetId", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { id: "a1", albumName: "Rome", assetCount: 12, albumThumbnailAssetId: "t1" },
        { id: "a2", albumName: "Oslo", assetCount: 0, albumThumbnailAssetId: null },
      ],
    });
    const albums = await createImmichClient(CONN).listAlbums();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/albums",
      expect.anything(),
    );
    expect(albums).toEqual([
      { id: "a1", albumName: "Rome", assetCount: 12, thumbnailAssetId: "t1" },
      { id: "a2", albumName: "Oslo", assetCount: 0, thumbnailAssetId: null },
    ]);
  });

  it("rejects a non-array body as kind=protocol", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { albums: [] } });
    await expect(createImmichClient(CONN).listAlbums()).rejects.toMatchObject({ kind: "protocol" });
  });
});

describe("listAlbumAssets", () => {
  const asset = (id: string) => ({
    id,
    type: "IMAGE",
    fileCreatedAt: "2026-05-01T10:00:00.000Z",
    originalFileName: `${id}.jpg`,
    originalMimeType: "image/jpeg",
    exifInfo: { latitude: 41.9, longitude: 12.5, fileSizeInByte: 2048 },
  });

  it("POSTs /api/search/metadata with albumIds + withExif and follows pagination", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { assets: { items: [asset("p1")], nextPage: "2" } } })
      .mockResolvedValueOnce({ data: { assets: { items: [asset("p2")], nextPage: null } } });

    const assets = await createImmichClient(CONN).listAlbumAssets("album-1");

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      1,
      "https://immich.lan/api/search/metadata",
      { albumIds: ["album-1"], withExif: true, page: 1, size: 1000 },
      expect.objectContaining({ headers: { "x-api-key": "secret-key" } }),
    );
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      "https://immich.lan/api/search/metadata",
      { albumIds: ["album-1"], withExif: true, page: 2, size: 1000 },
      expect.anything(),
    );
    expect(assets.map((a) => a.id)).toEqual(["p1", "p2"]);
  });

  it("maps exifInfo onto flat sizeBytes/lat/lon and tolerates a missing exifInfo", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        assets: {
          items: [
            asset("p1"),
            { ...asset("p2"), exifInfo: undefined },
            { ...asset("p3"), exifInfo: { latitude: null, longitude: null, fileSizeInByte: null } },
          ],
          nextPage: null,
        },
      },
    });
    const [p1, p2, p3] = await createImmichClient(CONN).listAlbumAssets("album-1");
    expect(p1).toEqual({
      id: "p1",
      type: "IMAGE",
      fileCreatedAt: "2026-05-01T10:00:00.000Z",
      originalFileName: "p1.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      lat: 41.9,
      lon: 12.5,
    });
    expect(p2).toMatchObject({ sizeBytes: null, lat: null, lon: null });
    expect(p3).toMatchObject({ sizeBytes: null, lat: null, lon: null });
  });

  it("stops after MAX_PAGES to avoid an unbounded loop on a misbehaving server", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { assets: { items: [asset("x")], nextPage: "99" } },
    });
    const assets = await createImmichClient(CONN).listAlbumAssets("album-1");
    expect(mockedAxios.post).toHaveBeenCalledTimes(50);
    expect(assets).toHaveLength(50);
  });

  it("maps 404 to kind=notFound (deleted album)", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: {} },
    });
    await expect(createImmichClient(CONN).listAlbumAssets("gone")).rejects.toMatchObject({
      kind: "notFound",
    });
  });
});

describe("fetchAssetStream", () => {
  it("uses /thumbnail?size= for thumbnail and preview", async () => {
    mockedAxios.get.mockResolvedValue({
      data: "stream",
      headers: { "content-type": "image/webp", "content-length": "123" },
    });
    const res = await createImmichClient(CONN).fetchAssetStream("asset-1", "preview");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/assets/asset-1/thumbnail?size=preview",
      expect.objectContaining({ responseType: "stream" }),
    );
    expect(res).toEqual({ stream: "stream", contentType: "image/webp", contentLength: 123 });
  });

  it("uses /original for the original (size=original is deprecated in v3)", async () => {
    mockedAxios.get.mockResolvedValue({
      data: "stream",
      headers: { "content-type": "image/jpeg" },
    });
    const res = await createImmichClient(CONN).fetchAssetStream("asset-1", "original");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://immich.lan/api/assets/asset-1/original",
      expect.objectContaining({ responseType: "stream" }),
    );
    expect(res.contentLength).toBeNull();
  });

  it("maps a 502 upstream to an ImmichError", async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 502, data: {} },
    });
    await expect(
      createImmichClient(CONN).fetchAssetStream("asset-1", "thumbnail"),
    ).rejects.toBeInstanceOf(ImmichError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichClient.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../services/immich/immichClient'`.

- [ ] **Step 3: Write `backend/src/services/immich/immichClient.ts`**

```typescript
/**
 * Typed wrapper around the Immich REST API.
 *
 * Pinned to Immich OpenAPI **3.0.1**. This is the ONLY file that knows Immich's
 * paths and payload shapes — when Immich shifts its API again (it has before:
 * `/api/asset` -> `/api/assets`), this file is the entire blast radius.
 *
 * Two shapes worth remembering:
 *  - `AlbumResponseDto` carries NO asset array. Album contents come from
 *    `POST /search/metadata` with `albumIds`, which is paginated.
 *  - `size=original` on `/assets/:id/thumbnail` is deprecated in v3; the
 *    original has its own endpoint.
 */
import axios, { AxiosRequestConfig } from "axios";
import {
  ImmichAlbum,
  ImmichAsset,
  ImmichAssetSize,
  ImmichConnection,
  ImmichError,
} from "./types";

/** Immich caps `size` at 1000. */
const PAGE_SIZE = 1000;
/** Hard stop so a misbehaving server can never spin us forever. */
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 15_000;
/** Streaming a full-size original over a slow LAN needs more headroom. */
const STREAM_TIMEOUT_MS = 60_000;

export interface ImmichAssetStream {
  stream: NodeJS.ReadableStream;
  contentType: string;
  contentLength: number | null;
}

export interface ImmichIdentity {
  id: string;
  email: string;
  name: string;
}

export interface ImmichClient {
  getServerVersion(): Promise<string>;
  whoami(): Promise<ImmichIdentity>;
  listAlbums(): Promise<ImmichAlbum[]>;
  listAlbumAssets(albumId: string): Promise<ImmichAsset[]>;
  fetchAssetStream(assetId: string, size: ImmichAssetSize): Promise<ImmichAssetStream>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Normalise anything thrown by axios into the four kinds the UI distinguishes.
 * An unknown non-axios throw is a protocol error — we never leak a raw stack.
 */
function toImmichError(error: unknown, context: string): ImmichError {
  if (error instanceof ImmichError) return error;

  if (isRecord(error) && error.isAxiosError === true) {
    const response = isRecord(error.response) ? error.response : undefined;
    const status = typeof response?.status === "number" ? response.status : undefined;

    if (status === 401 || status === 403) {
      return new ImmichError("auth", "Immich rejected the API key", status);
    }
    if (status === 404) {
      return new ImmichError("notFound", `Immich resource not found (${context})`, 404);
    }
    if (status === undefined || status >= 500) {
      return new ImmichError("unreachable", `Immich is unreachable (${context})`, status);
    }
    return new ImmichError("protocol", `Immich returned ${status} for ${context}`, status);
  }

  return new ImmichError("protocol", `Unexpected Immich failure (${context})`);
}

function mapAsset(raw: unknown): ImmichAsset | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const exif = isRecord(raw.exifInfo) ? raw.exifInfo : undefined;
  const type = raw.type === "VIDEO" ? "VIDEO" : "IMAGE";

  return {
    id: raw.id,
    type,
    fileCreatedAt: asString(raw.fileCreatedAt, new Date(0).toISOString()),
    originalFileName: asString(raw.originalFileName, `${raw.id}.bin`),
    mimeType: asString(raw.originalMimeType, "application/octet-stream"),
    sizeBytes: asNumberOrNull(exif?.fileSizeInByte),
    lat: asNumberOrNull(exif?.latitude),
    lon: asNumberOrNull(exif?.longitude),
  };
}

export function createImmichClient(conn: ImmichConnection): ImmichClient {
  const headers = { "x-api-key": conn.apiKey };
  const jsonConfig: AxiosRequestConfig = { headers, timeout: REQUEST_TIMEOUT_MS };
  const url = (suffix: string): string => `${conn.baseUrl}/api${suffix}`;

  return {
    async getServerVersion(): Promise<string> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url("/server/version"), jsonConfig));
      } catch (error) {
        throw toImmichError(error, "server/version");
      }
      if (!isRecord(data) || typeof data.major !== "number") {
        throw new ImmichError("protocol", "Immich returned an unexpected version payload");
      }
      return `${data.major}.${data.minor}.${data.patch}`;
    },

    async whoami(): Promise<ImmichIdentity> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url("/users/me"), jsonConfig));
      } catch (error) {
        throw toImmichError(error, "users/me");
      }
      if (!isRecord(data) || typeof data.id !== "string") {
        throw new ImmichError("protocol", "Immich returned an unexpected identity payload");
      }
      return {
        id: data.id,
        email: asString(data.email, ""),
        name: asString(data.name, ""),
      };
    },

    async listAlbums(): Promise<ImmichAlbum[]> {
      let data: unknown;
      try {
        ({ data } = await axios.get(url("/albums"), jsonConfig));
      } catch (error) {
        throw toImmichError(error, "albums");
      }
      if (!Array.isArray(data)) {
        throw new ImmichError("protocol", "Immich returned an unexpected album payload");
      }
      return data.filter(isRecord).map((raw) => ({
        id: asString(raw.id, ""),
        albumName: asString(raw.albumName, ""),
        assetCount: asNumberOrNull(raw.assetCount) ?? 0,
        thumbnailAssetId:
          typeof raw.albumThumbnailAssetId === "string" ? raw.albumThumbnailAssetId : null,
      }));
    },

    async listAlbumAssets(albumId: string): Promise<ImmichAsset[]> {
      const collected: ImmichAsset[] = [];

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        let data: unknown;
        try {
          ({ data } = await axios.post(
            url("/search/metadata"),
            { albumIds: [albumId], withExif: true, page, size: PAGE_SIZE },
            jsonConfig,
          ));
        } catch (error) {
          throw toImmichError(error, `search/metadata album=${albumId}`);
        }

        const assets = isRecord(data) && isRecord(data.assets) ? data.assets : undefined;
        if (!assets || !Array.isArray(assets.items)) {
          throw new ImmichError("protocol", "Immich returned an unexpected search payload");
        }

        for (const raw of assets.items) {
          const mapped = mapAsset(raw);
          if (mapped) collected.push(mapped);
        }

        if (typeof assets.nextPage !== "string") break;
      }

      return collected;
    },

    async fetchAssetStream(assetId: string, size: ImmichAssetSize): Promise<ImmichAssetStream> {
      const suffix =
        size === "original"
          ? `/assets/${assetId}/original`
          : `/assets/${assetId}/thumbnail?size=${size}`;

      try {
        const response = await axios.get(url(suffix), {
          headers,
          timeout: STREAM_TIMEOUT_MS,
          responseType: "stream",
        });
        const rawLength = response.headers["content-length"];
        const contentLength = typeof rawLength === "string" ? Number(rawLength) : NaN;

        return {
          stream: response.data as NodeJS.ReadableStream,
          contentType: asString(response.headers["content-type"], "application/octet-stream"),
          contentLength: Number.isFinite(contentLength) ? contentLength : null,
        };
      } catch (error) {
        throw toImmichError(error, `assets/${assetId} size=${size}`);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/immichClient.test.ts --forceExit`
Expected: PASS — 12 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && cd ..
git add backend/src/services/immich/immichClient.ts backend/src/__tests__/immichClient.test.ts
git commit -m "feat(immich): add typed REST client pinned to Immich OpenAPI 3.0.1"
```

---

## Task 4: Connection resolver

Mirrors `backend/src/services/apiKeyResolver.ts`: **User → Admin-Global → ENV**, decrypting the key with `decryptApiKey`. A tier only counts when it supplies **both** a base URL and a key — a half-configured user tier must fall through, not fail.

**Files:**
- Create: `backend/src/services/immich/immichResolver.ts`
- Test: `backend/src/__tests__/immichResolver.test.ts`

**Interfaces:**
- Consumes: `ImmichConnection`, `ImmichConnectionSource`, `ImmichMode`, `normalizeImmichBaseUrl` from `services/immich/types`; `decryptApiKey` from `utils/encryption`; `prisma` from `db`.
- Produces:
  - `async function getImmichConnection(userId?: string): Promise<ImmichConnection | null>`
  - `async function getImmichDefaultMode(userId: string): Promise<ImmichMode>`
  - `async function hasImmichAccess(userId: string): Promise<{ hasAccess: boolean; isShared: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/immichResolver.test.ts`:

```typescript
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const findUniqueUserSettings = jest.fn();
const findFirstAdminSettings = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: findUniqueUserSettings },
    adminSettings: { findFirst: findFirstAdminSettings },
  },
}));

jest.mock("../utils/encryption", () => ({
  // The resolver must call decryptApiKey — the fake strips a marker prefix.
  decryptApiKey: jest.fn((v: string | null | undefined) =>
    typeof v === "string" ? v.replace(/^enc:/, "") : null,
  ),
}));

import { getImmichConnection, getImmichDefaultMode } from "../services/immich/immichResolver";

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.IMMICH_BASE_URL;
  delete process.env.IMMICH_API_KEY;
  findUniqueUserSettings.mockResolvedValue(null);
  findFirstAdminSettings.mockResolvedValue(null);
});

describe("getImmichConnection priority", () => {
  it("prefers the user tier and decrypts the key", async () => {
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "https://user.lan/",
      immichApiKey: "enc:user-key",
    });
    findFirstAdminSettings.mockResolvedValue({
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });

    await expect(getImmichConnection("u1")).resolves.toEqual({
      baseUrl: "https://user.lan",
      apiKey: "user-key",
      source: "user",
    });
  });

  it("falls through to global when the user tier has a URL but no key", async () => {
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "https://user.lan",
      immichApiKey: null,
    });
    findFirstAdminSettings.mockResolvedValue({
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });

    await expect(getImmichConnection("u1")).resolves.toMatchObject({
      baseUrl: "https://global.lan",
      source: "global",
    });
  });

  it("falls through to ENV when neither DB tier is complete", async () => {
    process.env.IMMICH_BASE_URL = "https://env.lan/";
    process.env.IMMICH_API_KEY = "env-key";

    await expect(getImmichConnection("u1")).resolves.toEqual({
      baseUrl: "https://env.lan",
      apiKey: "env-key",
      source: "env",
    });
  });

  it("returns null when nothing is configured", async () => {
    await expect(getImmichConnection("u1")).resolves.toBeNull();
  });

  it("skips a tier whose key fails to decrypt", async () => {
    const { decryptApiKey } = jest.requireMock("../utils/encryption") as {
      decryptApiKey: jest.Mock;
    };
    decryptApiKey.mockReturnValueOnce(null); // user key is corrupt
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "https://user.lan",
      immichApiKey: "enc:broken",
    });
    process.env.IMMICH_BASE_URL = "https://env.lan";
    process.env.IMMICH_API_KEY = "env-key";

    await expect(getImmichConnection("u1")).resolves.toMatchObject({ source: "env" });
  });

  it("skips a tier whose base URL is unusable rather than throwing", async () => {
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "file:///etc/passwd",
      immichApiKey: "enc:user-key",
    });
    process.env.IMMICH_BASE_URL = "https://env.lan";
    process.env.IMMICH_API_KEY = "env-key";

    await expect(getImmichConnection("u1")).resolves.toMatchObject({ source: "env" });
  });

  it("ignores the user tier entirely when no userId is given", async () => {
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "https://user.lan",
      immichApiKey: "enc:user-key",
    });
    findFirstAdminSettings.mockResolvedValue({
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });

    await expect(getImmichConnection()).resolves.toMatchObject({ source: "global" });
    expect(findUniqueUserSettings).not.toHaveBeenCalled();
  });
});

describe("getImmichDefaultMode", () => {
  it("returns the stored mode", async () => {
    findUniqueUserSettings.mockResolvedValue({ immichDefaultMode: "import" });
    await expect(getImmichDefaultMode("u1")).resolves.toBe("import");
  });

  it("defaults to link when unset or invalid", async () => {
    findUniqueUserSettings.mockResolvedValue({ immichDefaultMode: "nonsense" });
    await expect(getImmichDefaultMode("u1")).resolves.toBe("link");

    findUniqueUserSettings.mockResolvedValue(null);
    await expect(getImmichDefaultMode("u1")).resolves.toBe("link");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichResolver.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../services/immich/immichResolver'`.

- [ ] **Step 3: Write `backend/src/services/immich/immichResolver.ts`**

```typescript
/**
 * Resolve the Immich connection for a request, mirroring `apiKeyResolver.ts`:
 * **User -> Admin-Global -> ENV**.
 *
 * A tier only counts when it yields BOTH a usable base URL and a decryptable
 * key. A half-configured tier falls through to the next one instead of failing
 * the request — otherwise a stray user URL would shadow a working global setup.
 */
import { prisma } from "../../db";
import { decryptApiKey } from "../../utils/encryption";
import logger from "../../utils/logger";
import {
  ImmichConnection,
  ImmichConnectionSource,
  ImmichMode,
  normalizeImmichBaseUrl,
} from "./types";

/** Build a connection from one tier, or null if the tier is incomplete/invalid. */
function buildConnection(
  rawUrl: string | null | undefined,
  rawKey: string | null | undefined,
  source: ImmichConnectionSource,
  decrypt: boolean,
): ImmichConnection | null {
  if (!rawUrl || !rawKey) return null;

  const apiKey = decrypt ? decryptApiKey(rawKey) : rawKey;
  if (!apiKey) {
    logger.warn({
      message: "immich_connection_key_undecryptable",
      context: { source },
    });
    return null;
  }

  try {
    return { baseUrl: normalizeImmichBaseUrl(rawUrl), apiKey, source };
  } catch {
    logger.warn({
      message: "immich_connection_invalid_base_url",
      context: { source },
    });
    return null;
  }
}

export async function getImmichConnection(userId?: string): Promise<ImmichConnection | null> {
  try {
    if (userId) {
      const settings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { immichBaseUrl: true, immichApiKey: true },
      });
      const user = buildConnection(settings?.immichBaseUrl, settings?.immichApiKey, "user", true);
      if (user) return user;
    }

    const admin = await prisma.adminSettings.findFirst();
    const global = buildConnection(
      admin?.globalImmichBaseUrl,
      admin?.globalImmichApiKey,
      "global",
      true,
    );
    if (global) return global;

    return buildConnection(process.env.IMMICH_BASE_URL, process.env.IMMICH_API_KEY, "env", false);
  } catch (error) {
    logger.error({
      message: "immich_connection_resolution_error",
      error,
      context: { userId },
    });
    return null;
  }
}

export async function getImmichDefaultMode(userId: string): Promise<ImmichMode> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { immichDefaultMode: true },
  });
  return settings?.immichDefaultMode === "import" ? "import" : "link";
}

/**
 * Whether the user can reach Immich at all, and whether they are riding on the
 * admin's global connection rather than their own — the settings card shows a
 * "shared" badge for that, exactly like the API-key cards do.
 */
export async function hasImmichAccess(
  userId: string,
): Promise<{ hasAccess: boolean; isShared: boolean }> {
  const conn = await getImmichConnection(userId);
  return { hasAccess: conn !== null, isShared: conn !== null && conn.source !== "user" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/immichResolver.test.ts --forceExit`
Expected: PASS — 9 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && cd ..
git add backend/src/services/immich/immichResolver.ts backend/src/__tests__/immichResolver.test.ts
git commit -m "feat(immich): resolve connection User -> Admin-Global -> ENV"
```

---

## Task 5: Album asset-list TTL cache

Opening a trip re-renders the gallery repeatedly. Without a cache each render re-lists every linked album from Immich. Cache the **metadata list only** — never the images (spec §5).

**Files:**
- Create: `backend/src/services/immich/immichAssetCache.ts`
- Test: `backend/src/__tests__/immichAssetCache.test.ts`

**Interfaces:**
- Consumes: `ImmichAsset` from `services/immich/types`.
- Produces:
  - `async function getCachedAlbumAssets(userId: string, albumId: string, load: () => Promise<ImmichAsset[]>): Promise<ImmichAsset[]>`
  - `function invalidateAlbumAssets(userId: string, albumId: string): void`
  - `function clearImmichAssetCache(): void` (test seam)
  - `const ASSET_CACHE_TTL_MS: number`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/immichAssetCache.test.ts`:

```typescript
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  getCachedAlbumAssets,
  invalidateAlbumAssets,
  clearImmichAssetCache,
  ASSET_CACHE_TTL_MS,
} from "../services/immich/immichAssetCache";
import { ImmichAsset } from "../services/immich/types";

const asset = (id: string): ImmichAsset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2026-05-01T00:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  lat: null,
  lon: null,
});

beforeEach(() => {
  jest.useFakeTimers();
  clearImmichAssetCache();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("getCachedAlbumAssets", () => {
  it("loads once and serves the cached list within the TTL", async () => {
    const load = jest.fn(async () => [asset("p1")]);

    await expect(getCachedAlbumAssets("u1", "a1", load)).resolves.toEqual([asset("p1")]);
    await expect(getCachedAlbumAssets("u1", "a1", load)).resolves.toEqual([asset("p1")]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL expires", async () => {
    const load = jest.fn(async () => [asset("p1")]);
    await getCachedAlbumAssets("u1", "a1", load);

    jest.advanceTimersByTime(ASSET_CACHE_TTL_MS + 1);
    await getCachedAlbumAssets("u1", "a1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("scopes entries per user and per album", async () => {
    const load = jest.fn(async () => [asset("p1")]);
    await getCachedAlbumAssets("u1", "a1", load);
    await getCachedAlbumAssets("u2", "a1", load);
    await getCachedAlbumAssets("u1", "a2", load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failed load", async () => {
    const load = jest
      .fn<() => Promise<ImmichAsset[]>>()
      .mockRejectedValueOnce(new Error("immich down"))
      .mockResolvedValueOnce([asset("p1")]);

    await expect(getCachedAlbumAssets("u1", "a1", load)).rejects.toThrow("immich down");
    await expect(getCachedAlbumAssets("u1", "a1", load)).resolves.toEqual([asset("p1")]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent loads of the same key into one upstream call", async () => {
    let resolveLoad: (value: ImmichAsset[]) => void = () => {};
    const load = jest.fn(
      () =>
        new Promise<ImmichAsset[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const a = getCachedAlbumAssets("u1", "a1", load);
    const b = getCachedAlbumAssets("u1", "a1", load);
    resolveLoad([asset("p1")]);

    expect(await a).toEqual([asset("p1")]);
    expect(await b).toEqual([asset("p1")]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateAlbumAssets", () => {
  it("forces the next call to reload", async () => {
    const load = jest.fn(async () => [asset("p1")]);
    await getCachedAlbumAssets("u1", "a1", load);
    invalidateAlbumAssets("u1", "a1");
    await getCachedAlbumAssets("u1", "a1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichAssetCache.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../services/immich/immichAssetCache'`.

- [ ] **Step 3: Write `backend/src/services/immich/immichAssetCache.ts`**

```typescript
/**
 * In-memory TTL cache of album -> asset-list metadata.
 *
 * Images are deliberately NOT cached (spec §5): the proxy streams them through
 * with browser cache headers, so server-side image storage stays at zero for
 * link-mode albums. Only this listing is cached, so re-rendering a trip does
 * not re-hit Immich for every tile.
 *
 * In-flight loads are shared, so N concurrent gallery sections asking for the
 * same album produce exactly one upstream request.
 */
import { ImmichAsset } from "./types";

export const ASSET_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  assets: ImmichAsset[];
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ImmichAsset[]>>();

const keyOf = (userId: string, albumId: string): string => `${userId}::${albumId}`;

export async function getCachedAlbumAssets(
  userId: string,
  albumId: string,
  load: () => Promise<ImmichAsset[]>,
): Promise<ImmichAsset[]> {
  const key = keyOf(userId, albumId);

  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.assets;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  // A failed load must not be cached — `finally` clears the in-flight slot so
  // the next caller retries upstream instead of adopting a rejected promise.
  const promise = load()
    .then((assets) => {
      entries.set(key, { assets, expiresAt: Date.now() + ASSET_CACHE_TTL_MS });
      return assets;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

export function invalidateAlbumAssets(userId: string, albumId: string): void {
  entries.delete(keyOf(userId, albumId));
}

/** Test seam. Never called from production code. */
export function clearImmichAssetCache(): void {
  entries.clear();
  inFlight.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/immichAssetCache.test.ts --forceExit`
Expected: PASS — 6 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && cd ..
git add backend/src/services/immich/immichAssetCache.ts backend/src/__tests__/immichAssetCache.test.ts
git commit -m "feat(immich): add 60s TTL cache for album asset listings"
```

---

## Task 6: Connection tester + settings routes (user & admin)

The API key **never leaves the backend** (spec §8): `GET` returns `hasKey`, never the value. The admin route masks like `admin/apiKeys.ts` does. `POST .../test` validates an ad-hoc pair *before* it is saved, falling back to the stored connection when the body is empty.

**Files:**
- Create: `backend/src/services/immich/immichTester.ts`
- Create: `backend/src/routes/settings/immich.ts`
- Create: `backend/src/routes/admin/immich.ts`
- Modify: `backend/src/routes/settings/index.ts`
- Modify: `backend/src/routes/admin/index.ts`
- Test: `backend/src/__tests__/immichTester.test.ts`
- Test: `backend/src/__tests__/immichSettingsRoutes.test.ts`

**Interfaces:**
- Consumes: `createImmichClient` (Task 3); `getImmichConnection`, `hasImmichAccess` (Task 4); `immichConnectionSchema`, `immichTestSchema` (Task 2); `normalizeImmichBaseUrl`, `ImmichError` (Task 2); `encryptApiKey`, `decryptApiKey` from `utils/encryption`.
- Produces:
  - `interface ImmichTestResult { success: boolean; message: string; details?: { version?: string; user?: string } }`
  - `async function testImmichConnection(baseUrl: string, apiKey: string): Promise<ImmichTestResult>`
  - Router default-exported from `routes/settings/immich.ts`, mounted at `/immich`
  - Router default-exported from `routes/admin/immich.ts`, mounted at `/immich`
  - `GET /api/v1/settings/immich` → `{ baseUrl: string | null, hasKey: boolean, defaultMode: ImmichMode, source: ImmichConnectionSource | null, isShared: boolean, hasAccess: boolean }`
  - `PUT /api/v1/settings/immich` → same shape as GET
  - `POST /api/v1/settings/immich/test` → `ImmichTestResult`
  - `GET /api/v1/admin/immich` → `{ baseUrl: string | null, apiKey: string | null /* masked */ }`
  - `PUT /api/v1/admin/immich` → same
  - `POST /api/v1/admin/immich/test` → `ImmichTestResult`

- [ ] **Step 1: Write the failing tester test**

Create `backend/src/__tests__/immichTester.test.ts`:

```typescript
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const getServerVersion = jest.fn<() => Promise<string>>();
const whoami = jest.fn<() => Promise<{ id: string; email: string; name: string }>>();

jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ getServerVersion, whoami }),
}));

import { testImmichConnection } from "../services/immich/immichTester";
import { ImmichError } from "../services/immich/types";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("testImmichConnection", () => {
  it("reports the server version and the authenticated user on success", async () => {
    getServerVersion.mockResolvedValue("1.138.2");
    whoami.mockResolvedValue({ id: "u1", email: "a@b.c", name: "Ann" });

    await expect(testImmichConnection("https://immich.lan", "key")).resolves.toEqual({
      success: true,
      message: "Connected to Immich",
      details: { version: "1.138.2", user: "Ann" },
    });
  });

  it("distinguishes a bad key from an unreachable server", async () => {
    getServerVersion.mockResolvedValue("1.138.2");
    whoami.mockRejectedValue(new ImmichError("auth", "Immich rejected the API key", 401));
    await expect(testImmichConnection("https://immich.lan", "bad")).resolves.toMatchObject({
      success: false,
      message: "Immich rejected the API key",
    });

    getServerVersion.mockRejectedValue(new ImmichError("unreachable", "Immich is unreachable"));
    await expect(testImmichConnection("https://immich.lan", "key")).resolves.toMatchObject({
      success: false,
      message: "Immich is unreachable",
    });
  });

  it("reports an invalid base URL without calling Immich", async () => {
    await expect(testImmichConnection("file:///etc/passwd", "key")).resolves.toMatchObject({
      success: false,
      message: "Immich URL must use http:// or https://",
    });
    expect(getServerVersion).not.toHaveBeenCalled();
  });

  it("reports a protocol mismatch when the server answers with garbage", async () => {
    getServerVersion.mockRejectedValue(
      new ImmichError("protocol", "Immich returned an unexpected version payload"),
    );
    await expect(testImmichConnection("https://immich.lan", "key")).resolves.toEqual({
      success: false,
      message: "Immich returned an unexpected version payload",
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichTester.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../services/immich/immichTester'`.

- [ ] **Step 3: Write `backend/src/services/immich/immichTester.ts`**

```typescript
/**
 * Validate an Immich connection and turn any failure into a message a
 * self-hoster can act on: bad URL vs bad key vs unreachable vs wrong software
 * answering on that port. Mirrors the `ApiKeyTestResult` shape of
 * `services/apiKeyTester.ts`.
 *
 * Version first (unauthenticated), identity second — so a wrong URL never
 * reads as a wrong key.
 */
import { createImmichClient } from "./immichClient";
import { ImmichError, normalizeImmichBaseUrl } from "./types";

export interface ImmichTestResult {
  success: boolean;
  message: string;
  details?: { version?: string; user?: string };
}

export async function testImmichConnection(
  baseUrl: string,
  apiKey: string,
): Promise<ImmichTestResult> {
  let normalized: string;
  try {
    normalized = normalizeImmichBaseUrl(baseUrl);
  } catch (error) {
    return {
      success: false,
      message: error instanceof ImmichError ? error.message : "Invalid Immich URL",
    };
  }

  const client = createImmichClient({ baseUrl: normalized, apiKey, source: "user" });

  try {
    const version = await client.getServerVersion();
    const identity = await client.whoami();
    return {
      success: true,
      message: "Connected to Immich",
      details: { version, user: identity.name },
    };
  } catch (error) {
    if (error instanceof ImmichError) {
      return { success: false, message: error.message };
    }
    return { success: false, message: "Could not reach Immich" };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx jest src/__tests__/immichTester.test.ts --forceExit`
Expected: PASS — 4 tests.

- [ ] **Step 5: Write the failing settings-route test**

Create `backend/src/__tests__/immichSettingsRoutes.test.ts`:

```typescript
/**
 * Route-level contract for the Immich settings endpoints. The routers assume
 * `authenticate` already ran (their parents mount it), so the harness injects
 * `req.userId` and mounts the sub-router directly.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const userSettingsFindUnique = jest.fn();
const userSettingsUpsert = jest.fn();
const adminSettingsFindFirst = jest.fn();
const adminSettingsUpdate = jest.fn();
const adminSettingsCreate = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: userSettingsFindUnique, upsert: userSettingsUpsert },
    adminSettings: {
      findFirst: adminSettingsFindFirst,
      update: adminSettingsUpdate,
      create: adminSettingsCreate,
    },
  },
}));

jest.mock("../utils/encryption", () => ({
  encryptApiKey: jest.fn((v: string | null) => (v === null ? null : `enc:${v}`)),
  decryptApiKey: jest.fn((v: string | null) => (typeof v === "string" ? v.replace(/^enc:/, "") : null)),
}));

const testImmichConnection = jest.fn();
jest.mock("../services/immich/immichTester", () => ({ testImmichConnection }));

const getImmichConnection = jest.fn();
const hasImmichAccess = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection, hasImmichAccess }));

import immichSettingsRouter from "../routes/settings/immich";
import immichAdminRouter from "../routes/admin/immich";
import { errorHandler } from "../middleware/errorHandler";

function makeApp(router: express.Router): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = "u1";
    next();
  });
  app.use("/immich", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  hasImmichAccess.mockResolvedValue({ hasAccess: true, isShared: false });
  getImmichConnection.mockResolvedValue({
    baseUrl: "https://immich.lan",
    apiKey: "k",
    source: "user",
  });
});

describe("GET /settings/immich", () => {
  it("returns hasKey but never the key itself", async () => {
    userSettingsFindUnique.mockResolvedValue({
      immichBaseUrl: "https://immich.lan",
      immichApiKey: "enc:super-secret",
      immichDefaultMode: "import",
    });

    const res = await request(makeApp(immichSettingsRouter)).get("/immich");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      baseUrl: "https://immich.lan",
      hasKey: true,
      defaultMode: "import",
      source: "user",
      isShared: false,
      hasAccess: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("super-secret");
  });

  it("reports an unconfigured user with defaults", async () => {
    userSettingsFindUnique.mockResolvedValue(null);
    getImmichConnection.mockResolvedValue(null);
    hasImmichAccess.mockResolvedValue({ hasAccess: false, isShared: false });

    const res = await request(makeApp(immichSettingsRouter)).get("/immich");
    expect(res.body).toEqual({
      baseUrl: null,
      hasKey: false,
      defaultMode: "link",
      source: null,
      isShared: false,
      hasAccess: false,
    });
  });
});

describe("PUT /settings/immich", () => {
  it("normalises the URL, encrypts the key and upserts", async () => {
    userSettingsFindUnique.mockResolvedValue({
      immichBaseUrl: "https://immich.lan",
      immichApiKey: "enc:k",
      immichDefaultMode: "link",
    });

    const res = await request(makeApp(immichSettingsRouter))
      .put("/immich")
      .send({ baseUrl: "https://immich.lan/", apiKey: "k", defaultMode: "import" });

    expect(res.status).toBe(200);
    expect(userSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        update: {
          immichBaseUrl: "https://immich.lan",
          immichApiKey: "enc:k",
          immichDefaultMode: "import",
        },
      }),
    );
  });

  it("clears the key when apiKey is explicitly null", async () => {
    userSettingsFindUnique.mockResolvedValue(null);
    await request(makeApp(immichSettingsRouter)).put("/immich").send({ apiKey: null });

    expect(userSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { immichApiKey: null } }),
    );
  });

  it("rejects a non-http base URL with 400", async () => {
    const res = await request(makeApp(immichSettingsRouter))
      .put("/immich")
      .send({ baseUrl: "file:///etc/passwd" });

    expect(res.status).toBe(400);
    expect(userSettingsUpsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown field with 400 (strict schema)", async () => {
    const res = await request(makeApp(immichSettingsRouter))
      .put("/immich")
      .send({ immichApiKey: "sneaky" });
    expect(res.status).toBe(400);
  });
});

describe("POST /settings/immich/test", () => {
  it("tests the ad-hoc pair from the body", async () => {
    testImmichConnection.mockResolvedValue({ success: true, message: "Connected to Immich" });

    const res = await request(makeApp(immichSettingsRouter))
      .post("/immich/test")
      .send({ baseUrl: "https://new.lan", apiKey: "new-key" });

    expect(res.status).toBe(200);
    expect(testImmichConnection).toHaveBeenCalledWith("https://new.lan", "new-key");
  });

  it("falls back to the stored connection when the body is empty", async () => {
    testImmichConnection.mockResolvedValue({ success: true, message: "Connected to Immich" });

    await request(makeApp(immichSettingsRouter)).post("/immich/test").send({});
    expect(testImmichConnection).toHaveBeenCalledWith("https://immich.lan", "k");
  });

  it("returns 400 when nothing is configured and nothing was sent", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(makeApp(immichSettingsRouter)).post("/immich/test").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/immich", () => {
  it("masks the stored global key", async () => {
    adminSettingsFindFirst.mockResolvedValue({
      id: 1,
      globalImmichBaseUrl: "https://immich.lan",
      globalImmichApiKey: "enc:abcdefghijkl",
    });

    const res = await request(makeApp(immichAdminRouter)).get("/immich");
    expect(res.body).toEqual({ baseUrl: "https://immich.lan", apiKey: "abcd****ijkl" });
  });
});

describe("PUT /admin/immich", () => {
  it("ignores a masked key round-trip instead of storing the mask", async () => {
    adminSettingsFindFirst.mockResolvedValue({ id: 1, globalImmichApiKey: "enc:abcdefghijkl" });

    await request(makeApp(immichAdminRouter))
      .put("/immich")
      .send({ baseUrl: "https://immich.lan", apiKey: "abcd****ijkl" });

    expect(adminSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { globalImmichBaseUrl: "https://immich.lan" },
      }),
    );
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichSettingsRoutes.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../routes/settings/immich'`.

- [ ] **Step 7: Write `backend/src/routes/settings/immich.ts`**

```typescript
/**
 * Per-user Immich connection. Mounted under `/api/v1/settings/immich`, whose
 * parent router already applies `authenticate` + `requireWriteScope`.
 *
 * The API key is write-only from the client's perspective: it goes in
 * encrypted and never comes back out.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { encryptApiKey } from "../../utils/encryption";
import { immichConnectionSchema, immichTestSchema } from "../../schemas/immich";
import { getImmichConnection, hasImmichAccess } from "../../services/immich/immichResolver";
import { testImmichConnection } from "../../services/immich/immichTester";
import { ImmichError, normalizeImmichBaseUrl } from "../../services/immich/types";
import logger from "../../utils/logger";

const router = Router();

async function readStatus(userId: string): Promise<Record<string, unknown>> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { immichBaseUrl: true, immichApiKey: true, immichDefaultMode: true },
  });
  const conn = await getImmichConnection(userId);
  const access = await hasImmichAccess(userId);

  return {
    baseUrl: settings?.immichBaseUrl ?? null,
    hasKey: Boolean(settings?.immichApiKey),
    defaultMode: settings?.immichDefaultMode === "import" ? "import" : "link",
    source: conn?.source ?? null,
    isShared: access.isShared,
    hasAccess: access.hasAccess,
  };
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await readStatus(req.userId!));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const payload = immichConnectionSchema.parse(req.body);

    const update: Record<string, string | null> = {};

    if (payload.baseUrl !== undefined) {
      if (payload.baseUrl === null) {
        update.immichBaseUrl = null;
      } else {
        try {
          update.immichBaseUrl = normalizeImmichBaseUrl(payload.baseUrl);
        } catch (error) {
          throw new AppError(
            error instanceof ImmichError ? error.message : "Invalid Immich URL",
            400,
          );
        }
      }
    }
    if (payload.apiKey !== undefined) {
      update.immichApiKey = payload.apiKey === null ? null : encryptApiKey(payload.apiKey);
    }
    if (payload.defaultMode !== undefined) {
      update.immichDefaultMode = payload.defaultMode;
    }

    await prisma.userSettings.upsert({
      where: { userId },
      update,
      create: { userId, data: {}, ...update },
    });

    logger.info({
      message: "immich_user_connection_updated",
      context: { userId, fields: Object.keys(update) },
    });

    res.json(await readStatus(userId));
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = immichTestSchema.parse(req.body);

    let baseUrl = body.baseUrl;
    let apiKey = body.apiKey;

    // An empty body means "test whatever is currently resolved for me".
    if (!baseUrl || !apiKey) {
      const stored = await getImmichConnection(req.userId!);
      if (!stored) throw new AppError("No Immich connection configured", 400);
      baseUrl = baseUrl ?? stored.baseUrl;
      apiKey = apiKey ?? stored.apiKey;
    }

    res.json(await testImmichConnection(baseUrl, apiKey));
  } catch (error) {
    next(error);
  }
});

export default router;
```

- [ ] **Step 8: Write `backend/src/routes/admin/immich.ts`**

```typescript
/**
 * Admin-global Immich connection (tier 2 of the resolver). Mounted under
 * `/api/v1/admin/immich`; the parent applies `authenticate` + `requireAdmin`
 * + `requireWriteScope`.
 *
 * Mirrors `admin/apiKeys.ts`: the stored key is returned masked, and a masked
 * value coming back in a PUT is treated as "unchanged" rather than stored.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import { immichConnectionSchema, immichTestSchema } from "../../schemas/immich";
import { testImmichConnection } from "../../services/immich/immichTester";
import { ImmichError, normalizeImmichBaseUrl } from "../../services/immich/types";
import logger from "../../utils/logger";

const router = Router();

function maskKey(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  const plain = decryptApiKey(encrypted);
  if (!plain) return null;
  if (plain.length <= 8) return "****";
  return `${plain.slice(0, 4)}****${plain.slice(-4)}`;
}

/** A value the client echoed back from a masked GET carries no new secret. */
function looksMasked(value: string | null | undefined): boolean {
  return !value || value.includes("****");
}

router.get("/", async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const admin = await prisma.adminSettings.findFirst();
    res.json({
      baseUrl: admin?.globalImmichBaseUrl ?? null,
      apiKey: maskKey(admin?.globalImmichApiKey),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = immichConnectionSchema.parse(req.body);
    const data: Record<string, string | null> = {};

    if (payload.baseUrl !== undefined) {
      if (payload.baseUrl === null) {
        data.globalImmichBaseUrl = null;
      } else {
        try {
          data.globalImmichBaseUrl = normalizeImmichBaseUrl(payload.baseUrl);
        } catch (error) {
          throw new AppError(
            error instanceof ImmichError ? error.message : "Invalid Immich URL",
            400,
          );
        }
      }
    }
    if (payload.apiKey !== undefined && !looksMasked(payload.apiKey)) {
      data.globalImmichApiKey = payload.apiKey === null ? null : encryptApiKey(payload.apiKey);
    } else if (payload.apiKey === null) {
      data.globalImmichApiKey = null;
    }

    const existing = await prisma.adminSettings.findFirst();
    if (existing) {
      await prisma.adminSettings.update({ where: { id: existing.id }, data });
    } else {
      await prisma.adminSettings.create({ data });
    }

    logger.info({
      message: "immich_global_connection_updated",
      context: { fields: Object.keys(data) },
    });

    const admin = await prisma.adminSettings.findFirst();
    res.json({
      baseUrl: admin?.globalImmichBaseUrl ?? null,
      apiKey: maskKey(admin?.globalImmichApiKey),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = immichTestSchema.parse(req.body);
    const admin = await prisma.adminSettings.findFirst();

    const baseUrl = body.baseUrl ?? admin?.globalImmichBaseUrl ?? null;
    const apiKey =
      body.apiKey && !looksMasked(body.apiKey)
        ? body.apiKey
        : decryptApiKey(admin?.globalImmichApiKey);

    if (!baseUrl || !apiKey) throw new AppError("No global Immich connection configured", 400);

    res.json(await testImmichConnection(baseUrl, apiKey));
  } catch (error) {
    next(error);
  }
});

export default router;
```

- [ ] **Step 9: Mount both routers**

In `backend/src/routes/settings/index.ts`, add the import next to the other sub-routers and mount it after `tokensRouter`:

```typescript
import immichRouter from "./immich";
// …
router.use("/immich", immichRouter);
```

In `backend/src/routes/admin/index.ts`, add:

```typescript
import immichAdminRouter from "./immich";
// …
router.use("/immich", immichAdminRouter);
```

- [ ] **Step 10: Run the route tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/immichSettingsRoutes.test.ts --forceExit`
Expected: PASS — 10 tests.

- [ ] **Step 11: Typecheck, lint, commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && cd ..
git add backend/src/services/immich/immichTester.ts backend/src/routes/settings/immich.ts \
        backend/src/routes/admin/immich.ts backend/src/routes/settings/index.ts \
        backend/src/routes/admin/index.ts backend/src/__tests__/immichTester.test.ts \
        backend/src/__tests__/immichSettingsRoutes.test.ts
git commit -m "feat(immich): add connection tester and user/admin settings endpoints"
```

---

## Task 7: Trip ↔ album link, unlink and listing routes

`backend/src/routes/trips.ts` is **823 lines** — already past the 800-line hard maximum. All Immich trip routes go into a new file. `resolveTrip` is exported from `trips.ts` and reused so ownership logic exists exactly once.

**Files:**
- Modify: `backend/src/routes/trips.ts` (export `resolveTrip` — one-word change)
- Create: `backend/src/routes/immich/tripAlbums.ts`
- Modify: `backend/src/index.ts` (mount)
- Test: `backend/src/__tests__/immichTripAlbums.test.ts`

**Interfaces:**
- Consumes: `resolveTrip` from `routes/trips`; `getImmichConnection`, `getImmichDefaultMode` (Task 4); `createImmichClient` (Task 3); `getCachedAlbumAssets`, `invalidateAlbumAssets` (Task 5); `linkAlbumsSchema`, `unlinkQuerySchema` (Task 2); `startAlbumImport`, `deleteImportedPhotoFiles` (Task 9, already built).
- Produces:
  - `GET /api/v1/trips/:id/immich/albums` → `{ albums: Array<ImmichAlbum & { linked: boolean; linkId: string | null }>, defaultMode: ImmichMode }`
  - `POST /api/v1/trips/:id/immich/albums` → `{ links: LinkedAlbumDto[] }` (201)
  - `DELETE /api/v1/trips/:id/immich/albums/:linkId?deleteCopies=true|false` → 204
  - `GET /api/v1/trips/:id/immich/albums/:linkId/assets` → `{ assets: GalleryAssetDto[] }` or `{ error: ImmichErrorKind }` with a non-200 status
  - `interface LinkedAlbumDto { id: string; immichAlbumId: string; albumName: string; assetCount: number; thumbnailAssetId: string | null; mode: ImmichMode; sortIdx: number; lastSyncedAt: string | null }`
  - `interface GalleryAssetDto { id: string; url: string; previewUrl: string; takenAt: string | null; lat: number | null; lon: number | null }`
  - Router default-exported from `routes/immich/tripAlbums.ts`, mounted at `/api/v1`

- [ ] **Step 1: Export `resolveTrip` from `trips.ts`**

In `backend/src/routes/trips.ts` line ~402, change:

```typescript
async function resolveTrip(userId: string, tripId: string): Promise<{ id: string }> {
```

to:

```typescript
export async function resolveTrip(userId: string, tripId: string): Promise<{ id: string }> {
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/__tests__/immichTripAlbums.test.ts`:

```typescript
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const resolveTrip = jest.fn(async () => ({ id: "trip-1" }));
jest.mock("../routes/trips", () => ({ resolveTrip }));

const findManyLinks = jest.fn();
const findFirstLink = jest.fn();
const createManyLinks = jest.fn();
const deleteLink = jest.fn();
const updateManyPhotos = jest.fn();
const findManyPhotos = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    tripImmichAlbum: {
      findMany: findManyLinks,
      findFirst: findFirstLink,
      createMany: createManyLinks,
      delete: deleteLink,
    },
    tripPhoto: { findMany: findManyPhotos, updateMany: updateManyPhotos },
  },
}));

const listAlbums = jest.fn();
const listAlbumAssets = jest.fn();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbums, listAlbumAssets }),
}));

const getImmichConnection = jest.fn();
const getImmichDefaultMode = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({
  getImmichConnection,
  getImmichDefaultMode,
}));

const startAlbumImport = jest.fn();
const deleteImportedPhotoFiles = jest.fn();
jest.mock("../services/immich/immichImport", () => ({
  startAlbumImport,
  deleteImportedPhotoFiles,
}));

import { clearImmichAssetCache } from "../services/immich/immichAssetCache";
import tripAlbumsRouter from "../routes/immich/tripAlbums";
import { errorHandler } from "../middleware/errorHandler";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = "u1";
    next();
  });
  app.use("/api/v1", tripAlbumsRouter);
  app.use(errorHandler);
  return app;
}

const CONN = { baseUrl: "https://immich.lan", apiKey: "k", source: "user" as const };

beforeEach(() => {
  jest.clearAllMocks();
  clearImmichAssetCache();
  getImmichConnection.mockResolvedValue(CONN);
  getImmichDefaultMode.mockResolvedValue("link");
  findManyLinks.mockResolvedValue([]);
});

describe("GET /trips/:id/immich/albums", () => {
  it("marks already-linked albums and returns the user's default mode", async () => {
    listAlbums.mockResolvedValue([
      { id: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: "t1" },
      { id: "a2", albumName: "Oslo", assetCount: 1, thumbnailAssetId: null },
    ]);
    findManyLinks.mockResolvedValue([{ id: "link-1", immichAlbumId: "a2" }]);
    getImmichDefaultMode.mockResolvedValue("import");

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums");

    expect(res.status).toBe(200);
    expect(res.body.defaultMode).toBe("import");
    expect(res.body.albums).toEqual([
      { id: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: "t1", linked: false, linkId: null },
      { id: "a2", albumName: "Oslo", assetCount: 1, thumbnailAssetId: null, linked: true, linkId: "link-1" },
    ]);
  });

  it("returns 409 with a machine-readable kind when Immich is unconfigured", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");
  });

  it("propagates an auth failure as 502 + kind=auth rather than a 500", async () => {
    const { ImmichError } = jest.requireActual<typeof import("../services/immich/types")>(
      "../services/immich/types",
    );
    listAlbums.mockRejectedValue(new ImmichError("auth", "Immich rejected the API key", 401));

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("auth");
  });

  it("404s when the user does not own the trip", async () => {
    const { AppError } = jest.requireActual<typeof import("../middleware/errorHandler")>(
      "../middleware/errorHandler",
    );
    resolveTrip.mockRejectedValueOnce(new AppError("Trip not found", 404));
    const res = await request(makeApp()).get("/api/v1/trips/other/immich/albums");
    expect(res.status).toBe(404);
  });
});

describe("POST /trips/:id/immich/albums", () => {
  it("creates link rows with cached name/count and skips duplicates", async () => {
    listAlbums.mockResolvedValue([{ id: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: "t1" }]);
    createManyLinks.mockResolvedValue({ count: 1 });
    findManyLinks
      .mockResolvedValueOnce([]) // existing links, before insert
      .mockResolvedValueOnce([
        {
          id: "link-1",
          immichAlbumId: "a1",
          albumName: "Rome",
          assetCount: 3,
          thumbnailAssetId: "t1",
          mode: "link",
          sortIdx: 0,
          lastSyncedAt: null,
        },
      ]);

    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/albums")
      .send({ albums: [{ immichAlbumId: "a1", mode: "link" }] });

    expect(res.status).toBe(201);
    expect(createManyLinks).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(res.body.links[0]).toMatchObject({ id: "link-1", albumName: "Rome", mode: "link" });
    expect(startAlbumImport).not.toHaveBeenCalled();
  });

  it("kicks off an import job for import-mode albums only", async () => {
    listAlbums.mockResolvedValue([
      { id: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: null },
      { id: "a2", albumName: "Oslo", assetCount: 1, thumbnailAssetId: null },
    ]);
    createManyLinks.mockResolvedValue({ count: 2 });
    findManyLinks.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "link-1", immichAlbumId: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: null, mode: "link", sortIdx: 0, lastSyncedAt: null },
      { id: "link-2", immichAlbumId: "a2", albumName: "Oslo", assetCount: 1, thumbnailAssetId: null, mode: "import", sortIdx: 1, lastSyncedAt: null },
    ]);

    await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/albums")
      .send({
        albums: [
          { immichAlbumId: "a1", mode: "link" },
          { immichAlbumId: "a2", mode: "import" },
        ],
      });

    expect(startAlbumImport).toHaveBeenCalledTimes(1);
    expect(startAlbumImport).toHaveBeenCalledWith("u1", "link-2");
  });

  it("rejects an album id the user's Immich does not have", async () => {
    listAlbums.mockResolvedValue([{ id: "a1", albumName: "Rome", assetCount: 3, thumbnailAssetId: null }]);
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/albums")
      .send({ albums: [{ immichAlbumId: "not-mine", mode: "link" }] });

    expect(res.status).toBe(400);
    expect(createManyLinks).not.toHaveBeenCalled();
  });

  it("rejects an empty album list with 400", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/albums")
      .send({ albums: [] });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /trips/:id/immich/albums/:linkId", () => {
  beforeEach(() => {
    findFirstLink.mockResolvedValue({ id: "link-1", tripId: "trip-1", immichAlbumId: "a1", mode: "import" });
  });

  it("keeps the copies by default, severing the FK so the cascade cannot eat them", async () => {
    const res = await request(makeApp()).delete("/api/v1/trips/trip-1/immich/albums/link-1");

    expect(res.status).toBe(204);
    expect(updateManyPhotos).toHaveBeenCalledWith({
      where: { immichAlbumLinkId: "link-1" },
      data: { immichAlbumLinkId: null },
    });
    expect(deleteImportedPhotoFiles).not.toHaveBeenCalled();
    expect(deleteLink).toHaveBeenCalledWith({ where: { id: "link-1" } });
  });

  it("deletes the files first when deleteCopies=true, then lets the cascade drop the rows", async () => {
    findManyPhotos.mockResolvedValue([{ filename: "a.jpg" }, { filename: "b.jpg" }]);

    const res = await request(makeApp()).delete(
      "/api/v1/trips/trip-1/immich/albums/link-1?deleteCopies=true",
    );

    expect(res.status).toBe(204);
    expect(deleteImportedPhotoFiles).toHaveBeenCalledWith(["a.jpg", "b.jpg"]);
    expect(updateManyPhotos).not.toHaveBeenCalled();
    expect(deleteLink).toHaveBeenCalledWith({ where: { id: "link-1" } });
  });

  it("does not touch photos for a link-mode album (there are none)", async () => {
    findFirstLink.mockResolvedValue({ id: "link-2", tripId: "trip-1", immichAlbumId: "a1", mode: "link" });
    await request(makeApp()).delete("/api/v1/trips/trip-1/immich/albums/link-2?deleteCopies=true");

    expect(deleteImportedPhotoFiles).not.toHaveBeenCalled();
    expect(updateManyPhotos).not.toHaveBeenCalled();
  });

  it("404s for a link that belongs to another trip", async () => {
    findFirstLink.mockResolvedValue(null);
    const res = await request(makeApp()).delete("/api/v1/trips/trip-1/immich/albums/link-x");
    expect(res.status).toBe(404);
    expect(deleteLink).not.toHaveBeenCalled();
  });
});

describe("GET /trips/:id/immich/albums/:linkId/assets", () => {
  it("returns proxy URLs for a link-mode album", async () => {
    findFirstLink.mockResolvedValue({ id: "link-1", tripId: "trip-1", immichAlbumId: "a1", mode: "link" });
    listAlbumAssets.mockResolvedValue([
      { id: "p1", type: "IMAGE", fileCreatedAt: "2026-05-01T00:00:00.000Z", originalFileName: "p1.jpg", mimeType: "image/jpeg", sizeBytes: 1, lat: 1, lon: 2 },
    ]);

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");

    expect(res.status).toBe(200);
    expect(res.body.assets[0]).toEqual({
      id: "p1",
      url: "/api/v1/trips/trip-1/immich/albums/link-1/assets/p1/file?size=thumbnail",
      previewUrl: "/api/v1/trips/trip-1/immich/albums/link-1/assets/p1/file?size=preview",
      takenAt: "2026-05-01T00:00:00.000Z",
      lat: 1,
      lon: 2,
    });
  });

  it("skips VIDEO assets (out of scope for Phase A)", async () => {
    findFirstLink.mockResolvedValue({ id: "link-1", tripId: "trip-1", immichAlbumId: "a1", mode: "link" });
    listAlbumAssets.mockResolvedValue([
      { id: "v1", type: "VIDEO", fileCreatedAt: "2026-05-01T00:00:00.000Z", originalFileName: "v.mp4", mimeType: "video/mp4", sizeBytes: 1, lat: null, lon: null },
    ]);
    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");
    expect(res.body.assets).toEqual([]);
  });

  it("returns 502 + kind=notFound when the album was deleted in Immich", async () => {
    const { ImmichError } = jest.requireActual<typeof import("../services/immich/types")>(
      "../services/immich/types",
    );
    findFirstLink.mockResolvedValue({ id: "link-1", tripId: "trip-1", immichAlbumId: "a1", mode: "link" });
    listAlbumAssets.mockRejectedValue(new ImmichError("notFound", "gone", 404));

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("notFound");
  });

  it("serves an import-mode album from local TripPhoto rows", async () => {
    findFirstLink.mockResolvedValue({ id: "link-1", tripId: "trip-1", immichAlbumId: "a1", mode: "import" });
    findManyPhotos.mockResolvedValue([
      { id: "photo-1", tripId: "trip-1", takenAt: new Date("2026-05-01T00:00:00.000Z"), lat: 1, lon: 2 },
    ]);

    const res = await request(makeApp()).get("/api/v1/trips/trip-1/immich/albums/link-1/assets");

    expect(listAlbumAssets).not.toHaveBeenCalled();
    expect(res.body.assets[0]).toEqual({
      id: "photo-1",
      url: "/api/v1/trips/trip-1/photos/photo-1/file",
      previewUrl: "/api/v1/trips/trip-1/photos/photo-1/file",
      takenAt: "2026-05-01T00:00:00.000Z",
      lat: 1,
      lon: 2,
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichTripAlbums.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../routes/immich/tripAlbums'`.

- [ ] **Step 4: Write `backend/src/routes/immich/tripAlbums.ts`**

```typescript
/**
 * Trip <-> Immich album linking.
 *
 * Lives outside `routes/trips.ts` because that file is already at the 800-line
 * hard maximum. Ownership is enforced by the same `resolveTrip` guard every
 * other trip sub-route uses, plus a link-belongs-to-trip check.
 *
 * Immich failures never surface as a 500: they become a 502 with a
 * machine-readable `error` kind so the gallery can render a degraded panel
 * instead of crashing.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { resolveTrip } from "../trips";
import { linkAlbumsSchema, unlinkQuerySchema } from "../../schemas/immich";
import { createImmichClient } from "../../services/immich/immichClient";
import { getImmichConnection, getImmichDefaultMode } from "../../services/immich/immichResolver";
import { getCachedAlbumAssets, invalidateAlbumAssets } from "../../services/immich/immichAssetCache";
import { deleteImportedPhotoFiles, startAlbumImport } from "../../services/immich/immichImport";
import { ImmichAsset, ImmichConnection, ImmichError, ImmichMode } from "../../services/immich/types";
import logger from "../../utils/logger";

const router = Router();

export interface LinkedAlbumDto {
  id: string;
  immichAlbumId: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  mode: ImmichMode;
  sortIdx: number;
  lastSyncedAt: string | null;
}

export interface GalleryAssetDto {
  id: string;
  url: string;
  previewUrl: string;
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
}

/** Turn any Immich failure into a 502 + kind. Anything else bubbles as-is. */
function sendImmichFailure(res: Response, error: unknown, next: NextFunction): void {
  if (error instanceof ImmichError) {
    logger.warn({ message: "immich_upstream_failure", context: { kind: error.kind } });
    res.status(502).json({ error: error.kind, message: error.message });
    return;
  }
  next(error);
}

/** Resolve the connection or answer 409 — "you have not configured Immich". */
async function requireConnection(userId: string, res: Response): Promise<ImmichConnection | null> {
  const conn = await getImmichConnection(userId);
  if (!conn) {
    res.status(409).json({ error: "notConfigured", message: "No Immich connection configured" });
    return null;
  }
  return conn;
}

/** The link must exist AND belong to the trip the caller already proved they own. */
async function resolveLink(
  tripId: string,
  linkId: string,
): Promise<{ id: string; immichAlbumId: string; mode: string }> {
  const link = await prisma.tripImmichAlbum.findFirst({
    where: { id: linkId, tripId },
    select: { id: true, immichAlbumId: true, mode: true },
  });
  if (!link) throw new AppError("Linked album not found", 404);
  return link;
}

const toLinkDto = (row: {
  id: string;
  immichAlbumId: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  mode: string;
  sortIdx: number;
  lastSyncedAt: Date | null;
}): LinkedAlbumDto => ({
  id: row.id,
  immichAlbumId: row.immichAlbumId,
  albumName: row.albumName,
  assetCount: row.assetCount,
  thumbnailAssetId: row.thumbnailAssetId,
  mode: row.mode === "import" ? "import" : "link",
  sortIdx: row.sortIdx,
  lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
});

const proxyUrl = (tripId: string, linkId: string, assetId: string, size: string): string =>
  `/api/v1/trips/${tripId}/immich/albums/${linkId}/assets/${assetId}/file?size=${size}`;

/* ─── Album picker ─── */

router.get(
  "/trips/:id/immich/albums",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);

      const conn = await requireConnection(userId, res);
      if (!conn) return;

      const albums = await createImmichClient(conn).listAlbums();
      const links = await prisma.tripImmichAlbum.findMany({
        where: { tripId: req.params.id },
        select: { id: true, immichAlbumId: true },
      });
      const linkByAlbum = new Map(links.map((l) => [l.immichAlbumId, l.id]));

      res.json({
        albums: albums.map((album) => ({
          ...album,
          linked: linkByAlbum.has(album.id),
          linkId: linkByAlbum.get(album.id) ?? null,
        })),
        defaultMode: await getImmichDefaultMode(userId),
      });
    } catch (error) {
      sendImmichFailure(res, error, next);
    }
  },
);

/* ─── Link ─── */

router.post(
  "/trips/:id/immich/albums",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const { albums: requested } = linkAlbumsSchema.parse(req.body);
      const conn = await requireConnection(userId, res);
      if (!conn) return;

      // Only albums the user's own Immich actually exposes may be linked —
      // this is the ownership boundary for every later proxy request.
      const available = await createImmichClient(conn).listAlbums();
      const byId = new Map(available.map((a) => [a.id, a]));
      const unknown = requested.filter((r) => !byId.has(r.immichAlbumId));
      if (unknown.length > 0) {
        throw new AppError(`Unknown Immich album: ${unknown[0].immichAlbumId}`, 400);
      }

      const existing = await prisma.tripImmichAlbum.findMany({
        where: { tripId },
        select: { sortIdx: true },
        orderBy: { sortIdx: "desc" },
        take: 1,
      });
      let nextIdx = (existing[0]?.sortIdx ?? -1) + 1;

      await prisma.tripImmichAlbum.createMany({
        data: requested.map((r) => {
          const album = byId.get(r.immichAlbumId)!;
          return {
            tripId,
            immichAlbumId: album.id,
            albumName: album.albumName,
            assetCount: album.assetCount,
            thumbnailAssetId: album.thumbnailAssetId,
            mode: r.mode,
            sortIdx: nextIdx++,
          };
        }),
        skipDuplicates: true,
      });

      const links = await prisma.tripImmichAlbum.findMany({
        where: { tripId },
        orderBy: { sortIdx: "asc" },
      });

      // Import mode downloads in the background; the UI polls the job.
      for (const link of links) {
        const wasRequested = requested.some((r) => r.immichAlbumId === link.immichAlbumId);
        if (wasRequested && link.mode === "import") {
          void startAlbumImport(userId, link.id);
        }
      }

      logger.info({
        message: "immich_albums_linked",
        context: { userId, tripId, count: requested.length },
      });

      res.status(201).json({ links: links.map(toLinkDto) });
    } catch (error) {
      sendImmichFailure(res, error, next);
    }
  },
);

/* ─── Unlink ─── */

router.delete(
  "/trips/:id/immich/albums/:linkId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const link = await resolveLink(tripId, req.params.linkId);
      const { deleteCopies } = unlinkQuerySchema.parse(req.query);

      if (link.mode === "import") {
        if (deleteCopies) {
          // Remove the bytes first: the cascade would drop the rows and orphan
          // the files, and an orphaned file is invisible to every later cleanup.
          const photos = await prisma.tripPhoto.findMany({
            where: { immichAlbumLinkId: link.id },
            select: { filename: true },
          });
          deleteImportedPhotoFiles(photos.map((p) => p.filename));
        } else {
          // Keep the copies as ordinary uploads by severing the FK, otherwise
          // `onDelete: Cascade` would delete them with the link row.
          await prisma.tripPhoto.updateMany({
            where: { immichAlbumLinkId: link.id },
            data: { immichAlbumLinkId: null },
          });
        }
      }

      await prisma.tripImmichAlbum.delete({ where: { id: link.id } });
      invalidateAlbumAssets(userId, link.immichAlbumId);

      logger.info({
        message: "immich_album_unlinked",
        context: { userId, tripId, linkId: link.id, deleteCopies },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/* ─── Assets of one linked album ─── */

router.get(
  "/trips/:id/immich/albums/:linkId/assets",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const link = await resolveLink(tripId, req.params.linkId);

      if (link.mode === "import") {
        const photos = await prisma.tripPhoto.findMany({
          where: { immichAlbumLinkId: link.id },
          orderBy: { sortIdx: "asc" },
          select: { id: true, tripId: true, takenAt: true, lat: true, lon: true },
        });
        const fileUrl = (photoId: string): string =>
          `/api/v1/trips/${tripId}/photos/${photoId}/file`;

        res.json({
          assets: photos.map((p) => ({
            id: p.id,
            url: fileUrl(p.id),
            previewUrl: fileUrl(p.id),
            takenAt: p.takenAt?.toISOString() ?? null,
            lat: p.lat,
            lon: p.lon,
          })),
        });
        return;
      }

      const conn = await requireConnection(userId, res);
      if (!conn) return;

      const assets = await getCachedAlbumAssets(userId, link.immichAlbumId, () =>
        createImmichClient(conn).listAlbumAssets(link.immichAlbumId),
      );

      res.json({
        assets: assets
          .filter((a: ImmichAsset) => a.type === "IMAGE")
          .map((a: ImmichAsset) => ({
            id: a.id,
            url: proxyUrl(tripId, link.id, a.id, "thumbnail"),
            previewUrl: proxyUrl(tripId, link.id, a.id, "preview"),
            takenAt: a.fileCreatedAt,
            lat: a.lat,
            lon: a.lon,
          })),
      });
    } catch (error) {
      sendImmichFailure(res, error, next);
    }
  },
);

export default router;
```

- [ ] **Step 5: Mount the router**

In `backend/src/index.ts`, next to `import tripsRoutes from './routes/trips';` add:

```typescript
import immichTripRoutes from './routes/immich/tripAlbums';
```

and next to `app.use('/api/v1', tripsRoutes);` (line ~244) add:

```typescript
app.use('/api/v1', immichTripRoutes);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/immichTripAlbums.test.ts --forceExit`
Expected: PASS — 14 tests.

`startAlbumImport` and `deleteImportedPhotoFiles` already exist — Task 9 built them. Import them from `../../services/immich/immichImport`; do not create a stub.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && cd ..
git add backend/src/routes/immich/tripAlbums.ts backend/src/routes/trips.ts backend/src/index.ts \
        backend/src/__tests__/immichTripAlbums.test.ts
git commit -m "feat(immich): link, unlink and list trip albums"
```

---

## Task 8: Image proxy

The heart of link mode: stream Immich's bytes through to the browser, store nothing (spec §5). Three things make this safe and fast:

1. **Ownership + membership.** The caller must own the trip *and* the requested `assetId` must actually appear in that linked album's cached asset list. Without the membership check, anyone owning any trip could read any asset in the connection's Immich.
2. **No SSRF.** The upstream URL is built from the stored, normalised `baseUrl` plus a UUID-validated asset id — never from client input (spec §8).
3. **Browser caching.** `ETag` + `Cache-Control: private, max-age=86400, immutable`. An asset id addresses immutable bytes in Immich, so a conditional request can be answered with `304` without touching Immich at all.

A failing upstream returns a **1×1 transparent PNG with status 502 and `Cache-Control: no-store`**, so the browser paints nothing rather than caching a broken image as valid (spec §7).

**Files:**
- Modify: `backend/src/config/constants.ts`
- Modify: `backend/src/middleware/rateLimit.ts`
- Create: `backend/src/routes/immich/assetProxy.ts`
- Modify: `backend/src/index.ts` (mount)
- Test: `backend/src/__tests__/immichAssetProxy.test.ts`

**Interfaces:**
- Consumes: `resolveTrip` (Task 7); `getImmichConnection` (Task 4); `createImmichClient` (Task 3); `getCachedAlbumAssets` (Task 5); `assetSizeSchema`, `assetIdParamSchema` (Task 2).
- Produces:
  - `GET /api/v1/trips/:id/immich/albums/:linkId/assets/:assetId/file?size=thumbnail|preview|original`
  - `RATE_LIMITS.IMMICH_PROXY_WINDOW_MS`, `RATE_LIMITS.IMMICH_PROXY_MAX`, `RATE_LIMITS.IMMICH_IMPORT_WINDOW_MS`, `RATE_LIMITS.IMMICH_IMPORT_MAX`
  - `immichProxyLimiter`, `immichImportLimiter` from `middleware/rateLimit`
  - Router default-exported from `routes/immich/assetProxy.ts`, mounted at `/api/v1`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/immichAssetProxy.test.ts`:

```typescript
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import { Readable } from "stream";

const resolveTrip = jest.fn(async () => ({ id: "trip-1" }));
jest.mock("../routes/trips", () => ({ resolveTrip }));

const findFirstLink = jest.fn();
jest.mock("../db", () => ({ prisma: { tripImmichAlbum: { findFirst: findFirstLink } } }));

const listAlbumAssets = jest.fn();
const fetchAssetStream = jest.fn();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbumAssets, fetchAssetStream }),
}));

const getImmichConnection = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection }));

// The proxy must not be rate-limited in unit tests.
jest.mock("../middleware/rateLimit", () => ({
  immichProxyLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { clearImmichAssetCache } from "../services/immich/immichAssetCache";
import assetProxyRouter from "../routes/immich/assetProxy";
import { errorHandler } from "../middleware/errorHandler";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ASSET_ID = "22222222-2222-4222-8222-222222222222";

function makeApp(): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = "u1";
    next();
  });
  app.use("/api/v1", assetProxyRouter);
  app.use(errorHandler);
  return app;
}

const url = (assetId: string, size?: string): string =>
  `/api/v1/trips/trip-1/immich/albums/link-1/assets/${assetId}/file${size ? `?size=${size}` : ""}`;

const asset = (id: string) => ({
  id,
  type: "IMAGE" as const,
  fileCreatedAt: "2026-05-01T00:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1,
  lat: null,
  lon: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearImmichAssetCache();
  getImmichConnection.mockResolvedValue({ baseUrl: "https://immich.lan", apiKey: "k", source: "user" });
  findFirstLink.mockResolvedValue({ id: "link-1", tripId: "trip-1", immichAlbumId: "a1", mode: "link" });
  listAlbumAssets.mockResolvedValue([asset(ASSET_ID)]);
  fetchAssetStream.mockImplementation(async () => ({
    stream: Readable.from([Buffer.from("image-bytes")]),
    contentType: "image/webp",
    contentLength: 11,
  }));
});

describe("asset proxy", () => {
  it("streams the thumbnail with immutable private cache headers and an ETag", async () => {
    const res = await request(makeApp()).get(url(ASSET_ID));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
    expect(res.headers["cache-control"]).toBe("private, max-age=86400, immutable");
    expect(res.headers.etag).toBe(`"${ASSET_ID}-thumbnail"`);
    expect(res.body.toString()).toBe("image-bytes");
    expect(fetchAssetStream).toHaveBeenCalledWith(ASSET_ID, "thumbnail");
  });

  it("defaults to size=thumbnail and honours an explicit preview", async () => {
    await request(makeApp()).get(url(ASSET_ID, "preview"));
    expect(fetchAssetStream).toHaveBeenCalledWith(ASSET_ID, "preview");
  });

  it("answers a matching If-None-Match with 304 without calling Immich", async () => {
    const res = await request(makeApp())
      .get(url(ASSET_ID))
      .set("If-None-Match", `"${ASSET_ID}-thumbnail"`);

    expect(res.status).toBe(304);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("refuses an asset that is not a member of the linked album", async () => {
    const res = await request(makeApp()).get(url(OTHER_ASSET_ID));

    expect(res.status).toBe(404);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID asset id before any upstream call", async () => {
    const res = await request(makeApp()).get(url("../../etc/passwd"));
    expect(res.status).toBe(400);
    expect(fetchAssetStream).not.toHaveBeenCalled();
  });

  it("rejects an unknown size", async () => {
    const res = await request(makeApp()).get(url(ASSET_ID, "huge"));
    expect(res.status).toBe(400);
  });

  it("404s when the caller does not own the trip", async () => {
    const { AppError } = jest.requireActual<typeof import("../middleware/errorHandler")>(
      "../middleware/errorHandler",
    );
    resolveTrip.mockRejectedValueOnce(new AppError("Trip not found", 404));
    const res = await request(makeApp()).get(url(ASSET_ID));
    expect(res.status).toBe(404);
  });

  it("returns a no-store placeholder PNG with 502 when Immich fails", async () => {
    const { ImmichError } = jest.requireActual<typeof import("../services/immich/types")>(
      "../services/immich/types",
    );
    fetchAssetStream.mockRejectedValue(new ImmichError("unreachable", "down"));

    const res = await request(makeApp()).get(url(ASSET_ID));

    expect(res.status).toBe(502);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("returns 409 when no Immich connection is configured", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(makeApp()).get(url(ASSET_ID));
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichAssetProxy.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../routes/immich/assetProxy'`.

- [ ] **Step 3: Add the rate-limit constants**

In `backend/src/config/constants.ts`, inside the exported `RATE_LIMITS` object, add:

```typescript
  // Immich: a single gallery render can request hundreds of tiles, so the
  // proxy budget is deliberately generous. Imports are the opposite — rare,
  // heavy, and worth throttling hard.
  IMMICH_PROXY_WINDOW_MS: 60 * 1000,
  IMMICH_PROXY_MAX: 600,
  IMMICH_IMPORT_WINDOW_MS: 15 * 60 * 1000,
  IMMICH_IMPORT_MAX: 20,
```

- [ ] **Step 4: Add the limiters**

In `backend/src/middleware/rateLimit.ts`, alongside the other exported limiters:

```typescript
export const immichProxyLimiter = rateLimit({
  windowMs: RATE_LIMITS.IMMICH_PROXY_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.IMMICH_PROXY_MAX),
  standardHeaders: true,
  legacyHeaders: false,
});

export const immichImportLimiter = rateLimit({
  windowMs: RATE_LIMITS.IMMICH_IMPORT_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.IMMICH_IMPORT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
});
```

- [ ] **Step 5: Write `backend/src/routes/immich/assetProxy.ts`**

```typescript
/**
 * Stream a linked album's image from Immich to the browser. Nothing is written
 * to disk — link mode's whole promise is zero duplicate storage (spec §5).
 *
 * Security (spec §8):
 *  - the caller must own the trip (`resolveTrip`),
 *  - the asset must be a member of THAT linked album (checked against the
 *    cached asset list), otherwise owning any trip would turn the proxy into
 *    an arbitrary-asset reader,
 *  - the upstream URL is built from the stored, normalised base URL plus a
 *    UUID-validated asset id. No client-supplied URL is ever fetched.
 *
 * Caching: an Immich asset id addresses immutable bytes, so we hand the
 * browser a strong ETag and a long private max-age and answer repeat views
 * with 304 without ever touching Immich.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { immichProxyLimiter } from "../../middleware/rateLimit";
import { resolveTrip } from "../trips";
import { assetIdParamSchema, assetSizeSchema } from "../../schemas/immich";
import { createImmichClient } from "../../services/immich/immichClient";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { getCachedAlbumAssets } from "../../services/immich/immichAssetCache";
import { ImmichError } from "../../services/immich/types";
import logger from "../../utils/logger";

const router = Router();

const CACHE_CONTROL = "private, max-age=86400, immutable";

/** 1x1 transparent PNG — painted instead of a broken-image icon on failure. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function sendPlaceholder(res: Response, status: number): void {
  if (res.headersSent) return;
  res.status(status);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(PLACEHOLDER_PNG);
}

router.get(
  "/trips/:id/immich/albums/:linkId/assets/:assetId/file",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const assetId = assetIdParamSchema.safeParse(req.params.assetId);
      if (!assetId.success) throw new AppError("Invalid asset id", 400);

      const size = assetSizeSchema.safeParse(req.query.size);
      if (!size.success) throw new AppError("Invalid size", 400);

      const etag = `"${assetId.data}-${size.data}"`;
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      const link = await prisma.tripImmichAlbum.findFirst({
        where: { id: req.params.linkId, tripId },
        select: { immichAlbumId: true },
      });
      if (!link) throw new AppError("Linked album not found", 404);

      const conn = await getImmichConnection(userId);
      if (!conn) {
        res.status(409).json({ error: "notConfigured" });
        return;
      }

      const client = createImmichClient(conn);
      const assets = await getCachedAlbumAssets(userId, link.immichAlbumId, () =>
        client.listAlbumAssets(link.immichAlbumId),
      );
      if (!assets.some((a) => a.id === assetId.data)) {
        throw new AppError("Asset not found in this album", 404);
      }

      const upstream = await client.fetchAssetStream(assetId.data, size.data);

      res.setHeader("Content-Type", upstream.contentType);
      res.setHeader("Cache-Control", CACHE_CONTROL);
      res.setHeader("ETag", etag);
      if (upstream.contentLength !== null) {
        res.setHeader("Content-Length", String(upstream.contentLength));
      }

      // A mid-stream upstream abort must not leave the response hanging.
      upstream.stream.on("error", (error: unknown) => {
        logger.error({
          message: "immich_proxy_stream_error",
          error,
          context: { assetId: assetId.data },
        });
        res.destroy();
      });

      upstream.stream.pipe(res);
    } catch (error) {
      if (error instanceof ImmichError) {
        logger.warn({ message: "immich_proxy_upstream_failure", context: { kind: error.kind } });
        sendPlaceholder(res, error.kind === "notFound" ? 404 : 502);
        return;
      }
      next(error);
    }
  },
);

export default router;
```

- [ ] **Step 6: Mount it**

In `backend/src/index.ts`, next to the `immichTripRoutes` import add:

```typescript
import immichAssetProxyRoutes from './routes/immich/assetProxy';
```

and next to `app.use('/api/v1', immichTripRoutes);` add:

```typescript
app.use('/api/v1', immichAssetProxyRoutes);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/immichAssetProxy.test.ts --forceExit`
Expected: PASS — 9 tests.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && cd ..
git add backend/src/routes/immich/assetProxy.ts backend/src/middleware/rateLimit.ts \
        backend/src/config/constants.ts backend/src/index.ts \
        backend/src/__tests__/immichAssetProxy.test.ts
git commit -m "feat(immich): stream album images through an ownership-checked proxy"
```

---

## Task 9: Import pipeline service

> **Execution order:** this task runs **before Task 7**. `immichImport.ts` has no
> dependency on the route layer, so building the real service first means Task 7
> can import it directly instead of a stub. The routes that expose this service
> live in **Task 9R**, which runs after Tasks 7 and 8.

Import mode downloads originals into the existing trip-photo directory (which the Docker entrypoint symlinks onto the data volume, so copies land in backups) and creates ordinary `TripPhoto` rows tagged with `immichAssetId`. Idempotency comes from the `(tripId, immichAssetId)` unique index, so re-sync only fetches what is missing.

There is no job queue in this repo — only `node-cron` schedulers. We mirror the established `airportSeedingService` pattern: a DB status row, a `running` guard against concurrent runs, and periodic progress updates the UI polls.

**Files:**
- Create: `backend/src/services/immich/immichImport.ts`
- Test: `backend/src/__tests__/immichImport.test.ts`

**Interfaces:**
- Consumes: `createImmichClient` (Task 3); `getImmichConnection` (Task 4); `invalidateAlbumAssets` (Task 5); `getTripPhotoDir`, `deleteTripPhotoFile` from `middleware/upload`.
- Produces:
  - `async function startAlbumImport(userId: string, linkId: string): Promise<void>` — fire-and-forget; never throws to the caller
  - `async function estimateAlbumImport(userId: string, albumId: string): Promise<{ assetCount: number; totalBytes: number }>`
  - `async function getImportJob(linkId: string): Promise<ImportJobDto | null>`
  - `function deleteImportedPhotoFiles(filenames: string[]): void`
  - `interface ImportJobDto { status: "pending" | "running" | "completed" | "failed"; totalAssets: number; processedAssets: number; failedAssets: number; error: string | null }`
  - `const IMPORT_ALLOWED_MIME_TYPES: readonly string[]`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/immichImport.test.ts`:

```typescript
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Readable } from "stream";

const jobUpsert = jest.fn();
const jobUpdate = jest.fn();
const jobFindUnique = jest.fn();
const linkFindUnique = jest.fn();
const linkUpdate = jest.fn();
const photoFindMany = jest.fn();
const photoCreate = jest.fn();
const photoAggregate = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    immichImportJob: { upsert: jobUpsert, update: jobUpdate, findUnique: jobFindUnique },
    tripImmichAlbum: { findUnique: linkFindUnique, update: linkUpdate },
    tripPhoto: { findMany: photoFindMany, create: photoCreate, aggregate: photoAggregate },
  },
}));

const listAlbumAssets = jest.fn();
const fetchAssetStream = jest.fn();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbumAssets, fetchAssetStream }),
}));

const getImmichConnection = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection }));

const writtenFiles: string[] = [];
jest.mock("fs", () => ({
  existsSync: jest.fn(() => true),
  createWriteStream: jest.fn((p: string) => {
    writtenFiles.push(p);
    const { PassThrough } = jest.requireActual<typeof import("stream")>("stream");
    const sink = new PassThrough();
    sink.on("data", () => {});
    return sink;
  }),
  unlinkSync: jest.fn(),
}));

jest.mock("../middleware/upload", () => ({
  getTripPhotoDir: () => "/data/uploads/trip-photos",
  deleteTripPhotoFile: jest.fn(),
}));

import {
  startAlbumImport,
  estimateAlbumImport,
  IMPORT_ALLOWED_MIME_TYPES,
} from "../services/immich/immichImport";

const asset = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2026-05-01T00:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1000,
  lat: 1,
  lon: 2,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  writtenFiles.length = 0;
  getImmichConnection.mockResolvedValue({ baseUrl: "https://immich.lan", apiKey: "k", source: "user" });
  linkFindUnique.mockResolvedValue({
    id: "link-1",
    tripId: "trip-1",
    immichAlbumId: "a1",
    mode: "import",
  });
  jobFindUnique.mockResolvedValue(null);
  jobUpsert.mockResolvedValue({ id: "job-1", status: "running" });
  photoFindMany.mockResolvedValue([]);
  photoCreate.mockResolvedValue({ id: "photo-1" });
  fetchAssetStream.mockImplementation(async () => ({
    stream: Readable.from([Buffer.from("bytes")]),
    contentType: "image/jpeg",
    contentLength: 5,
  }));
});

describe("startAlbumImport", () => {
  it("downloads every asset and records provenance + coordinates", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1"), asset("p2")]);

    await startAlbumImport("u1", "link-1");

    expect(fetchAssetStream).toHaveBeenCalledWith("p1", "original");
    expect(fetchAssetStream).toHaveBeenCalledWith("p2", "original");
    expect(photoCreate).toHaveBeenCalledTimes(2);
    expect(photoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tripId: "trip-1",
          immichAssetId: "p1",
          immichAlbumLinkId: "link-1",
          mimetype: "image/jpeg",
          lat: 1,
          lon: 2,
        }),
      }),
    );
    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }),
    );
  });

  it("is idempotent — already-imported assets are skipped on re-sync", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1"), asset("p2")]);
    photoFindMany.mockResolvedValue([{ immichAssetId: "p1" }]);

    await startAlbumImport("u1", "link-1");

    expect(fetchAssetStream).toHaveBeenCalledTimes(1);
    expect(fetchAssetStream).toHaveBeenCalledWith("p2", "original");
  });

  it("skips videos and disallowed mime types without failing the job", async () => {
    listAlbumAssets.mockResolvedValue([
      asset("v1", { type: "VIDEO", mimeType: "video/mp4" }),
      asset("x1", { mimeType: "image/heic" }),
      asset("p1"),
    ]);

    await startAlbumImport("u1", "link-1");

    expect(IMPORT_ALLOWED_MIME_TYPES).not.toContain("image/heic");
    expect(fetchAssetStream).toHaveBeenCalledTimes(1);
    expect(fetchAssetStream).toHaveBeenCalledWith("p1", "original");
  });

  it("counts a per-asset failure, keeps the successes, and still completes", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1"), asset("p2")]);
    fetchAssetStream
      .mockRejectedValueOnce(new Error("upstream died"))
      .mockResolvedValueOnce({
        stream: Readable.from([Buffer.from("bytes")]),
        contentType: "image/jpeg",
        contentLength: 5,
      });

    await startAlbumImport("u1", "link-1");

    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", failedAssets: 1 }),
      }),
    );
  });

  it("refuses to start a second run while one is already running", async () => {
    jobFindUnique.mockResolvedValue({ id: "job-1", status: "running" });

    await startAlbumImport("u1", "link-1");

    expect(listAlbumAssets).not.toHaveBeenCalled();
    expect(jobUpsert).not.toHaveBeenCalled();
  });

  it("marks the job failed when the album listing itself fails", async () => {
    listAlbumAssets.mockRejectedValue(new Error("immich down"));

    await expect(startAlbumImport("u1", "link-1")).resolves.toBeUndefined();

    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", error: "immich down" }),
      }),
    );
  });

  it("stamps lastSyncedAt on the link when the run completes", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1")]);
    await startAlbumImport("u1", "link-1");
    expect(linkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link-1" },
        data: expect.objectContaining({ lastSyncedAt: expect.any(Date) }),
      }),
    );
  });

  it("does nothing when Immich is unconfigured", async () => {
    getImmichConnection.mockResolvedValue(null);
    await startAlbumImport("u1", "link-1");
    expect(listAlbumAssets).not.toHaveBeenCalled();
  });
});

describe("estimateAlbumImport", () => {
  it("sums importable asset sizes and ignores videos", async () => {
    listAlbumAssets.mockResolvedValue([
      asset("p1", { sizeBytes: 1000 }),
      asset("p2", { sizeBytes: 2500 }),
      asset("v1", { type: "VIDEO", mimeType: "video/mp4", sizeBytes: 999999 }),
    ]);

    await expect(estimateAlbumImport("u1", "a1")).resolves.toEqual({
      assetCount: 2,
      totalBytes: 3500,
    });
  });

  it("treats an unknown size as zero rather than NaN", async () => {
    listAlbumAssets.mockResolvedValue([asset("p1", { sizeBytes: null })]);
    await expect(estimateAlbumImport("u1", "a1")).resolves.toEqual({
      assetCount: 1,
      totalBytes: 0,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichImport.test.ts --forceExit`
Expected: FAIL — `startAlbumImport is not a function` / no export `estimateAlbumImport` (the Task-7 stub is still in place).

- [ ] **Step 3: Write `backend/src/services/immich/immichImport.ts`**

```typescript
/**
 * Import ("copy") mode: download an Immich album's originals onto the data
 * volume and register them as ordinary `TripPhoto` rows.
 *
 * Progress is tracked with a DB status row, mirroring `airportSeedingService`
 * — this repo has no job queue, only cron schedulers, and the UI polls.
 *
 * Idempotency lives in the `(trip_id, immich_asset_id)` unique index: a
 * re-sync lists the album again and downloads only what is missing. One bad
 * asset fails that asset, not the run.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { prisma } from "../../db";
import { deleteTripPhotoFile, getTripPhotoDir } from "../../middleware/upload";
import logger from "../../utils/logger";
import { createImmichClient } from "./immichClient";
import { getImmichConnection } from "./immichResolver";
import { invalidateAlbumAssets } from "./immichAssetCache";
import { ImmichAsset } from "./types";

/** Mirrors the multer `tripPhotoFilter` allow-list — same bytes, same rules. */
export const IMPORT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** Keep the event loop responsive on a 5000-photo album. */
const CHUNK_SIZE = 10;

export interface ImportJobDto {
  status: "pending" | "running" | "completed" | "failed";
  totalAssets: number;
  processedAssets: number;
  failedAssets: number;
  error: string | null;
}

const isImportable = (asset: ImmichAsset): boolean =>
  asset.type === "IMAGE" &&
  (IMPORT_ALLOWED_MIME_TYPES as readonly string[]).includes(asset.mimeType);

/** Same shape multer produces, so both upload paths look alike on disk. */
function buildFilename(originalName: string): string {
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const ext = path.extname(originalName).toLowerCase();
  const basename = path.basename(originalName, ext);
  const sanitized = basename.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
  return `${uniqueSuffix}-${sanitized}${ext}`;
}

export function deleteImportedPhotoFiles(filenames: string[]): void {
  for (const filename of filenames) {
    deleteTripPhotoFile(filename);
  }
}

export async function getImportJob(linkId: string): Promise<ImportJobDto | null> {
  const job = await prisma.immichImportJob.findUnique({ where: { albumLinkId: linkId } });
  if (!job) return null;
  return {
    status: job.status as ImportJobDto["status"],
    totalAssets: job.totalAssets,
    processedAssets: job.processedAssets,
    failedAssets: job.failedAssets,
    error: job.error,
  };
}

export async function estimateAlbumImport(
  userId: string,
  albumId: string,
): Promise<{ assetCount: number; totalBytes: number }> {
  const conn = await getImmichConnection(userId);
  if (!conn) return { assetCount: 0, totalBytes: 0 };

  const assets = (await createImmichClient(conn).listAlbumAssets(albumId)).filter(isImportable);

  return {
    assetCount: assets.length,
    totalBytes: assets.reduce((sum, a) => sum + (a.sizeBytes ?? 0), 0),
  };
}

/** Download one asset. Returns false on any per-asset failure. */
async function importAsset(
  client: ReturnType<typeof createImmichClient>,
  tripId: string,
  linkId: string,
  asset: ImmichAsset,
): Promise<boolean> {
  const filename = buildFilename(asset.originalFileName);
  const filePath = path.join(getTripPhotoDir(), filename);

  try {
    const upstream = await client.fetchAssetStream(asset.id, "original");
    await pipeline(upstream.stream, fs.createWriteStream(filePath));

    await prisma.tripPhoto.create({
      data: {
        tripId,
        filename,
        mimetype: asset.mimeType,
        sizeBytes: asset.sizeBytes ?? 0,
        takenAt: new Date(asset.fileCreatedAt),
        immichAssetId: asset.id,
        immichAlbumLinkId: linkId,
        lat: asset.lat,
        lon: asset.lon,
      },
    });
    return true;
  } catch (error) {
    logger.warn({
      message: "immich_import_asset_failed",
      error,
      context: { assetId: asset.id, linkId },
    });
    // Never leave bytes behind for a row that does not exist.
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (cleanupError) {
      logger.warn({ message: "immich_import_cleanup_failed", error: cleanupError });
    }
    return false;
  }
}

/**
 * Fire-and-forget. Callers must not await correctness from this — it reports
 * through the job row. It never rejects, so a failed import cannot take down
 * the request that triggered it.
 */
export async function startAlbumImport(userId: string, linkId: string): Promise<void> {
  try {
    const existing = await prisma.immichImportJob.findUnique({ where: { albumLinkId: linkId } });
    if (existing?.status === "running") {
      logger.info({ message: "immich_import_already_running", context: { linkId } });
      return;
    }

    const link = await prisma.tripImmichAlbum.findUnique({ where: { id: linkId } });
    if (!link) return;

    const conn = await getImmichConnection(userId);
    if (!conn) {
      logger.warn({ message: "immich_import_no_connection", context: { linkId } });
      return;
    }

    const runningJob = {
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      error: null,
      processedAssets: 0,
      failedAssets: 0,
    };
    await prisma.immichImportJob.upsert({
      where: { albumLinkId: linkId },
      update: runningJob,
      create: { albumLinkId: linkId, ...runningJob },
    });

    const client = createImmichClient(conn);
    let processed = 0;
    let failed = 0;

    try {
      const all = await client.listAlbumAssets(link.immichAlbumId);
      const importable = all.filter(isImportable);

      const alreadyImported = await prisma.tripPhoto.findMany({
        where: { tripId: link.tripId, immichAssetId: { not: null } },
        select: { immichAssetId: true },
      });
      const seen = new Set(alreadyImported.map((p) => p.immichAssetId));
      const todo = importable.filter((a) => !seen.has(a.id));

      await prisma.immichImportJob.update({
        where: { albumLinkId: linkId },
        data: { totalAssets: todo.length },
      });

      for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
        const chunk = todo.slice(i, i + CHUNK_SIZE);
        const results = await Promise.all(
          chunk.map((asset) => importAsset(client, link.tripId, linkId, asset)),
        );
        processed += results.filter(Boolean).length;
        failed += results.filter((ok) => !ok).length;

        await prisma.immichImportJob.update({
          where: { albumLinkId: linkId },
          data: { processedAssets: processed, failedAssets: failed },
        });
      }

      await prisma.immichImportJob.update({
        where: { albumLinkId: linkId },
        data: {
          status: "completed",
          completedAt: new Date(),
          processedAssets: processed,
          failedAssets: failed,
        },
      });
      await prisma.tripImmichAlbum.update({
        where: { id: linkId },
        data: { lastSyncedAt: new Date(), assetCount: importable.length },
      });
      invalidateAlbumAssets(userId, link.immichAlbumId);

      logger.info({
        message: "immich_import_completed",
        context: { linkId, processed, failed },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      logger.error({ message: "immich_import_failed", error, context: { linkId } });
      await prisma.immichImportJob.update({
        where: { albumLinkId: linkId },
        data: { status: "failed", error: message, completedAt: new Date() },
      });
    }
  } catch (error) {
    // Last line of defence: a fire-and-forget job must never reject.
    logger.error({ message: "immich_import_crashed", error, context: { linkId } });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/immichImport.test.ts --forceExit`
Expected: PASS — 10 tests.

- [ ] **Step 5: Typecheck, lint, commit**

`immichImport.ts` is a leaf module at this point — nothing imports it yet. Task 7 will.

```bash
cd backend && npx tsc --noEmit && npm run lint && cd ..
git add backend/src/services/immich/immichImport.ts backend/src/__tests__/immichImport.test.ts
git commit -m "feat(immich): add import pipeline with progress job and storage estimate"
```

---

## Task 16: Import routes — resync, job status, storage estimate

> **Execution order:** runs **after Task 7 and Task 8**, despite its number — it
> appends to the router Task 7 created and uses the rate limiter Task 8 added.
> It is numbered 16 (not "9R") so each task has a unique number the brief
> extractor can match; it sits here in the file because it belongs beside the
> import service it exposes.

Expose the Task-9 service over HTTP: a storage estimate for the picker, a re-sync trigger, and a job-status endpoint the gallery polls.

**Files:**
- Modify: `backend/src/routes/immich/tripAlbums.ts` (append routes)

**Interfaces:**
- Consumes: `startAlbumImport`, `estimateAlbumImport`, `getImportJob` (Task 9); `resolveTrip`, `resolveLink`, `sendImmichFailure` (Task 7); `immichImportLimiter` (Task 8).
- Produces:
  - `GET /api/v1/trips/:id/immich/estimate?albumId=<id>` → `{ assetCount, totalBytes }`
  - `POST /api/v1/trips/:id/immich/albums/:linkId/resync` → `{ job: ImportJobDto }` (202)
  - `GET /api/v1/trips/:id/immich/albums/:linkId/import-job` → `{ job: ImportJobDto | null }`

- [ ] **Step 1: Add the resync / job / estimate routes**

Append to `backend/src/routes/immich/tripAlbums.ts`, before `export default router;`. Extend the existing import of `immichImport` to bring in `estimateAlbumImport` and `getImportJob`, and import `immichImportLimiter` from `../../middleware/rateLimit`.

```typescript
/* ─── Import job: estimate, kick, poll ─── */

router.get(
  "/trips/:id/immich/estimate",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);

      const albumId = typeof req.query.albumId === "string" ? req.query.albumId : "";
      if (!albumId) throw new AppError("albumId is required", 400);

      res.json(await estimateAlbumImport(userId, albumId));
    } catch (error) {
      sendImmichFailure(res, error, next);
    }
  },
);

router.post(
  "/trips/:id/immich/albums/:linkId/resync",
  authenticate,
  requireWriteScope,
  immichImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const link = await resolveLink(tripId, req.params.linkId);
      if (link.mode !== "import") {
        throw new AppError("Only imported albums can be re-synced", 400);
      }

      void startAlbumImport(userId, link.id);

      res.status(202).json({
        job: { status: "running", totalAssets: 0, processedAssets: 0, failedAssets: 0, error: null },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/trips/:id/immich/albums/:linkId/import-job",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const link = await resolveLink(tripId, req.params.linkId);
      res.json({ job: await getImportJob(link.id) });
    } catch (error) {
      next(error);
    }
  },
);
```

- [ ] **Step 2: Re-run the whole Immich backend suite**

The route additions are covered by the existing `immichTripAlbums` and `immichImport` suites; this confirms nothing regressed.

Run: `cd backend && npx jest src/__tests__/immich --forceExit`
Expected: PASS — all Immich suites green.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && cd ..
git add backend/src/routes/immich/tripAlbums.ts
git commit -m "feat(immich): expose re-sync, import-job status and storage estimate"
```

---

## Task 10: Trip cover from an Immich asset

Two ways to set a cover from the gallery lightbox: a **live-linked** asset (cover URL = the proxy URL) or a **local** photo — an upload or an imported copy (cover URL = the existing file URL). Unlinking an album whose live asset provides the cover must clear it, not leave a dangling image.

Both routes live in a new file: `routes/trips.ts` is at the 800-line cap, and `POST /trips/:id/photos/:photoId/cover` — though not Immich-specific — has nowhere else to go without breaking that rule.

**Files:**
- Create: `backend/src/routes/immich/tripCover.ts`
- Modify: `backend/src/routes/immich/tripAlbums.ts` (clear an orphaned cover on unlink)
- Modify: `backend/src/index.ts` (mount)
- Test: `backend/src/__tests__/immichTripCover.test.ts`

**Interfaces:**
- Consumes: `resolveTrip` (Task 7); `getImmichConnection` (Task 4); `createImmichClient` (Task 3); `getCachedAlbumAssets` (Task 5); `assetIdParamSchema` (Task 2).
- Produces:
  - `POST /api/v1/trips/:id/immich/cover` body `{ linkId: string; assetId: string }` → `{ coverImageUrl: string }`
  - `POST /api/v1/trips/:id/photos/:photoId/cover` → `{ coverImageUrl: string }`
  - `setCoverSchema` in `backend/src/schemas/immich.ts`
  - `function immichCoverUrl(tripId: string, linkId: string, assetId: string): string`

- [ ] **Step 1: Add the schema**

Append to `backend/src/schemas/immich.ts`:

```typescript
export const setCoverSchema = z
  .object({
    linkId: z.string().uuid(),
    assetId: z.string().uuid(),
  })
  .strict();
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/__tests__/immichTripCover.test.ts`:

```typescript
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const resolveTrip = jest.fn(async () => ({ id: "trip-1" }));
jest.mock("../routes/trips", () => ({ resolveTrip }));

const findFirstLink = jest.fn();
const findFirstPhoto = jest.fn();
const tripUpdate = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    tripImmichAlbum: { findFirst: findFirstLink },
    tripPhoto: { findFirst: findFirstPhoto },
    trip: { update: tripUpdate },
  },
}));

const listAlbumAssets = jest.fn();
jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ listAlbumAssets }),
}));

const getImmichConnection = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection }));

import { clearImmichAssetCache } from "../services/immich/immichAssetCache";
import tripCoverRouter from "../routes/immich/tripCover";
import { errorHandler } from "../middleware/errorHandler";

const LINK_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ASSET_ID = "22222222-2222-4222-8222-222222222222";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = "u1";
    next();
  });
  app.use("/api/v1", tripCoverRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearImmichAssetCache();
  getImmichConnection.mockResolvedValue({ baseUrl: "https://immich.lan", apiKey: "k", source: "user" });
  findFirstLink.mockResolvedValue({ id: LINK_ID, tripId: "trip-1", immichAlbumId: "a1", mode: "link" });
  listAlbumAssets.mockResolvedValue([
    { id: ASSET_ID, type: "IMAGE", fileCreatedAt: "2026-05-01T00:00:00.000Z", originalFileName: "p.jpg", mimeType: "image/jpeg", sizeBytes: 1, lat: null, lon: null },
  ]);
  tripUpdate.mockResolvedValue({});
});

describe("POST /trips/:id/immich/cover", () => {
  it("stores the preview proxy URL as the cover", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: ASSET_ID });

    const expected = `/api/v1/trips/trip-1/immich/albums/${LINK_ID}/assets/${ASSET_ID}/file?size=preview`;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ coverImageUrl: expected });
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      data: { coverImageUrl: expected },
    });
  });

  it("refuses an asset that is not in the linked album", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: OTHER_ASSET_ID });

    expect(res.status).toBe(404);
    expect(tripUpdate).not.toHaveBeenCalled();
  });

  it("refuses a link belonging to another trip", async () => {
    findFirstLink.mockResolvedValue(null);
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: ASSET_ID });
    expect(res.status).toBe(404);
  });

  it("rejects a non-UUID assetId with 400", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trips/trip-1/immich/cover")
      .send({ linkId: LINK_ID, assetId: "../../etc/passwd" });
    expect(res.status).toBe(400);
  });
});

describe("POST /trips/:id/photos/:photoId/cover", () => {
  it("stores the local file URL for an upload or imported copy", async () => {
    findFirstPhoto.mockResolvedValue({ id: "photo-1" });

    const res = await request(makeApp()).post("/api/v1/trips/trip-1/photos/photo-1/cover");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ coverImageUrl: "/api/v1/trips/trip-1/photos/photo-1/file" });
  });

  it("404s for a photo belonging to another trip", async () => {
    findFirstPhoto.mockResolvedValue(null);
    const res = await request(makeApp()).post("/api/v1/trips/trip-1/photos/photo-x/cover");
    expect(res.status).toBe(404);
    expect(tripUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx jest src/__tests__/immichTripCover.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../routes/immich/tripCover'`.

- [ ] **Step 4: Write `backend/src/routes/immich/tripCover.ts`**

```typescript
/**
 * Set a trip's cover from the gallery lightbox.
 *
 * A live-linked asset's cover is the proxy URL — nothing is copied, so the
 * cover stays a reference. A local photo (manual upload or imported copy) uses
 * the existing file route. Both simply write `Trip.coverImageUrl`.
 *
 * `POST /trips/:id/photos/:photoId/cover` is not Immich-specific, but
 * `routes/trips.ts` is at the 800-line hard cap, so it lands here next to its
 * sibling rather than growing a file that is already too big.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { resolveTrip } from "../trips";
import { setCoverSchema } from "../../schemas/immich";
import { createImmichClient } from "../../services/immich/immichClient";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { getCachedAlbumAssets } from "../../services/immich/immichAssetCache";
import { ImmichError } from "../../services/immich/types";
import logger from "../../utils/logger";

const router = Router();

export function immichCoverUrl(tripId: string, linkId: string, assetId: string): string {
  return `/api/v1/trips/${tripId}/immich/albums/${linkId}/assets/${assetId}/file?size=preview`;
}

router.post(
  "/trips/:id/immich/cover",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const { linkId, assetId } = setCoverSchema.parse(req.body);

      const link = await prisma.tripImmichAlbum.findFirst({
        where: { id: linkId, tripId },
        select: { id: true, immichAlbumId: true },
      });
      if (!link) throw new AppError("Linked album not found", 404);

      const conn = await getImmichConnection(userId);
      if (!conn) throw new AppError("No Immich connection configured", 409);

      // The asset must belong to this album — same boundary the proxy enforces.
      const assets = await getCachedAlbumAssets(userId, link.immichAlbumId, () =>
        createImmichClient(conn).listAlbumAssets(link.immichAlbumId),
      );
      if (!assets.some((a) => a.id === assetId)) {
        throw new AppError("Asset not found in this album", 404);
      }

      const coverImageUrl = immichCoverUrl(tripId, link.id, assetId);
      await prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl } });

      logger.info({ message: "immich_cover_set", context: { tripId, linkId: link.id } });
      res.json({ coverImageUrl });
    } catch (error) {
      if (error instanceof ImmichError) {
        res.status(502).json({ error: error.kind, message: error.message });
        return;
      }
      next(error);
    }
  },
);

router.post(
  "/trips/:id/photos/:photoId/cover",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const photo = await prisma.tripPhoto.findFirst({
        where: { id: req.params.photoId, tripId },
        select: { id: true },
      });
      if (!photo) throw new AppError("Photo not found", 404);

      const coverImageUrl = `/api/v1/trips/${tripId}/photos/${photo.id}/file`;
      await prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl } });

      res.json({ coverImageUrl });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
```

- [ ] **Step 5: Clear an orphaned cover on unlink**

In `backend/src/routes/immich/tripAlbums.ts`, inside the `DELETE .../albums/:linkId` handler, immediately before `await prisma.tripImmichAlbum.delete(...)`:

```typescript
      // A live cover points at this link's proxy URL. Deleting the link would
      // leave the trip card rendering a 404 image, so clear it first.
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: { coverImageUrl: true },
      });
      if (trip?.coverImageUrl?.includes(`/immich/albums/${link.id}/`)) {
        await prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl: null } });
      }
```

Add `trip: { findUnique: jest.fn(), update: jest.fn() }` to the `jest.mock("../db")` block in `backend/src/__tests__/immichTripAlbums.test.ts`, and add this test to its `DELETE` describe block:

```typescript
  it("clears the trip cover when the unlinked album provided it", async () => {
    const { prisma } = jest.requireMock("../db") as {
      prisma: { trip: { findUnique: jest.Mock; update: jest.Mock } };
    };
    prisma.trip.findUnique.mockResolvedValue({
      coverImageUrl: "/api/v1/trips/trip-1/immich/albums/link-1/assets/x/file?size=preview",
    });

    await request(makeApp()).delete("/api/v1/trips/trip-1/immich/albums/link-1");

    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      data: { coverImageUrl: null },
    });
  });
```

- [ ] **Step 6: Mount the router**

In `backend/src/index.ts`:

```typescript
import immichTripCoverRoutes from './routes/immich/tripCover';
// …
app.use('/api/v1', immichTripCoverRoutes);
```

- [ ] **Step 7: Run the backend Immich suite**

Run: `cd backend && npx jest src/__tests__/immich --forceExit`
Expected: PASS — every Immich suite, including the new cover tests.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
cd backend && npx tsc --noEmit && npm run lint && cd ..
git add backend/src/routes/immich/tripCover.ts backend/src/routes/immich/tripAlbums.ts \
        backend/src/schemas/immich.ts backend/src/index.ts \
        backend/src/__tests__/immichTripCover.test.ts backend/src/__tests__/immichTripAlbums.test.ts
git commit -m "feat(immich): set trip cover from a linked or imported photo"
```

---

## Task 11: Frontend types and API client

**Files:**
- Create: `frontend/src/types/immich.ts`
- Create: `frontend/src/lib/api/immich.ts`
- Modify: `frontend/src/lib/api/index.ts` (re-export, matching the existing barrel)
- Test: `frontend/src/lib/api/__tests__/immich.test.ts`

**Interfaces:**
- Consumes: the shared axios instance — `import { api } from "./client"`, exactly as `lib/api/trips.ts` does. It already sets `withCredentials: true`.
- Produces:
  - `type ImmichMode = "link" | "import"`
  - `interface ImmichConnectionStatus { baseUrl: string | null; hasKey: boolean; defaultMode: ImmichMode; source: "user" | "global" | "env" | null; isShared: boolean; hasAccess: boolean }`
  - `interface ImmichTestResult { success: boolean; message: string; details?: { version?: string; user?: string } }`
  - `interface ImmichAlbumSummary { id: string; albumName: string; assetCount: number; thumbnailAssetId: string | null; linked: boolean; linkId: string | null }`
  - `interface LinkedAlbum { id: string; immichAlbumId: string; albumName: string; assetCount: number; thumbnailAssetId: string | null; mode: ImmichMode; sortIdx: number; lastSyncedAt: string | null }`
  - `interface ImmichGalleryAsset { id: string; url: string; previewUrl: string; takenAt: string | null; lat: number | null; lon: number | null }`
  - `interface ImportJob { status: "pending" | "running" | "completed" | "failed"; totalAssets: number; processedAssets: number; failedAssets: number; error: string | null }`
  - `type ImmichFailureKind = "notConfigured" | "unreachable" | "auth" | "notFound" | "protocol"`
  - `immichApi` with: `getSettings`, `updateSettings`, `testConnection`, `getAdminSettings`, `updateAdminSettings`, `testAdminConnection`, `listAlbums`, `linkAlbums`, `unlinkAlbum`, `getAlbumAssets`, `resyncAlbum`, `getImportJob`, `estimateImport`, `setImmichCover`, `setPhotoCover`
  - `function immichFailureKind(error: unknown): ImmichFailureKind | null`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/api/__tests__/immich.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock("../client", () => ({ api: { get, post, put, delete: del } }));

import { immichApi, immichFailureKind } from "../immich";

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
});

describe("immichApi settings", () => {
  it("reads the connection status", async () => {
    get.mockResolvedValue({ data: { baseUrl: "https://immich.lan", hasKey: true } });
    await expect(immichApi.getSettings()).resolves.toMatchObject({ hasKey: true });
    expect(get).toHaveBeenCalledWith("/settings/immich");
  });

  it("sends a null apiKey to clear the stored key", async () => {
    await immichApi.updateSettings({ apiKey: null });
    expect(put).toHaveBeenCalledWith("/settings/immich", { apiKey: null });
  });

  it("tests an ad-hoc pair", async () => {
    await immichApi.testConnection({ baseUrl: "https://x.lan", apiKey: "k" });
    expect(post).toHaveBeenCalledWith("/settings/immich/test", {
      baseUrl: "https://x.lan",
      apiKey: "k",
    });
  });
});

describe("immichApi trip albums", () => {
  it("lists albums for the picker", async () => {
    await immichApi.listAlbums("trip-1");
    expect(get).toHaveBeenCalledWith("/trips/trip-1/immich/albums");
  });

  it("links albums with their per-album mode", async () => {
    await immichApi.linkAlbums("trip-1", [{ immichAlbumId: "a1", mode: "import" }]);
    expect(post).toHaveBeenCalledWith("/trips/trip-1/immich/albums", {
      albums: [{ immichAlbumId: "a1", mode: "import" }],
    });
  });

  it("passes deleteCopies through as a query param", async () => {
    await immichApi.unlinkAlbum("trip-1", "link-1", true);
    expect(del).toHaveBeenCalledWith("/trips/trip-1/immich/albums/link-1?deleteCopies=true");

    await immichApi.unlinkAlbum("trip-1", "link-1", false);
    expect(del).toHaveBeenCalledWith("/trips/trip-1/immich/albums/link-1?deleteCopies=false");
  });

  it("requests an import estimate for one album", async () => {
    await immichApi.estimateImport("trip-1", "a1");
    expect(get).toHaveBeenCalledWith("/trips/trip-1/immich/estimate?albumId=a1");
  });

  it("kicks a resync and polls the job", async () => {
    await immichApi.resyncAlbum("trip-1", "link-1");
    expect(post).toHaveBeenCalledWith("/trips/trip-1/immich/albums/link-1/resync");

    await immichApi.getImportJob("trip-1", "link-1");
    expect(get).toHaveBeenCalledWith("/trips/trip-1/immich/albums/link-1/import-job");
  });

  it("sets a cover from a live asset and from a local photo", async () => {
    await immichApi.setImmichCover("trip-1", "link-1", "asset-1");
    expect(post).toHaveBeenCalledWith("/trips/trip-1/immich/cover", {
      linkId: "link-1",
      assetId: "asset-1",
    });

    await immichApi.setPhotoCover("trip-1", "photo-1");
    expect(post).toHaveBeenCalledWith("/trips/trip-1/photos/photo-1/cover");
  });
});

describe("immichFailureKind", () => {
  it("extracts the kind from a 409 notConfigured", () => {
    expect(immichFailureKind({ response: { status: 409, data: { error: "notConfigured" } } })).toBe(
      "notConfigured",
    );
  });

  it("extracts the kind from a 502 upstream failure", () => {
    expect(immichFailureKind({ response: { status: 502, data: { error: "auth" } } })).toBe("auth");
  });

  it("returns null for an unrelated error", () => {
    expect(immichFailureKind(new Error("boom"))).toBeNull();
    expect(immichFailureKind({ response: { status: 500, data: {} } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/lib/api/__tests__/immich.test.ts`
Expected: FAIL — cannot resolve `../immich`.

- [ ] **Step 3: Write `frontend/src/types/immich.ts`**

```typescript
export type ImmichMode = "link" | "import";

export type ImmichConnectionSource = "user" | "global" | "env";

export interface ImmichConnectionStatus {
  baseUrl: string | null;
  hasKey: boolean;
  defaultMode: ImmichMode;
  source: ImmichConnectionSource | null;
  isShared: boolean;
  hasAccess: boolean;
}

export interface ImmichTestResult {
  success: boolean;
  message: string;
  details?: { version?: string; user?: string };
}

export interface ImmichAlbumSummary {
  id: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  linked: boolean;
  linkId: string | null;
}

export interface LinkedAlbum {
  id: string;
  immichAlbumId: string;
  albumName: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  mode: ImmichMode;
  sortIdx: number;
  lastSyncedAt: string | null;
}

export interface ImmichGalleryAsset {
  id: string;
  url: string;
  previewUrl: string;
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
}

export interface ImportJob {
  status: "pending" | "running" | "completed" | "failed";
  totalAssets: number;
  processedAssets: number;
  failedAssets: number;
  error: string | null;
}

export interface ImportEstimate {
  assetCount: number;
  totalBytes: number;
}

/**
 * Why an Immich-backed request failed. `notConfigured` comes back as 409 from
 * our own API; the rest are upstream kinds surfaced as 502.
 */
export type ImmichFailureKind =
  | "notConfigured"
  | "unreachable"
  | "auth"
  | "notFound"
  | "protocol";
```

- [ ] **Step 4: Write `frontend/src/lib/api/immich.ts`**

```typescript
import { api } from "./client";
import type {
  ImmichAlbumSummary,
  ImmichConnectionStatus,
  ImmichFailureKind,
  ImmichGalleryAsset,
  ImmichMode,
  ImmichTestResult,
  ImportEstimate,
  ImportJob,
  LinkedAlbum,
} from "../../types/immich";

const FAILURE_KINDS: readonly ImmichFailureKind[] = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
];

/**
 * Pull the machine-readable kind out of a failed Immich request so the gallery
 * can render a specific degraded panel instead of a generic error toast.
 */
export function immichFailureKind(error: unknown): ImmichFailureKind | null {
  if (typeof error !== "object" || error === null) return null;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  const kind = response?.data?.error;
  return typeof kind === "string" && (FAILURE_KINDS as readonly string[]).includes(kind)
    ? (kind as ImmichFailureKind)
    : null;
}

export const immichApi = {
  async getSettings(): Promise<ImmichConnectionStatus> {
    const { data } = await api.get("/settings/immich");
    return data;
  },

  async updateSettings(payload: {
    baseUrl?: string | null;
    apiKey?: string | null;
    defaultMode?: ImmichMode;
  }): Promise<ImmichConnectionStatus> {
    const { data } = await api.put("/settings/immich", payload);
    return data;
  },

  async testConnection(payload: { baseUrl?: string; apiKey?: string }): Promise<ImmichTestResult> {
    const { data } = await api.post("/settings/immich/test", payload);
    return data;
  },

  async getAdminSettings(): Promise<{ baseUrl: string | null; apiKey: string | null }> {
    const { data } = await api.get("/admin/immich");
    return data;
  },

  async updateAdminSettings(payload: {
    baseUrl?: string | null;
    apiKey?: string | null;
  }): Promise<{ baseUrl: string | null; apiKey: string | null }> {
    const { data } = await api.put("/admin/immich", payload);
    return data;
  },

  async testAdminConnection(payload: {
    baseUrl?: string;
    apiKey?: string;
  }): Promise<ImmichTestResult> {
    const { data } = await api.post("/admin/immich/test", payload);
    return data;
  },

  async listAlbums(
    tripId: string,
  ): Promise<{ albums: ImmichAlbumSummary[]; defaultMode: ImmichMode }> {
    const { data } = await api.get(`/trips/${tripId}/immich/albums`);
    return data;
  },

  async linkAlbums(
    tripId: string,
    albums: Array<{ immichAlbumId: string; mode: ImmichMode }>,
  ): Promise<{ links: LinkedAlbum[] }> {
    const { data } = await api.post(`/trips/${tripId}/immich/albums`, { albums });
    return data;
  },

  async unlinkAlbum(tripId: string, linkId: string, deleteCopies: boolean): Promise<void> {
    await api.delete(`/trips/${tripId}/immich/albums/${linkId}?deleteCopies=${deleteCopies}`);
  },

  async getAlbumAssets(
    tripId: string,
    linkId: string,
  ): Promise<{ assets: ImmichGalleryAsset[] }> {
    const { data } = await api.get(`/trips/${tripId}/immich/albums/${linkId}/assets`);
    return data;
  },

  async resyncAlbum(tripId: string, linkId: string): Promise<{ job: ImportJob }> {
    const { data } = await api.post(`/trips/${tripId}/immich/albums/${linkId}/resync`);
    return data;
  },

  async getImportJob(tripId: string, linkId: string): Promise<{ job: ImportJob | null }> {
    const { data } = await api.get(`/trips/${tripId}/immich/albums/${linkId}/import-job`);
    return data;
  },

  async estimateImport(tripId: string, albumId: string): Promise<ImportEstimate> {
    const { data } = await api.get(`/trips/${tripId}/immich/estimate?albumId=${albumId}`);
    return data;
  },

  async setImmichCover(
    tripId: string,
    linkId: string,
    assetId: string,
  ): Promise<{ coverImageUrl: string }> {
    const { data } = await api.post(`/trips/${tripId}/immich/cover`, { linkId, assetId });
    return data;
  },

  async setPhotoCover(tripId: string, photoId: string): Promise<{ coverImageUrl: string }> {
    const { data } = await api.post(`/trips/${tripId}/photos/${photoId}/cover`);
    return data;
  },
};
```

- [ ] **Step 5: Re-export from the barrel**

`frontend/src/lib/api/index.ts` re-exports every sibling module. Add, next to the other `export * from` lines:

```typescript
export * from "./immich";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest --run src/lib/api/__tests__/immich.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint && cd ..
git add frontend/src/types/immich.ts frontend/src/lib/api/immich.ts \
        frontend/src/lib/api/index.ts frontend/src/lib/api/__tests__/immich.test.ts
git commit -m "feat(immich): add frontend types and API client"
```

---

## Task 12: i18n namespace + Immich connection card (settings)

Strings live in a new `immich` namespace, mirroring the per-feature namespace files under `frontend/src/i18n/resources/{de,en}/`. **DE is written first, EN mirrored in the same commit** — never one without the other.

**Files:**
- Create: `frontend/src/i18n/resources/de/immich.json`
- Create: `frontend/src/i18n/resources/en/immich.json`
- Modify: `frontend/src/i18n/config.ts` (register the namespace)
- Create: `frontend/src/components/Settings/ImmichConnectionCard.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx` (render the card)
- Test: `frontend/src/components/Settings/__tests__/ImmichConnectionCard.test.tsx`

**Interfaces:**
- Consumes: `immichApi` (Task 11); `useTranslation` from `../../hooks/useTranslation` (signature: `useTranslation(namespace?: string | string[]) => { t, i18n, ready }`).
- Produces: `ImmichConnectionCard` (default export), taking no props.

- [ ] **Step 1: Write both translation files**

`frontend/src/i18n/resources/de/immich.json`:

```json
{
  "title": "Immich",
  "subtitle": "Fotos aus deiner eigenen Immich-Instanz verknüpfen",
  "baseUrl": "Server-URL",
  "baseUrlPlaceholder": "https://immich.example.com",
  "apiKey": "API-Schlüssel",
  "apiKeyPlaceholder": "In Immich unter Konto → API-Schlüssel erstellen",
  "apiKeyStored": "Ein Schlüssel ist gespeichert",
  "clearKey": "Schlüssel entfernen",
  "save": "Speichern",
  "saving": "Speichern …",
  "test": "Verbindung testen",
  "testing": "Teste …",
  "connected": "Verbunden · v{{version}}",
  "shared": "Vom Administrator bereitgestellt",
  "notConfigured": "Keine Immich-Verbindung eingerichtet",
  "defaultMode": "Standard beim Verknüpfen",
  "modeLink": "Verlinken",
  "modeImport": "Kopieren",
  "modeLinkHint": "Fotos bleiben in Immich — kein zusätzlicher Speicher.",
  "modeImportHint": "Fotos werden kopiert und liegen im Backup.",
  "albums": {
    "link": "Immich-Album verknüpfen",
    "pickerTitle": "Alben auswählen",
    "alreadyLinked": "Bereits verknüpft",
    "photoCount": "{{count}} Foto",
    "photoCount_other": "{{count}} Fotos",
    "estimate": "Benötigt etwa {{size}}",
    "confirm": "{{count}} Album verknüpfen",
    "confirm_other": "{{count}} Alben verknüpfen",
    "cancel": "Abbrechen",
    "empty": "Keine Alben in Immich gefunden",
    "unlink": "Trennen",
    "unlinkTitle": "Album trennen",
    "unlinkKeepCopies": "Kopien behalten",
    "unlinkDeleteCopies": "Kopien löschen",
    "resync": "Neu synchronisieren",
    "resyncing": "Synchronisiere … {{done}}/{{total}}",
    "lastSynced": "Zuletzt: {{date}}",
    "badgeLink": "live",
    "badgeImport": "Kopie"
  },
  "gallery": {
    "uploaded": "Hochgeladen",
    "setAsCover": "Als Titelbild",
    "coverSet": "Titelbild gesetzt",
    "previous": "Vorheriges Foto",
    "next": "Nächstes Foto",
    "close": "Schließen"
  },
  "errors": {
    "notConfigured": "Keine Immich-Verbindung eingerichtet.",
    "unreachable": "Immich ist nicht erreichbar.",
    "auth": "Immich hat den API-Schlüssel abgelehnt.",
    "notFound": "Album nicht gefunden — wurde es in Immich gelöscht?",
    "protocol": "Unerwartete Antwort von Immich. Passt die Server-Version?",
    "retry": "Erneut versuchen"
  }
}
```

`frontend/src/i18n/resources/en/immich.json`:

```json
{
  "title": "Immich",
  "subtitle": "Link photos from your own Immich instance",
  "baseUrl": "Server URL",
  "baseUrlPlaceholder": "https://immich.example.com",
  "apiKey": "API key",
  "apiKeyPlaceholder": "Create one in Immich under Account → API Keys",
  "apiKeyStored": "A key is stored",
  "clearKey": "Remove key",
  "save": "Save",
  "saving": "Saving…",
  "test": "Test connection",
  "testing": "Testing…",
  "connected": "Connected · v{{version}}",
  "shared": "Provided by the administrator",
  "notConfigured": "No Immich connection configured",
  "defaultMode": "Default when linking",
  "modeLink": "Link",
  "modeImport": "Copy",
  "modeLinkHint": "Photos stay in Immich — no extra storage.",
  "modeImportHint": "Photos are copied and included in backups.",
  "albums": {
    "link": "Link Immich album",
    "pickerTitle": "Select albums",
    "alreadyLinked": "Already linked",
    "photoCount": "{{count}} photo",
    "photoCount_other": "{{count}} photos",
    "estimate": "Needs about {{size}}",
    "confirm": "Link {{count}} album",
    "confirm_other": "Link {{count}} albums",
    "cancel": "Cancel",
    "empty": "No albums found in Immich",
    "unlink": "Unlink",
    "unlinkTitle": "Unlink album",
    "unlinkKeepCopies": "Keep copies",
    "unlinkDeleteCopies": "Delete copies",
    "resync": "Re-sync",
    "resyncing": "Syncing… {{done}}/{{total}}",
    "lastSynced": "Last: {{date}}",
    "badgeLink": "live",
    "badgeImport": "copy"
  },
  "gallery": {
    "uploaded": "Uploaded",
    "setAsCover": "Set as cover",
    "coverSet": "Cover updated",
    "previous": "Previous photo",
    "next": "Next photo",
    "close": "Close"
  },
  "errors": {
    "notConfigured": "No Immich connection configured.",
    "unreachable": "Immich is unreachable.",
    "auth": "Immich rejected the API key.",
    "notFound": "Album not found — was it deleted in Immich?",
    "protocol": "Unexpected response from Immich. Does the server version match?",
    "retry": "Try again"
  }
}
```

- [ ] **Step 2: Register the namespace**

In `frontend/src/i18n/config.ts`, add the two imports next to their siblings and the `immich` entry to both the `en` and `de` resource objects:

```typescript
import enImmich from "./resources/en/immich.json";
import deImmich from "./resources/de/immich.json";
```

```typescript
// inside resources.en
immich: enImmich,
// inside resources.de
immich: deImmich,
```

- [ ] **Step 3: Write the failing test**

Create `frontend/src/components/Settings/__tests__/ImmichConnectionCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getSettings = vi.fn();
const updateSettings = vi.fn();
const testConnection = vi.fn();
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getSettings, updateSettings, testConnection },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

import ImmichConnectionCard from "../ImmichConnectionCard";

const CONFIGURED = {
  baseUrl: "https://immich.lan",
  hasKey: true,
  defaultMode: "link" as const,
  source: "user" as const,
  isShared: false,
  hasAccess: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue(CONFIGURED);
  updateSettings.mockResolvedValue(CONFIGURED);
  testConnection.mockResolvedValue({ success: true, message: "ok", details: { version: "1.138.2" } });
});

describe("ImmichConnectionCard", () => {
  it("loads the stored URL and shows that a key exists without revealing it", async () => {
    render(<ImmichConnectionCard />);

    await waitFor(() => {
      expect(screen.getByLabelText("baseUrl")).toHaveValue("https://immich.lan");
    });
    expect(screen.getByText("apiKeyStored")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
  });

  it("saves the URL, key and default mode together", async () => {
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.type(screen.getByLabelText("apiKey"), "new-key");
    await user.click(screen.getByRole("radio", { name: "modeImport" }));
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        baseUrl: "https://immich.lan",
        apiKey: "new-key",
        defaultMode: "import",
      }),
    );
  });

  it("omits apiKey from the payload when the field was left empty", async () => {
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0][0]).not.toHaveProperty("apiKey");
  });

  it("clears the stored key by sending an explicit null", async () => {
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "clearKey" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ apiKey: null }));
  });

  it("shows the server version after a successful test", async () => {
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "test" }));

    await waitFor(() => expect(screen.getByText("connected")).toBeInTheDocument());
  });

  it("surfaces the failure message when the test fails", async () => {
    testConnection.mockResolvedValue({ success: false, message: "Immich rejected the API key" });
    const user = userEvent.setup();
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "test" }));

    await waitFor(() =>
      expect(screen.getByText("Immich rejected the API key")).toBeInTheDocument(),
    );
  });

  it("marks a globally-provided connection as shared", async () => {
    getSettings.mockResolvedValue({ ...CONFIGURED, source: "global", isShared: true });
    render(<ImmichConnectionCard />);
    await waitFor(() => expect(screen.getByText("shared")).toBeInTheDocument());
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Settings/__tests__/ImmichConnectionCard.test.tsx`
Expected: FAIL — cannot resolve `../ImmichConnectionCard`.

- [ ] **Step 5: Write `frontend/src/components/Settings/ImmichConnectionCard.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { immichApi } from "../../lib/api/immich";
import type { ImmichConnectionStatus, ImmichMode, ImmichTestResult } from "../../types/immich";

/**
 * User-facing Immich connection settings.
 *
 * The API key is write-only: the backend returns `hasKey`, never the value, so
 * an empty key field means "leave the stored key alone" and the explicit
 * "remove key" action sends `null`.
 */
export default function ImmichConnectionCard(): JSX.Element {
  const { t } = useTranslation("immich");

  const [status, setStatus] = useState<ImmichConnectionStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultMode, setDefaultMode] = useState<ImmichMode>("link");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ImmichTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: ImmichConnectionStatus) => {
    setStatus(next);
    setBaseUrl(next.baseUrl ?? "");
    setDefaultMode(next.defaultMode);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await immichApi.getSettings();
        if (!cancelled) apply(next);
      } catch {
        if (!cancelled) setError(t("errors.unreachable"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, t]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      // An untouched key field must not overwrite the stored key.
      const payload: { baseUrl: string; defaultMode: ImmichMode; apiKey?: string } = {
        baseUrl,
        defaultMode,
      };
      if (apiKey.trim() !== "") payload.apiKey = apiKey.trim();

      apply(await immichApi.updateSettings(payload));
      setApiKey("");
    } catch {
      setError(t("errors.unreachable"));
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async (): Promise<void> => {
    setSaving(true);
    try {
      apply(await immichApi.updateSettings({ apiKey: null }));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const trimmed = apiKey.trim();
      setTestResult(
        await immichApi.testConnection(trimmed === "" ? { baseUrl } : { baseUrl, apiKey: trimmed }),
      );
    } catch {
      setTestResult({ success: false, message: t("errors.unreachable") });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <header className="mb-3">
        <h3 className="text-lg font-semibold">{t("title")}</h3>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
        {status?.isShared && <span className="text-xs text-amber-400">{t("shared")}</span>}
      </header>

      <label className="block text-sm" htmlFor="immich-base-url">
        {t("baseUrl")}
      </label>
      <input
        id="immich-base-url"
        aria-label="baseUrl"
        className="mb-3 w-full rounded border border-slate-600 bg-slate-900 p-2"
        placeholder={t("baseUrlPlaceholder")}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />

      <label className="block text-sm" htmlFor="immich-api-key">
        {t("apiKey")}
      </label>
      <input
        id="immich-api-key"
        aria-label="apiKey"
        type="password"
        autoComplete="off"
        className="w-full rounded border border-slate-600 bg-slate-900 p-2"
        placeholder={t("apiKeyPlaceholder")}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      {status?.hasKey && (
        <div className="mb-3 mt-1 flex items-center gap-2 text-xs text-slate-400">
          <span>{t("apiKeyStored")}</span>
          <button type="button" className="underline" onClick={() => void handleClearKey()}>
            {t("clearKey")}
          </button>
        </div>
      )}

      <fieldset className="my-3">
        <legend className="text-sm">{t("defaultMode")}</legend>
        {(["link", "import"] as const).map((mode) => (
          <label key={mode} className="mr-4 inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="immich-default-mode"
              aria-label={mode === "link" ? "modeLink" : "modeImport"}
              checked={defaultMode === mode}
              onChange={() => setDefaultMode(mode)}
            />
            {mode === "link" ? t("modeLink") : t("modeImport")}
          </label>
        ))}
        <p className="text-xs text-slate-400">
          {defaultMode === "link" ? t("modeLinkHint") : t("modeImportHint")}
        </p>
      </fieldset>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          className="rounded bg-sky-600 px-3 py-1.5 text-sm"
          onClick={() => void handleSave()}
        >
          {saving ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          disabled={testing}
          className="rounded border border-slate-600 px-3 py-1.5 text-sm"
          onClick={() => void handleTest()}
        >
          {testing ? t("testing") : t("test")}
        </button>
      </div>

      {testResult && (
        <p className={`mt-2 text-sm ${testResult.success ? "text-emerald-400" : "text-rose-400"}`}>
          {testResult.success
            ? t("connected", { version: testResult.details?.version ?? "?" })
            : testResult.message}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 6: Render it in the settings page**

In `frontend/src/pages/SettingsPage.tsx`, import the card and render it in the same section as the API-key cards:

```tsx
import ImmichConnectionCard from "../components/Settings/ImmichConnectionCard";
// …
<ImmichConnectionCard />
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd frontend && npx vitest --run src/components/Settings/__tests__/ImmichConnectionCard.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint && cd ..
git add frontend/src/i18n frontend/src/components/Settings/ImmichConnectionCard.tsx \
        frontend/src/pages/SettingsPage.tsx \
        frontend/src/components/Settings/__tests__/ImmichConnectionCard.test.tsx
git commit -m "feat(immich): add connection settings card with DE/EN copy"
```

---

## Task 13: Album picker modal

Multi-select, per-album mode toggle pre-filled from the user's `defaultMode`, and a storage estimate shown **before** confirming an import (spec §6).

**Files:**
- Create: `frontend/src/components/Trips/ImmichAlbumPicker.tsx`
- Test: `frontend/src/components/Trips/__tests__/ImmichAlbumPicker.test.tsx`

**Interfaces:**
- Consumes: `immichApi.listAlbums`, `immichApi.estimateImport`, `immichApi.linkAlbums` (Task 11); `immichFailureKind` (Task 11).
- Produces: `ImmichAlbumPicker` (default export) with props `{ tripId: string; onClose: () => void; onLinked: () => void }`.
- Also produces `formatBytes(bytes: number): string` exported from the same file (used by the picker's estimate line).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Trips/__tests__/ImmichAlbumPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listAlbums = vi.fn();
const estimateImport = vi.fn();
const linkAlbums = vi.fn();
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { listAlbums, estimateImport, linkAlbums },
  immichFailureKind: (e: unknown) =>
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null,
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

import ImmichAlbumPicker, { formatBytes } from "../ImmichAlbumPicker";

const ALBUMS = [
  { id: "a1", albumName: "Rome", assetCount: 12, thumbnailAssetId: "t1", linked: false, linkId: null },
  { id: "a2", albumName: "Oslo", assetCount: 4, thumbnailAssetId: null, linked: true, linkId: "l2" },
];

beforeEach(() => {
  vi.clearAllMocks();
  listAlbums.mockResolvedValue({ albums: ALBUMS, defaultMode: "link" });
  estimateImport.mockResolvedValue({ assetCount: 12, totalBytes: 25_000_000 });
  linkAlbums.mockResolvedValue({ links: [] });
});

describe("formatBytes", () => {
  it("renders human-readable sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(25_000_000)).toBe("23.8 MB");
    expect(formatBytes(3_221_225_472)).toBe("3.0 GB");
  });
});

describe("ImmichAlbumPicker", () => {
  const renderPicker = () =>
    render(<ImmichAlbumPicker tripId="trip-1" onClose={vi.fn()} onLinked={vi.fn()} />);

  it("lists albums and disables the ones already linked", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());

    expect(screen.getByRole("checkbox", { name: /Rome/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Oslo/ })).toBeDisabled();
    expect(screen.getByText("albums.alreadyLinked")).toBeInTheDocument();
  });

  it("links the selected album in the default mode", async () => {
    const onLinked = vi.fn();
    render(<ImmichAlbumPicker tripId="trip-1" onClose={vi.fn()} onLinked={onLinked} />);
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));
    await user.click(screen.getByRole("button", { name: /albums.confirm/ }));

    await waitFor(() =>
      expect(linkAlbums).toHaveBeenCalledWith("trip-1", [{ immichAlbumId: "a1", mode: "link" }]),
    );
    expect(onLinked).toHaveBeenCalled();
  });

  it("fetches and shows a storage estimate only when an album is switched to import", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));
    expect(estimateImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "modeImport" }));

    await waitFor(() => expect(estimateImport).toHaveBeenCalledWith("trip-1", "a1"));
    await waitFor(() => expect(screen.getByText("albums.estimate")).toBeInTheDocument());
  });

  it("does not link anything when nothing is selected", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /albums.confirm/ })).toBeDisabled();
    expect(linkAlbums).not.toHaveBeenCalled();
  });

  it("shows a degraded panel when Immich is unconfigured", async () => {
    listAlbums.mockRejectedValue({ response: { data: { error: "notConfigured" } } });
    renderPicker();
    await waitFor(() => expect(screen.getByText("errors.notConfigured")).toBeInTheDocument());
  });

  it("shows an empty state when Immich has no albums", async () => {
    listAlbums.mockResolvedValue({ albums: [], defaultMode: "link" });
    renderPicker();
    await waitFor(() => expect(screen.getByText("albums.empty")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/ImmichAlbumPicker.test.tsx`
Expected: FAIL — cannot resolve `../ImmichAlbumPicker`.

- [ ] **Step 3: Write `frontend/src/components/Trips/ImmichAlbumPicker.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { immichApi, immichFailureKind } from "../../lib/api/immich";
import type { ImmichAlbumSummary, ImmichFailureKind, ImmichMode } from "../../types/immich";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  return exponent === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[exponent]}`;
}

interface Props {
  tripId: string;
  onClose: () => void;
  onLinked: () => void;
}

interface Selection {
  mode: ImmichMode;
  estimateBytes: number | null;
}

/**
 * Multi-select album picker. Import mode is the expensive choice, so its
 * storage cost is fetched lazily — only for albums the user actually flips to
 * "copy" — and shown before the link is confirmed.
 */
export default function ImmichAlbumPicker({ tripId, onClose, onLinked }: Props): JSX.Element {
  const { t } = useTranslation("immich");

  const [albums, setAlbums] = useState<ImmichAlbumSummary[]>([]);
  const [defaultMode, setDefaultMode] = useState<ImmichMode>("link");
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  const [failure, setFailure] = useState<ImmichFailureKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await immichApi.listAlbums(tripId);
        if (cancelled) return;
        setAlbums(data.albums);
        setDefaultMode(data.defaultMode);
      } catch (error) {
        if (!cancelled) setFailure(immichFailureKind(error) ?? "unreachable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const toggle = (albumId: string): void => {
    setSelected((prev) => {
      if (prev[albumId]) {
        const { [albumId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [albumId]: { mode: defaultMode, estimateBytes: null } };
    });
  };

  const setMode = async (albumId: string, mode: ImmichMode): Promise<void> => {
    setSelected((prev) => ({ ...prev, [albumId]: { mode, estimateBytes: null } }));
    if (mode !== "import") return;

    // Only "copy" costs disk, so only "copy" pays for an estimate round-trip.
    const estimate = await immichApi.estimateImport(tripId, albumId);
    setSelected((prev) =>
      prev[albumId] ? { ...prev, [albumId]: { mode, estimateBytes: estimate.totalBytes } } : prev,
    );
  };

  const handleConfirm = async (): Promise<void> => {
    setLinking(true);
    try {
      await immichApi.linkAlbums(
        tripId,
        Object.entries(selected).map(([immichAlbumId, s]) => ({ immichAlbumId, mode: s.mode })),
      );
      onLinked();
      onClose();
    } catch (error) {
      setFailure(immichFailureKind(error) ?? "unreachable");
    } finally {
      setLinking(false);
    }
  };

  const count = Object.keys(selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-slate-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">{t("albums.pickerTitle")}</h2>

        {failure && <p className="text-sm text-rose-400">{t(`errors.${failure}`)}</p>}
        {!loading && !failure && albums.length === 0 && (
          <p className="text-sm text-slate-400">{t("albums.empty")}</p>
        )}

        <ul className="space-y-2">
          {albums.map((album) => {
            const selection = selected[album.id];
            return (
              <li key={album.id} className="rounded border border-slate-700 p-2">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={album.albumName}
                    disabled={album.linked}
                    checked={Boolean(selection)}
                    onChange={() => toggle(album.id)}
                  />
                  <span className="flex-1">
                    <span className="block">{album.albumName}</span>
                    <span className="block text-xs text-slate-400">
                      {t("albums.photoCount", { count: album.assetCount })}
                    </span>
                  </span>
                  {album.linked && (
                    <span className="text-xs text-slate-500">{t("albums.alreadyLinked")}</span>
                  )}
                </label>

                {selection && (
                  <div className="mt-2 flex items-center gap-2 pl-7">
                    {(["link", "import"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-label={mode === "link" ? "modeLink" : "modeImport"}
                        aria-pressed={selection.mode === mode}
                        className={`rounded px-2 py-0.5 text-xs ${
                          selection.mode === mode ? "bg-sky-600" : "border border-slate-600"
                        }`}
                        onClick={() => void setMode(album.id, mode)}
                      >
                        {mode === "link" ? t("modeLink") : t("modeImport")}
                      </button>
                    ))}
                    {selection.estimateBytes !== null && (
                      <span className="text-xs text-amber-400">
                        {t("albums.estimate", { size: formatBytes(selection.estimateBytes) })}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <footer className="mt-4 flex justify-end gap-2">
          <button type="button" className="px-3 py-1.5 text-sm" onClick={onClose}>
            {t("albums.cancel")}
          </button>
          <button
            type="button"
            disabled={count === 0 || linking}
            className="rounded bg-sky-600 px-3 py-1.5 text-sm disabled:opacity-40"
            onClick={() => void handleConfirm()}
          >
            {t("albums.confirm", { count })}
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/ImmichAlbumPicker.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint && cd ..
git add frontend/src/components/Trips/ImmichAlbumPicker.tsx \
        frontend/src/components/Trips/__tests__/ImmichAlbumPicker.test.tsx
git commit -m "feat(immich): add album picker with per-album mode and storage estimate"
```

---

## Task 14: Extracted lightbox with prev/next and set-as-cover

`TripGallery.tsx` currently holds an inline `Lightbox` (lines 169–207) with no navigation. Extract it, add prev/next and "set as trip cover", and make it work for both local photos and proxied Immich assets.

**Files:**
- Create: `frontend/src/components/Trips/PhotoLightbox.tsx`
- Modify: `frontend/src/components/Trips/TripGallery.tsx` (delete the inline `Lightbox`, import the new one)
- Test: `frontend/src/components/Trips/__tests__/PhotoLightbox.test.tsx`

**Interfaces:**
- Consumes: `immichApi.setImmichCover`, `immichApi.setPhotoCover` (Task 11).
- Produces:
  - `interface LightboxItem { id: string; previewUrl: string; caption?: string | null; source: { kind: "photo" } | { kind: "immich"; linkId: string } }`
  - `PhotoLightbox` (default export) with props `{ tripId: string; items: LightboxItem[]; startIndex: number; onClose: () => void; onCoverChanged?: (coverImageUrl: string) => void }`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Trips/__tests__/PhotoLightbox.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setImmichCover = vi.fn();
const setPhotoCover = vi.fn();
vi.mock("../../../lib/api/immich", () => ({ immichApi: { setImmichCover, setPhotoCover } }));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

import PhotoLightbox, { type LightboxItem } from "../PhotoLightbox";

const ITEMS: LightboxItem[] = [
  { id: "p1", previewUrl: "/p1.jpg", caption: "First", source: { kind: "photo" } },
  { id: "a1", previewUrl: "/a1.jpg", caption: null, source: { kind: "immich", linkId: "link-1" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  setImmichCover.mockResolvedValue({ coverImageUrl: "/cover-immich" });
  setPhotoCover.mockResolvedValue({ coverImageUrl: "/cover-photo" });
});

const renderBox = (startIndex = 0, onCoverChanged = vi.fn()) =>
  render(
    <PhotoLightbox
      tripId="trip-1"
      items={ITEMS}
      startIndex={startIndex}
      onClose={vi.fn()}
      onCoverChanged={onCoverChanged}
    />,
  );

describe("PhotoLightbox", () => {
  it("shows the item at startIndex", () => {
    renderBox(1);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a1.jpg");
  });

  it("navigates with the next/previous buttons and wraps around", async () => {
    const user = userEvent.setup();
    renderBox(0);

    await user.click(screen.getByRole("button", { name: "gallery.next" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a1.jpg");

    await user.click(screen.getByRole("button", { name: "gallery.next" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/p1.jpg");

    await user.click(screen.getByRole("button", { name: "gallery.previous" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a1.jpg");
  });

  it("navigates with the arrow keys and closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <PhotoLightbox tripId="trip-1" items={ITEMS} startIndex={0} onClose={onClose} />,
    );

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a1.jpg");

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("sets a local photo as the cover", async () => {
    const onCoverChanged = vi.fn();
    const user = userEvent.setup();
    renderBox(0, onCoverChanged);

    await user.click(screen.getByRole("button", { name: "gallery.setAsCover" }));

    await waitFor(() => expect(setPhotoCover).toHaveBeenCalledWith("trip-1", "p1"));
    expect(setImmichCover).not.toHaveBeenCalled();
    expect(onCoverChanged).toHaveBeenCalledWith("/cover-photo");
  });

  it("sets a live Immich asset as the cover using its link id", async () => {
    const user = userEvent.setup();
    renderBox(1);

    await user.click(screen.getByRole("button", { name: "gallery.setAsCover" }));

    await waitFor(() => expect(setImmichCover).toHaveBeenCalledWith("trip-1", "link-1", "a1"));
    expect(setPhotoCover).not.toHaveBeenCalled();
  });

  it("renders nothing for an empty item list", () => {
    const { container } = render(
      <PhotoLightbox tripId="trip-1" items={[]} startIndex={0} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/PhotoLightbox.test.tsx`
Expected: FAIL — cannot resolve `../PhotoLightbox`.

- [ ] **Step 3: Write `frontend/src/components/Trips/PhotoLightbox.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { immichApi } from "../../lib/api/immich";

export interface LightboxItem {
  id: string;
  previewUrl: string;
  caption?: string | null;
  /** A local `TripPhoto`, or a live asset proxied from a linked album. */
  source: { kind: "photo" } | { kind: "immich"; linkId: string };
}

interface Props {
  tripId: string;
  items: LightboxItem[];
  startIndex: number;
  onClose: () => void;
  onCoverChanged?: (coverImageUrl: string) => void;
}

/**
 * Full-screen viewer shared by uploaded photos and linked Immich assets. The
 * only difference between the two is which endpoint sets the cover — the
 * image itself is just a URL, proxied or local.
 */
export default function PhotoLightbox({
  tripId,
  items,
  startIndex,
  onClose,
  onCoverChanged,
}: Props): JSX.Element | null {
  const { t } = useTranslation("immich");
  const [index, setIndex] = useState(startIndex);
  const [coverSet, setCoverSet] = useState(false);

  const step = useCallback(
    (delta: number) => {
      setCoverSet(false);
      setIndex((prev) => (prev + delta + items.length) % items.length);
    },
    [items.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  if (items.length === 0) return null;
  const item = items[index];

  const handleSetCover = async (): Promise<void> => {
    const result =
      item.source.kind === "immich"
        ? await immichApi.setImmichCover(tripId, item.source.linkId, item.id)
        : await immichApi.setPhotoCover(tripId, item.id);

    setCoverSet(true);
    onCoverChanged?.(result.coverImageUrl);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div className="relative max-h-[85vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <img src={item.previewUrl} alt={item.caption ?? ""} className="max-h-[85vh] object-contain" />

        {items.length > 1 && (
          <>
            <button
              type="button"
              aria-label={t("gallery.previous")}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2"
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={t("gallery.next")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2"
              onClick={() => step(1)}
            >
              ›
            </button>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {item.caption && <span className="text-sm text-slate-300">{item.caption}</span>}
        <button
          type="button"
          aria-label={t("gallery.setAsCover")}
          className="rounded border border-slate-500 px-3 py-1 text-sm"
          onClick={() => void handleSetCover()}
        >
          {coverSet ? t("gallery.coverSet") : t("gallery.setAsCover")}
        </button>
        <button
          type="button"
          aria-label={t("gallery.close")}
          className="rounded border border-slate-500 px-3 py-1 text-sm"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Remove the inline lightbox from `TripGallery.tsx`**

Delete the local `Lightbox` function (currently lines ~169–207) and its render site, and replace the render with:

```tsx
import PhotoLightbox, { type LightboxItem } from "./PhotoLightbox";
// …
{lightbox && (
  <PhotoLightbox
    tripId={tripId}
    items={uploadedItems}
    startIndex={lightbox.index}
    onClose={() => setLightbox(null)}
    onCoverChanged={() => onChange()}
  />
)}
```

where `uploadedItems` maps the existing `photos` prop:

```tsx
const uploadedItems: LightboxItem[] = photos.map((p) => ({
  id: p.id,
  previewUrl: p.url,
  caption: p.caption,
  source: { kind: "photo" },
}));
```

and `lightbox` state changes from `TripPhoto | null` to `{ index: number } | null`, set by `PhotoTile`'s click handler via its array index.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest --run src/components/Trips`
Expected: PASS — the new lightbox suite plus any existing TripGallery tests.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint && cd ..
git add frontend/src/components/Trips/PhotoLightbox.tsx frontend/src/components/Trips/TripGallery.tsx \
        frontend/src/components/Trips/__tests__/PhotoLightbox.test.tsx
git commit -m "feat(immich): extract lightbox, add prev/next and set-as-cover"
```

---

## Task 15: Grouped gallery — album sections, degraded state, re-sync

The last piece: the trip gallery grows an "Uploaded" section plus one section per linked album, each with a `live`/`Kopie` badge, unlink, and (for import mode) re-sync with progress. A link-mode section whose Immich is unreachable shows a degraded panel — the rest of the gallery keeps working (spec §7).

**Files:**
- Create: `frontend/src/components/Trips/ImmichAlbumSection.tsx`
- Modify: `frontend/src/components/Trips/TripGallery.tsx` (render sections + "Link Immich album" button)
- Modify: `frontend/src/pages/TripDetailPage.tsx` (pass `immichAlbums` from the trip payload)
- Modify: `backend/src/routes/trips.ts` (include `immichAlbums` in `GET /trips/:id`)
- Modify: `frontend/src/types/index.ts` (`Trip.immichAlbums?: LinkedAlbum[]`)
- Test: `frontend/src/components/Trips/__tests__/ImmichAlbumSection.test.tsx`

**Interfaces:**
- Consumes: `immichApi.getAlbumAssets`, `immichApi.unlinkAlbum`, `immichApi.resyncAlbum`, `immichApi.getImportJob`, `immichFailureKind` (Task 11); `PhotoLightbox`, `LightboxItem` (Task 14).
- Produces: `ImmichAlbumSection` (default export) with props `{ tripId: string; album: LinkedAlbum; onChanged: () => void }`.

- [ ] **Step 1: Include the links in the trip payload**

In `backend/src/routes/trips.ts`, the `GET /trips/:id` handler (lines ~239–269) already selects `photos`. Add `immichAlbums` to the same Prisma `include`, and pass it through in the response:

```typescript
      include: {
        photos: true,
        immichAlbums: { orderBy: { sortIdx: "asc" } },
        // … existing includes unchanged
      },
```

In `frontend/src/types/index.ts`, extend the `Trip` interface:

```typescript
import type { LinkedAlbum } from "./immich";
// …
  immichAlbums?: LinkedAlbum[];
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/Trips/__tests__/ImmichAlbumSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getAlbumAssets = vi.fn();
const unlinkAlbum = vi.fn();
const resyncAlbum = vi.fn();
const getImportJob = vi.fn();
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getAlbumAssets, unlinkAlbum, resyncAlbum, getImportJob },
  immichFailureKind: (e: unknown) =>
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null,
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

vi.mock("../PhotoLightbox", () => ({ default: () => <div data-testid="lightbox" /> }));

import ImmichAlbumSection from "../ImmichAlbumSection";
import type { LinkedAlbum } from "../../../types/immich";

const LINK_ALBUM: LinkedAlbum = {
  id: "link-1",
  immichAlbumId: "a1",
  albumName: "Rome",
  assetCount: 2,
  thumbnailAssetId: null,
  mode: "link",
  sortIdx: 0,
  lastSyncedAt: null,
};

const IMPORT_ALBUM: LinkedAlbum = { ...LINK_ALBUM, id: "link-2", mode: "import" };

const ASSETS = [
  { id: "p1", url: "/t1.jpg", previewUrl: "/p1.jpg", takenAt: null, lat: null, lon: null },
  { id: "p2", url: "/t2.jpg", previewUrl: "/p2.jpg", takenAt: null, lat: null, lon: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  getAlbumAssets.mockResolvedValue({ assets: ASSETS });
  unlinkAlbum.mockResolvedValue(undefined);
  resyncAlbum.mockResolvedValue({ job: { status: "running" } });
  getImportJob.mockResolvedValue({ job: null });
});

describe("ImmichAlbumSection", () => {
  it("renders the album header with a live badge and its tiles", async () => {
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.getByText("Rome")).toBeInTheDocument();
    expect(screen.getByText("albums.badgeLink")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "albums.resync" })).not.toBeInTheDocument();
  });

  it("shows a copy badge and a re-sync button for import mode", async () => {
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("albums.badgeImport")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "albums.resync" })).toBeInTheDocument();
  });

  it("renders a degraded panel instead of tiles when Immich is unreachable", async () => {
    getAlbumAssets.mockRejectedValue({ response: { data: { error: "unreachable" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.unreachable")).toBeInTheDocument());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "errors.retry" })).toBeInTheDocument();
  });

  it("offers unlink for a deleted album", async () => {
    getAlbumAssets.mockRejectedValue({ response: { data: { error: "notFound" } } });
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("errors.notFound")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "albums.unlink" })).toBeInTheDocument();
  });

  it("unlinks a link-mode album without asking about copies", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ImmichAlbumSection tripId="trip-1" album={LINK_ALBUM} onChanged={onChanged} />);
    await waitFor(() => expect(getAlbumAssets).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "albums.unlink" }));

    await waitFor(() => expect(unlinkAlbum).toHaveBeenCalledWith("trip-1", "link-1", false));
    expect(onChanged).toHaveBeenCalled();
  });

  it("asks whether to delete the copies when unlinking an import-mode album", async () => {
    const user = userEvent.setup();
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(getAlbumAssets).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "albums.unlink" }));
    expect(unlinkAlbum).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "albums.unlinkDeleteCopies" }));
    await waitFor(() => expect(unlinkAlbum).toHaveBeenCalledWith("trip-1", "link-2", true));
  });

  it("kicks a re-sync and polls the job until it completes", async () => {
    getImportJob
      .mockResolvedValueOnce({ job: { status: "running", totalAssets: 2, processedAssets: 1, failedAssets: 0, error: null } })
      .mockResolvedValue({ job: { status: "completed", totalAssets: 2, processedAssets: 2, failedAssets: 0, error: null } });

    const user = userEvent.setup();
    render(<ImmichAlbumSection tripId="trip-1" album={IMPORT_ALBUM} onChanged={vi.fn()} />);
    await waitFor(() => expect(getAlbumAssets).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "albums.resync" }));

    await waitFor(() => expect(resyncAlbum).toHaveBeenCalledWith("trip-1", "link-2"));
    await waitFor(() => expect(screen.getByText("albums.resyncing")).toBeInTheDocument());
    await waitFor(
      () => expect(screen.getByRole("button", { name: "albums.resync" })).toBeEnabled(),
      { timeout: 4000 },
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Trips/__tests__/ImmichAlbumSection.test.tsx`
Expected: FAIL — cannot resolve `../ImmichAlbumSection`.

- [ ] **Step 4: Write `frontend/src/components/Trips/ImmichAlbumSection.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { immichApi, immichFailureKind } from "../../lib/api/immich";
import type { ImmichFailureKind, ImmichGalleryAsset, LinkedAlbum } from "../../types/immich";
import PhotoLightbox, { type LightboxItem } from "./PhotoLightbox";

const JOB_POLL_MS = 1500;

interface Props {
  tripId: string;
  album: LinkedAlbum;
  onChanged: () => void;
}

/**
 * One gallery section for one linked album.
 *
 * A failing link-mode album degrades to a panel rather than taking the whole
 * gallery down — the user's uploads and their other albums stay visible.
 */
export default function ImmichAlbumSection({ tripId, album, onChanged }: Props): JSX.Element {
  const { t } = useTranslation("immich");

  const [assets, setAssets] = useState<ImmichGalleryAsset[]>([]);
  const [failure, setFailure] = useState<ImmichFailureKind | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setFailure(null);
    try {
      const data = await immichApi.getAlbumAssets(tripId, album.id);
      setAssets(data.assets);
    } catch (error) {
      setFailure(immichFailureKind(error) ?? "unreachable");
    }
  }, [tripId, album.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // A running import must be reflected even if the user reloads mid-sync.
  useEffect(() => {
    if (album.mode !== "import") return;
    void (async () => {
      const { job } = await immichApi.getImportJob(tripId, album.id);
      if (job?.status === "running") startPolling();
    })();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, album.id, album.mode]);

  const stopPolling = (): void => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const startPolling = (): void => {
    setSyncing(true);
    stopPolling();
    pollRef.current = setInterval(() => {
      void (async () => {
        const { job } = await immichApi.getImportJob(tripId, album.id);
        if (!job) return;
        setProgress({ done: job.processedAssets, total: job.totalAssets });
        if (job.status === "completed" || job.status === "failed") {
          stopPolling();
          setSyncing(false);
          setProgress(null);
          await load();
          onChanged();
        }
      })();
    }, JOB_POLL_MS);
  };

  const handleResync = async (): Promise<void> => {
    await immichApi.resyncAlbum(tripId, album.id);
    startPolling();
  };

  const handleUnlink = async (deleteCopies: boolean): Promise<void> => {
    await immichApi.unlinkAlbum(tripId, album.id, deleteCopies);
    setConfirmingUnlink(false);
    onChanged();
  };

  const onUnlinkClick = (): void => {
    // Only import mode has bytes on disk worth asking about.
    if (album.mode === "import") setConfirmingUnlink(true);
    else void handleUnlink(false);
  };

  const items: LightboxItem[] = assets.map((a) => ({
    id: a.id,
    previewUrl: a.previewUrl,
    source: album.mode === "import" ? { kind: "photo" } : { kind: "immich", linkId: album.id },
  }));

  return (
    <section className="mt-6">
      <header className="mb-2 flex items-center gap-3">
        <h3 className="font-semibold">{album.albumName}</h3>
        <span className="text-xs text-slate-400">
          {t("albums.photoCount", { count: album.assetCount })}
        </span>
        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs">
          {album.mode === "import" ? t("albums.badgeImport") : t("albums.badgeLink")}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {album.mode === "import" && (
            <button
              type="button"
              aria-label={t("albums.resync")}
              disabled={syncing}
              className="text-xs underline disabled:opacity-40"
              onClick={() => void handleResync()}
            >
              {syncing && progress
                ? t("albums.resyncing", { done: progress.done, total: progress.total })
                : t("albums.resync")}
            </button>
          )}
          <button
            type="button"
            aria-label={t("albums.unlink")}
            className="text-xs underline"
            onClick={onUnlinkClick}
          >
            {t("albums.unlink")}
          </button>
        </div>
      </header>

      {confirmingUnlink && (
        <div className="mb-2 flex gap-2 rounded border border-slate-600 p-2 text-sm">
          <span className="flex-1">{t("albums.unlinkTitle")}</span>
          <button
            type="button"
            aria-label={t("albums.unlinkKeepCopies")}
            className="underline"
            onClick={() => void handleUnlink(false)}
          >
            {t("albums.unlinkKeepCopies")}
          </button>
          <button
            type="button"
            aria-label={t("albums.unlinkDeleteCopies")}
            className="text-rose-400 underline"
            onClick={() => void handleUnlink(true)}
          >
            {t("albums.unlinkDeleteCopies")}
          </button>
        </div>
      )}

      {failure ? (
        <div className="rounded border border-slate-700 bg-slate-900/60 p-4 text-sm">
          <p className="text-rose-400">{t(`errors.${failure}`)}</p>
          {failure !== "notFound" && (
            <button type="button" aria-label={t("errors.retry")} className="mt-2 underline" onClick={() => void load()}>
              {t("errors.retry")}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
          {assets.map((asset, index) => (
            <button key={asset.id} type="button" onClick={() => setLightboxIndex(index)}>
              <img
                src={asset.url}
                alt={album.albumName}
                loading="lazy"
                className="aspect-square w-full rounded object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <PhotoLightbox
          tripId={tripId}
          items={items}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onCoverChanged={() => onChanged()}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 5: Wire the sections into `TripGallery.tsx`**

Add an `immichAlbums: LinkedAlbum[]` prop, a "Link Immich album" button that opens `ImmichAlbumPicker`, wrap the existing grid in a section titled `t("gallery.uploaded")`, and render one `ImmichAlbumSection` per album:

```tsx
{immichAlbums.map((album) => (
  <ImmichAlbumSection key={album.id} tripId={tripId} album={album} onChanged={onChange} />
))}
```

In `frontend/src/pages/TripDetailPage.tsx`, pass it through:

```tsx
<TripGallery
  tripId={shownTrip.id}
  photos={shownTrip.photos ?? []}
  immichAlbums={shownTrip.immichAlbums ?? []}
  onChange={() => void load()}
/>
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npx vitest --run`
Expected: PASS — all suites, including the new Immich ones.

- [ ] **Step 7: Full build checks (both sides)**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit && cd ..
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run && cd ..
```

Expected: all green. This is the gate before UAT.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Trips/ImmichAlbumSection.tsx frontend/src/components/Trips/TripGallery.tsx \
        frontend/src/pages/TripDetailPage.tsx frontend/src/types/index.ts \
        backend/src/routes/trips.ts \
        frontend/src/components/Trips/__tests__/ImmichAlbumSection.test.tsx
git commit -m "feat(immich): group the trip gallery by album with degraded state and re-sync"
```

---

## Manual smoke test (UAT — after Task 15)

CI never talks to a real Immich (spec §9). Before this branch is considered done, run once against a live instance:

1. In Immich, create an API key (Account → API Keys).
2. Settings → Immich: paste URL + key → **Test connection** shows `Connected · vX.Y.Z`.
3. Open a trip → **Link Immich album** → pick one album in `link` mode → confirm.
   - Tiles load. Network tab shows `…/file?size=thumbnail` returning `200` once, then `304` on reload.
   - Check the server: `getTripPhotoDir()` gained **no** files.
4. Click a tile → lightbox → prev/next → **Set as cover** → the trip card shows the Immich image.
5. Link a second album in `import` mode → the storage estimate appears before confirming → progress runs → photos appear.
   - Check the server: the files **are** on the data volume, and appear in a fresh backup.
6. Re-sync the imported album → no duplicates are created.
7. Add a photo to that album in Immich → re-sync → only the new photo downloads.
8. Stop Immich → reload the trip → the link-mode section shows "Immich ist nicht erreichbar." with a retry, the uploads section still renders.
9. Unlink the imported album with **Kopien behalten** → photos remain as ordinary uploads.
10. Unlink an album that provided the cover → the trip card falls back gracefully, no broken image.

---

## Self-review notes

Checked against the spec, section by section:

- §3 data model → Task 1, plus the `ImmichImportJob` table the spec omitted (justified in "Deviations").
- §4.1 resolver → Task 4. §4.2 client → Task 3 (with the `search/metadata` correction). §4.3 cache → Task 5. §4.4 import → Task 9. §4.5 endpoints → Tasks 6, 7, 8, 9, 10.
- §5 image-serving → Task 8 (proxy, no server-side image cache, browser ETag).
- §6 frontend → Tasks 11–15. §7 degradation → Tasks 8 (placeholder PNG), 13, 15 (degraded panel). §8 security → Tasks 2 (URL normalisation), 6 (key never returned), 7/8/10 (ownership + membership).
- §9 testing → every task is TDD; the live-Immich smoke is the UAT block above.
- §11 constraints → Global Constraints; no task touches `backend/VERSION` or `CHANGELOG.md`.
- §12 deferred → nothing here implements shared links, faces, video, or write-back.
- Phase B (`searchByDateRange`, `/immich/suggest`) and Phase C (`/photo-map`, `lat`/`lon` consumers) are deliberately absent; the Task-1 data model already carries `lat`/`lon` so neither needs a migration later.

Naming is consistent across tasks: `ImmichMode`, `ImmichAssetSize`, `ImmichConnection{,Source}`, `ImmichError.kind`, `createImmichClient`, `listAlbumAssets`, `getCachedAlbumAssets`, `startAlbumImport`, `LinkedAlbum`, `ImmichGalleryAsset`, `LightboxItem`.
