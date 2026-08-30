# Lodging rating categories become a fixed, switchable vocabulary — design

**Date:** 2026-08-25
**Rides:** 2.6.0 (branch `feat/lodging-rating-categories`)
**Status:** DRAFT — three decisions at the end are the owner's, and nothing
should be built before they are answered
**Origin:** the owner, 2026-08-24: he does not use *Frühstück*, and wants *Bett*
and *Parkplatz*. He also decided the shape: **a fixed stock of categories to
switch on and off, not freely nameable ones.**

## Problem

A stay can be rated in exactly three categories, and they are hard-coded three
times over: as columns (`ratingRoom`, `ratingBreakfast`, `ratingService` —
`backend/prisma/schema.prisma:1341-1343`), as three named fields in the deriver
(`backend/src/shared/ratingDerivation.ts:47`), and as three pickers in the
editor (`frontend/src/components/lodging/StayEditorRatingsSection.tsx:44-61`).

For a traveller who never eats in the hotel, one of his three slots is dead
weight, and the two things he actually judges a room by — the bed and whether he
could park — have nowhere to go. Worse, an unused category is not merely
useless: *Frühstück* left blank is indistinguishable from *Frühstück* not
offered, and the overall average silently becomes a mean of two.

Free-text categories were considered and **rejected by the owner**. The reason
is sound and worth recording: user-named categories cannot be aggregated. The
whole quality tab — "Ketten, nach deinem Urteil", "Länder, nach deinem Urteil"
(`backend/src/utils/lodgingStats/quality.ts:104-106`) — depends on two stays in
different countries having rated *the same thing*. "Bett" and "Betten" would be
two categories, and every ranking would quietly fragment.

## Verified before designing

Measured in this checkout, not transcribed:

- `prisma migrate diff --from-migrations --to-schema-datamodel` reports **an
  empty migration**. `prisma migrate dev` is usable normally; migrations do not
  need hand-writing.
- **`UserSettings.enabledDomains String[] @default(["flight"])`
  (`schema.prisma:430`) is a real column**, not a key in the `data` JSON. It is
  the exact precedent for this feature: a per-user subset of a vocabulary the
  code owns. This design follows it rather than inventing a second pattern.
- The overall rating is a **cache**, not an input: `ratingOverall` is re-derived
  on every write (`backend/src/routes/lodging.ts:564-569` on create, `757-765`
  on update) and the editor offers no picker for it — pinned by
  `frontend/src/components/lodging/__tests__/StayEditor.test.tsx:478`.
- The deriver falls back to a source-supplied `current` when no component
  exists (`ratingDerivation.ts:50`). That path exists for imports and legacy
  rows and must survive.
- The PATCH merge distinguishes "not sent" from "explicitly cleared"
  (`backend/src/routes/lodging.ts:732-735`). `??` would collapse the two and
  make a cleared rating un-clearable.
- Ranges are `z.number().min(1).max(5)` with **no `.int()`**
  (`backend/src/schemas/lodging.ts:42`) — half stars are valid, `0` is not, and
  `null` is the only "unrated".
- The three columns are `Float?` with **no default**, and a data-only migration
  already backfilled the cache once
  (`20260809093215_backfill_stay_overall_rating`).

Two pre-existing asymmetries found while surveying, both worth fixing while we
are in here:

- `backend/src/services/lodging/mappingSuggestion.ts:23-25` never offers
  `ratingService` to the column-mapping LLM, although
  `frontend/src/lib/importers/lodgingCsv.ts:91` defines German aliases for it.
  A "Bew. Service" column is therefore mappable by hand and invisible to the
  suggestion.
- `backend/src/services/lodging/lodgingCandidates.ts:46-48` explicitly nulls
  room/breakfast/overall and never mentions service.

## The vocabulary

One list, owned by the code, mirrored the way `shared/domains.ts` already is:
`backend/src/shared/ratingCategories.ts` + `frontend/src/shared/ratingCategories.ts`.

| key | DE | EN |
|---|---|---|
| `room` | Zimmer | Room |
| `bed` | Bett | Bed |
| `bathroom` | Bad | Bathroom |
| `cleanliness` | Sauberkeit | Cleanliness |
| `breakfast` | Frühstück | Breakfast |
| `service` | Service | Service |
| `location` | Lage | Location |
| `parking` | Parkplatz | Parking |
| `wifi` | WLAN | Wi-Fi |
| `quiet` | Ruhe | Quiet |

**Deliberately NOT in the list: "Preis-Leistung".** The quality tab already
computes value as `ratingOverall / pricePerNight`
(`backend/src/utils/lodgingStats/quality.ts:118-121`). A hand-given
price-performance score would sit on the same screen as that arithmetic and
disagree with it, and the reader would have no way to tell which one to believe.
One value figure, derived from the price actually paid.

`AVAILABLE_RATING_CATEGORIES` is iterated everywhere the way
`AVAILABLE_DOMAINS` is; no code path may name a category literally.

## Storage

**A child table**, `LodgingStayRating`:

```prisma
model LodgingStayRating {
  id       String      @id @default(uuid())
  stayId   String      @map("stay_id")
  stay     LodgingStay @relation(fields: [stayId], references: [id], onDelete: Cascade)
  category String
  value    Float
  @@unique([stayId, category])
  @@map("lodging_stay_ratings")
}
```

Why not the two alternatives:

- **More columns** (`rating_bed`, `rating_parking`, …) keeps today's shape and
  costs a migration for every future category. Ten nullable floats also make
  "which categories did this stay rate" a ten-way null check in every consumer.
- **A JSON map on the stay** needs no migration ever, but nothing stops a typo'd
  key from persisting, and this repo has a standing gotcha about Prisma JSON
  casting. The unique index is the point: one value per category per stay,
  enforced where it cannot be argued with.

`ratingOverall` **stays** as a column. It is the cache the list sort
(`backend/src/routes/lodging.ts:150-151`), the chain average
(`backend/src/routes/lodgingChains.ts:123`) and every ranking read; turning it
into a join-and-average would be a large, unrelated change.

Migration, in two steps so neither can half-apply:

1. Schema migration creates the table.
2. Data-only migration copies each non-null `rating_room` / `rating_breakfast` /
   `rating_service` into a row, then **leaves the old columns in place**.

Dropping the three columns is a separate, later migration — after a release has
run on real data and the new table has been seen to be complete. A rollback in
between must not lose the user's judgements.

## Which categories a user sees

`UserSettings.lodgingRatingCategories String[] @default(["room", "breakfast", "service"])`.

The default is **today's three**, deliberately: an existing instance must show
exactly what it showed before the upgrade, and the owner switches his own set
afterwards. A new account gets the same three for the same reason — one rule, no
branch, nothing to explain in a changelog.

Validation is the same shape as `enabledDomains`: every entry must be in the
vocabulary, duplicates rejected, and **the empty set is allowed** — someone who
does not want to rate anything should be able to say so, and the editor then
shows no rating section at all.

## The rule that keeps toggling safe

> **The overall is the mean of the values a stay HAS — never of the categories
> currently switched on.**

This is the load-bearing decision. The tempting alternative — average the active
categories — means switching *Frühstück* off silently rewrites the overall of
every past stay the next time it is touched, because `ratingOverall` is derived
on write. The user would change a preference and watch history move.

So: `deriveStayOverallRating` takes the stay's rating rows, ignores the active
set entirely, and keeps its current arithmetic — unweighted mean, rounded to the
nearest half star, `current` as the fallback when there are no rows. Its
existing tests stay valid.

**A rating in a switched-off category is shown, not hidden.** The editor renders
it below the active pickers, labelled as a category the user no longer uses,
with the clear (×) button that `StarRatingInput` already has
(`frontend/src/components/lodging/StarRatingInput.tsx:78`). The user decides
whether that old breakfast score is history worth keeping or noise worth
deleting. Hiding it while it still moved the overall would be the same class of
defect as the backup that silently dropped photo directories.

## What follows

**Stats** (`backend/src/utils/lodgingStats/quality.ts`). The four fixed
accumulators become a map keyed by category, each with its own denominator — the
"nulls skipped, own denominator" behaviour at lines 81–92 is already right and
just needs to be generic. `LodgingRatingStats.byCategory: Record<string, …>`
replaces the named `room`/`breakfast`/`service` fields. The quality tab renders
one block per category **that has at least one rating**, so a user who never
rated parking never sees an empty parking row.

**Achievements — the one that needs a decision.** `PERFECT_STAY_1`
("Nichts zu beanstanden", `backend/src/data/achievementSeeds/partE.ts:37`)
currently requires 5/5 in *all four* ratings
(`backend/src/utils/lodgingStats/index.ts:140-146`), and "all four" stops
meaning anything once the count varies. Proposal: **at least three categories
rated, and every rated category is a 5.** The floor matters — without it, a
single 5 in a single category would earn a gold achievement. The German text
needs rewriting either way.

Note the hazard: any rule change can retroactively *revoke* an unlocked
achievement. The proposed rule only ever grants more (a 5/5/5 stay under the old
rule satisfies the new one), which is the property to preserve.
`ENDURED_STAY` (`ratingOverall <= 2`) and `RATED_STAYS` are untouched — both read
the overall or a count.

**Import.** `lodgingCsv.ts` gets its alias table generated from the vocabulary
(`bewzimmer`, `bewbett`, `bewparkplatz`, …) rather than hand-written per
category, and `mappingSuggestion.ts` offers the whole vocabulary — which fixes
the missing-`ratingService` asymmetry as a side effect. The booking parser
still extracts no ratings; a booking confirmation has none.

**i18n.** One key per category under `lodging:ratingCategory.*`, DE and EN in
the same change. The existing `field.ratingRoom` / `field.ratingBreakfast` /
`field.ratingService` keys are replaced by it; `field.ratingOverallDerived`
("Ø aus Zimmer, Frühstück und Service") must become generic — it names the three
categories today and would lie the moment the set changes.

**API.** Stay create/update accept `ratings: Array<{category, value}>` and the
response carries the same. The three legacy field names stay **accepted** on
input for one release so the CSV importer and any external caller keep working,
mapped onto the new rows on the way in.

## Not in scope

- Weighting categories against each other. The mean is unweighted today and
  nobody has asked for more.
- Per-chain or per-country category sets.
- Rating anything other than a lodging stay. POI has its own `PlaceVisit.rating`
  (`schema.prisma:1564`) and is not touched.

## Decisions for the owner

1. **The vocabulary above** — ten entries. Anything missing, anything to cut?
   ("Preis-Leistung" is excluded on purpose; see the reasoning above.)
2. **The perfect-stay rule** — "at least three categories rated and all of them
   5". Is three the right floor?
3. **Scope** — does this ride 2.6.0, which is already at rc.14 and carries the
   lodging domain, or does it wait for 2.7.0? It is a schema change plus a
   settings surface, which is not a small addition to a release that is already
   in candidate rounds.
