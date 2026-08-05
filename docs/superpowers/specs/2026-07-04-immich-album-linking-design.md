# Immich Album Integration — Design Spec

**Date:** 2026-07-04
**Issue:** #154 "Link Immich Album"
**Branch:** `dev/immich-albums` (long-running, off `main`, releases ~v2.6)
**Status:** Design — pending user review before implementation planning

## 1. Overview

Let users pull photos from their self-hosted [Immich](https://immich.app)
instance into TravStats trips instead of re-uploading them. A trip can link one
or more Immich albums; each linked album is either **live-linked** (a reference
only — photos proxied from Immich on demand, nothing stored) or **imported** (a
one-time local copy, stored like a normal upload, included in backups). The
choice has a per-user default and is overridable per album.

Built on top of this: TravStats suggests albums/photos by the trip's date range,
and plots geotagged photos on the trip map — leveraging data TravStats already
has (trip dates, maps) against Immich's metadata (timestamps, EXIF GPS).

### Goals

- Link Immich albums to a trip without duplicating storage (the core ask).
- Offer an explicit **copy** mode for users who want photos in their backups /
  available offline.
- Photos from linked albums render in the trip gallery next to uploads, grouped
  per album, and degrade gracefully when Immich is unreachable.
- Reuse existing patterns: encrypted API-key storage, the User→Global→ENV
  resolver, the trip-photo gallery, the upload/serve pipeline.

### Non-Goals (this feature) — deferred to the roadmap (§12)

Shared-album (unauthenticated) links, faces→companions, photos for
cruises/flights, per-journal-day photos, video, writing back to Immich.

### Phasing (build order on the branch; released together)

- **Phase A — Foundation & linking:** connection + settings, data model,
  album picker, link/copy modes, grouped gallery, image proxy, degraded
  handling, lightbox, cover-from-Immich, re-sync + storage estimate.
- **Phase B — Date-based auto-suggest:** suggest albums/photos overlapping the
  trip's date range.
- **Phase C — Photos on the map:** plot geotagged photos on the trip map/globe.

Each phase gets its own implementation plan; this spec is the shared contract so
the Phase-A data model already accommodates B and C.

## 2. Existing code this builds on

- **`TripPhoto`** (`schema.prisma`): `id, tripId, filename, mimetype, sizeBytes,
  caption, takenAt, sortIdx, createdAt`; files on disk via `getTripPhotoDir()`
  (the `/app/data` volume), served by `GET /trips/:id/photos/:photoId/file`,
  uploaded via `POST /trips/:id/photos` (multer). Cover = a `TripPhoto` with the
  `__cover__` sentinel caption; `Trip.coverImageUrl` holds the cover URL.
- **API keys** (`apiKeyResolver.ts`, `utils/encryption.ts`): `encryptApiKey` /
  `decryptApiKey`; two tiers `userSettings` + `adminSettings`; resolver priority
  **User → Global → ENV**. `apiKeyTester.ts` validates a key. OpenSky shows the
  multi-field-credential pattern.
- **Upload middleware** (`middleware/upload.ts`): file validation, size limits,
  disk storage on the data volume.

## 3. Data model (Prisma migration)

**Settings — add to BOTH `userSettings` and `adminSettings`:**

| Field | Type | Notes |
|---|---|---|
| `immichBaseUrl` | `String?` | plain (not secret) — e.g. `https://immich.home.lan` |
| `immichApiKey` | `String?` | **encrypted at rest** (encryptApiKey) |

**`userSettings` only** (personal preference, not resolved through tiers):

| Field | Type | Notes |
|---|---|---|
| `immichDefaultMode` | `String` `@default("link")` | `"link"` \| `"import"` |

**New table `TripImmichAlbum`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `tripId` | `String` → `Trip` `onDelete: Cascade` | |
| `immichAlbumId` | `String` | Immich album UUID |
| `albumName` | `String` | cached label |
| `assetCount` | `Int @default(0)` | cached count |
| `thumbnailAssetId` | `String?` | cached cover asset for the section header |
| `mode` | `String @default("link")` | `"link"` \| `"import"` |
| `sortIdx` | `Int @default(0)` | |
| `lastSyncedAt` | `DateTime?` | import mode: last download/re-sync |
| `createdAt` | `DateTime @default(now())` | |

`@@unique([tripId, immichAlbumId])`, `@@index([tripId])`.

**Extend `TripPhoto`** (so imported photos and geo data have a home):

| Field | Type | Notes |
|---|---|---|
| `immichAssetId` | `String?` | set for imported photos (provenance / dedup on re-sync); null for manual uploads |
| `immichAlbumLinkId` | `String?` → `TripImmichAlbum` `onDelete: Cascade` | which linked album an imported photo belongs to (null for manual uploads) |
| `lat` | `Float?` | EXIF latitude (Phase C) — populated for imported Immich photos; best-effort for manual uploads |
| `lon` | `Float?` | EXIF longitude (Phase C) |

**Resulting semantics:**
- Manual upload: `immichAssetId=null`, `immichAlbumLinkId=null`, file on disk.
- Imported photo: `immichAssetId` set, `immichAlbumLinkId` set, file on disk
  (downloaded copy), lat/lon from EXIF.
- Live-linked album: **no `TripPhoto` rows** — assets are fetched live from
  Immich for the album section and the map.

**Migration caveat:** the repo has known schema drift (see root CLAUDE.md) that
makes `prisma migrate dev` bundle unrelated changes. The migration must be
generated/reviewed carefully (or hand-written following the existing additive
migrations) so it only adds the fields/table above. Resolved in the Phase-A
plan.

## 4. Backend architecture

### 4.1 Immich connection resolver — `services/immich/immichResolver.ts`

Mirrors `apiKeyResolver.ts`. `getImmichConnection(userId): Promise<{ baseUrl,
apiKey } | null>` resolving **User → Admin-Global → ENV**
(`IMMICH_BASE_URL` / `IMMICH_API_KEY`). Decrypts the key. Returns null when
unconfigured. `getImmichDefaultMode(userId)` reads `userSettings.immichDefaultMode`
(default `"link"`).

### 4.2 Immich API client — `services/immich/immichClient.ts`

Thin, typed wrapper around the Immich REST API (auth header `x-api-key`). One
place that knows Immich's endpoints so version drift is contained.

- `listAlbums()` → `[{ id, albumName, assetCount, albumThumbnailAssetId }]`
- `getAlbum(albumId)` → album with `assets: [{ id, type, fileCreatedAt,
  exifInfo?: { latitude, longitude } }]`
- `searchByDateRange(from, to)` → assets in a window (Phase B)
- `fetchAsset(assetId, size: "thumbnail"|"preview"|"original")` → a readable
  stream + content-type (for the proxy and for downloads)
- `ping()` / `whoami()` → connection validation (Phase A settings test)

**Version note:** Immich's API has shifted across versions (e.g. `/api/asset`
→ `/api/assets`). The plan pins a documented Immich API version, and the client
surfaces a clear error if the server responds unexpectedly (feeds the "test
connection" message).

### 4.3 Album asset-list cache

A small in-memory TTL cache (per `{userId, albumId}`, ~60s) of the album→assets
listing, so opening a trip repeatedly doesn't re-list Immich every render. Images
themselves are **not** cached server-side (see §5).

### 4.4 Import pipeline — `services/immich/immichImport.ts`

For `mode="import"`: download each album asset's `original` via the client,
validate (reuse `fileValidation`), store on the data volume like an upload, and
create a `TripPhoto` row (`immichAssetId`, `immichAlbumLinkId`, `lat/lon` from
EXIF). Idempotent by `immichAssetId` (re-sync only fetches assets not already
imported). Runs as a tracked background job with progress; large albums are
chunked. A **storage estimate** (sum of asset sizes from Immich metadata) is
returned to the UI before confirming an import.

### 4.5 Endpoints (all `authenticate` + trip-ownership; write ops `requireWriteScope`)

**Settings**
- `GET /settings/immich` → `{ baseUrl, hasKey, defaultMode, source }` (never the key)
- `PUT /settings/immich` → set `baseUrl` / `apiKey` / `defaultMode`
- `POST /settings/immich/test` → validate URL+key (via `whoami`), return server version
- `GET|PUT /admin/immich`, `POST /admin/immich/test` → global connection (admin only)

**Trip ↔ albums**
- `GET /trips/:id/immich/albums` → user's Immich albums for the picker (mark
  already-linked)
- `GET /trips/:id/immich/suggest` → albums + loose photo count overlapping the
  trip's `[startDate, endDate]` (Phase B)
- `POST /trips/:id/immich/albums` → body `[{ immichAlbumId, mode }]`; creates
  `TripImmichAlbum` rows; `import` mode kicks off the import job
- `DELETE /trips/:id/immich/albums/:linkId?deleteCopies=true|false` → unlink;
  for import mode, optionally delete the copied `TripPhoto` files
- `POST /trips/:id/immich/albums/:linkId/resync` → import mode: pull newly-added
  assets (dedup by `immichAssetId`), refresh cached count
- `GET /trips/:id/immich/albums/:linkId/assets` → the album's asset list for its
  gallery section (cached; link mode). Import mode reads the `TripPhoto` rows.
- `GET /trips/:id/immich/albums/:linkId/assets/:assetId/file?size=thumbnail|preview|original`
  → **image proxy** (streams from Immich; ownership-checked; strong HTTP cache
  headers)

**Cover & map**
- Cover: extend `PATCH /trips/:id` to accept an Immich asset reference for the
  cover (`coverImageUrl` stores the proxy URL for a live asset, or the local
  file URL for an imported/uploaded one). Unlinking an album that provides the
  live cover clears it gracefully.
- `GET /trips/:id/photo-map` → geolocated photos for the map layer: imported
  photos with `lat/lon`, live-linked album assets with EXIF coords, and any
  manual uploads with extracted coords → `[{ id, lat, lon, thumbUrl }]` (Phase C)

## 5. Image-serving strategy

**Live proxy, no server-side image cache** (chosen; A+C from the discussion):
the proxy fetches thumbnail/preview/original from Immich per request and streams
it through with strong `Cache-Control` + `ETag`, so the **browser** does the
caching. Server image storage stays at **zero** for link mode (true to the
no-duplicate goal). Only the album→asset **list** (metadata) is cached in memory
(§4.3). A disk thumbnail cache is explicitly deferred unless profiling shows the
proxy is a bottleneck. Import mode serves from the local copy via the existing
`TripPhoto` file route.

## 6. Frontend

- **Settings** (`pages`/settings): an **Immich connection card** next to the
  API-key cards — URL, masked key, `defaultMode` segmented control (Verlinken /
  Kopieren), "Test connection" with a status badge (Connected · vX.Y). An admin
  variant sets the global connection.
- **Trip detail** (photo section):
  - `Upload` + `Link Immich album` buttons.
  - **Album picker modal**: lists Immich albums (thumb, name, count); per-album
    mode toggle pre-filled from `defaultMode`; multi-select; import shows a
    storage estimate before confirming. A **date-suggest banner** (Phase B) at
    the top: "Immich hat N Fotos aus dem Reisezeitraum — Album X, Y".
  - **Grouped gallery**: "Uploaded" section, then one section per linked album
    (header: name · count · `live`/`Kopie` badge · Unlink; import shows
    Re-sync). Link-mode sections load tiles via the proxy; import-mode from local
    files. Degraded state per link-mode album when Immich is unreachable.
  - **Lightbox**: click a tile → enlarged view (`preview`/`original` via proxy),
    prev/next, "Set as trip cover".
  - **Photos on map** (Phase C): the trip's existing map/detail gains a photo
    layer toggle; pins from `GET /trips/:id/photo-map`, click → lightbox.
- **API client** (`lib/api`) + TS types; **i18n DE + EN together** for every new
  string.

## 7. Error handling & degradation

- Immich unreachable / key invalid → link-mode album sections show a clear
  "Immich nicht erreichbar" panel (not a gallery crash); settings test returns a
  precise message (bad URL vs auth vs version).
- Deleted album → section shows "Album nicht gefunden", offers Unlink.
- Import job failure (partial download) → the job reports which assets failed;
  successfully-imported photos remain; user can re-sync.
- Never swallow errors (project convention); the image proxy returns a small
  placeholder + a 502/504 status when Immich fails so the browser doesn't cache a
  broken image as valid.

## 8. Security

- **API key never leaves the backend** — only the proxy/import use it; settings
  responses expose `hasKey`, never the value.
- **No SSRF from client input** — the proxy only builds URLs against the stored,
  user-configured `immichBaseUrl` + validated Immich asset IDs; it never fetches
  a client-supplied URL. The base URL is set by the trusted user/admin in
  settings (self-hosted, pointing at their own Immich).
- **Ownership everywhere** — every trip/album/asset route verifies the requesting
  user owns the trip (and by extension the link).
- API key encrypted at rest; validate/normalize the base URL on save (scheme +
  host; strip trailing slash).

## 9. Testing

- **Unit:** `immichResolver` priority logic; `immichClient` against mocked Immich
  HTTP responses (albums/assets/asset stream, version-shift error); import dedup
  by `immichAssetId`; EXIF→lat/lon extraction; Phase-B date-overlap logic;
  Phase-C `photo-map` aggregation (uploads+imported+linked).
- **Integration:** link/unlink/import + ownership; proxy auth + streaming; resync
  idempotency; unlink-with/without-deleteCopies.
- **Frontend (Vitest):** picker (mode toggle, storage estimate, date-suggest
  banner), grouped gallery sections, lightbox, degraded state, cover-set, map
  layer data shaping.
- No live Immich in CI — the client is tested against fixtures; a manual smoke
  runs against a real Immich during UAT.

## 10. File structure (new/'+' modified)

```
backend/src/
  services/immich/
    immichResolver.ts     # connection + default-mode resolution
    immichClient.ts       # Immich REST wrapper (version-contained)
    immichImport.ts       # import/re-sync pipeline
    immichAssetCache.ts   # in-memory asset-list TTL cache
  routes/
    settings/immich.ts    # + user connection endpoints
    admin/immich.ts       # + global connection endpoints
    trips.ts              # + album link/unlink/resync/proxy/suggest/photo-map
  schemas/immich.ts       # Zod: connection, link body, mode enum
  utils/exif.ts           # + lat/lon extraction (Phase C)
frontend/src/
  components/trip/ImmichConnectionCard.tsx
  components/trip/ImmichAlbumPicker.tsx
  components/trip/TripGallery.tsx            # + album sections, lightbox
  components/trip/TripPhotoMapLayer.tsx      # Phase C
  lib/api/immich.ts + types/immich.ts
  i18n/de.json, en.json                      # + immich.* keys
backend/prisma/migrations/<ts>_immich_albums/  # data model (§3)
```

## 11. Constraints (inherited)

TypeScript `strict`, `any` forbidden (`unknown`+guards); Zod at boundaries;
Pino logger (no console); immutability; files 200–400 lines ideal / 800 max;
code/comments/commits English, UI copy DE+EN; **never touch `backend/VERSION` /
`CHANGELOG.md` on this branch**; sync-forward via `git merge main` after each
release.

## 12. Deferred / roadmap (explicitly out of scope)

Shared-album (unauth) link as an alternate connection mode; companions from
Immich face recognition; linking photos to cruises/flights and to per-day
journal entries; video assets; writing albums/tags back to Immich; disk
thumbnail cache (only if the proxy profiles as a bottleneck).

## 13. Open questions

None blocking. Confirmed decisions: connection User→Admin→ENV; multiple albums
per trip; grouped-by-album gallery; link/copy with per-user default +
per-album override; lightbox + cover-from-Immich in v1; date-suggest (B) and
photos-on-map (C) in v1 scope, built after A.
