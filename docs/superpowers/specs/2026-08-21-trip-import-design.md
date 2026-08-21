# Trip import — one booking document in, one trip out

**Date:** 2026-08-21 · **Branch:** `dev/trip-import` · **Status:** spec for owner review

## Problem

A tour-operator booking (HX expedition confirmation, Berge & Meer travel
documents, and their kind) describes one journey: flights, hotels, sometimes a
cruise, transfers, a price. TravStats today parses single domains — a flight
mail into flights, a hotel mail into a stay, a cruise mail into a cruise — but
a document that carries the WHOLE journey has no door. The owner entered his
Antarctica booking by hand on 2026-08-21 (cruise + hotel + trip + linking six
existing flights); that manual sequence is exactly what this feature turns
into one reviewed import.

## Prior art this builds on (all on `main`)

- `backend/src/services/trip/tripDocumentParser.ts` — deterministic parser for
  Berge & Meer invoice + travel-document pairs, measured against 7 real
  bookings (7 trips, 20 flights, 34 stays; rejection rules for placeholder
  rows like `XX XXX 00:00–00:01`, `sep. Ticket*`, `Zug zum Flug`).
- `frontend/src/components/import/adapters/tripAdapter.tsx` — the trip import
  dialog is pre-wired behind `TRIP_DOCUMENT_IMPORT_READY = false`.
- The import-batch system (`ImportBatch`, one revertible unit, provenance per
  row via `externalRef`) and the flight-duplicate detection.
- The single-domain parsers (flight/cruise/lodging) with the 2026-08-21
  truthfulness fixes (verbatim flight numbers, booking grand total, stay-period
  year anchoring) from `fix/parser-extraction-truthfulness`.
- Codex second opinion (2026-08-15): staged template→LLM extraction, and
  suspicious rows PRE-DESELECTED with their source text shown beside them —
  the most expensive failure is not the failed import but the plausibly wrong
  one.

## Design

### 1. A new parse domain: `trip`

`PARSER_SUPPORTED_DOMAINS` gains `'trip'`. `POST /parse-pdf` and the email
parse route accept `domain: 'trip'` and return one **TripProposal**:

```ts
interface TripProposal {
  trip: { name; startDate; endDate; companions[]; bookingReference; price?; currency? };
  flights: ProposedItem<ParsedBooking>[];      // reuses the flight parse shape
  lodgings: ProposedItem<LodgingCandidate>[];  // reuses the lodging candidate shape
  cruises: ProposedItem<ParsedCruise>[];       // usually 0 or 1
  rejectedRows: { sourceLine: string; reason: RejectReason }[]; // shown, never imported
  parserUsed: "template:berge-meer" | "template:hx" | "ollama";
}

interface ProposedItem<T> {
  data: T;
  /** Where this came from, quoted from the document — rendered beside the row. */
  sourceExcerpt: string;
  /** Pre-deselected in the review UI when true. */
  suspicious: boolean;
  suspicionReason?: string;
  /** Filled by the dedupe pass: an existing entity this row matches. */
  existing?: { kind: "flight" | "lodging" | "cruise"; id: string; label: string };
}
```

### 2. Staged extraction

1. **Templates first.** `tripDocumentParser` (Berge & Meer) is stage one; an
   **HX template** is written as stage two against the owner's real
   confirmation (its layout is stable label/value pairs — booking header,
   guests + per-guest cost blocks, payment-plan total, transfers, hotels,
   flights, itinerary). A template that recognises its sender wins outright.
2. **LLM whole-document extraction** as the fallback for unknown operators:
   one schema (`{trip, flights[], lodgings[], cruise?}`), one Ollama call,
   built from the three single-domain prompts and inheriting all their
   truthfulness rules.

### 3. Truthfulness gate (applies to BOTH stages)

- Flight numbers, prices, dates and booking references are only accepted when
  they appear **verbatim** in the source text; everything else is dropped or
  flagged `suspicious`.
- The year anchor is the **travel period**, never the letter/print/booking
  date.
- The trip price is the **grand total actually charged** (payment-plan total
  where present); per-guest and pre-discount amounts are never proposed.
- Every proposed row carries its `sourceExcerpt` so the reviewer can check the
  claim without opening the PDF.

### 4. Dedupe against the user's data

Before the proposal reaches the UI, each item is matched against existing
entities:

- flights via the existing duplicate key (flight number + day + route, the
  provenance logic from `/flights/batch`),
- lodgings via `externalRef`, then name+city proximity
  (`nameSimilarity`/`proximityMatch` exist),
- cruises via booking reference + date range.

A match sets `existing` and flips the row's default action from **create** to
**link** — in the Antarctica case the dialog would have offered "6 flights
already present → link", not six duplicates.

### 5. Review UI — one card

The trip import dialog (flag flipped ON) renders the proposal as one card:
trip header on top (name, dates, price, companions — editable), then sections
*Flights / Hotels / Cruise*, each row with checkbox + summary + source excerpt.
Suspicious rows come pre-deselected and sorted first in their section.
Rows with `existing` show "verknüpfen mit <label>" instead of "neu anlegen".
`rejectedRows` render collapsed at the bottom — visible, never importable.

### 6. Commit — one batch

One `POST` commits the reviewed proposal atomically:

- creates the trip (unless the user picked an existing one from a dropdown),
- creates the selected new entities, links the matched existing ones,
- writes ONE `ImportBatch` (domain `trip`) so the import log shows a single
  entry and revert takes the whole journey back — created entities are
  deleted, linked existing ones only unlinked.

### 7. Stages

| Stage | Contents | Done means |
|---|---|---|
| 1 | Backend: `trip` parse domain, HX template, LLM fallback, truthfulness gate, dedupe; measured against the HX PDF + the 7 Berge & Meer samples | parse endpoint returns a correct TripProposal for both families |
| 2 | Review UI + one-batch commit + revert; `TRIP_DOCUMENT_IMPORT_READY = true` | Antarctica booking imports end-to-end in the browser, revert restores the previous state |
| 3 | Polish: unknown-operator LLM hardening, more templates as real documents arrive | — |

## Non-goals

- Transfers, Rail & Fly, day programs — no domains exist for them; rejected
  rows list them so nothing silently disappears.
- Journal/diary generation from itineraries (the measured documents carry no
  usable day-program prose).
- Multi-booking documents (one document = one trip; a second booking in the
  same file is out of scope for stage 1–2).

## Open questions for the owner

1. Trip price on the trip vs. on the parts: the HX default puts the grand
   total on the **cruise** (as done by hand on 2026-08-21) when a cruise is
   the journey's core, else on the **trip**. Fine?
2. Should the dialog offer linking into an EXISTING trip (dropdown) in stage 2,
   or is "always creates a new trip" acceptable for the first cut?
