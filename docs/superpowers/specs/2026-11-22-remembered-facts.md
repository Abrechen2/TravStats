# Remembered facts — "aus der Erinnerung"

Council idea, owner: "weiter bauen" (2026-11-22). Keep retrospective recollections apart from
sourced facts. An old trip entered from memory ("Sommer 1998, ungefähr zwei Wochen, mit dem Auto
nach Italien") says so and does not pretend precision. The life-book / gap work is separate and
untouched.

## Model

Three additive columns on nine tables — `trips`, `flights`, `lodging_stays`, `rail_journeys`,
`bus_journeys`, `ferry_journeys`, `rental_bookings`, `cruises`, `place_visits`:

| column | meaning |
|---|---|
| `provenance` | `recorded` (a document, booking, track or import) · `remembered` (typed in from memory) · NULL (unknown — every row older than the field) |
| `remembered_on` | DATE, the day it was written down ("erinnert am"); only with `remembered` |
| `remembered_note` | the user's own words, max 500 characters; only with `remembered` |

A CHECK per table holds the vocabulary and "date and note belong to `remembered` only". NULL is a
real third value, not "recorded": legacy rows are not claimed to be sourced.

**Approximate dates.** The existing precision fields are reused where they exist (`date_precision`
DAY/MONTH/YEAR on stays, `DATE_ONLY` on flight/rail/bus/ferry `dep_precision`). No precision column
is added: a remembered entry is, by definition, approximate, and the marker plus the note carry the
"ungefähr zwei Wochen". A trip's span is stored as the best guess.

**Classification of the new columns.**
- Sharing: private. They are in no `*_FACT_FIELDS` whitelist, so a copy starts with NULL — one
  person's recollection is not another account's record. A test pins this.
- Backup / archive / export: ride along (pg_dump; the archive and the all-data export read whole
  rows). Federation: totals only, unaffected.
- Companion: additive. Rows already carry the columns (sync feed `omit` lists are untouched).

## API (additive, enveloped, `routes/provenance.ts`)

- `PUT /api/v1/provenance/:entryType/:id` — body `{provenance: "recorded"|"remembered"|null,
  rememberedOn?: "YYYY-MM-DD"|null, rememberedNote?: string|null}`. `null` clears all three.
  `entryType` is the Prisma delegate name: `trip | flight | lodgingStay | railJourney |
  busJourney | ferryJourney | rentalBooking | cruise | placeVisit`. Own entries only; 404 otherwise.
- `GET /api/v1/provenance/notices`, `POST /api/v1/provenance/notices/:id/dismiss`.
- `GET /api/v1/stats/summary?onlyRecorded=true` — leaves out flights marked `remembered`.

Create/update endpoints of the nine domains are untouched; a client marks an entry right after
saving it. Minimum server version for the Companion: the release carrying this change.

## Statistics

Remembered entries count by default. "Nur belegte" leaves out `remembered`; it keeps NULL
(unknown) — an unknown is not a recollection, and dropping every legacy row would empty the page.

ONE filter, no per-endpoint copies: a GET carrying `?onlyRecorded=true` on the statistics page's
routes (`/stats`, `/achievements` and the lists it computes from: flights, cruises, trips, rail,
bus, ferry, rentals, lodging, places) opens a request scope (`services/provenance/recordedOnly.ts`,
an AsyncLocalStorage that ends with the response); the Prisma query hook in `db.ts` then narrows
every READ inside it:

- the nine models (`findMany/First/Unique/count/aggregate/groupBy`), the predicate kept as a
  sibling `AND` so a `findUnique` keeps its unique key;
- every to-many `include`/`select` and `_count` that reaches one, at any depth (a to-one relation
  cannot carry a filter and names a row the parent already points at);
- parents that exist only through their entries — a lodging and its stays, a place and its visits —
  drop out when they have entries and none is visible;
- raw SQL, which the hook cannot see, says the same through `recordedSql.ts` (the lodging list,
  facets and stay list);
- achievements are earned once and stored, so they cannot be narrowed: a recorded-only read answers
  `409 ACHIEVEMENTS_NOT_FILTERABLE` and the page leaves the block out.

The middleware removes the parameter so strict query schemas never see it; only GETs open a scope.
Writes are never narrowed. `provenance.guard.test.ts` walks every parameter-free GET route under the
scoped prefixes (plus a few with parameters) and asserts an account whose WHOLE history is
remembered answers exactly like an empty account when the filter is on — and not like one when it
is off.

Web: `RecordedOnlyBoundary` puts one "Nur belegte" switch on the page and re-mounts it when
flipped, so every card and hook reads again under the same filter. The switch lives only while the
page is mounted (`lib/stats/recordedOnly.ts`; the API client adds the parameter), never persisted.
Roadtrips and tours carry no provenance and are not narrowed.

## Contradiction notice

A remembered thing and a recorded one of the same trip disagree when the recorded span lies more
than a day outside the remembered one (a zone or a night flight is not a contradiction):

- remembered trip, recorded entry outside its span — `outsideRememberedSpan`;
- recorded or unknown trip (an unknown row is treated as the record: it predates the field and is
  almost always a booking or import; the notice words it neutrally and can be dismissed), remembered entry outside its span — `outsideRecordedSpan`.

Two recollections cannot contradict a record, two records are not our call. The result is a row in
`provenance_notices`, never a change: the user edits the entry or dismisses the notice ("beide so
lassen"). A notice is named by a content key (kind, both labels, the recorded day), so it exists
once, a dismissal survives deleting and re-importing the entry, and a pending one whose
contradiction has gone is `resolved` and reopens if it returns. The notices are kept current ON WRITE: a write to any of the nine models marks its account
dirty (a second write observer in `db.ts`), and one pass per account runs a few seconds later
(`noticeTriggers.ts`); a boot sweep covers writes that named no account, and opening the inbox or
marking an entry also runs it. The badge's `GET /provenance/notices/count` reads stored rows only.

## Web

- `RememberedMarker`: a quiet "aus der Erinnerung" chip with the note and the date as a tooltip and
  accessible name (not colour-only). On every domain's detail page (`ProvenanceDetails`) and list row: trip, flight, stay, rail, bus,
  ferry, rental, cruise, place visit.
- `RememberedEditor`: a three-way choice (unknown / belegt / aus der Erinnerung) with the date and
  note fields, on the trip detail and the flight / stay detail.
- Inbox: a "Erinnerung und Beleg widersprechen sich" section and its share of the inbox badge
  (`GET /provenance/notices/count`); DE and EN together. Full width.
