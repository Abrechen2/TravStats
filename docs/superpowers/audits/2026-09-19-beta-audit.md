# Beta audit of 2.7.0-beta.8 — issues, features, and data integrity (2026-09-19)

Owner's asks, in order: "Checke alle Issues ob sie wirklich behoben sind mit einem Beta Audit durch, ebenso die Features" and "Mache noch ein Datenintegritäts-Test, dass keine Nutzerdaten zerstört werden durch Fehler". Target: the public beta `beta.travstats.de` and the internal beta CT106, both on `2.7.0-beta.8` (main `8caaffd0`). Method: three auditors against the running beta (browser via Playwright, curl against the API, code reading), then two integrity auditors (real dumps in throwaway databases; write paths in code with new Jest guards), each finding reproduced before it was called a defect, each fix reviewed by a second agent before it merged. Working notes and the auditors' full reports are under `.superpowers/sdd/beta-audit-2026-09-19/` (git-ignored).

## 1. Verdicts on the issues

| Issue | Verdict on beta.8 | Now |
|---|---|---|
| #332 next-up names the municipality | FIXED (MUC→MXP shows "Milan Malpensa") | — |
| #331 hotel countdown ignores timezone | FIXED (Tokyo 15:00 → 06:00Z from the lodging's coordinates) | — |
| #330 pointer on achievements | PARTIAL: a dialog opened, but no evidence and raw progress `495456 / 500000` | fixed on main: formatted progress with unit, evidence trigger for 23 rules (`countries` excluded — its resolver counts differently) |
| #321 'About' untranslated | FIXED | — |
| #291 invented flight number | PARTIAL: `FB23` in a newsletter still became a flight | fixed on main: a lone number needs a second witness (confirmation phrase or a clock time near it); stylesheets, scripts, comments and attributes are stripped first; corpora 31/31 and 108/108 unchanged per file |
| forgejo#88 (13 points) | 11 FIXED; P5 (disabled areas as grey `0` tabs, no reason) NOT FIXED; P9 third point (refused save unreachable — buttons disabled) PARTIAL; P12 "Stern" wording | all fixed on main |
| forgejo#94 photo-journeys tab | FIXED (honest empty states, scan 200) | — |
| forgejo#53 records / wrapped / passport / country detail | FIXED (country detail is an inline evidence panel by design) | — |
| forgejo#121 `_count.photos` | FIXED and published | — |
| forgejo#120 OpenAPI fields | FIXED, 51/51; residual `Flight.trip` unpublished | published on main |
| forgejo#49 `/stats/page` | FIXED (0.25 s vs 2.1 s; the page uses it) | — |
| forgejo#124 phase 6 workshop | FIXED end-to-end via the API; NOT FIXED from the browser for lodging (`.eml` headers stripped → no anchor; name on its own line → wrong reason) | fixed on main: sender and subject persisted on the sample, letterhead line derives, marks and stored text cannot disagree (server refuses a mismatch) |
| Alex's list of 2026-09-17 (10 points) | 9 FIXED; date format ignored on the lodging and cruise list tables | fixed on main; the settings scroll tail Alex reported on 09-19 is gone (bottom-of-page rule) |

## 2. Verdicts on the 2.7.0 features

FIXED as promised: year comparison labels, evidence panel (KPI + ranked rows + share link), split cards with keyboard and 390 px stacking, wishlist inline trigger, flight-form section summary and Enter-to-save, beta registry with one entry, Dawarich as a normal integration, admin as its own page, places/lists/passport out of beta, inbox tabs and paginated logbook, workshop domain picker and honest abstention, PWA manifest, demo boundary, reset without SMTP, documents API.

Overclaimed or missing, all corrected on main:
- **Documents had no web surface** — the release notes promised them at the entry. A `Dokumente` section now lives on flight, cruise, stay, place-visit and trip detail.
- **Touren carried a hard-coded BETA pill** while the registry listed only device pairing. Removed.
- Settings groups: only the domain groups have their own address; the four general ones are anchors on one page — the notes now say so.
- Tours are their own trip tab, not Timeline rows — the notes now say so.
- The Orte import is a CSV import that also takes a Google Takeout export — the notes now say so.
- The AI summary showed its button on an instance without a model — it now says no model is configured.
- No in-app install affordance — "Als App installieren" appears in the user menu when the browser offers it.
- The cruise base-currency tile abstained for EUR cruises in a EUR account — the rule "an amount already in the base currency needs no rate" now holds for cruises, the trip cost record and every lodging money figure, in one helper per domain.
- Flight form: doubled required marks and an error before any input — gone.

## 3. Data integrity

**What holds, measured on real data** (beta tester data, demo data, and a prod-data mirror of 2.6.2, each in a throwaway database): no table lost a row across up to 16 migrations; a checksum over the pre-existing columns is byte-identical before and after every migration; delete/truncate tripwires on 32–44 tables fired zero times during boot and migrations; every user-added catalogue row survives the re-seed; 13 users' read endpoints answer 200 with counts matching the tables; the backup round trip restores 67 tables equal. Transactions under the Prisma 7 adapter roll back on a throw, a foreign-key violation and a bad batch member; all 94 delete rules are explicit and match the live foreign keys; the demo wipe touches only the demo user's rows; no route reports success after a failed write; the flight merge never overwrites a curated value, not even with null; a document is written file-first, row-second. Five guard suites (`backend/src/__tests__/integrity/`) stay in the tree.

**What did not hold, and is fixed on main:**
1. HIGH — the demo seed adopted any account named `demo` (password reset to `demo123`, profile, passkeys, 2FA, tokens and all 30 tables wiped). It now heals a legacy demo row and refuses a real person's account; the name is reserved at registration, admin creation and setup.
2. HIGH — an earned achievement and its date were revoked by a restart (`AWAY_SHARE_25` lost on the prod mirror; `NOT_A_MORNING_PERSON` lost when the container ran in Europe/Berlin). A badge once earned stays earned; hour-of-day is read on the departure airport's clock.
3. MEDIUM — the geocode backfill threw away the position of every Google-resolved chain hotel (invalid nested write, hidden by a per-row catch) and the reverse pass overwrote an address typed while it ran. Scalar chain id; compare-and-swap per field.
4. MEDIUM — a failed pre-migration backup was one WARN line and the migration proceeded. On a version change a failed backup now stops the boot, names a client/server version skew, and `SKIP_PRE_MIGRATION_BACKUP=true` is the documented way past it.
5. MEDIUM — unfiled documents were deleted after 7 days without a word; a document unfiled after 30 days would have gone within the hour. 30 days from unfiling, announced in the inbox with the date.
6. MEDIUM — documents cascaded silently on every delete; a GPX track and a place visit were deleted on one unconfirmed click; the import-undo dialog promised the lodging rule for every domain. Dialogs count documents, name every cascade, ask before a track or a visit goes, and say what each domain's undo really does.
7. LOW — reset requests missing from the demo wipe; companion backfill outside a transaction; dead code in the import undo.

## 4. Accepted, not built
- The Prisma CLI is a production peer and brings four high npm-audit advisories (mysql2, deepmerge-ts) nothing here can reach — recorded on the board.
- `/flights` fetches 500 rows and pages client-side; real paging needs backend search/sort/trip parameters — board item.
- "Historische Anreicherung" wears a Beta pill without a registry key — owner decision.
- The telemetry consent sits inside the what's-new dialog — owner decision.
- `ollamaAvailable` in a parse response is a configuration flag, not reachability — board note.
- No light mode exists; the passport is dark like the rest.

## 5. Not verified in a browser
The fixes listed under "now" and "fixed on main" were verified by tests and reviews, not yet on a running beta; that is the beta.9 pass.
