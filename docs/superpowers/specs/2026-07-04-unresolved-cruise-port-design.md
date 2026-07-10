# Unresolved cruise port — first-class stop state (no sea-day downgrade)

**Status:** approved 2026-07-04 · **Target:** v2.3 · **Branch:** `dev/v2.3`

## Goal

When a cruise import can't match a stop's port to the catalog, the port must
**not** be lost. Today it is silently downgraded to a **sea day** (`isAtSea=true,
portId=null`) with the name stuffed into `excursionNote` as `[unmatched: X]` — a
rushed save keeps the note but records a *sea day*, so the port call, stats and
route are wrong and correcting it later is manual.

Introduce a **third stop state**: an *unresolved port* — a stop that carries a
port **name** without a catalog `portId` and is **not** a sea day. The name is
never lost, the stop stays visibly a port (flagged 🔶), and the user can resolve
it to a catalog port anytime. Because the data is safe on save, no save-time
guard/confirmation is needed.

## Non-goals (YAGNI)

- No automatic geocoder fallback for unknown ports (separate feature).
- No map rendering for coordinate-less stops (unresolved ports stay off the map).
- No change to matched-port or sea-day behavior.

## Stop states (the invariant)

Each `CruiseStop` is exactly one of:
1. **Matched port** — `portId` set, `isAtSea=false`, `unresolvedPortName=null`.
2. **Sea day** — `isAtSea=true`, `portId=null`, `unresolvedPortName=null`.
3. **Unresolved port** *(new)* — `portId=null`, `isAtSea=false`,
   `unresolvedPortName` set (non-empty).

## A. Data model

**Prisma (`backend/prisma/schema.prisma`, model `CruiseStop`):** add
```
unresolvedPortName String? @map("unresolved_port_name")
```
**Migration:** hand-written, additive, following the existing cruise-migration
convention — do NOT run `prisma migrate dev` (it would bundle the known
pre-existing schema drift and break prod on deploy; see the cruise-migration
gotcha in CLAUDE.md). A new dir under `backend/prisma/migrations/` with a single
`ALTER TABLE cruise_stops ADD COLUMN unresolved_port_name text;` plus the backfill
(section E). Nullable, no default → safe/additive.

**Zod (`backend/src/schemas/cruise.ts`):** add
`unresolvedPortName: z.string().trim().min(1).nullable().optional()`. Replace the
current 2-state refine (`s.isAtSea || portId set`) with the 3-state invariant:
- valid iff `isAtSea` OR `portId != null` OR `unresolvedPortName` set;
- reject the contradiction `portId != null && unresolvedPortName` set;
- reject `isAtSea && (portId != null || unresolvedPortName)`.
Keep clear messages + `path`.

## B. Backend resolver (`cruiseEntityResolver.mapStop`)

Remove the sea-day downgrade + `[unmatched: X]` excursionNote tagging. On a
non-sea-day stop with no port match but a `portName`:
- set `unresolvedPortName = stop.portName`, `portId = null`, `isAtSea = false`;
- leave `excursionNote` clean (the stop's own note only);
- still push `{ dayNumber, portName }` to the returned `unmatchedPorts` list (the
  import preview warning consumes it).
Matched ports and sea days are unchanged.

## C. Serialization / reads

- Include `unresolvedPortName` wherever cruise stops are returned (the cruise GET
  and any stop DTO/serializer). The `/cruises/:id/geometry` endpoint is
  unaffected — it already reads only coordinate-bearing (matched) ports.
- `cruiseDistance/cruiseLegService.ts` already filters `isAtSea:false, portId:{not:null}`
  → unresolved stops are naturally excluded from legs/distance. **Verify, don't change.**

## D. Frontend — types, editor, timeline

- **Types** (`frontend/src/types`): `CruiseStop` and `CruiseStopInput` gain
  `unresolvedPortName?: string | null`.
- **`CruiseStopsEditor.tsx`:** render three row kinds. The new unresolved kind
  shows 🔶 + the name + "nicht aufgelöst / not resolved" and a `PortPicker` to
  resolve it; picking a port sets `portId` and clears `unresolvedPortName`.
  Sea-day and matched-port rows unchanged. (A manually-added stop still starts as
  a normal port via PortPicker — the unresolved state comes from import.)
- **Cruise detail timeline** (the stop list on `/cruises/:id`): an unresolved stop
  shows its name with a 🔶 marker instead of "Sea day".
- i18n DE+EN: `unresolvedPort` label + editor/timeline strings.

## E. Backfill existing data (in the migration)

Best-effort one-time SQL in the same migration, recovering earlier imports:
```sql
UPDATE cruise_stops
SET unresolved_port_name = substring(excursion_note from '\[unmatched: (.+?)\]'),
    is_at_sea = false,
    excursion_note = NULLIF(trim(regexp_replace(excursion_note, '\s*\[unmatched: .+?\]', '')), '')
WHERE is_at_sea = true AND excursion_note LIKE '%[unmatched:%';
```
Idempotent (the `LIKE` guard means a re-run finds nothing after cleanup).

## F. Stats / counting (unresolved counts as a port call)

- **Frontend `countUniquePorts` (`components/Cruise/cruisePorts.ts`):** today counts
  distinct matched `port.id`. Add the distinct **unresolved port names** (stops with
  `!isAtSea && port==null && unresolvedPortName`), deduped case-insensitively by
  trimmed name — so the metric stays "unique ports" (two "Taranto" stops = 1), while
  a matched port and an unresolved same-named port are still counted separately
  (no cross-dedupe by name against catalog ports — keep it simple). The cruise
  list/table "ports" column and the `sortCruises` `ports` key pick this up
  automatically.
- **Backend port-call stats** (`cruiseStatsAdapter` / `totalPortCalls`): include
  unresolved stops in the port-call count the same way (a stop is a port call if
  `!isAtSea` — matched or unresolved).
- Map/route/distance: unchanged (coordinate-less → excluded).
- UI may show the unresolved sub-count ("Ports: 6 (1 🔶)") on the detail page —
  optional polish, not required for correctness.

## G. Import preview

Keep the existing unmatched-ports **warning** + the auto-expanded stops editor.
No save-time guard/confirmation is added — an unresolved port is now a valid,
non-lossy save. The warning simply nudges the user to resolve before saving.

## Error handling

- Zod rejects contradictory stops (both portId and unresolvedPortName, etc.) with
  a clear message at the offending `path`.
- Resolver never throws on an unmatched port — it produces an unresolved stop.
- Backfill guarded by the `LIKE` filter; malformed notes just don't match.

## Testing

- **Zod** (`schemas` test): the 3 valid states pass; the contradictions reject.
- **Resolver** (`cruiseEntityResolver.test`): an unmatched named stop → unresolved
  (`unresolvedPortName` set, `isAtSea=false`, `portId=null`, clean note), still in
  `unmatchedPorts`; matched + sea-day unchanged.
- **`countUniquePorts`** (frontend): unresolved stop counted as a port; mixed
  matched+unresolved+sea-day counts correctly.
- **Editor**: an unresolved row renders the 🔶 name; resolving via PortPicker sets
  portId and clears the name.
- **Migration backfill**: a seeded sea-day row with `[unmatched: X]` note becomes
  an unresolved port; note cleaned; idempotent on re-run.

## Rollout

Lands on `dev/v2.3`; ships in the next Beta and the 2.3.0 release. Additive
migration + backfill run on deploy. No breaking change to existing matched/sea-day
stops.
