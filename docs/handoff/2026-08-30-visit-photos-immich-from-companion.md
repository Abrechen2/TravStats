# Place-visit photos: make the copy replaceable by an Immich link

**From:** the Companion session (TravStatsCompanion, `main`)
**Date:** 2026-08-30
**Status:** the Companion now uploads visit photos. Everything below is what
the server would need for those uploads to *stop* being duplicates.

---

## What the Companion just shipped

The POI detail (`05c`) can attach a photograph to a place visit. It uses the
endpoints that already exist:

- `GET  /api/v1/places/visits/:visitId/photos`
- `POST /api/v1/places/visits/:visitId/photos` (multipart, field `photos`)
- `GET  /api/v1/places/visits/:visitId/photos/:photoId/file`
- `DELETE /api/v1/places/visits/:visitId/photos/:photoId`

Two deliberate choices on the app side, both made *for* this handoff:

1. **The original bytes are uploaded, unmodified.** This is the only upload in
   the Companion that does not resize or re-encode a picked image — everywhere
   else a photo is shrunk before it goes anywhere. Here the bytes are the
   identity, so that a checksum taken later still matches the asset in Immich.
   The 15 MB `TRIP_PHOTO_MAX_SIZE` ceiling accommodates a phone original.
2. **The camera's own filename travels** as the multipart part name, so
   `placePhotoStorage`'s `${uniqueSuffix}-${sanitized}${ext}` preserves it. On
   Android that is the real `IMG_20260604_101500.jpg`; on iOS the picker often
   gives none and the app falls back to the URI's last segment rather than
   inventing a shared `photo.jpg` — which would make every upload look alike to
   a matcher.

The app tells the user, in the band itself and not as small print, that the
photo now also lives on their server and that it is meant to be swapped for a
library link later. That sentence is a promise this handoff is asking you to
let us keep.

---

## What the server has today

- `PlaceVisitPhoto` carries **`immichAssetId`**, commented *"set only when
  imported from a linked album"* — and **nothing in the backend writes it**.
  A grep across `src/` finds only the route file that reads it into the DTO.
- Immich is wired for **trips only**: `TripImmichAlbum` (link | import mode),
  `routes/immich/assetProxy.ts`, `ImmichImportJob`, and the resolver's
  User → Admin-Global → ENV tiers.
- `services/photoJourneys/scan.ts` already calls `searchAssetsByDate` and keeps
  **asset ids rather than bytes**, explicitly so the library is not duplicated.
  That is the same instinct this asks for, one domain over.

So the machinery exists; what is missing for place visits is an ownership rule
and two columns.

---

## Ask 1 — identity columns on `PlaceVisitPhoto` (small, and the urgent one)

```prisma
/// SHA-1 of the uploaded original, base64 — the same encoding Immich uses for
/// `asset.checksum`, so a later migration can match exactly instead of guessing.
checksum String? @map("checksum")
/// EXIF capture time. `TripPhoto` already has this column; its absence here is
/// why a photo uploaded today can only be matched on name and size.
takenAt DateTime? @map("taken_at")
```

Computed server-side on upload (the bytes are already on disk in the multer
handler — no client change needed, and a client-supplied checksum would be
unverified anyway).

**Why this is the urgent half:** every photo uploaded before these columns
exist can only ever be matched heuristically — original filename, size,
`createdAt`. That works often and not always. Every photo uploaded *after* them
can be matched exactly. The window is the only thing that gets worse by
waiting.

---

## Ask 2 — the ownership rule for a proxy without an album

This is the actual design question, and it is a security question rather than a
UI one.

`assetProxy.ts` checks: *you own the trip **and** the asset is a member of that
linked album*. The comment says why — otherwise owning any trip would turn the
proxy into an arbitrary-asset reader. A place visit has no album, so that rule
does not carry over.

Three shapes, in the order I would rank them:

1. **The row is the grant.** Proxy at
   `/places/visits/:visitId/photos/:photoId/file`, unchanged path, and the
   check is: the visit is yours, the photo belongs to that visit, and the
   asset id streamed is *the one stored on that row*. No client-supplied asset
   id is ever fetched. This inherits the existing ownership story exactly
   (read off the visit, never off the photo) and cannot be widened by a caller.
2. **A per-user allow-list of assets the user's own connection returned**,
   written when a search answers. More general, more state, and it grants
   reads for assets nobody attached to anything.
3. **Trust the album membership of some "place photos" album.** Mirrors trips,
   but forces the user to curate an album per place, which nobody will.

Shape 1 needs no new table and no new grant concept. It is what I would build.

---

## Ask 3 — the swap, and the feature it unlocks

**Migration:** for each `PlaceVisitPhoto` with `checksum != null` and
`immichAssetId == null`, ask the user's Immich connection whether it holds that
checksum. On a hit: set `immichAssetId`, delete the file from
`PLACE_PHOTO_DIR`, keep the row. The row's id, caption and sort index do not
move, so nothing on any client has to know this happened.

**The feature this really unlocks** — and the reason the Companion asked in the
first place: a visit has a *date* and *coordinates*. With `searchAssetsByDate`
and the EXIF lat/lon already used by `photoJourneys`, the server can answer

```
GET /api/v1/places/visits/:visitId/photos/suggestions
→ { suggestions: [{ assetId, takenAt, distanceM, thumbnailUrl }] }
```

*"You have six photos from that day within 2 km of this place."* The Companion
would render them the way it renders `02j` hunches: evidence first, the person
confirms, nothing attaches on its own. Read-only, like
`curated/:key/suggestions` — and for the same documented reason.

---

## What NOT to do

- **Do not give the phone Immich credentials.** The resolver's three tiers exist
  so the key lives in one place, encrypted. A second copy on a device would be
  a downgrade for a feature the server can already proxy.
- **Do not make `PlaceVisitPhoto` polymorphic with `TripPhoto`.** The route
  file's own header argues this at length and is right: a shared owner column
  reaches into the import job, the resync ordering invariant and the proxy's
  ownership check.
- **Do not auto-attach suggested photos.** Same rule the visit suggestions
  already state: propose, never write.

---

*Nothing in the TravStats repo was committed by the Companion session — this
file is a note, not a change.*
