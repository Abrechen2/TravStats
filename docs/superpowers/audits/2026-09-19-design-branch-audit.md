# Design-branch audit — night of 2026-09-18 → 19

Branch `dev/design-system`, release commit `cfee1fc5`, deployed to the public preview as `2.7.0-design.10` at 02:16 UTC. Mandate (owner, before sleeping): finish every open task, deploy a beta, audit the whole — UI included — run breaking tests, write this report. Merging into `main` was excluded and is asked separately.

## 0. What shipped tonight

45 commits on top of the snapshot `97f4d0e6` (184 files, +15 980 / −1 406); 139 commits since the previous preview `design.9`. In one paragraph: the evidence panel ("which entries produced this number") now answers for all 78 registered metric keys and the four ranking dimensions, with the cold audit's eighteen findings closed or named; the shared demo account's boundary is closed on eight surfaces the security audit found open (one Critical, three High); the year comparison on the overview compares like against like; a most-expensive-trip figure that compared face values across currencies now converts; and five defects that only a browser could see were fixed after the pass that found them.

## 1. Method

Two cold-context audits of the frozen snapshot `97f4d0e6` (a read-only worktree without node_modules), each by a Claude Opus subagent with no prior context: layer 1 security and the demo boundary (588 route registrations walked), layer 2 the evidence feature. Codex was over its usage limit until 2026-09-20 and Gemini's free tier answered 429 — no external model reviewed tonight; they were unavailable, not skipped. Every fix landed through the same loop: brief → implementer → task reviewer (spec compliance AND code quality, both verdicts required) → fix round → scoped re-review. Every "fails on the current code" test was reverted, run, and its output recorded in the per-task reports under `.superpowers/sdd/2026-09-18-evidence-panel/` (gitignored, on disk). Gates were run on the release commit: backend tsc/lint, frontend tsc/lint, file-size ratchet, schema drift (migration replay), Prettier in the CI view (`git -c core.autocrlf=false archive`), backend Jest 594/594 suites (5 247 tests), frontend Vitest 510/510 files (4 273 tests), both coverage ratchets (both rose). Two flakes are recorded below.

## 2. Security audit (layer 1)

| # | Sev | Finding | State |
|---|---|---|---|
| 1 | Critical | `POST /documents` had no demo guard; `Document` missing from the reseed wipe. A visitor's boarding pass would persist past 04:00 UTC and be readable by the next visitor. | **Was not live** — design.9 predated the route (`/api/v1/documents` answered 404 on the preview). Fixed `7ddae0d4`: `rejectDemo` above multer (measured on the old code: 201, file written), `Document` first in `wipeDemoUser`. |
| 1b | Medium (found by the fix's reviewer) | The four parse routes accept `retain: true` and wrote a Document for any caller — the same table and the same read. | Fixed `f2069d95`: `recordParse` ignores `retain` for the shared demo (measured: a row was created through `/parse-pdf` on the old code). |
| 2 | High | Flight lookup spends the operator's RapidAPI quota for the demo. | Fixed `c8be1838`: `rejectDemoQuota` on both routes, as the bulk refresh already had. |
| 3 | High | Every parse route reaches the admin's Ollama. | Ruled: the template parser stays available to the demo (it is the preview's showcase); the LLM fallback is skipped inside the three parsers (`3aca5678`), keyed on `isSharedDemoUser`; `POST /lodging-import/suggest-mapping`, a fourth Ollama caller, got `rejectDemo`. |
| 4 | High | Lodging import spends the Google Places key. | Fixed `c8be1838`: `rejectDemo` on `/preview` and `/commit`. |
| 5 | Medium | The global limiter's LAN skip is silently off behind a proxy presenting a private source. | Fixed `18282267`: skip only outside production. CT134 already names its proxy in `TRUST_PROXY` (real client IP in the log). |
| 6 | Medium | Evidence router unthrottled. | Fixed `18282267`: `statsLimiter`, 30/min per user — visible tonight as 429s in the probes. |
| 7 | Medium | `GET /airports/:code` unauthenticated, writes the global catalogue on a miss. | Fixed `2aeb26c1` + `ab149e80`: `authenticate` + `rejectDemoWrites` on the route AND the write path closed in the handler (demo + unknown code → 404). Measured on the old code: the demo created a permanent `Airport` row through a GET. |
| 8 | Low | `rejectDemoWrites` keys on the HTTP method. | Became concrete in #7; documented in the guard's comment. Not generalised. |

Verified correct and unchanged: the predicate `isDemo && username === "demo"` everywhere; every wave-A guard present and ordered; the evidence endpoint scopes every query on the caller; auth takes no user id from params or body; `no-store` default with only `private` overrides; the wipe now covers every user-owned model `ensureUser` does not remove.

Left deliberately: the `rejectDemoQuota` message on the single flight lookup says "Bulk refresh…" (reused as ruled — one odd sentence for the owner to word). The negative airport cache stores a null entry it never honours (`if (cached)`), which errs safe — recorded in the test comment, not changed.

## 3. Evidence audit (layer 2)

| # | Sev | Finding | State |
|---|---|---|---|
| 1 | High | `omitted.count` read as "rows ahead": load-more never ended | Fixed `66fadea4` — `hasMore = entries < returned + omitted`, footer counts what is still missing |
| 2 | High | Scorecard tile in year mode with no year → 400 | Fixed `ad55d029` — current UTC year, as the tile's own `resolveWindow` |
| 3 | Med | Scorecard labels claimed "rolling 12 months" in every scope | Fixed `37722679`, DE+EN |
| 4 | Med | A comment promised a `/stats/business` cross-check that did not exist | Fixed `f2c1e63a` — cross-checks fetch the endpoint in the same test; the `year*` family named honestly as argument-binding only (`e16b23b1`) |
| 5 | Med | A comment described a projection that was not there | Fixed `2d9d3228` — four projections; `flightCount` loads id and date only |
| 6 | Med | The sum/distinct invariant is self-satisfying for most resolvers | Header says so; the population guard is the endpoint cross-check; the harness widening needed for `travelAccountHomeNights` confined to `notPerEntry` (`404dc237`) |
| 7 | Med | Full scan per open; no limiter | Limiter done (`18282267`); scan bounding deferred — three of four ranking folds have no Prisma inverse (§9) |
| 8 | Med | The registry bound nothing; `servedIn: 1` ≠ served | Fixed `e6763641` — a binding test calls every resolver and compares aggregation/unit/scopes; docstring corrected. Tonight 78/78 keys are served. |
| 9 | Med | `??` where the calculator uses `\|\|` | Fixed `fa322276`; the sweep of every code column is recorded |
| 10 | Low | `value: null` never exercised on a real resolver | Fixed `511b455b` + the domain abstention suite (`e0d43dcd`) |
| 11 | Low | Block content inside `<button>` | Renders correctly in the browser; markup validity not charged tonight |
| 12 | Low | Two `<p>` replacements inline-block | Fixed `511b455b`; measured full-width in the browser |
| 13 | Low | Hydration not scoped by user | Fixed `20273747` — every `id: { in }` carries `userId` |
| 14 | Low | Float strict equality in scorecard tests | Fixed `511b455b` — tolerance-aware rounder; the harness rounds both sides |
| 15 | Low | `airlineCount` keyed by label on the client | Fixed `f99e8925` |
| 16–18 | Info | Dead ends (`yearUnpricedFlightCount` has no trigger; `scope` prop unused; two reasons produced by nothing; deduped cost credits the first flight of a booking) | Recorded; not changed |

## 4. Tasks completed tonight

- **Task 10 fix round** (`c399070f`): stale-base-currency snapshots excluded from the most-expensive-trip comparison; the exclusion count on screen DE+EN; the XLSX importer snapshots FX for cruises and flights (`xlsxImport/fxSnapshot.ts`); the lodging sheet writes the property record and carries no price.
- **Task 14** — security, eight commits `7ddae0d4..f2069d95` (§2).
- **Task 13** — evidence audit, fourteen commits `66fadea4..301bc742` (§3).
- **Task 7b-1/2/3** — the remaining sixty resolvers, fifteen commits `815410cf..afaf21b7`: every predicate lives in one home the calculator also calls (`utils/stats/flightPredicates.ts`, `shared/crossDomainCounting.ts`, `shared/placeCounting.ts`, `shared/lodgingSpend*`); loaders moved out of `routes/stats.ts` (1 877 → 1 610 lines); the travel-account night attribution is one core both the route and the resolvers call; a `?domains=` scope on a key that does not honour it is refused with 400 instead of being echoed.
- **Task 12** (`9ef5428e`, `4c0ee381`): the running year compares against the same span of the previous year; `lib/stats/comparisonWindow.ts` is the one home; either year may be the running one; the headline stays uncut and only the delta is windowed; surfaces whose totals the server computes per year (cruise/stay/place strip, flight year cards, scorecard "Jahr") carry an honest "ggü. ganzem Jahr" label plus a note — a true same-period figure there needs those endpoints to accept an end date.
- **Task 11b** (`5e7060c1..cfee1fc5`): five browser-found defects (§8).

## 5. Product findings for the morning (not defects in tonight's code)

- **`cruiseTotalSpend`** is served from the base-currency rule while `CruiseMoneySection` says on screen it will not add currencies. Left unwired. Decision: give the section a base-currency total, or set the key `servedIn: 2`.
- **`equatorCrossingCount` and `hemisphereHopCount`** in `/stats/unique` are byte-identical rules — two tiles, one number, always were.
- **`cruiseCompanionCount`** counts slots, not people (a companion on two cruises = 2); faithful to a `sum`/`companions` entry. If "people travelled with" was meant, it is a `distinct`.
- **Thirteen served keys have no trigger by ruling**: they live inside another card's description, in two-number cards ("12E / 8W", "3 / 4"), or on a surface that shows no all-time figure. All are addressable by URL; tests pin each wired set.
- **Registry corrections, each measured**: `timezoneHopperFlightCount` is distinct/timezones; `roundTripFlightCount` counts round trips (0.5 per paired leg); `lodgingNightsAwayTotal` is distinct; `allTime` added on 39 year-only entries (the tabs default to lifetime); two calculator strings corrected. Key names stay — a key is an address.
- **Changelog items** (numbers that move on screen): the round-trip tile drops by one per A→A leg — a flight that lands where it took off is not a round trip (`eb4fcca6`); the current-year comparison on the overview changes for every user whose year is incomplete (Task 12).
- **`adaptCruise`** (frontend) reads cruise dates in the browser zone while every other adapter uses UTC or the airport clock — west of UTC a tile and its panel can disagree by a day. Pre-existing; a Forgejo issue candidate.
- **Two country vocabularies** meet in the cross-domain union (`lodgingCountryKey` falls back to the raw name beside ISO codes). Cannot bite on today's data.
- **Country credits render as ISO codes** ("DE") beside labelled neighbours ("Hotel Rheinblick") — a localised name is not data, so the label belongs on the client (`countryName.ts` exists). Frontend follow-up.
- **No `unconvertible` reason exists** in the unattributed vocabulary; the money measures use `notPerEntry` beside `value: null` as the nearest fit. Release-2 vocabulary item.
- **The panel is centred, not docked right** at `sm+` as the spec said; Task 8 built on `Modal` (bottom docking below 640 px only) and the owner accepted design.9 in the browser with this panel. Noted, not charged.

## 6. Deploy

Image `ghcr.io/abrechen2/travstats:2.7.0-design.10` built from `cfee1fc5` (amd64, 1.95 GB), pushed. Backups on CT134 before the switch: `.env.bak-pre-design10`, `docker-compose.yml.bak-pre-design10`, `backups/pre-design10.dump` (1.4 MB, `pg_dump -Fc`). Deployed via `scripts/preview/deploy-preview.sh beta 2.7.0-design.10`: health `ok` at 02:16:22 UTC, all migrations applied (the cruise base-currency migration included), demo reseeded at 02:16:45 (173 flights, 24 cruises, 33 stays, 95 places). Public checks: `/api/v1/version` reports design.10; `POST /documents`, `GET /evidence/...` and `GET /airports/:code` answer 401 unauthenticated. Board: `preview-beta.expect = 2.7.0-design.10` with the rollback note; mirror pushed.

## 7. Breaking tests

**A. Evidence endpoint** (local stack, then the public preview as the demo): unauthenticated 401; `record`/`achievement` 501; unknown kind 400/404; hostile keys (empty, colons, 2 KB, `%00`, traversal, SQL) all 400/404; offsets `-1`, `1e9`, `NaN`, `abc`, `1.5` and limits `0`, `-5`, `101`, `100000`, `abc` all 400; `year` without a year, `year=999999`, `year=abc`, a stray year on `allTime`, an unsupported scope, an unknown domain, a duplicated parameter — all 400; `?domains=` on a key that does not honour it 400, on a `crossDomain*` key 200; offset past the end 200 with `returned 0` / `omitted 133`; 50 parallel opens of one heavy ranking → 49 × 429 from the new limiter, no 5xx. Cross-user: each account sees only its own figure (133 vs the admin's), never 403.

**B. Demo guards** (local, demo and admin; public, demo only): documents upload, flight lookup (single and bulk), lodging import preview/commit, trip AI summary, the `autoUpdate` settings block, the six catalogue POSTs, `coverImageUrl` on trip create, passkey/2FA/diagnostic export — every one 403 for the demo; the local admin is not refused except by `rejectDemoQuota`, which keys on `isDemo` by ruling (the local admin carries it). Multipart uploads with a real body refused before multer. One probe of mine used a wrong path (`/aircraft-types`; the route is `/aircraft`).

**D. The reseed race** (local): a loop creating trips as the demo while the reseed ran — 19 writes landed before the epoch bump, the first 401 came 200 ms after the last 201, zero survivors after the wipe.

**C/E** are the browser pass (§8). Not measured: a 390 px viewport (`resize_window` leaves `innerWidth` unchanged in this setup — known) and a listener-leak count over twenty open/close cycles.

## 8. Browser pass

Local stack on the seeded demo, then the public preview after the deploy. Verified: overview tile → panel (4 entries) → Escape → focus returns to the tile; the Task 12 labels ("Jahr 2026 vs. gleicher Zeitraum 2025", the country tile's copy, the scorecard's "ggü. ganzem Jahr 2025" + note); the flights tab's 30+ triggers with cards `block` and rows `flex`; paging 100 → "33 weitere bekannt" → load more → 133 rows; ranking MUC 71 = panel 71 with no "recomputed" line; distinct airports 65 = 65 (a 70 measured earlier was the pre-reseed data set); cruise 19, lodging 31, places 82 all equal their tiles; tampered URLs (501, 404, 400) show the error line, no crash, no "0"; console clean.

Five defects the suites did not see, all fixed in Task 11b and re-verified on the public preview: **A** the footer counted the last page ("33 angezeigt" for 133 rows); **B** the airport ranking rows printed `evidence.entry.role.arrival` — the strings existed but the flat key never reached them; **C** the error state kept the "wird geladen…" title; **D** distinct credits printed entity UUIDs for places and lodgings — `EvidenceEntry.creditLabels` added to both mirrors and the schema, filled by five resolver families (Elbphilharmonie, 25hours Hotel HafenCity, AIDAsol, Lufthansa on screen now); **E** Escape on the error panel — measured as a probe artefact, pinned by a test anyway.

## 9. Open, deferred with reasons

- **Evidence #7, second half**: every panel open folds predicates in JS over the caller's full countable set; `limit`/`offset` bound the answer, not the scan. Three of the four ranking folds have no Prisma-expressible inverse. The limiter bounds cost per user; the scan stays. A deploy decision for a large account, not a correctness one.
- **Same-period figures on server-computed surfaces**: the cruise/stay/place strip, the flight year cards and the scorecard's "Jahr" range are labelled honestly but not narrowed; `/stats/timeseries` and the domain stats endpoints would need an end-date parameter.
- **Cross-checks that share an implementation**: the `year*` family (`computeSummary`), cruise/lodging (one loader), the flight predicates (one home) — each bind the arguments or the population only; the per-key literal tests carry predicate correctness, and every suite header says which is which.
- **Two load flakes**, both green alone and green on an idle machine: `services/geo/__tests__/countryFromCoordinates.test.ts` once in a full backend run; `SettingsPage.adminScope.test.tsx` three times in full frontend runs while three dev servers and a Docker build shared the CPU (a 1 s `findByRole` default). The final runs were clean.
- Three LOWs from the 11b review recorded, not charged: `creditLabels: {}` on a credit-less cruise row; the `EVIDENCE_TEXT_KEYS` doc omits a second excluded literal key; a report gave the wrong reason for a right decision.

## 10. The one question for the owner

Whether `dev/design-system` merges into `main` — asked separately, as its own question.
