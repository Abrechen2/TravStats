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

Remembered entries count by default. "Nur belegte" (`onlyRecorded`) leaves out `remembered`; it
keeps NULL (unknown) — an unknown is not a recollection, and dropping every legacy row would empty
the page. Built for the flight summary; the other domains' totals follow the same one-line
predicate (`provenance IS DISTINCT FROM 'remembered'`) when their stats are wired.

## Contradiction notice

A remembered thing and a recorded one of the same trip disagree when the recorded span lies more
than a day outside the remembered one (a zone or a night flight is not a contradiction):

- remembered trip, recorded entry outside its span — `outsideRememberedSpan`;
- recorded (or unknown) trip, remembered entry outside its span — `outsideRecordedSpan`.

Two recollections cannot contradict a record, two records are not our call. The result is a row in
`provenance_notices`, never a change: the user edits the entry or dismisses the notice ("beide so
lassen"). A notice is named by a content key (kind, both labels, the recorded day), so it exists
once, a dismissal survives deleting and re-importing the entry, and a pending one whose
contradiction has gone is `resolved` and reopens if it returns. The pass runs when the inbox list
is read and after each marking.

## Web

- `RememberedMarker`: a quiet "aus der Erinnerung" chip with the note and the date as a tooltip and
  accessible name (not colour-only). On the trip header and the flight and stay rows.
- `RememberedEditor`: a three-way choice (unknown / belegt / aus der Erinnerung) with the date and
  note fields, on the trip detail and the flight / stay detail.
- Inbox: a "Erinnerung und Beleg widersprechen sich" section; DE and EN together. Full width.
- Stats: `SummaryParams.onlyRecorded` is in the client. The "Nur belegte" switch itself is NOT on the
  stats page yet: the page composes figures from many endpoints (`/stats/page`, per-domain stats)
  and a switch that filters only one of them would show two populations side by side. It waits for
  the other endpoints to take the same parameter.
