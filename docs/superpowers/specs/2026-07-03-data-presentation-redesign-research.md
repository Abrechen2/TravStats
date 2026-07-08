# Data Presentation & Engagement Redesign — Cited Guidelines + Proposal

**Date:** 2026-07-03
**Scope:** BOTH surfaces — TravStats web frontend (React/Vite) and TravStatsApp (Expo/RN)
**Origin:** Owner directive 2026-07-02 — TravStats feels off "from the data-viewing
side and the stickiness side"; it must show everything, calculate properly, and
make people want to come back. This doc is the research deliverable: verified,
cited guidelines mapped onto a concrete redesign proposal.

**Method:** Deep-research workflow (5 search angles, 25 sources fetched, 121
claims extracted, top 25 adversarially verified with 3 independent refutation
votes each — 24 confirmed, 0 refuted). Track-1 (data-viz) principles below are
adversarially verified; Track-2 (engagement) principles carry verbatim quotes
from the fetched primary/secondary sources but did not go through the 3-vote
pass — treat their *numbers* as vendor-reported.

---

## Part A — Guidelines catalog (cited)

### Track 1: Dashboard & data-visualization

**G1 — Overview first, detail on demand (progressive disclosure).**
Show only the few most important things initially; defer the rest behind one
interaction. This measurably improves learnability, efficiency, and error rate.
Hiding secondary detail does *not* harm users' mental model — people understand
a system better when the design prioritizes for them.
→ https://www.nngroup.com/articles/progressive-disclosure/ (verified 3-0)

**G2 — Everything frequently needed must be up front.** Progressive disclosure
fails if users must drill down for daily needs. Decide the split empirically
(frequency of use), not by designer intuition.
→ https://www.nngroup.com/articles/progressive-disclosure/ (verified 3-0)

**G3 — Three data altitudes.** Structure stats as macro (totals/averages) →
mid-level (useful subsets) → individual data points. This maps 1:1 onto
hero-KPIs → insight modules → drill-down detail.
→ https://developer.apple.com/design/human-interface-guidelines/charting-data (verified 3-0)

**G4 — Every chart carries its takeaway as text.** Title/subtitle/headline must
state the key message ("Chance of light rain in the next hour") so users grasp
it without reading the chart. Interpretive deltas ("up 12% vs. last 30 days")
make the text meaningful.
→ https://developer.apple.com/design/human-interface-guidelines/charting-data (verified 3-0)
→ https://developer.apple.com/videos/play/wwdc2022/110342/ (verified 3-0)

**G5 — Charts sparingly; a chart is an attention signal.** Only the most
important information should become a chart; an effective chart focuses on a
few key pieces of information. Argument against chart-dense, redundant
dashboards.
→ https://developer.apple.com/videos/play/wwdc2022/110342/ (verified 3-0)
→ https://developer.apple.com/videos/play/wwdc2022/110340/ (verified 3-0)

**G6 — Sparkline preview → expanded chart, with continuity.** Small static
preview charts (no grid lines, no labels, no interactivity) sit higher in the
navigation hierarchy and link to full interactive versions. The expanded chart
must keep the same type, colors, marks, annotations, and visible numbers —
changing the picture on drill-down is disorienting.
→ https://developer.apple.com/videos/play/wwdc2022/110340/ (verified 3-0)
→ https://developer.apple.com/videos/play/wwdc2022/110342/ (verified 3-0)
→ https://developer.apple.com/design/human-interface-guidelines/charting-data (verified 3-0)

**G7 — Current values need history.** A KPI without trend context is not
meaningful; history is the most useful context for a measure of current
activity. Sparklines are "often ideal for dashboards". When comparing
magnitudes across sparklines, use a shared zero-based scale with filled area;
when comparing shapes, per-series min-max scale is fine (but flag it).
→ https://www.perceptualedge.com/articles/visual_business_intelligence/best_practices_for_scaling_sparklines.pdf (quoted)

**G8 — Encode quantity as length/2D-position, never area/angle/color.** Length
and 2D position are the fastest, most accurate preattentive encodings. Pie
charts encode by area+angle and are only readable near 0/25/50/75/100%; bars
beat pies for part-to-whole comparison ("a 3% difference … practically
invisible in a pie"). Multiple pies over time are the worst option — a line of
percentages shows change far better. Bar charts require a zero baseline. Color
must never encode magnitude and never be the only channel (pair with
shape/pattern; required contrast; Dark-Mode palettes).
→ https://www.nngroup.com/videos/data-visualizations-dashboards/ (verified 3-0)
→ https://www.nngroup.com/articles/dashboards-preattentive/ (quoted)
→ https://www.perceptualedge.com/articles/visual_business_intelligence/save_the_pies_for_dessert.pdf (quoted)
→ https://www.datawrapper.de/blog/chart-types-guide (quoted)
→ https://developer.apple.com/videos/play/wwdc2022/110340/ (verified 3-0, zero-baseline)
→ https://m3.material.io/blog/data-visualization-accessibility (verified 2-0, color)

**G9 — Details on demand without leaving the screen; interaction optional.**
Supplemental precision lives in tooltips/overlays on the primary screen.
Critical information must be visible *without* interaction; scrubbing/
drill-down is enrichment (Stocks pattern). Mobile: touch-and-hold tooltip;
touch targets padded to the full chart height, not mark-sized.
→ https://www.nngroup.com/articles/complex-application-design/ (verified 3-0)
→ https://developer.apple.com/design/human-interface-guidelines/charts (quoted)
→ https://m2.material.io/design/communication/data-visualization.html (verified 2-0)
→ https://developer.apple.com/videos/play/wwdc2022/110340/ (verified 3-0, touch targets)

**G10 — Reduce clutter by removal, not just emphasis; never remove capability.**
Making KPIs stand out is achieved as much by deleting nonessential elements as
by emphasizing important ones. Clutter reduction must not cost features. NN/g's
three complexity strategies: predictable placement, clear hierarchy,
progressive disclosure.
→ https://www.nngroup.com/articles/complex-application-design/ (verified 3-0)
→ https://www.nngroup.com/videos/managing-visual-complexity/ (verified 3-0)

**G11 — One focal point; same scales for comparable data; familiar chart
types.** A dashboard prioritizes via layout and displays a single focal point
(color, position, size, weight), arranged around the questions users ask of the
data. Comparable datasets (flights vs. cruises) stay on identical scales.
Prefer familiar forms (bar/line; M3 explicitly blesses donuts for
part-to-whole); a novel form must be taught and central, not supplementary.
"Presentation dashboard" archetype: a few small charts or a scorecard with
dynamic headlines that verbalize each chart's insight.
→ https://m2.material.io/design/communication/data-visualization.html (verified 2-0)
→ https://m3.material.io/blog/data-visualization-accessibility (verified 2-0)
→ https://developer.apple.com/design/human-interface-guidelines/charting-data (verified 3-0)

**G12 — Small multiples for many series; device-class split.** Spaghetti
multi-line charts → one panel per series (sorted by a stated metric). Treemaps
only for hierarchical data, never for precise comparison. Glanceable surfaces
(widgets/watch) show today/simple; the bigger companion surface carries longer
ranges and richer interaction.
→ https://www.datawrapper.de/blog/chart-types-guide (quoted)
→ https://www.datawrapper.de/blog/what-to-consider-when-creating-small-multiple-line-charts (quoted)
→ https://www.nngroup.com/articles/treemaps/ (quoted)
→ https://developer.apple.com/design/human-interface-guidelines/charts (quoted)

### Track 2: Ethical engagement ("stickiness")

**E1 — Milestone celebrations measurably retain.** Duolingo: streak-milestone
animations alone → +1.7% D7 retention for new users; 7-day streak → 3.6×
course completion, 2.4× next-day return. Hard-earned achievements retain far
better than trivial ones (74.2% vs 32.3% retention by difficulty bucket,
Trophy data).
→ https://blog.duolingo.com/how-duolingo-streak-builds-habit/ (quoted, primary)
→ https://trophy.so/blog/strava-gamification-case-study (quoted, vendor data)

**E2 — Forgiveness beats punishment.** More streak freezes → *more* DAU
(+0.38%); freezes applied silently (no shame popup); low thresholds (any
activity counts → +40% more 7-day streaks); grounded in UPenn/UCLA research
that "slack" beats rigid rules. Loss-aversion is the dark side of streaks —
broken-streak anxiety is the canonical failure mode.
→ https://blog.duolingo.com/how-duolingo-streak-builds-habit/ (quoted)
→ https://duolingo.deconstructoroffun.com/mechanics/streaks (quoted)
→ https://uxmag.com/articles/gamification-or-manipulation-understanding-the-ethics-of-engagement-loops (quoted)

**E3 — Match the cadence to the real behavior.** Strava deliberately uses
*weekly* streaks — daily would break for reasons outside users' control. Local
Legend rewards *consistency in a rolling 90-day window*, not speed; thousands
of hyper-local segment leaderboards let ordinary users plausibly rank. For a
travel logbook (trips are episodic!), daily streaks are the wrong mechanic;
rolling windows and consistency framing are right.
→ https://trophy.so/blog/strava-gamification-case-study (quoted)

**E4 — Recap = narrative, not analytics.** Wrapped reframes stats as story
("You spent 788 hours finding yourself", not "47,283 minutes"), reveals them
in paced chapters (progressive disclosure as drama), and drives ~227M sharers.
→ https://uxplaybook.org/articles/spotify-wrapped-ux-design-lessons (quoted)

**E5 — Design the share artifact first.** Platform-native aspect ratios,
premium illustration quality. Duolingo's share-card redesign alone → 5–10×
organic sharing, 6M daily streak shares. Flighty's Passport pairs lifetime
stats with custom shareable artwork.
→ https://duolingo.deconstructoroffun.com/mechanics/streaks (quoted)
→ https://developer.apple.com/news/?id=970ncww4 (quoted, Apple editorial on Flighty)
→ https://uxplaybook.org/articles/spotify-wrapped-ux-design-lessons (quoted)

**E6 — Ambient presence over attention capture.** Flighty's engagement comes
from persistent calm information (Live Activities/Dynamic Island — "you don't
have to check your phone"), departure-board information hierarchy (one line
per flight, "50 years of figuring out what's important"), and shining when
things go wrong (offline-capable minimal visualization).
→ https://developer.apple.com/news/?id=970ncww4 (quoted)

**E7 — The ethics tests.** A deceptive pattern = business outcome at the
user's expense (NN/g); deception producing unintended choices (academic
definition, arXiv scoping review). Ethical gamification requires user control /
opt-out (Nike Run Club, Apple Fitness cited), transparency about how the
system works, and rewards that amplify existing behavior instead of
manufacturing artificial goals (Wrapped lesson). Overjustification caveat:
external rewards on already-enjoyed activities can erode intrinsic motivation.
Five-question checklist: user control? builds intrinsic motivation? meaningful
rewards? honest about psychological effects? would you recommend it to someone
you care about?
→ https://www.nngroup.com/videos/avoid-deceptive-patterns/ (quoted)
→ https://arxiv.org/pdf/2405.08832 (quoted)
→ https://uxmag.com/articles/gamification-or-manipulation-understanding-the-ethics-of-engagement-loops (quoted)
→ https://uxplaybook.org/articles/spotify-wrapped-ux-design-lessons (quoted)

---

## Part B — Gap map: TravStats today vs. guidelines

Web inventory (agent-verified 2026-07-02, file refs in memory) × guidelines:

| # | Weakness (web) | Violates |
|---|---|---|
| 1 | Wall of ~50+ StatCards, no hierarchy (AdvancedStatsPage.tsx:633-749) | G1, G3, G5, G10, G11 |
| 2 | No drill-down; nearly every metric is a dead end | G1, G3, G9 |
| 3 | All-time KPIs are bare numbers; comparison only in explicit compare-mode | G4, G7 |
| 4 | Charts non-interactive beyond hover tooltip; no click-to-filter | G9 |
| 5 | Flights-per-time drawn 4×, airline stats 3×, year KPIs 3× | G5, G6, G10 |
| 6 | No part-to-whole chart; seat class/status/continent as number lists | G8, G11 |
| 7 | Two heatmaps with different color languages | G6, G11 |
| 8 | Calendar-year granularity only; no rolling windows (backend supports fromDate/toDate!) | G7, E3 |
| 9 | Records/superlatives inert text tiles; no map highlight, no hero treatment | E1, E4, E5 |
| 10 | Fragmented IA; /stats/routes orphaned (components/Stats.tsx dead code) | G2, G10, G11 |

App counterpart (2026-07-02 audit): dashboard = static card list; stats screen
computes locally instead of /stats/*; no time-range control; no YoY; records
not surfaced; engagement primitives exist (passport reveal, Wrapped, confetti,
reminders, on-this-day) but there is **no recurring loop** — nothing changes
day to day beyond on-this-day. → violates G3, G4, G7; underuses E1–E5.

---

## Part C — Redesign proposal

### C1. Shared information architecture (both surfaces)

Adopt the three-altitude structure (G3) as the spine of every stats surface:

1. **Altitude 1 — Hero scorecard (4–6 KPIs max).** Each KPI = value + headline
   takeaway (G4) + label-free sparkline (G6/G7) + delta vs. previous rolling
   window (G7). Default-on trend context — no compare-mode required. Everything
   else moves down a level (G1/G2: flights count, distance, countries, hours are
   the "frequently needed" set; CO₂-in-elephants is not).
2. **Altitude 2 — Insight modules.** One canonical time-series module (kills
   the 4× redundancy, G5/G6): a single bar/line chart with range switcher
   (12-months rolling default | calendar year | all-time) fed by the already
   existing `fromDate/toDate` on `/stats/summary` (gap #8). One part-to-whole
   module (G8/G11): horizontal bars (or M3-blessed donut for ≤5 slices) for
   seat class / status / continent, replacing number lists. One geo module.
   One rankings module (airlines/airports/aircraft/routes — resurrect
   `/stats/routes`, gap #10).
3. **Altitude 3 — Detail.** Every KPI, chart segment, ranking row and record
   drills into the *filtered flight/cruise list* (G9): stat → pre-filtered
   FlightsTablePage on web (URL params), stat → filtered list screen in-app.
   Rule: **no dead-end numbers.** Anything countable links to the rows that
   produced it.

Cross-cutting rules: one heatmap component, one color language (gap #7, G6);
comparable flight/cruise KPIs on identical scales (G11); charts only where
they earn attention (G5); zero-baseline bars, no magnitude-by-color (G8);
preview→expanded continuity — the tile sparkline and the expanded chart are
the same component in two sizes (G6).

### C2. Web specifics

- **AdvancedStatsPage** → restructure from scroll-of-everything into
  scorecard + modules + collapsed "More stats" (staged disclosure, G1/G10).
  Trivia (CO₂ elephants etc.) lives behind one expander, not beside hero KPIs.
- **Click-to-filter everywhere** (gap #4): chart bars/segments/heatmap cells
  set the same filter state the table understands.
- **Records become hero moments** (gap #9): "longest flight" renders as a
  map-highlighted route card with a share affordance, not a text tile;
  "first-ever flight" gets an anniversary surface (E1/E4/E5).
- **IA consolidation** (gap #10): Dashboard = map-first + scorecard;
  AdvancedStats = the numbers home; kill orphaned components/Stats.tsx after
  porting its /stats/routes consumption.

### C3. App specifics

- Stats screen consumes `/stats/*` instead of computing locally (single source
  of truth, and it unlocks rolling windows server-side).
- Dashboard adopts the same scorecard: KPI + sparkline + delta tiles (G6:
  no-label sparklines; G9: full-height touch targets, touch-and-hold tooltip).
- Time-range control + YoY delta chips (G7).
- Records surfaced in-app with celebration + share card (E1/E5; celebration
  primitives already exist).
- Device-class split (G12): widget/glance = today + one number; app = ranges +
  interaction.

### C4. Engagement loop (ethical, per E-guidelines)

- **No daily streaks.** Travel is episodic — wrong cadence (E3). Instead:
  *travel-year progress* (rolling 12-month window: countries, flights, km vs.
  same window last year) and *consistency framing* ("5th month in a row with
  a trip") — Strava's rolling-window model.
- **Recap rhythm:** monthly mini-recap (only when the month had activity) +
  year-end Wrapped (exists in-app; add web) — narrative framing, chapter-paced
  reveal (E4), share artifact designed first (E5), DE/EN.
- **Milestones & PRs:** new country/airport/airline, round-number flights,
  personal records (longest/highest/fastest) → celebration moment + share
  card. Keep them hard-earned (E1) — no confetti for opening the app.
- **Ambient layer (app):** upcoming-trip countdown and on-this-day as the calm
  daily-changing surface (E6) — information presence, not notification spam.
- **Guardrails (E7):** every engagement feature opt-outable in settings;
  transparent mechanics; no guilt copy ("Du hast X verloren…" is banned);
  rewards only amplify real logged travel. Apply the five-question checklist
  in review for each new mechanic.

### C5. Suggested phasing

1. **Wave A (foundation, both):** canonical time-series module + rolling
   windows (backend params exist); scorecard with sparkline+delta; app
   switches to /stats/*.
2. **Wave B (drill-down):** stat→filtered-list contract on web + app;
   click-to-filter charts; /stats/routes resurrection; IA consolidation.
3. **Wave C (part-to-whole + dedup):** breakdown module; single heatmap;
   redundancy removal.
4. **Wave D (engagement):** records-as-hero-moments + share cards; travel-year
   progress; monthly recap; guardrail settings.

---

## Verification status appendix

- 24 claims confirmed via 3-vote adversarial verification (votes 3-0 or 2-0
  with one vote lost to a session-limit error; re-verification re-run started
  2026-07-03).
- 1 claim unverified (Material Design pie-charts-over-time prohibition,
  1-0 with 2 errored votes) — the verbatim quote was independently extracted
  and is present at https://m2.material.io/design/communication/data-visualization.html.
- Track-2 claims: quotes verified against fetched page content by extractor
  agents; retention percentages are first-party (Duolingo blog) or vendor
  (Trophy) numbers — cite as such, don't treat as independent science.
