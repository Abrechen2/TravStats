# Companion redesign — plan and server contract

- **Date:** 2026-10-25
- **Owner ruling:** "Bau das mal so real auf" (25.10.2026), on the concept
  artifact https://claude.ai/artifact/1BP5TvhPRvwYnTRBkignnH and the click
  prototype https://claude.ai/artifact/S3kZhFREKu24QUZz4RGZKc
- **Branches:** `feat/companion-redesign` in both repositories, on Forgejo
  (Companion phase 1 at `c2b0ade1`)
- **Coordinator:** `travstats-server` writes this plan and owns the contract;
  `travstats-companion` asks for changes by message.

## Phases

| # | Phase | Companion | Server | State |
|---|---|---|---|---|
| 1 | Navigation + Start | Fixed bar Start · Reisen · + · Karte · Statistik; account button top right (old "Mehr" sheet, carries the inbox dot); board editor and presets removed; Start picks its composition from the trips (between / before a trip within 14 days / travelling), computed on the device from `GET /trips` | none — existing endpoints only | **done** (app, `c2b0ade1`) |
| 2 | Reisen + Track | Reisen list and trip header with cover image; "Bearbeiten im Web" buttons; review findings in the inbox with resolve + undo | C1 (no work), C2 (pattern only), C3 (new finding kinds, undo) | open |
| 3 | Statistik | Gesamt/Jahr switch driving every drilldown | C4 (`year` on every stats endpoint the app reads) | server **built** (C4), app open |

C5 (server-side trip phase) is **not** built — see below.

## Contract

Rules for every item: **server first, additive only.** Nothing below removes
or renames a field that an installed app reads. Each item names the minimum
server version once it is built; until then the app must treat the feature
as absent (feature check: a 404 / 400 on the new parameter, or the field
missing), never as an error.

### C1 — Trip cover image (exists, no server work)

The field is already there:

| Field | Type | Where |
|---|---|---|
| `coverImageUrl` | `string \| null` | every trip in `GET /api/v1/trips` and `GET /api/v1/trips/:id` |

- The value is a **server-relative path**, normally
  `/api/v1/trips/:id/photos/:photoId/file` (uploaded cover) or an Immich
  proxy path `/api/v1/immich/albums/:linkId/…` (linked album). Resolve it
  against the server URL and send the session cookie; both routes check
  ownership. An absolute `http(s)://` URL is possible for old rows — load it
  as is.
- `null` means no cover. The app draws its own placeholder; the server sends
  none (abstention rule).
- Setting it: `POST /api/v1/trips/:id/cover` (multipart, field `cover`;
  set the multipart Content-Type yourself) or `PATCH /api/v1/trips/:id`
  with `coverImageUrl` pointing at one of the trip's own photos
  (`refusesCoverImage` rejects foreign ones with 400). Unlinking an Immich
  album clears a cover that came from it.
- Minimum server: any 2.7.0-rc.

### C2 — Web deep links (URL pattern; optional base field)

The web app is served by the same origin as the API in the standard image,
so a link is `<serverUrl><path>`. Patterns, all existing web routes:

| Object | Path |
|---|---|
| Trip | `/trips/:id` (tab: `?tab=<name>`, `overview` is the default and has no parameter) |
| Trip route (tour/roadtrip leg inside a trip) | `/trips/:id/route/:routeId` |
| Flight | `/flights/:id` |
| Rail ride / rail connection | `/rail/:id` · `/rail/connection/:id` |
| Bus · ferry · rental | `/bus/:id` · `/ferry/:id` · `/rentals/:id` |
| Cruise | `/cruises/:id` |
| Lodging · lodging chain | `/lodging/:id` · `/lodging/chains/:id` |
| Place · place list | `/places/:id` · `/places/lists/:id` |
| Tour · roadtrip | `/tours/:routeId` · `/roadtrips/:id` |
| Aircraft (catalog) | `/aircraft/:registration` |
| Inbox | `/pending-updates` |
| Settings group | `/settings/:page` |

- Unknown id → the web shows its own not-found; the app needs no check first.
- No `webBaseUrl` field: every instance serves web and API on one origin
  (Companion, 2026-10-25). If that ever changes, an additive
  `webBaseUrl: string | null` on `GET /api/v1/version` is the way.
- Airports, airlines, ports and ships have no web detail page today; a
  button for them is out of scope until one exists.

### C3 — Inbox review findings with a type, evidence, resolve, undo

**What exists.** The web inbox reads four sources, and the app already reads
three of them (`inbox-sources.ts`): photo journeys, unfiled documents and trip
suggestions. The fourth, `data_quality_flags`, is the one shaped like a
finding: `id`, `entityType`, `entityId`, `kind`, `status`
(`open|resolved|dismissed`), `details` (JSON evidence), `createdAt`,
`resolvedAt`, with `GET /api/v1/data-quality-flags`,
`POST /:id/resolve` and `POST /:id/dismiss`. Today's kinds are
`address_country_mismatch` and `undated_country_evidence`.

**Proposal: extend that table, do not add a second inbox.** One home for
"a question the server has about your data" (counting-rule principle).

| Field (response item) | Type | Notes |
|---|---|---|
| `id` | `string` | uuid |
| `kind` | `"ferryMatch" \| "photoMatch" \| "duplicate" \| existing kinds` | new kinds added to `DATA_QUALITY_FLAG_KINDS`; the app ignores kinds it does not know |
| `entityType` / `entityId` | `string` | the record the finding is about; deep link via C2 |
| `status` | `"open" \| "resolved" \| "dismissed"` | |
| `evidence` | object, per kind (below) | today's `details`, renamed in the response only as an additive alias; `details` stays |
| `createdAt` / `resolvedAt` | ISO string / `string \| null` | |
| `undoUntil` | `string \| null` | set while an undo is possible |

Evidence per new kind (all fields nullable unless stated):

| Kind | Evidence |
|---|---|
| `ferryMatch` | `ferryId` (required), `candidateTripId`, `departurePort`, `arrivalPort`, `departureTime`, `reason` (stable code) |
| `photoMatch` | `photoIds` (required, ≥1), `candidateEntityType`, `candidateEntityId`, `takenFrom`, `takenTo`, `distanceKm` |
| `duplicate` | `entityType` (required), `ids` (required, ≥2), `keptId` suggestion, `matchedFields` (array of field names) |

Endpoints:

- `POST /api/v1/data-quality-flags/:id/resolve` — body
  `{ action: "<kind-specific code>" }` (e.g. `link`, `merge`, `keep`); answers
  the updated finding with `undoUntil` set. Applying the change and marking
  the finding happen in one transaction.
- `POST /api/v1/data-quality-flags/:id/dismiss` — unchanged; also sets
  `undoUntil`.
- `POST /api/v1/data-quality-flags/:id/undo` — **new**. Reverts the applied
  change and reopens the finding while `now < undoUntil`; after that 409
  `{ error: "undoExpired" }`. Window: **10 minutes**, server-side constant.
- Errors use stable codes (`notFound`, `invalidAction`, `undoExpired`,
  `staleFinding` when the records changed since the check ran), never prose.

**Decided by the owner, 2026-10-25 ("Wie du vorschlägst") — the two
recommendations below are the plan:**

1. *Where the undo lives.* A server undo for `merge` means keeping enough of
   the merged-away record to restore it — real work per kind. The cheap
   alternative is an app-side undo: the toast holds the request for ~5 s and
   only then calls `resolve`. **Recommendation:** app-side delay for phase 2,
   server `undo` only for `dismiss` and `link` (both trivially reversible);
   `merge` gets a server undo when duplicates are built.
2. *The detectors.* No check today produces `ferryMatch`, `photoMatch` or
   `duplicate`. Photo journeys (`/photo-journeys`) already cover part of
   "photo match" — does `photoMatch` replace them in the app, or sit beside
   them? **Recommendation:** keep photo journeys as they are, and build
   `duplicate` first (it has the clearest evidence), then `ferryMatch`.

### C4 — Statistics scoped by year

**What exists.** Most `/api/v1/stats/*` endpoints take `fromDate`/`toDate`
(`DateRangeQuerySchema`); `/stats/summary` also takes `year` and
`compareYear`. `/stats/insights/*`, `/stats/domain-records` and the
`/stats/aircraft*` routes take no range, and `/stats/page` **refuses** any
range on purpose (400), because four of its nine sections have none and a
partial scope would lie.

**Contract.**

**Built 2026-10-25** on `feat/companion-redesign` (owner: "Wie du
vorschlägst"). Minimum server: the first RC cut from this branch.

- `year=<YYYY>` (optional, integer 1900–2100) on every endpoint below. A
  record belongs to a year when one of the days it covers falls in it, on the
  **local calendar** of where it happened — a flight by its departure
  airport's day, rail/bus/ferry by the station's or port's clock, a place by
  its own calendar. Lodging stays and port calls carry no zone and are dated
  as stored, exactly as the lifetime figures date them. Two rules for a record
  spanning New Year, each already the rule of its screen:
  - **Counting tabs** (summary, hero figures except countries, airports,
    airlines, aircraft types, punctuality, records, timeseries, lodging,
    cruise, rail) count an event **once, in the year it started** — a flight
    by its departure, a stay by its check-in, a cruise by its start, the rule
    the cross-domain overview already uses (`utils/stats/domainYear.ts`).
  - **Presence** (passport, country page, hero `countries`) shows a country in
    **every** year the evidence has days in.
- Invalid `year` → 400 (range 1900–2100; `/rail/stats` keeps its older bound
  of 2200). On the endpoints that also take a range (summary, timeseries,
  airports, punctuality), `year` together with `fromDate`/`toDate` → 400
  `{ error, code: "VALIDATION_FAILED", field: "year" }`. The others take no
  range at all and ignore `fromDate`/`toDate` as before.
- Undated records belong to no year: they appear only in the all-time view.
- Every response carries `scope: { year: number | null }` (inside `data` on the
  enveloped ones: lodging, records, rail). `null` = all-time. Without `year`
  the body is exactly the old one plus `scope`.
- **Feature check:** a server without `year` on an endpoint ignores the
  parameter (Zod strips it) and answers all-time with no `scope`. Trust
  `scope.year`, never the status code; a missing `scope` means "not scoped".
  No endpoint in the list answers "year unsupported" — the code for it was
  never needed and is not built.
- `/stats/page` still refuses any range; the app does not read it.

Per endpoint:

| # | Endpoint | Before | Now |
|---|---|---|---|
| 1 | `/stats/summary` | `year`, `compareYear` | + `scope` (with `compareYear`: `{ current, compare, scope }`) |
| 2 | `/stats/hero` | none | `year` on every figure, countries from the year-scoped passport |
| 3 | `/stats/timeseries` | `year` with `window=year` | `year` with no `window` = that year's 12 months; `scope.year` is the year the window resolved to, `null` for rolling/all/range |
| 4 | `/stats/airports` · `/stats/airlines` · `/stats/aircraft-types` | range · none · none | `year` |
| 5 | `/stats/lodging` · `/stats/cruise` · `/rail/stats` | `year` (all three already had it) | + `scope` |
| 6 | `/stats/passport` · `/stats/countries/:code` | none | `year`; see below |
| 7 | `/stats/punctuality` · `/stats/records` | range · none | `year` |

Passport and country page under a year:

- Tiers, thresholds, `daysPresent` and "unclear" reasons are computed from
  that year's evidence only. A flight chain over New Year is graded on all its
  legs first, then its evidence is cut by day — otherwise its destination
  would read as an open chain in both years.
- `firstYear`/`lastYear` are that year. `isNew` / `newThisYear` mean **"first
  visited in that year"** (without `year`: the current year, as before);
  `firstVisitedYear` stays the lifetime value.
- `/stats/countries/:code?year=Y` for a country with no record in Y → **404**.
- A stay over New Year counts all its nights in both years (`lodging.nights`).

Not scoped: `/stats/wrapped` (has its own year), `/stats/page`.

### C5 — Server-side trip phase: not built

The phase (between / before within 14 days / travelling) is derived from the
trips the server already sends, so it is a cache-free computation, not data
the server is missing — it does not conflict with "the server is the record".
The web has no such board. **The app keeps computing it.** If the web gets the
same board, the rule moves to `shared/` on the server and both sides read it
from there — then it becomes a contract item.

## Open for Companion

- Nothing. C1/C2/C4 accepted as written; C3 sits behind a feature check in
  the app (2026-10-25).

## Open for server

- C3, as decided by the owner on 2026-10-25 ("Wie du vorschlägst"): the app
  delays a resolve ~5 s for its own undo in phase 2; the server builds `undo`
  for `dismiss` and `link` only, and the `duplicate` detector first, then
  `ferryMatch`. Photo journeys stay as they are. Not started.
