# Trip suggestions v2 — one gate, one memory, one stream

Owner, 2026-11-23: the trip detection needs a big overhaul; above all a rejected
proposal and the off switch must never nag. Branch `feat/trip-suggest-v2`.

## Starting point (measured)

- **Engine A** (`services/tripSuggestions/`): computed on demand behind
  `GET /trip-suggestions` and `/count`; answers in `trip_suggestion_decisions`;
  a dismissed proposal returns once its member set changes by Jaccard < 0.5.
- **Engine B** (`services/locationEvidence/trips/`): the nightly TravTrack sweep
  writes `location_suggestions` rows of kind `trip`. It ignored
  `user_settings.trip_suggestions_enabled` — prod has the switch off and five
  pending TravTrack trip rows, all overlapping existing trips.
- A rejection was never tied to a day span: extend/assign keyed on the target
  trip, place visits on the exact fingerprint.

## Decisions

1. **One gate.** `tripSuggestionsEnabled` is read by engine A's routes (as
   before), by `suggestTrips` (before the read and again under the lock) and the
   sweep's account query, by the pending `location-suggestions` list (kind
   `trip` is hidden, never deleted) and by accepting/rejecting a TravTrack trip
   question (409 `TRIP_SUGGESTIONS_DISABLED`). The Companion uses these same
   endpoints; no separate notification path exists for trip questions. Back on,
   the hidden rows show again and the sweep resumes.
2. **Rejection memory = day span + home signature.** A dismissal stores
   `start_day`/`end_day`, the home it was judged against (`home_signature`,
   `lat,lon` to two decimals; null where unknown, e.g. TravTrack) and its
   `source`. A later trip-family candidate (new trip, assign, extend, TravTrack
   trip) that overlaps a dismissed span by at least one day, under a compatible
   home (both known and more than `AWAY_KM` apart = different home), stays
   suppressed — unless it is **more than double** the rejected span's days, in
   which case it is asked once more, flagged `expanded` ("erweitert"). A
   place-visit dismissal suppresses any visit proposal for the same place whose
   day it covers. Old decisions without a span stay valid: their span is
   derived from the members still in the logbook; where none can be derived the
   previous Jaccard/fingerprint rule applies. Unticked members on accept keep
   the member-set rule (no span), so they do not hide later entries of the
   trip just made.
3. **Quiet period.** For `trip_suggestion_quiet_days` (per account, default
   14, 0–90, `tripSuggestions.quietDays`) after a dismissal even an expanded
   candidate over the same span is not asked.
4. **One decision table.** TravTrack answers (rejected/accepted) are written to
   `trip_suggestion_decisions` too (`source = travtrack`, fingerprint
   `travtrack:<evidence key>`); the migration copies every answered TravTrack
   trip row there. Engine A reads them, so a rejected TravTrack period also
   silences engine A over the same days, and the other way round.
5. **One stream.** `services/tripSuggestions/stream.ts` merges A's proposals and
   B's pending trip rows before display: B rows suppressed by the memory, rows
   whose days existing trips cover by more than 50 %, and rows overlapping one
   of A's trip proposals (A has entries, so it wins) are dropped; a new-trip
   candidate of A whose days trips cover by more than 50 % is dropped. A's
   absence already becomes extend/assign when it touches a trip's window, so
   extend is preferred over new trip. At most **3 open cards** across both
   sources, newest first; `/count` is that number (0 when off).
6. **New inputs.** Package bookings: entries sharing a `bookingId` are glued
   into one absence (signal `package`). Purpose: a candidate whose members all
   carry `purpose = business` is proposed with `purpose: "business"`, and
   accepting it as a new trip sets `category = business`. TravTrack stays enter
   through B's away runs (merged as above). Inferred home days
   (`fix/travtrack-home-silence`, not on main yet) plug in at `awayPeriods`
   classification: a day it infers as home ends a run, so no change is needed
   here once it lands.
7. **Reset.** `POST /trip-suggestions/rejections/reset` deletes the account's
   dismissed decisions and its rejected TravTrack trip rows (so the sweep may
   ask again); Settings → Reisen & Vorschläge has "Abgelehnte zurücksetzen".

## Contract delta (additive)

- `TripSuggestion`: `expanded?: true`, `purpose?: "business"`, signal `package`.
- `GET /trip-suggestions`: `suggestions` capped at the stream's share of the 3
  open cards; `total` is the stream's uncapped count.
- `POST /trip-suggestions/rejections/reset` → `{ reset: number }`.
- Settings: `tripSuggestions.quietDays` (int 0–90).

## Open

- B's own sweep still never re-creates a question over an answered TravTrack
  row; the expanded re-ask therefore reaches TravTrack-only periods only after
  a reset.
