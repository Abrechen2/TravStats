# POI Domain — Handover

**Date:** 2026-08-23
**Branch:** `dev/poi-domain` (worktree `.claude/worktrees/bridge-cse_01Afwu211f547aqNWveF6c1Y`)
**State:** Phase A complete and verified. **Local only — pushed nowhere.** Nothing on `main`.
**Gate:** the domain is invisible to ordinary users (`poiDomain` in `config/betaFeatures.ts`),
so merging carries no release risk.

## What is on the branch

Eight commits: three docs, five feature.

| Commit | What |
|---|---|
| `cb66a519` | Design spec |
| `0ae594f0` | Mockup page + the colour findings that changed the design |
| `9db4797a` | Mockups redrawn in the product's real chrome |
| `c404d09d` | `Place` + `PlaceVisit`, migrations, API, domain turned on |
| `c51144c3` | List page, trip timeline, 17 API tests |
| `9cb18dfa` | The instance beta gate |
| `78b7d62d` | Create/edit form + detail page |
| `e1c764f5` | Three defects a browser found |

48 files, ~4 300 lines.

## The decision the whole thing rests on

Issue #177 asked that trip POIs and global POIs not become "two different kinds of POI".
That rules out the cheap option — projecting trip stops onto the global map — because a POI
would then exist only as an attachment to a trip: "every McDonald's I have been to" is
inexpressible, and the same place on two trips is two rows no count can reconcile.

So the place was promoted to a first-class entity and the trip became a **view** of it —
`Lodging`/`LodgingStay` mirrored exactly. #177 closes as a consequence of the model rather
than as a feature.

## Invariants someone will otherwise break

- **`Place.visited` defaults to `false`** — the opposite of `Lodging.visited`. Lodging chose
  `true` because every row predating the column was a real stay. Here the dominant creation
  path is *adding a target to a list*, and a wishlist entry silently counted as visited would
  inflate the headline number on day one.
- **Counting comes from data and dates, never a status string** (`shared/placeCounting.ts`,
  mirrored to the frontend). A visit dated in the future is not a visit. An **undated** visit
  *is* one — nobody enters a plan without a date, so treating the gap as "planned" would drop
  real history out of every total.
- **The migration pair is expand/contract and only the expand half exists.**
  `20260823150500_poi_backfill_from_trip_stops` copies and deliberately does not delete. The
  DELETE belongs **one release later**; until it runs, `isSupersededByPlaceVisit` in
  `lib/tripTimeline.ts` is what stops every migrated POI appearing twice. Its rule mirrors the
  migration's own WHERE clause, so the two cannot drift.
- **Coordinate-less POI trip stops are neither migrated nor deleted.** `places.lat/lon` is NOT
  NULL, and deleting a user's text to satisfy a schema was not acceptable. They stay trip stops.
- **No "colour by category" mode, ever.** Map pins are a scatter case; only about three
  categorical hues clear the all-pairs separation floor and there are eight categories.

## Verification

| | |
|---|---|
| Backend `tsc` + `lint` | clean |
| Backend places API tests | 17/17 |
| Backend routes + shared suites | all tests pass |
| Frontend `tsc` + `lint` | clean |
| Frontend tests | 311 files green |
| Migration | applied and asserted against real Postgres, including the rows designed *not* to migrate |
| Browser UAT | list, detail, POI tab, hard navigation |

**Not run here:** the full 319-suite backend sweep (long, and most of it is untouched by this
work), and Playwright E2E.

## Three defects the tests could not catch

All found by starting the stack and looking. Every unit test was green before and after each.
They are fixed and pinned, and are listed here because they are the shape of what this domain
will keep producing.

1. **`/places` bounced to the dashboard on every reload, bookmark and new-tab link.** Clicking
   through from inside the app worked, so nothing looked wrong. `betaFeaturesEnabled` is never
   persisted to localStorage while `enabledDomains` is — which is exactly why the other
   domains' routes survive a refresh and this one did not. Guards are three-state now.
2. **Place pins were invisible.** deck.gl's `TextLayer` builds its font atlas from a canvas and
   cannot render colour emoji: every category glyph drew an opaque black box *on top of* the
   teal dot. Not a missing label — a missing pin.
3. **The map legend printed the raw key `poi.legend.solid`.** The legend looks labels up by
   colour slot; the key had been written as `all`.

## What is NOT built

- **Phase B — custom lists.** The owner's actual "every McDonald's" case. `lib/placeColor.ts`
  already reserves the `list` colour mode and explains why it is absent until a list has a
  colour to resolve.
- **Phase C — shipped checklists** (New 7 Wonders etc.) with photo proof.
- **Places on the All tab.** When they are added, that layer needs its **own distinct mark** —
  POI teal against cruise blue measures below the normal-vision separation floor, and the glyph
  that was meant to carry it turned out to be unrenderable. A colour will not do it. The note
  sits in `placePinsLayer.ts` where someone would need it.
- **A POI section in the map appearance panel.** `AppearanceDomain` still has no `poi` slot; the
  tab brings its own mode switcher and legend instead.
- **The contract migration** (see invariants).

## The one decision still open

**Curated checklists: lazy materialisation vs. copy-on-subscribe.** Recommendation: lazy —
subscribing creates one row and a target becomes a real `Place` only when ticked.
Copy-on-subscribe caps how large a shipped list can sensibly get and freezes catalogue
corrections, which matters for the lists that obviously follow (UNESCO ~1200 sites, national
parks). The cost of lazy is that the checklist screen is the one screen rendering two kinds of
row.

**It gets expensive after Phase C ships**, because it changes what the user's own rows mean.
Worth settling before C starts.

## Environment left behind

- **Scratch databases on the dev Postgres (`localhost:5433`): `poi_wt` and `poi_wt_shadow`.**
  Deliberately created so the shared `flights_dev` was never migrated against. `poi_wt` has the
  full migration history, seeded catalogues, the `admin`/`admin123` account and five sample
  places. Kept because Phase B will want them; drop with `DROP DATABASE` when done.
- Dev servers started for the browser check have been stopped.
- `roadmap.local.yaml` (in `TravStats-local`) is updated but **left uncommitted**, because it
  already carried someone else's in-flight deploy-state edits that are not mine to commit.
