# Lodging Import & Location Input — Design

**Date:** 2026-07-11 · **Branch:** `dev/hotels` · **Status:** approved by the owner

Covers Phase B of the lodging domain (booking import) plus two things that turned
out to belong here: the one-time CSV migration path, and the place-search /
coordinate-input component that was publicly promised in Discord and explicitly
deferred to "the POI/Hotel domain".

## 1. Why

Three separate needs converge on the same machinery:

1. **The ongoing path.** Booking confirmations arrive by email/PDF and should
   become stays without retyping — the same way flights and cruises already work.
2. **The one-time migration.** Both real users already keep their history outside
   TravStats and cannot get it in today:
   - The owner: a Google-Maps export, prepared to **232 lodgings** with name, type,
     chain, stars, address, city, country, **coordinates** and a **Google place id**
     — but **no stays** (no dates, no prices, no ratings). These are *places*.
   - Alex: an Excel list of **226 hotels** (name, chain, street, postcode, city,
     country) plus one sheet per year of **380 stays / 687 nights** (hotel, check-in,
     check-out, room rating, breakfast rating) — joined by a free-text hotel name.
     No coordinates.
   These two shapes are mirror images: places without stays vs. stays without
   coordinates. The import must handle both.
3. **The promise.** In `#bug-report` → "Einfügen von Koordinaten", Alex asked that
   coordinates pasted from Google Maps auto-split into the lat/lon fields, and for a
   search that fills the details in. The answer in the channel committed to a real
   place search (type a place, sight **or hotel** → suggestions → coordinates filled),
   a map pin to fine-tune, paste-detection of decimal pairs, **OSM-based, free, no API
   key**, configurable (public service by default, self-hosted instance accepted) —
   and deferred it out of 2.3 *because it belongs with the POI/Hotel domain*. That is
   this domain. The promise falls due here.

## 2. Data model

Three additions. No data migration needed beyond the new columns.

- **`Lodging.externalRef`** (`String?`) — a proven identity for a place, e.g.
  `google:ChIJd8BlQ2Bo5kcRAFTLmuLK8bA`. **`@@unique([userId, externalRef])`**.
  The owner's 232 rows carry a Google place id whose CID was *proven* identical to
  the saved place for 222 of them — so a re-import of the same file is provably a
  no-op rather than 232 duplicates. Alex's Excel and the email parser have no such
  id and fall back to name+city matching, which the user confirms in the preview.
- **`LodgingStay.externalRef`** (`String?`, `@@unique([userId, externalRef])`) —
  e.g. `booking:5087376273` from a confirmation number, so re-uploading the same
  email cannot create the stay twice.
- **`LodgingImportBatch`** — `id`, `userId`, `source` (`csv` | `email` | `pdf`),
  `fileName`, `createdAt`, plus `batchId` FKs on the rows it created. Reason: an
  import of 232 rows that turns out wrong must be **revertible as a unit**. Without
  it the only remedy is deleting 232 lodgings by hand.

## 3. The two import paths

Both end in **the same preview and the same commit** — meaning the *lodging* preview
and the *lodging* commit. The parser is just another producer of import candidates,
not a second system.

> **Correction after reading the code (2026-07-11).** Two assumptions in an earlier
> draft of this spec were wrong, and the plan reflects the corrected reality:
> - **`services/importPreview.ts` / `routes/import.ts` cannot be reused.** Their row
>   type *requires* `fromIata`/`toIata` and the body is airport-timezone math and
>   flight-number dedup. Lodging gets its own preview/commit path. Nothing is shared
>   with the flight import at the service layer.
> - **`ColumnMappingWizard` is not domain-agnostic**, despite the adapter comment that
>   says future domains can plug in. It hard-codes the flight mapping shape, the flight
>   alias table and flight-specific i18n keys. It must be made generic first — which is
>   a change to **shipped, working flight-import code**, not a pure addition. That task
>   carries real blast radius and must keep the flight import green.

```
CSV ──► column mapping (LLM-suggested) ─┐
                                        ├─► candidates ──► editable preview ──► commit (batch)
email/PDF ──► template ──► LLM fallback ┘
```

### 3.1 CSV — a one-time migration tool (explicitly not the ongoing path)

Plugs into the existing `DomainImportPanel` by writing **one adapter file**
(`frontend/src/components/import/adapters/lodgingAdapter.tsx`). The shell, the
`ColumnMappingWizard` and the generic CSV tile already exist and are documented as
domain-agnostic ("future domains (hotels, POI, …) can opt in by writing one adapter").

1. **Mapping.** The header row plus three sample rows go to the LLM, which proposes a
   column mapping ("Anreise" → `checkIn`, "Bew. Zimmer" → `ratingRoom`). **The LLM is
   never in the critical path**: if it is slow, unreachable or wrong, a header-name
   heuristic fills in and the user maps by hand. (The owner's LLM runs on weak
   hardware and has timed out in production before — no feature may depend on it.)
2. **Shape detection.** The wizard infers from the confirmed mapping what the file
   holds:
   - only lodging fields → **places only** (the owner's case),
   - stay fields + a hotel-name column → **stays** resolved against existing lodgings
     (Alex's second file),
   - both → a flat table producing a lodging and its stay per row.
3. **Preview.** The full table is editable — but **questionable rows sort to the top**:
   unresolvable hotel name, ambiguous date, uncertain duplicate. The header states
   `198 new · 24 already present (skipped) · 10 need you`.
4. **Commit** writes everything under one `LodgingImportBatch`.
   **No geocoding during the commit.** The owner's file already carries coordinates,
   and where they are missing, Nominatim's 1 req/s policy would block for ~4 minutes on
   232 rows. Rows commit immediately; a background pass fills missing coordinates
   afterwards, throttled. A row without coordinates is valid — it simply has no map pin.

### 3.2 Email / PDF — the ongoing path

1. **Template first.** Six of the seven real samples are Booking.com German
   confirmations, and they are strictly structured — `Bestätigungsnummer`, hotel name,
   `Anreise`/`Abreise` with times, `Ihre Buchung` (nights + room category), `Lage`
   (full address), `Gesamtpreis` with currency. A deterministic template parser reads
   them instantly and offline. This is not a cost argument: the LLM path has timed out
   on the owner's hardware, a template never does.
2. **LLM only as a fallback** for senders no template matches (the seventh sample is a
   direct hotel booking). If it fails, the user lands in manual entry with the fields
   pre-filled — never in a dead end.
3. **Dedup** on `booking:<confirmation number>`.
4. Then the same editable preview as the CSV path — satisfying Alex's request to
   *correct recognition errors before the import commits*, on both paths at once.

`.msg`, `.eml` and `.txt` are already supported by the existing email route
(`@kenjiuno/msgreader`), which already branches by domain. Phase B adds the
`lodging` branch, not new infrastructure.

## 4. Location input (the Discord promise)

One component — `LocationInput` — used by the **hotel form**, the **trip-stop editor**
and later the **POI tab**:

1. **Type → suggestions.** Selecting one fills name, address, city, country **and**
   coordinates.
2. **Paste detects coordinates.** `47.3769, 8.5417` pasted into the field splits into
   lat/lon automatically (Alex's original request, verbatim). Plus Codes are out of
   scope for this iteration and are noted as a follow-up, as the channel said.
3. **A map pin** to fine-tune.
4. If neither is used, the existing geocode-on-save still runs.

**Geocoders (owner decision):** **Photon** (komoot, OSM, keyless) for search-as-you-type —
Nominatim's usage policy forbids per-keystroke queries — and **Nominatim** for the
one-shot geocode on save, where 1 req/s is fine. **Both URLs are configurable in
settings**, defaulting to the public instances, with a self-hosted URL accepted, exactly
as promised in the channel.

## 5. Error handling

- **The LLM never blocks.** Column mapping falls back to a heuristic; email parsing falls
  back to manual entry with pre-filled fields.
- **Geocoding never blocks a save** (already true) and never blocks an import commit.
- **A failed row never fails the batch.** Bad rows are surfaced in the preview and
  skipped on commit, with a count — never silently dropped.
- **A duplicate is skipped, not merged**, unless the user chooses otherwise in the
  preview. `externalRef` makes the safe case exact.
- Every import is revertible as a batch.

## 6. Testing

- **The 7 real booking confirmations are the parser fixtures** (`test-samples/Hotel
  Buchungen/`). They are the owner's *real* emails: they stay local, never enter a
  commit, a log, or a deployed instance. Assertions run against extracted values, not
  against the files themselves.
- Template parser: each of the six Booking.com samples yields hotel, check-in,
  check-out, nights, room category, address, total price + currency, confirmation number.
- Re-importing the same file/email is a no-op (`externalRef`).
- CSV: the owner's 232-place shape (no stays) and Alex's two-file shape (stays joined by
  hotel name) both import; unresolvable names surface in the preview rather than
  creating orphans.
- A row without coordinates commits fine and gets no pin.
- `LocationInput`: pasting `47.3769, 8.5417` splits into both fields; a failed geocoder
  leaves the form usable.

## 7. Out of scope

- Google Plus Codes (noted in the channel as "perspektivisch").
- Loyalty-account linking for live tier status — the owner already dismissed it
  (no universal API).
- The POI domain itself; `LocationInput` is merely built so POI can reuse it.
