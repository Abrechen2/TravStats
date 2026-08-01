# Companions as a real entity — design

**Date:** 2026-08-01
**Rides:** 2.5.0
**Status:** approved by the owner 2026-08-01
**Second opinion:** Codex gpt-5.4 (high effort), cold read of the repository

## Problem

`companions` is a free-text `String[]` on three Prisma models — `Flight` (~194),
`Trip` (~705), `Cruise` (~886). Every record re-types the names, so `Anna`,
`anna` and `Anna ` become three different people. Nothing can be renamed, nothing
can be counted, and a typo is permanent.

There is no `Companion` table and no suggestions endpoint.

`Flight.coPassengers` is a separate `String[]`, deliberately so: the schema
comments define `companions` as the user's curated travel group and
`coPassengers` as names auto-parsed from the booking mail.

## Verified before designing

- `prisma migrate diff --from-migrations --to-schema-datamodel` reports an empty
  migration. The drift that `CLAUDE.md` warned about until today is gone;
  `prisma migrate dev` works normally. (Corrected in `fb29be15`.)
- The mobile app and the companion repo do not reference `companions`. App-wide
  means the web backend, the web frontend, and the artefacts below — not a second
  client.
- `utils/flightMerge.ts` treats companions as a generic array:
  `ARRAY_FIELDS = ["tags", "companions", "coPassengers"]`.
- `frontend/src/lib/xlsxRoundTrip.ts` exports and re-imports companions as a
  comma-joined text column.

## Decisions

| Question | Decision |
|---|---|
| Shape | `Companion` entity + three explicit join tables |
| Polymorphic join | Rejected — Prisma models polymorphic FKs poorly; loses referential integrity |
| Identity | `userId + canonicalName` unique |
| Canonicalization | NFKC, trim, collapse inner whitespace, lowercase — **diacritics preserved** |
| Accent-insensitive search | Separate non-unique `searchName` |
| Backfill | Idempotent boot backfill, not SQL in the migration |
| Legacy `String[]` columns | **Kept and dual-written for one release**, dropped in 2.6.0 |
| API contract | Unchanged: `companions: string[]` in and out |
| `coPassengers` | Stays `String[]` this release |
| Ordering | Preserved via `position` on the join rows |

### Why diacritics are preserved in the identity

Folding accents merges `José` and `Jose` into one person. That is a wrong answer
that cannot be undone once rows are linked. Accent-insensitive *search* is a
separate concern and gets its own column — the same split the album picker
already uses for #181.

### Why the legacy columns stay one release

This is self-hosted software. A user who hits trouble pulls the previous image,
and that image reads `companions String[]`. Dropping the columns in the same
release makes rollback a restore-from-backup exercise. They stay, dual-written,
and 2.6.0 removes them once the entity has run in the wild.

### Why the API keeps arrays of names

`xlsxRoundTrip.ts` exports and re-imports names as text. The moment the backend
stops accepting `companions: string[]`, Excel import breaks. The entity lives
behind the contract; callers keep sending names.

## Schema

```prisma
model Companion {
  id            String   @id @default(uuid())
  userId        String   @map("user_id")
  canonicalName String   @map("canonical_name")  // NFKC+trim+collapse+lower, accents kept
  displayName   String   @map("display_name")    // as last written by the user
  searchName    String   @map("search_name")     // accents folded — search only, never identity
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  user    User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  flights FlightCompanion[]
  trips   TripCompanion[]
  cruises CruiseCompanion[]

  @@unique([userId, canonicalName])
  @@index([userId, searchName])
  @@map("companions")
}

model FlightCompanion {
  flightId    String @map("flight_id")
  companionId String @map("companion_id")
  position    Int

  flight    Flight    @relation(fields: [flightId], references: [id], onDelete: Cascade)
  companion Companion @relation(fields: [companionId], references: [id], onDelete: Cascade)

  @@id([flightId, companionId])
  @@index([companionId])
  @@map("flight_companions")
}
```

`TripCompanion` and `CruiseCompanion` are identical against their own parents.

`position` exists so export → import → export is byte-stable. Without it a join
table returns rows in whatever order the planner chooses and every Excel export
churns.

## Resolution service

`resolveCompanions(userId, names: string[]): Promise<Companion[]>` is the single
entry point every write path uses. It canonicalizes each name, finds or creates
the companion, refreshes `displayName` to the latest spelling, and returns them
in input order. Creation races are resolved by the unique constraint and a
retry-on-P2002, the same pattern the airline catalogue already uses.

## Backfill

An idempotent boot backfill, in the style of the existing cost-system and
airline-code backfills:

1. For each user, read the legacy arrays from all three tables.
2. Drop blank and whitespace-only entries. Preserve everything else verbatim —
   no aggressive cleaning; odd-but-real names are still names.
3. Create companions via the same canonicalization the runtime uses.
4. Link rows with `position` taken from the array index.
5. Where several spellings collapse to one canonical key, keep the most frequent
   trimmed form as `displayName` and log the aliases at info level.

It must be safe to run repeatedly: linking is `createMany({ skipDuplicates })`
against the composite primary key.

## Consumers to change

**Write paths** — resolve names to links, keep writing the legacy array:
`routes/flights.ts`, `routes/flightsBatch.ts`, `routes/trips.ts` and
`routes/cruises.ts`.

> **The cruise path is a trap.** `routes/cruises.ts` never mentions `companions`
> by name — it persists the field through a spread (`data: { userId, ...rest }`,
> ~line 296), and `schemas/cruise.ts:102` is what lets it through. Grepping for
> the field finds nothing there. Companion resolution must destructure
> `companions` out of `rest` explicitly; otherwise the spread keeps writing the
> array, the joins are silently never created, and nothing fails loudly.

**Read paths** — map links back to `string[]` so responses are unchanged:
the same routes plus `services/tripSummaryService.ts`,
`services/tripCleanupService.ts`, `services/diagnosticsBundle.ts`.

**`utils/flightMerge.ts` — the trap.** Companions is currently one of
`ARRAY_FIELDS` and merges fill-if-empty. Joins need that spelled out explicitly.
Decision: keep today's semantics exactly — fill only when the target has no
companions — but operate on resolved ids. Behaviour must not change as a side
effect of the storage change.

**`services/openapi/paths.ts`** — the contract does not change, but the new
`GET /companions` endpoint is documented.

**Frontend** — the companions control becomes a picker with autocomplete over
`GET /companions`, free entry still allowed, in the flight form, the trip UI
(`components/Trip*`) and `components/Cruise/CruiseEditModal.tsx`.

**`frontend/src/lib/xlsxRoundTrip.ts`** — unchanged by design. It is the reason
the contract stays string-based, and it is the regression test that proves it.

## API

- `GET /api/v1/companions` — the user's companions with usage counts, for the
  picker. Rate-limited like other authenticated reads.
- Everything else unchanged.

## Rollback

Because the legacy columns stay populated, rolling back to the previous image is
a plain image swap. No reverse backfill is needed this release. That property is
the whole reason for the dual write and must be verified before shipping:
after the backfill, the legacy arrays and the joins must agree.

## Testing

- Canonicalization: `Anna`, `anna`, ` Anna ` collapse to one companion;
  `José` and `Jose` stay two.
- Backfill idempotency: running it twice produces the same rows and no duplicates.
- Backfill fidelity: after the run, every record's joins reproduce its legacy
  array exactly, in the same order.
- Dual write: creating and updating a flight leaves the legacy array and the
  joins in agreement.
- `flightMerge`: a merge into a record that already has companions does not
  change them; a merge into an empty one fills them.
- Excel: export → import → export is stable, including a name with diacritics.
- Cascade: deleting a flight removes its links and leaves the companion; deleting
  a user removes both.

## Explicitly out of scope

- Dropping the legacy `String[]` columns — 2.6.0.
- Linking `coPassengers` to companions. Parser artefacts like `MUELLER/SARAH MS`
  are not trustworthy identities; promoting them silently would pollute the
  catalogue. The form offers an explicit take-over action instead.
- Merging two existing companions, renaming one everywhere, avatars, and
  "who did I travel with most" statistics. All become possible once the entity
  exists; none are needed to ship it.
