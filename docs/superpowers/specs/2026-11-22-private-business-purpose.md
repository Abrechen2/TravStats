# Private or business: a purpose on entries, hideable per domain (owner, 2026-11-22)

Status: **plan for the owner's decision; no code before his OK.**

## Owner's words

> Every visit (PlaceVisit) and place (Place) can be "privat" or "geschäftlich".
> The split applies in statistics, maps, lists, counts, sorting and filters and
> can be hidden. Hiding is set per domain, e.g. hide all business ones in the
> Places domain, independent of flights, stays and so on.

Context: the Worktravel session is preparing about 300 business site visits
(commissioning, maintenance, re-optimisation) and about 120 trips from the
work calendar; they should be imported with this marker.

## Today

- `Trip.category` (vacation | business | weekend | family | other) exists.
- `Place` and `PlaceVisit` carry no private/business marker (schema.prisma,
  models around lines 3677 and 3836). Neither do flights, stays or the
  transport domains.
- Place visits are not shared between servers (`shareTypes.ts`: `poi` is
  private by owner decision 2).

## Recommendation

1. **One field, `purpose`, with the values `private` | `business` | null
   (unknown), on visits and entries, not on places.**
   - It goes on `PlaceVisit` now, and in the same migration on flights, stays,
     rail/bus/ferry journeys, rentals and cruises, so the per-domain hiding has
     the same handle everywhere.
   - A `Place` gets no stored marker of its own: one place can have private
     and business visits (a hotel, a city). Where a place needs a label, it is
     derived from its visits ("nur geschäftlich", "nur privat", "beides"),
     never stored.
2. **Taken over from the trip on creation, then independent.** A new entry in
   a `business` trip starts as `business`, one in a vacation/weekend/family
   trip as `private`. Changing the trip's category later does not silently
   flip existing entries; the trip page offers "Zweck auf alle Einträge
   übertragen" as an explicit action.
3. **Existing rows stay null (unknown)**, as the rule "abstention is a result"
   demands; nothing is silently declared private. A one-off, user-started
   action "Zweck aus der Reise-Kategorie übernehmen" fills null entries inside
   categorised trips. The Worktravel import sets the value explicitly.
4. **Hiding per domain**, as a user setting
   `purposeVisibility: { poi: { hide: ["business"] }, flight: { hide: [] }, … }`,
   one row per domain in the domain settings ("Geschäftliche ausblenden" /
   "Private ausblenden"). It is applied **on the server** before counting,
   aggregation and paging, through the same request-scoped filter mechanism
   the "nur belegte" switch uses (`services/provenance/recordedOnly.ts`),
   generalised into one entry filter, so lists, maps, statistics and the
   activity feed always show the same population. Unknown entries are never
   hidden by a purpose filter.
5. **Counting**: one rule in `shared/` (with its frontend mirror). A hidden
   purpose removes the entries from every count of that domain. A visible
   business visit counts like a private one (a place or country visited on
   business is still visited), unless the owner decides otherwise (Q1). The
   `Place.visited` promotion and the counting use the same rule, so a hidden
   business visit cannot make a place count through the back door.
6. **Companion and API**: additive. `purpose` is an optional field; an older
   app that does not send it leaves the value unchanged (never resets it to
   null). The filter is a request parameter, so an app that does not send it
   sees everything as today.
7. **Sharing**: `poi` stays private (no change). For shared entry types the
   purpose is the member's own view and is **not** part of the shared facts:
   a trip shared with a colleague may be business for one and private for the
   other.

## Display

- A small "geschäftlich" chip on business entries in lists, detail headers and
  map cards; private entries show nothing (the common case). Unknown shows
  nothing either.
- Statistics show, under the totals, how many entries are hidden by the
  purpose filter ("12 geschäftliche Besuche ausgeblendet"), so a hidden number
  is never mistaken for a real zero.
- Sorting and filtering in lists get "Zweck" as a column and filter.

## Phases

| Phase | What |
|---|---|
| P1 | Migration (`purpose` on PlaceVisit and the entry tables, null default), API fields, editor field on visit and entry forms, chip, trip inheritance on create |
| P2 | Per-domain visibility setting, server-side filter shared with "nur belegte", counting rule, hidden-count hint |
| P3 | "Zweck aus Reise übernehmen" bulk action; Worktravel import with explicit purposes |
| P4 | Companion: show and set the purpose (additive) |

## Council (2026-11-22: Gemini, Copilot; Codex at its usage limit)

Both put the marker on the visit, not the place, and both copy it from the
trip on creation without a live link. They differ on the default for existing
rows: Gemini wanted `private`, Copilot `null`/unknown. The plan follows
Copilot, because a silent "private" would be invented data. Copilot's pitfall
is taken into point 5: `Place.visited` promotion must use the same
purpose-aware rule. Answers: `~/.cache/tmp/ai-council.mwygrL/` (Gemini),
`~/.cache/tmp/ai-council.hY0xFJ/` (Copilot) on lisbeth.

## Open for the owner

- Q1: Does a visible business visit count as "visited" for countries and
  places (recommended: yes; hiding is the way to leave it out)?

## As built (P1–P3, `feat/purpose`) and the contract

Owner decision 2026-11-22: Q1 is yes, a visible business visit counts as visited. Council
(Copilot, end to end) added: hiding is derived from the STORED setting, never a request parameter.

**Storage.** `purpose` TEXT NULL with a CHECK (`private` | `business`) on `place_visits`, `flights`,
`lodging_stays`, `rail_journeys`, `bus_journeys`, `ferry_journeys`, `rental_bookings`, `cruises`.
`user_settings.purpose_visibility` JSON NULL: `{ "poi": ["business"], "flight": [] }`.

**Contract (additive).**
- `purpose` (`"private" | "business" | null`) is returned on every entry row and accepted, optional, on
  create and update of the eight kinds. Omitted: unchanged on update, the trip's category on create
  (business -> business; vacation/weekend/family -> private; other/none -> null). `null` clears.
- `PUT /api/v1/purpose/entries/:entryType/:id` `{ purpose }` — one entry, own entries only.
- `GET|PUT /api/v1/purpose/visibility` — the per-domain setting; answers `{ visibility, revision }`.
- `GET /api/v1/purpose/hidden` — counts per domain and purpose that the setting leaves out.
- `POST /api/v1/purpose/trips/:tripId/apply` (optional `{ purpose }`) and `POST /api/v1/purpose/from-trips`.
- **Visibility revision for cached rows (Companion).** Every authenticated GET inside the entry scope
  carries `X-Purpose-Visibility: <revision>`; it changes exactly when `purposeVisibility` changes. An
  app that sees a new value evicts its cached entry rows and refetches. Minimum server version for the
  app: the one that ships this header.
- Hiding is applied on the server to every read inside the scope (`ENTRY_SCOPE_PREFIXES` in
  `services/provenance/recordedOnly.ts`): lists, maps, stats, activity feed, life book, companions
  timeline, gap calendar, upcoming. A trip whose entries are all hidden drops out with them; a place
  whose visits are all hidden drops out (so `Place.visited` is no back door). Unknown is never hidden.

**Left out of this package (follow-up).** Leaderboard (`services/comparison/domainAggregates.ts`) and
badges still count hidden entries: badges are stored, not derived per request. Tours/roadtrips
(`trip_routes`) carry no purpose yet. Visit suggestions and the person timeline outside the listed
prefixes are not scoped. A place with a hidden business visit AND only planned visible visits keeps its
stored `visited` flag.

**Classification.** `purpose` is excluded from the federation field inventory (the member's own view),
is part of the account export and ZIP archive (generic columns, together with the setting), and is in
the OpenAPI schemas. Shared-trip sync never writes `purpose`: the sharing adapters copy facts only.
