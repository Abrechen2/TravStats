# CLAUDE.md — history

Moved out of `CLAUDE.md` unchanged on 2026-10-25, so that file carries only the
rules in force (it is loaded with every message). Each section names where it
stood. Read it for the *why* behind a rule; the rule itself lives in `CLAUDE.md`.

## Who writes to `main` — the Paperclip era (CLAUDE.md, Deploy & Release Workflow)

> **Paperclip is out of service since 2026-09-27** (owner). Nothing arrives
> through Forgejo pull requests any more, so `main` has two writers again: the
> owner and the Claude sessions. The Paperclip rows and rules below are kept
> as the record of how it worked and what to restore if it comes back — they
> bind nobody while it is off. Rules 1 and 2 stay in force regardless: two
> remotes can still disagree.

"No PRs" above describes the Claude sessions, not everyone. `main` had
three writers, and a plan computed against it minutes ago can be stale:

| Writer | Route into `main` |
|---|---|
| The owner | Direct merge or push |
| Claude sessions (PC, CT142) | Local merge on the owner's release decision, no PR |
| ~~Paperclip agents~~ (CT 145, commits as `paperclip-bot`) — out of service since 2026-09-27 | Forgejo pull requests; merged only by the owner |

On 2026-09-25 two Paperclip PRs were merged into `main` on Forgejo while a
Claude session was integrating branches against the same `main`, and five
CI commits existed only on Forgejo until a session fast-forwarded to them.
Hence:

1. **Before moving `main`, fetch both remotes** (`git fetch origin main &&
   git fetch forgejo main`). If either moved, merge it into the branch being
   integrated and re-run the gates first.
2. **Fast-forward only, pushed to both remotes.** Never force-push `main`.
   When the two disagree, Forgejo is the side PRs land on — reconcile from it.
3. **A Forgejo PR is `forgejo#N` in every commit message**, including the
   merge commit. Forgejo's default "Merge pull request #128" becomes, once
   the commit reaches GitHub, a link to GitHub #128 — a different thing (see
   the reference rules under *Three trackers* below).
4. **`.forgejo/workflows/`** was Paperclip's CI work (change it through a PR
   or with the owner). While Paperclip is off it is ordinary repo config —
   still change it deliberately, since the homelab runner executes it.
5. **Paperclip work that matters for a release gets a Leitstand item.** The
   board reads issues, not PRs, so an unrecorded PR is invisible there.

Paperclip reads this file, not the private session memory on the owner's
machines — a rule that must bind every writer belongs here.

## Build Checks — how CI came to run them (CLAUDE.md, Build Checks)

This list is the real gate, and since 2026-09-15 CI runs almost all of it.
`ci.yml` covers typecheck and lint in both trees, Vitest, Prettier on the whole
tree (since forgejo#61), the **file-size ratchet** and the **schema-drift check** — the
last two wired on 2026-09-15 (forgejo#60), having been runnable and unwired
since 2026-09-01. The backend Jest job is **required** since 2026-09-16: it
was advisory for a fortnight, then its first run that reached the suite at all
went 524 of 524 on main, and the owner promoted it.

## Three trackers — why Forgejo issues were once ruled out (CLAUDE.md, Where a finding goes)

Forgejo issues were once ruled out here, for two reasons that were correct and
have both now been answered rather than argued away.

## Three trackers — board blindness (CLAUDE.md, Where a finding goes)

**Board blindness — solved in the tool.** The objection that the Leitstand
could only measure `github` items live, and would have to hand-copy the state
of anything else, was true until 2026-08-30. It now has a `forgejo` source type
that reads titles and open/closed state through the `tea` CLI, exactly as the
`github` one shells out to `gh`, including the unassigned column. Configure it
with a `forgejo:` block in `roadmap.local.yaml`.

So: `source: { type: forgejo, ref: 36 }` is a first-class board item, carries no
title, and is measured live. A finding the board cannot see is a finding nobody
is measuring — that was the real objection, and it no longer applies.

## Beta gating — full original bullet (CLAUDE.md, Critical Gotchas)

- **Beta gating (since 2.4.0)** — unfinished features register in
  `frontend/src/config/betaFeatures.ts` and hide behind `betaFeaturesEnabled`
  (admin_settings column, default `false`). **That registry is the list — do
  not restate it here**; a list in prose beside a list in code is a list that
  is wrong. Each entry carries `why` it is hidden and `returnsWhen` it may
  come back, and a test fails when either is missing. Un-gating means deleting
  the entry AND every `isFeatureVisible` call it named — a gate left wired to a
  key that no longer exists reads like a gate that is still there. Two standing
  notes: the flag is instance state, never persisted client-side (see the
  `partialize` in `settingsStore.ts`); and the whole point of `returnsWhen` is
  that it is acted on — on 2026-09-01 `devicePairing`, `tourRoutes` and
  `dawarich` came off together, the first because the phone app it named
  (TravStatsCompanion, not the abandoned TravStatsApp the entry still said)
  had shipped while the gate hid the only place a claim code is minted, and
  the last because releasing tour routes WAS the event its own `returnsWhen`
  was waiting for. And on 2026-09-05, reading the 2.6.0 announcement that
  called them "out of beta", the owner ruled all three beta and put them back
  behind the switch (2.6.0 was re-cut) — a `returnsWhen` that has come true is a reason
  to ask, not a licence to ship.

## Schema drift — the hand-written cruise migrations (CLAUDE.md, Critical Gotchas)

- **Schema drift** — the two cruise migrations (`20260419120000_cruise_module`,
  `20260419130000_cruise_fixups`) were hand-written because schema.prisma had
  drift that `prisma migrate dev` would have bundled into any new migration.
  That is over; `prisma migrate dev` is normal again. This paragraph used to
  carry the measurement, and claimed the opposite for months after it stopped
  being true — which cost a design decision. `npm run check:drift` answers it
  now, so ask the check, not the doc.

## Rules — the 2026-09 measurement of the tooling gap (CLAUDE.md, Rules)

The gap is a tooling one, not a discipline one, and it is measurable: the
`any` ban has three violations in this tree and all three are the word "any"
in an English sentence, while the 800-line limit — stated for just as long,
checked by nothing until now — is broken by 21 files, the largest at 2161.

## Rules — where the checks run, and how they got there (CLAUDE.md, Rules)

**Where they run.** The pre-commit hooks and two workflows are automatic.
`ci.yml` (2026-08-30) runs typecheck + lint for both trees, Vitest, and
Prettier on the whole tree (since forgejo#61) as required jobs, and — since 2026-09-16 —
the backend Jest suite as a required one too; its comment block keeps the
history of why it was advisory until then. `security.yml` runs
`npm audit` on production deps (the gate) and Trivy (a report in the job log)
on every push to `main` and weekly. Nothing is uploaded to GitHub code
scanning any more, and its CodeQL default setup is off (owner, 2026-10-25,
the same move as Sublarr): the Security tab held 514 open alerts nobody
triaged, mostly test code and unreachable dev chains. Dependabot alerts and
security updates and secret scanning are untouched.

`check:size` and `check:drift` DO run in CI since 2026-09-15 (forgejo#60) —
size in the `static` job, drift in a `schema-drift` job of its own, because it
is the only static check that needs a database. The four Jest/Vitest ratchets
ride along with whichever suite owns them, which means the OpenAPI pair is
exactly as binding as the backend job, which is required since 2026-09-16.

**"Run in CI" was, until 2026-09-16, "is red in CI".** Both database jobs
failed on every run from the day they were wired: the service image was
`postgres:16-alpine`, which has no PostGIS, so `migrate deploy` in the Jest job
and the migration replay in the drift job died on `CREATE EXTENSION postgis`;
and `prisma migrate diff` does not create the shadow database it is pointed at
(P1003), which every developer running `check:drift` the documented way met
too. The images are `postgis/postgis:16-3.4` now and the script creates its
shadow. Nobody noticed for a day because both jobs looked like the known
advisory red — which is the argument for a red job never being normal.

The delay cost exactly what the ratchet exists to prevent: on 2026-09-15 a
branch landed on main with four files grown past their frozen size, and nobody
saw it, because nothing asked. This paragraph has a history of being wrong in
the other direction too — it claimed "only Prettier" for a week after `ci.yml`
landed (corrected 2026-09-06), and the two plan docs that called drift
"CI-guarded" before it was were corrected on 2026-09-04.

**One drift script, since 2026-09-01.** There were two, and they disagreed:
`scripts/check-schema-drift.mjs` at the root replayed the migrations into a
shadow DB, while `backend/scripts/check-schema-drift.ts` compared against the
connected database because `--from-migrations` reported postgis as false
drift under the `postgresqlExtensions` preview feature. That feature left
`schema.prisma`, the objection expired with it, and `e24c9a57` (forgejo#74)
deleted the root script and moved the backend one onto `--from-migrations`.
`npm run check:drift` at the root delegates to it. A postgis diff, should
one ever appear again, is the feature coming back — not noise.

**The 800-line number is ratified** (owner, 2026-09-05). What was settled
first is the shape: a limit, a frozen baseline, and a list that only shrinks.
`check-file-size.mjs` scans `backend/src` and `frontend/src` (tests and seed
scripts excluded); 21 files already exceed 800 and are frozen at their
current size in `scripts/file-size-baseline.json`, the largest at 2161. A
listed file may shrink, may never grow, and must leave the list at 800 or
below — `--update` refuses to raise an entry. The number was provisional for
four days — it was what CLAUDE.md happened to say — and was confirmed as the
rule on 2026-09-05 together with the design-system decisions in
`ClaudeDesign/handoff/2026-09-05-web-redesign-rueckmeldung.md` §9.

## Practised — never document an invariant you do not test: the `/stats/timeseries` story (CLAUDE.md, Rules)

- **Never document an invariant you do not test.** The OpenAPI description of
  `/stats/timeseries` claimed it grouped by "the departure airport's calendar
  day" while `utils/stats/timeseries.ts` bucketed on `getUTCFullYear` /
  `getUTCMonth` and never consulted the timezone map the same route built for
  durations. No test could have caught it: `stats.timeseries.test.ts` stubs the
  airport cache empty, so the zone was structurally unobservable. The claim was
  deleted rather than left standing — an empty spec beats a confident one.

  **The sentence is back, because the code caught up.** forgejo#46 made
  `timeseriesRows.ts` resolve `airportCalendarDay(...)`, and
  `stats.timeseriesLocalTime.test.ts` pins it with real catalogue airports, so
  the zone is now observable. The endpoint left the OpenAPI ratchet on
  2026-09-15 with a schema and that description. The order is the point: the
  claim followed the test, not the other way round. This paragraph itself
  described the old state for however long the fix had been in — corrected
  2026-09-15, which is the same failure mode one level up.

## Design-system decisions of 2026-09-05 and their reversals (CLAUDE.md, Open)

The 800-line number was ratified on 2026-09-05. Thirteen design-system decisions from the same day
are recorded, with the owner's answer to each, in
`ClaudeDesign/handoff/2026-09-05-web-redesign-rueckmeldung.md` §9 — read
that table before re-opening any of them (tours are ONE domain colour; the
parser goes into the beta registry; settings become one route per group;
companions and tags extend to all four domains). TWO of the thirteen have
since been reversed by the owner:

- No. 4, `domainColors`, was ruled to stay behind the beta badge on
  2026-09-05 and ruled out from behind it on 2026-09-09, because the goal for
  2.7 is that nothing is left in the beta registry at all. The table says so.
- **"Dashboard tabs stay" was reversed on 2026-09-28**: the domain strip is
  hidden, and the six-row domain filter answers "what is on the map" in its
  place. The tab ROUTES are untouched — `/dashboard/:tab` still resolves, so
  every bookmark keeps working — but the strip was the only way to reach them
  from the page, so "Nur" in the filter navigates there instead. That is not
  cosmetic: eight map modes exist on a single-domain view and nowhere else
  (stats-map, trips, itinerary, port-frequency, nights, chains, markers,
  sea-routes), because `TAB_MODE_REGISTRY` keys modes by tab. A filter that
  only hid layers would have made those unreachable.
  `DomainTabStrip.tsx` and `NextUpEntry.tsx` are still in the tree, unused by
  the app, as the way back.

## Git-Remotes — warum `push forgejo --all` (CLAUDE.md, Git-Remotes)

Der zweite Befehl ist der entscheidende. Am 1. August 2026 existierten
15 Branches ueber vier Repositories ausschliesslich lokal, obwohl alle ein
GitHub-Remote hatten.

## Git-Remotes — warum der Spiegel von jedem Rechner gepflegt wird (CLAUDE.md, Git-Remotes)

**Warum die Regel existiert:** bis zum 25.08.2026 pushte nur CT142 in den
Spiegel, der PC kuratierte still seine eigene Fassung. Gemessen an dem Tag:
`roadmap.local.yaml` hatte 50 gemeinsame Item-Ids, **120 nur auf dem PC und 18
nur im Spiegel** — keine Seite war Obermenge, ein Kopieren haette also in jede
Richtung echte Kuratierung geloescht. Das Zusammenfuehren kostete eine Sitzung.
Deshalb bricht das Skript ab, wenn beide Seiten sich bewegt haben, statt zu
kopieren.
## Cruise sea-routes and the Marnet router — full original bullets (CLAUDE.md, Critical Gotchas)

- **Cruise sea-routes** — `backend/src/services/schematicRouter.ts` runs
  the schematic pipeline (coarse 1° A* water path → Douglas-Peucker
  simplification to 3–8 waypoints; raw port coords are always the
  first/last waypoint; if A* fails on a truly disconnected sea it returns
  a straight `[dep, arr]` chord). This **replaced** the old Hybrid-v2 A*
  pipeline (`seaRouter.ts`, removed) — the route-cache table was dropped
  too (migration `20260425200000_drop_cruise_route_cache`; no more
  `CruiseRouteCache` / `CACHE_VERSION`). The frontend fetches the
  waypoints per leg via `GET /api/v1/cruises/:id/geometry` and runs a
  Catmull-Rom spline through them; the dashboard Cruises tab consumes
  this via `MapContainer3D`. When the backend returns no geometry for a
  leg, `buildCruiseArcs` (`frontend/src/components/layers/cruiseArcsLayer.ts`)
  falls back to a straight chord `[[a.lon,a.lat],[b.lon,b.lat]]` — there
  is no `buildCruiseArc` Bezier helper anymore. Prototype iteration for
  routing algorithms lives in `tools/sea-route-lab/` — not wired into the
  app, browser-only.
- **Marnet shipping-lane router is in-house** — the abandoned
  `searoute-ts` npm package was dropped on 2026-04-30 (its extensionless
  ESM imports broke silently on Node ≥ 22, so every cruise leg was
  falling through to the coarse 1° fallback for weeks). The vendored
  Eurostat marnet GeoJSON now lives at `backend/data/marnet/marnet.geojson`
  and is loaded by `services/marnet/marnetGraph.ts` (graph + A*). The
  high-level entry point is `routeMarnet()` in `services/marnet/marnetRouter.ts`.
  Both `services/schematicRouter.ts` and `services/cruiseDistance/marnetCalculator.ts`
  consume it. The Dockerfile copies `backend/data/marnet/marnet.geojson`
  into the production image alongside the land mask — without it the
  router throws ENOENT on first cruise request.

## Practised — the flight-counting status note, since merged (CLAUDE.md, Rules)

  `shared/flightCounting.ts` is the same move for flights; it lives on
  `refactor/flight-counting-predicate` and is not merged, so
  `status === 'flown' || status === 'historical'` is still inlined here.

## Global rules — the old coverage thresholds (CLAUDE.md, Rules)

  real figure, not a target — a fixed 80 would reward tests written to move a
  number. Both configs' old hard thresholds (50 and 30/20/20, never checked
  against a run) were removed in the same change.
