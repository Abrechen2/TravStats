# ADR 0002 — One time model for server, web and Companion

Status: **proposed**, 2026-09-26. Owner request the same day: "Mit den
Zeitzonen gibt's häufiger Probleme, wir brauchen ein Konzept, das im gesamten
Server und Companion gleich umgesetzt und eindeutig ist." Open questions for
the owner are in the last section; nothing here is binding until they are
answered and the status says accepted.

## Context

Measured on `integrate/test-2026-09-26` and Companion `forgejo/main` f859e41
(the Companion is an Expo 56 / React Native app):

- **The schema cannot say what a time means.** 177 columns are
  `TIMESTAMP(3)`, none is `timestamptz`, one is `DATE` (`Document.issuedOn`).
  Four meanings share that one type:
  - a real instant in UTC (flights since the fake-UTC repair, rail, tracks,
    photos, tokens);
  - a local wall clock stored as if it were UTC ("fake UTC":
    `PlaceVisit.visitedAt`, `CruiseStop.arrivalTime/departureTime`,
    `TripStop.startDate/endDate`, legacy flights tagged `LEGACY_FAKE_UTC`);
  - a calendar day stored as UTC midnight (`LodgingStay.checkIn/checkOut`,
    `Cruise.startDate/endDate`, `CruiseStop.date`, trips, journal,
    `User.birthdate`);
  - `CountryDay.date`, deliberately a UTC day because a GPS point has no zone.
  Only flights (`dep/arrTimeSemantics`) and rail (`dep/arrTimezone`) label
  which one they hold.
- **One field is already mixed:** the web writes `PlaceVisit.visitedAt` as
  fake UTC (`PlaceDetailPage.tsx:122`), the Companion as a real instant
  (`place-list/[id].tsx:550`). Rows cannot be told apart afterwards.
- **A flight does not keep its zone.** The client's zone wins on write but is
  not stored; reads join the airport catalogue, so a catalogue correction
  moves the displayed time of every past flight at that airport.
- **Zones fall back silently.** Both geo-tz wrappers (`deriveTimezone`,
  `timezoneOfLodging`) turn an exception into `null`, after which a wall clock
  is read as UTC. On 2026-09-26 that shipped every new rail journey one to two
  hours wrong, because `geo-tz/all` did not load under tsx. The Companion
  writes `departure.timezone ?? 'UTC'` when creating a flight; the web falls
  back to the user's profile zone and then `"UTC"` in 13 places.
- **The host zone leaks into stored data.** Zod preprocessors parse
  offset-less strings with `new Date(v)` (`schemas/cruise.ts:46`,
  `lodging.ts:45`, `place.ts:9`), so the server's own zone decides what is
  stored. Host-local `Date` getters: backend 29, web 75, Companion 72.
  TravStats CI never runs a suite under a zone other than UTC.
- **Three meanings of "today":** server UTC midnight, Companion device
  midnight, flight lookup airport or browser zone.
- **Seven implementations of "the calendar day in zone Z"**, two geo-tz
  wrappers, three "wall clock → instant" functions.
- **About 35 incidents in 60 days**, in six causes: UTC day instead of the
  place's day (15), host/device zone (7), DST gap (2), wrong or missing zone
  data (4), placeholder semantics (4), provider times (3).

Every one of these was fixed where it surfaced. The count is the argument
for fixing the model instead.

## Decision

### D1 — Every time value is one of two kinds, and says which

| Kind | Stored as | Examples |
|---|---|---|
| **Instant** | real UTC in the timestamp column **plus the IANA zone of the place it happened at**, in a column next to it, frozen at write time | departure/arrival, check-in/out *time*, port call, visit, photo taken, track start |
| **Local date** | a `DATE` column (the calendar day as the place knew it) **plus the zone** where the day belongs to a place | a stay night, a cruise day, a trip's start/end day, a journal day, a date-only historical flight |
| **Floating date** | a `DATE` column with **no zone** — a day that means the same everywhere | a birthday, a document's issue date |

A `DATE` never crosses a code boundary as a JS `Date`: Prisma returns
`@db.Date` as UTC midnight, and any host-local getter on it shifts the day
west of UTC. The data layer converts it to a `"YYYY-MM-DD"` string on read
and back on write, and everything above it handles strings.

Plus a precision where the source is coarser than the kind (`day`, `month`,
`year`, `unknown` — the lodging `datePrecision` generalised). **Fake UTC is
abolished**: no column holds a wall clock pretending to be UTC. `CountryDay`
stays a UTC day by decision (see Q3) and says so in its schema comment.

The local wall clock is **derived, never stored as truth**. A column may cache
it for queries, but the instant and the zone are the source.

### D2 — A zone comes from the place, through one resolver, or not at all

- `backend/src/shared/time/zoneOf.ts` is the only place that answers "which
  zone is this place in": catalogue zone first (`Airport`, `Port`,
  `RailStation` — which today are not read on write), coordinates through
  `geo-tz/all` second. One import that works under tsx, jest and compiled
  node; a startup self-check resolves a known coordinate and marks `/health`
  degraded if it fails.
- It never falls back to the server's, the browser's, the device's or the
  user's profile zone for a **place**. If it cannot answer, the write fails
  with `TZ_UNRESOLVED`, or the value is stored as a local date with
  precision `unknown` — never as UTC by default.
- The zone is **stored with the value** and not re-derived on read, so a
  catalogue correction does not move history. Freezing is not a dead end: a
  wrongly resolved zone is corrected (a) per entry by the user, and (b) by an
  admin re-resolution job that re-runs the resolver over stored values,
  shows a dry-run report (rows whose zone would change and by how much), and
  applies only on confirmation. A political zone change is the same job with
  a newer tzdata.

### D3 — Clients send what the ticket says; the server converts once

- **In:** `{ "local": "2027-03-28T02:30", "zone": "Europe/Berlin" }`, or a
  place reference the server resolves. Offset-less datetime strings outside
  this shape are rejected by the schemas — no `new Date(v)` on input.
  - A wall clock **typed by a person** in a DST gap →
    `LOCAL_TIME_NONEXISTENT` (exists for flights and rail; becomes general).
    Machine sources — GPS points, photo EXIF with offset, provider feeds,
    tracks — carry instants, never wall clocks, and are never refused for a
    gap; a background sync must not fail silently on the one hour a year
    that does not exist.
  - A wall clock in the repeated hour → the earlier occurrence, plus an
    `ambiguous: true` flag the client may answer with `fold: "later"`.
- **Out:** every time field as `{ utc, zone, offset, local, precision }` —
  `offset` (e.g. `"+02:00"`) is the one in force at that instant, so a client
  can build an RFC 3339 string without a zone library. Web and Companion
  display `local` as is and use `utc` only to sort and to measure durations.
  No client computes a zone. `/api/v1/version` reports the server's tzdata
  version; a client that meets a zone name it does not know still displays
  `local`/`offset` and never throws.
- Additive rollout: the new shape is added beside today's fields; the old
  fields are removed only after the Companion has moved (Companion issue).

### D4 — Which zone answers which question

| Question | Zone |
|---|---|
| When does it depart/arrive/check in; when was the photo taken | the **place's** zone (what the ticket and the clock on the wall said) |
| Which calendar day does it belong to — statistics year/month, trip span, weather day, same-day photos, "visited on" | the **place's** local day |
| Is it past or planned; "today"; countdowns; "in 3 days" | the **user's profile zone** (Q1) |
| Durations and ordering | UTC only |
| Scheduled server jobs | explicit zone per job (`node-cron` `timezone` option), never the host |

### D5 — One implementation, mirrored, proven against shared vectors

- `backend/src/shared/time/` (zone resolver, `toInstant(local, zone)`,
  `toLocal(utc, zone)`, `localDay(utc, zone)`, `todayIn(zone)`, gap/fold
  rules), mirrored at `frontend/src/shared/time/` for display-only needs, and
  in the Companion at `lib/time/`. All other helpers (`zonedWallClock`,
  `localWallClockOf`, `airportCalendarDay`, `stationDayKey`,
  `legacyFakeUtcToRealUtc`, `stayInstant`, …) are routed through it and then
  deleted.
- `shared/time/vectors.json` is the contract: DST gap and fold (Berlin, New
  York, Sydney), the date line (Tokyo→Frankfurt, Samoa skipping 2011-12-30),
  half- and quarter-hour zones (India, Nepal, Lord Howe's 30-minute DST),
  historical changes (Moscow 2011/2014, Turkey 2016), overnight train and
  red-eye across midnight, a stay whose check-out precedes check-in in UTC.
  Server, web and Companion each run their implementation against the same
  file; the Companion vendors it with a version header and its CI fails when
  the header lags.

### D6 — Enforced, not just written down

- ESLint (backend, web, Companion): forbid host-local `Date` getters/setters,
  `new Date(y, m, d…)`, `toLocale*String()` without `timeZone`, date-fns
  `format`, and `fromZonedTime`/`formatInTimeZone`/`toZonedTime` outside
  `shared/time/`. Introduced as a **ratchet** over today's offenders (a
  baseline that only shrinks), like the file-size rule.
- CI runs the backend and web suites a second time under
  `TZ=Pacific/Kiritimati` (UTC+14) and `TZ=America/St_Johns` (UTC−3:30).
  A result that depends on the host zone turns red there. The Companion
  already runs under `America/Los_Angeles`; it adds Kiritimati.
- An OpenAPI guard: every time field in a documented response has the D3
  shape (ratchet over today's endpoints).
- **"Now" is injected, not read.** Code asks a clock (`shared/time/clock.ts`)
  instead of calling `new Date()`/`Date.now()` for anything that decides a
  day or a status; tests pin it — including at 23:59 and 00:01 in the
  relevant zones — because an odd host zone alone does not catch a bug that
  only shows up across midnight.
- **Libraries at the edges.** Spreadsheet (exceljs), PDF/mail parsers and
  provider clients are boundaries: a date cell or parsed string is converted
  through `shared/time/` right there, with a test per boundary, because a
  lint rule cannot see into `node_modules`.

### D7 — Migration in phases, each with its guard

1. **Foundation:** `shared/time/`, vectors, resolver with startup check and
   no silent fallback, the odd-zone CI jobs (as a ratchet listing today's
   failures), cron zones. No schema change.
2. **Write paths:** schemas stop parsing offset-less strings; rail, lodging,
   place visits, cruise stops, flights write through `toInstant`.
3. **Schema:** zone columns beside every instant that belongs to a place
   (flights keep the zone they were written with), fake-UTC columns converted
   to real UTC, day columns to `DATE`. A migration report lists every row it
   could not resolve instead of guessing. `PlaceVisit.visitedAt` rows are
   split by writer where provenance allows (Q4).
4. **Read shape:** `{utc, zone, local, precision}` added to every time field;
   web moves to it; the lint ratchet goes to zero.
5. **Companion:** separate issue (`dennis/TravStatsCompanion`), same vectors.
6. **Removal:** old fields and helpers deleted once the Companion has moved.

## Consequences

- Every time bug of the last two months becomes either impossible (host
  zone, silent fallback, fake UTC) or a failing vector.
- The schema migration touches most tables; it is mechanical but large, and
  the fake-UTC conversion needs each row's zone, which is why D2 and phase 1
  come first.
- The API grows a field per time value for a while; the Companion can move
  at its own pace.
- The web keeps a user-facing choice: showing place-local time is the rule;
  a secondary "your time" hint is optional UI, not a second truth.

## Review

An independent review (Gemini, 2026-09-26, no shared context) led to six
changes folded in above: gap refusal limited to typed wall clocks, floating
dates without a zone, `DATE` never crossing a boundary as a JS `Date`, the
`offset` field and the tzdata version, an injected clock with midnight
tests, and conversion at library boundaries. Its answers to the open
questions below match the proposals.

## Open questions for the owner

- **Q1 — "Today" in the Companion:** the user's profile zone (one answer on
  every device, matches the web) or the device's current zone (a traveller
  abroad sees "today" where they are)? Proposed: profile zone for status and
  statistics, device zone only for the live "now" screen, and the profile
  zone follows the device when the user opts in.
- **Q2 — Display:** always the place's local time (proposed), with an
  optional "your time" hint?
- **Q3 — `CountryDay`:** keep the UTC day for GPS points (cheap, documented
  exception), or resolve each point's zone (correct, costs a geo-tz lookup per
  point)?
- **Q4 — Mixed `PlaceVisit.visitedAt`:** if provenance cannot split web- and
  Companion-written rows, mark the ambiguous ones `precision: unknown` for
  the time of day (the date survives), or ask the user per visit?
- **Q5 — Repeated hour default:** the earlier occurrence (proposed) or
  refuse and ask?
