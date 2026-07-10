# Trip Tab — Vision & Decomposition

**Date:** 2026-07-10
**Source:** Brainstorming with owner (abrechen2) + questionnaire answered by
collaborator Alex (alexkuenzel_58740). Raw answers were collected at
`travstats.de/umfrage/reise/` (now offline; questionnaire committed to TravStatsWeb
`feat/reise-fragebogen`).
**Branch:** written on `dev/hotels` alongside the existing
`2026-07-04-lodging-domain-design.md`.
**Status:** Vision spec — pending owner review before any implementation planning.

> This is an **umbrella / decomposition** document, not an implementation-ready spec.
> It sits *above* the Lodging spec (which is one concrete slice) and defines the
> shared trip-tab picture the individual slices build toward. Each slice gets its own
> detailed spec + plan. Nothing here is built until the owner reviews this and picks
> the first slice.

---

## 1. Why this exists

The trip tab already does a lot (timeline, map, gallery, journal, stats, AI summary,
Immich albums, auto-detection). The brainstorming was originally the owner's own
mental model; the questionnaire deliberately asked Alex **open questions first** so we
wouldn't just get our assumptions back. His answers agreed on the big direction but
introduced three things the owner's options never contained — and those three are what
this document is really about.

The single sentence that captures the vision, in Alex's words paraphrased:

> **A trip is a collection of heterogeneous activities on one central timeline,
> presented beautifully in a read-only View by default, with one edit toggle for the
> whole trip — and it should hold every kind of activity, not just flights and cruises.**

---

## 2. Decisions ledger (what is settled)

### Owner's five (from brainstorming)
1. **Plan and log, in the same trip object** — a trip has a prospective and a
   retrospective side; they are not separate trees.
2. **Depth: one state per activity** — no `planned`/`actual` field pairs, no parallel
   plan-vs-actual object trees. The original plan may be overwritten.
3. **Plan appears on the *existing* timeline**, visually distinguished (owner leaned
   toward an "Alles / nur Plan / nur Erlebt" filter) — **not** a sixth tab.
   `TripDetailPage.tsx` is already 1319 lines and the tab bar had a scrollbar bug (#155).
4. *(superseded — see Q8 below)* originally "time suggests → user confirms".
5. Decompose; the first slice was proposed as the plan-vs-actual data model.

### Alex's answers (endorsed by the owner)
- **A5 both-in-one-object; A7 same timeline, visually distinguished** — agree with the
  owner.
- **A6 "the plan is just a draft, gone once lived"** ≈ owner's "one state, overwritten".
  Same outcome; the original plan is not preserved either way. **Confirmed.**
- **The Übersicht tab is too empty → make the Timeline the *central object* of a trip**,
  opening in a nice read-only "View", not the editor.
- **Per-entry edit buttons annoy → one central "Bearbeiten" toggle** puts the whole trip
  into edit mode. In View mode a click opens the activity's *detail*; in Edit mode the
  same click opens its *editor*. Default: **past trips = View, future trips = Edit**.
- **More activity types**: hotels + POIs (planned) **and train, car, taxi, bus** — the
  thing he praised about TripIt was that *every* transport type was present.

### The one real conflict, resolved (Q8)
The owner originally chose "never auto-flip; user confirms" for stops, specifically
because of the `zombie_auto_flown` incident (auto-flipped flights fired phantom stats).
Alex chose **auto-flip by date, correctable**. **The owner resolved it in Alex's
favour.**

- **Decision:** an activity whose date has passed **auto-flips to `completed`/`flown`**,
  with a control to later mark it **cancelled ("ausgefallen")** or delete it.
- **This is already how the Lodging spec's §8.1 treats domain events** (flights/cruises/
  stays auto-flip once the date passes). The Q8 decision simply extends the same rule to
  the generic `TripStop`, making the whole system **consistent** instead of having stops
  behave differently from domain events.
- **MANDATORY mitigation (non-negotiable, this is the zombie lesson):** marking an
  auto-completed activity as cancelled or deleting it **must retroactively recompute
  stats, countries, and achievements** to remove its contribution. The correction path
  must be self-healing. The owner accepts the phantom-stat *window* between the date
  passing and a correction; they do **not** accept it becoming permanent. (Cf. the
  Lodging spec §9.2 "pair stay DELETEs with achievement cleanup" and the
  achievement-engine-is-monotonic lesson — generalize that to every activity type.)

---

## 3. Architecture: the two-tier activity model

The load-bearing design idea. Alex wants ~8 activity types; making each a full domain
(own model, parser, stats, achievements, seed data) would be absurd for a taxi ride.
The codebase already implies the right split:

### Tier 1 — Heavyweight domains
`flight`, `cruise`, `lodging` (and later a real `poi` domain). Each has its own Prisma
model, booking parser, stats, achievements, dashboard tab, and reference data. They
attach to a trip via a direct FK (`Trip.flights`, `Trip.cruises`, `Trip.lodgingStays`).
This is the cruise blueprint the Lodging spec follows. **New heavyweight domains are
expensive and deliberate.**

### Tier 2 — Lightweight TripStop activities
`train`, `car`, `taxi`, `bus`, `hike`, ad-hoc `poi` placeholders, "hotel TBD while
planning". These are **not domains.** They reuse the existing generic **`TripStop`**,
which *already* carries a `domain` label field (`poi`/`hotel`/`train`/`hike`/…), coords,
dates, title, notes, and `orderIdx`. A taxi ride is a `TripStop` with `domain='taxi'`,
not a `Taxi` model.

**Why this is the right cut:** the two tiers already exist in the code, unplanned.
Tier 1 is for things you log with rich structure and want statistics on; Tier 2 is for
"it happened, put it on the timeline" with minimal ceremony. The Lodging spec §8.1
already bridges them: a *tentative* hotel while planning is a `TripStop` with
`domain='hotel'` that **promotes to a real `LodgingStay`** once booked.

### What the timeline renders
The trip timeline merges, by date: Tier-1 domain events (via their FKs) + Tier-2
`TripStop`s + journal entries. It already does exactly this for flights/cruises/stops/
journal today. Adding train/car/taxi/bus is **adding `TripStop.domain` values + icons +
colours**, not new backend machinery.

### Plan-vs-actual lives in one field
Per the owner's "one state per activity": `TripStop` gains a **`status`** field aligned
with the existing cross-domain vocabulary (`scheduled | completed | cancelled`, matching
cruise; flight uses `scheduled|flown|cancelled`). A shared **derivation** maps any
activity's status into one timeline vocabulary so the View can style them uniformly
(planned = faint/dashed; completed = solid; cancelled = struck-through). This is a small
additive migration (one column), not a new axis — Tier-1 events already have `status`.

---

## 4. View vs Edit mode (Alex's biggest ask)

Today every timeline entry carries its own edit/delete buttons; the Übersicht tab is
thin. The redesign:

- **The Timeline becomes the trip's landing view**, presented read-only. Clicking an
  activity opens its **detail** (view), as a modal or detail page — not an edit form.
- **One central "Bearbeiten" toggle** flips the whole trip into Edit mode. In Edit mode
  the same click opens the activity's **editor**; add/reorder/delete controls appear.
- **Default mode by trip tense:** past/completed trips open in View; future/planned trips
  open in Edit. (Derivable from `Trip.status` / date range, which already exists.)
- The Übersicht stat boxes stay, but the Timeline is the centrepiece.

This is a **frontend-shaped** slice: a mode context threaded through the trip detail
page + timeline, view components for each activity type, and removal of the per-entry
buttons. It is independent of the domain work and independent of the plan/actual field.

---

## 5. Refactor prerequisites (must precede any addition)

Two files are already over/near the limits and adding to them makes it worse:
- **`backend/src/routes/trips.ts` = 824 lines** — over the 800 hard cap, 21 endpoints
  across 6 concerns. Any new trip endpoint must first **split** it (photos/cover, stops,
  journal into sub-routers). The Immich work already set the precedent (`routes/immich/*`).
- **`frontend/src/pages/TripDetailPage.tsx` = 1319 lines** — holds the page shell plus 3
  of 5 tab bodies inline. The View/Edit redesign should **extract the tab bodies into
  their own component files** (the Map/Gallery tabs are already separate — follow that).

Neither refactor changes behaviour; both are prerequisites, not features. A slice that
touches these areas owns the split for the part it touches.

---

## 6. Decomposition & sequencing

Sub-projects, each its own spec + plan. Ordered by dependency and by Alex's priorities
(he ranked **Hotels** as the next feature; his loudest *complaint* was View/Edit).

| # | Slice | What it delivers | Depends on | Notes |
|---|-------|------------------|-----------|-------|
| **S1** | **Lodging domain** | The whole hotels feature. **Already specced** — `2026-07-04-lodging-domain-design.md`, phases A/B/C. | — | Alex's #1 priority. The next concrete work. Proves Tier-1 for a new domain. |
| **S2** | **Timeline-as-centre + View/Edit mode** | §4. Trip landing = read-only timeline; one central edit toggle; per-entry buttons removed; tab-body extraction. | TripDetailPage split (§5) | Alex's loudest complaint. Frontend-shaped, domain-independent. Can run parallel to S1. |
| **S3** | **Lightweight activity types** | `TripStop.domain` gains `train`/`car`/`taxi`/`bus` (+icons/colours/i18n); `TripStop.status` field + shared status derivation (§3); plan/actual visual distinction on the timeline (owner's decision 2+3, Alex A6/A7). | S2 (uses the new timeline), trips.ts split (§5) | Small backend (one column, enum values) + timeline styling. |
| **S4** | *(deferred)* Documents/tickets vault, per-trip | File attachments on a trip (booking PDFs, tickets), offline. | trips.ts split | Alex A4 "vorher festhalten". Not yet scoped. |
| **S5** | *(deferred)* Budget & expenses | Owner's earlier sub-project; TravelSpend-style. | — | Only `Booking.price` exists today. |
| **S6** | *(deferred)* Export & share | ICS/CSV export; static tokened share link with read/edit config (Alex A10). | auth: needs a first unauthenticated code path | Alex wants shares configurable: read / all-edit / invited-edit. |
| **S7** | *(deferred)* Day-planner | Wanderlog-style per-day plan. | S2, S3 | Lowest fit for a logbook; only if demand appears. |

**Recommended immediate order:** **S1 (Lodging)** is the concrete next slice for this
worktree — it's already specced and it's Alex's top priority. **S2 (View/Edit)** is the
highest-value UX change and can proceed independently; sequence it right after (or in
parallel, since it barely touches the backend). **S3** needs S2's timeline to exist
first.

---

## 7. First slice for the hotels worktree

This worktree (`dev/hotels`) is **238 commits behind `main`** as of writing, and has an
old CLAUDE.md. **Before any implementation:**

1. `git merge main` in the worktree (carries the Immich work, the encryption fix, the
   current schema, the 800-line-cap files, etc.). Expect real conflicts in
   `schema.prisma` — merge carefully; do **not** rebase (CLAUDE.md rule).
2. Re-read the Lodging spec against the *merged* tree — a few "mirrors cruise X"
   references may have moved.
3. Then create the **Lodging Phase-A implementation plan** (writing-plans) from the
   Lodging spec.

S2 (View/Edit) is arguably a better *first* thing to build for the trip tab as a whole,
but it belongs on its own branch off current `main`, not on `dev/hotels`. **Owner
decides** whether the hotels worktree does S1 first (as its name implies) or whether we
open a separate branch for S2 first.

---

## 8. Open decisions for the review gate

1. **Tier-2 taxonomy (§3):** confirm train/car/taxi/bus are `TripStop.domain` values, not
   new domains. (Strongly implied by the existing `TripStop.domain` field; flagged for
   explicit sign-off.)
2. **Immediate order (§6/§7):** hotels worktree does **S1 (Lodging) first**, or open a
   branch for **S2 (View/Edit) first**? Alex ranked Hotels #1 but complained loudest
   about View/Edit.
3. **3D/flat map preference (Alex, secondary):** he finds the 3D flight arcs an acquired
   taste and wants a 3D/flat toggle in settings. Fold into S2, or a tiny standalone
   settings PR? Not yet placed in the decomposition.
4. **Cross-trip overview (latent, from Alex A11):** his biggest TripIt gripe was the lack
   of overviews *across* all trips. Not in any slice yet; note as a future dashboard want.

---

## 9. What this does NOT change

- The Lodging spec stands as-is; this document references it, doesn't supersede it. Its
  §8.1 lifecycle and the Q8 decision here are **aligned** (both auto-flip by date).
- No decision here contradicts an existing owner decision except Q8, which the owner
  explicitly re-decided (§2).
- Inherited constraints (TS strict, `any` forbidden, Zod at boundaries, Pino, files
  200–400/800 max, English code / DE+EN UI, domain-gating, never touch
  `VERSION`/`CHANGELOG` on a dev branch, sync-forward via `git merge main`) all apply.
