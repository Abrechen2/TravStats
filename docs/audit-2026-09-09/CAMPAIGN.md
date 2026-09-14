# Clearing the 2026-09-09 audit — working plan

Started 2026-09-14 on the owner's instruction: fix everything, merge every
branch, get every known issue to a state where it can be closed.

This file is the checklist that survives a session. `FINDINGS.md` says what
each finding is and how Codex proved it; `FIX_REVIEW.md` says what an earlier
round already closed. **This file only tracks what is left and who decides it.**

Rules that apply throughout, from `CLAUDE.md`:

- A fix ships with a test that fails without it, and the test is verified red
  on the broken code before it is trusted green.
- Merging into `main` is the owner's release decision, asked in isolation.
- An internal finding becomes a Leitstand item; a user-visible one becomes an
  issue. Which tracker: see `CLAUDE.md`, "Where a finding goes".

## Scope, as the owner settled it on 2026-09-14

Both of the questions this plan opened were answered the same way: **in, and in
the next release.**

1. `dev/v2.7` (14 commits) and `dev/design-system` (33) are part of "every
   branch". The next release therefore carries the 2.7 forward line and the
   redesign, not just the audit fixes.
2. The five issues that are product rather than defect — forgejo#40, #42, #53,
   #61, #62 — are to be built, not dropped.

Two consequences worth writing down, because they are easy to lose:

- **The beta registry is not automatically emptied by this.** On 2026-09-05 the
  owner put `devicePairing`, `tourRoutes` and `dawarich` back behind the switch
  after they had been announced as out of beta. Shipping 2.7 is not by itself a
  decision to un-gate them; each entry's `returnsWhen` is still a reason to ask.
- **This is a release with a redesign in it.** `dev/design-system` and the 13
  design decisions in
  `ClaudeDesign/handoff/2026-09-05-web-redesign-rueckmeldung.md` §9 move
  together with everything else here.

## Standing

| | |
|---|---|
| Findings AUD-061–103 | 43 |
| Fixed | **17** — 069, 077–087, 097, 099, 100–102 |
| **Open** | **26** — 0×P1, 23×P2, 3×P3 |
| Partially fixed, from the earlier round | AUD-050, AUD-056, AUD-057 |
| Deliberately deferred by the owner | AUD-009, AUD-010 |

**Every P1 is closed.** What remains is P2 and P3 — wrong numbers, lost data on
an edge, accessibility, and tests that assert less than they claim. None of it
is an availability or credential risk any more.

## Work blocks

Each block is one branch and one reviewable group. Order is by blast radius,
not by number.

| # | Block | Findings | State |
|---|---|---|---|
| A | Dependencies + supply chain | AUD-097 | **done** on `chore/deps-2026-09-14`; majors open (see below) |
| B | Backup / restore | AUD-069 (P1) | **done** `910266c1` |
| C | Integration credentials | AUD-087 (P1), 100, 101, 102 | **done** — `2c218f45`, `367fb102` |
| D | Geocoding and place resolution | AUD-061–064, 068, 070, 071 | open |
| E | Currency and FX | AUD-065, 066, 067 | open |
| F | POI | AUD-072–076 | open |
| G | Statistics and time | AUD-077–086 | **done** — `e5e07fb0`, `a7ceaa5a`, `f1cbba11`, `2d73d996`, `2ded2aa8` |
| H | Cruise | AUD-088, 089, 090 | open |
| I | Import and flight suggestions | AUD-091–096 | open |
| J | Test truthfulness and mobile UI | AUD-098, 103 | open |
| K | Parser residuals | AUD-050, 056, 057 | open |

### Found while working, not in Codex's register

**CAMP-01 — three routes answer with prose where the contract is a kind.**
`CLAUDE.md` states the rule: every Immich error body uses the fixed vocabulary
`notConfigured|unreachable|auth|notFound|protocol|invalidUrl` that the
frontend's `immichFailureKind()` parses, and prose "silently degrades to a
generic toast". `ImmichError` carries both a `.kind` and a prose `.message`.

Measured 2026-09-14 — the same contract is implemented four ways:

| Site | Sends |
|---|---|
| `routes/immich/tripAlbums.ts:56` | `error.kind` — correct |
| `services/immich/immichTester.ts:44` | `error.kind` — correct |
| `routes/settings/dawarich.ts:73` | `error.kind` — correct |
| `routes/settings/immich.ts:67` | `error.message` — **prose** |
| `routes/admin/immich.ts:70` | `error.message` — **prose** |
| `routes/admin/dawarich.ts:78` | `error.message` — **prose** |

Effect: a user who mistypes the Immich URL in Settings gets the generic toast
instead of "The server URL is not valid" — which is exactly the distinction
`invalidUrl` was introduced to make, per `CLAUDE.md`: so "a URL typo does not
send the user debugging their server version". Fixed together with AUD-087,
since it is the same contract in the same handler.

**CAMP-02 — the backend typecheck does not cover tests.**
`backend/tsconfig.json` has `"exclude": ["node_modules", "dist", "**/*.test.ts"]`,
so `npx tsc --noEmit` — the first line of the Build Checks gate in `CLAUDE.md`
— never type-checks a test file. Measured 2026-09-14: adding two required
fields to `AccountFlight` left every existing fixture in
`travelAccount.test.ts` missing them, and both the typecheck and the suite
stayed green. A test can therefore pass while asserting against a shape the
product no longer has.

Not fixed here: turning it on will surface an unknown number of existing
errors, and that is a ratchet-sized job rather than a line in a bug-fix commit.
It belongs on the "Practised, not enforced" list until then.

**CAMP-03 — BKK carries the timezone `Asia/Jakarta` in the airport catalogue.**
Same UTC offset, so nothing measured here changed, but it is the wrong zone and
would diverge the moment either country changed its rules. Catalogue data, not
application logic.

**CAMP-04 — the import E2E specs only pass on a clean database.**
Found while closing AUD-098. `import.fr24.spec.ts` uploads a fixed fixture and
asserts "8 bereit"; on a second run those eight rows are already in the
database, so they come back as duplicates and the case fails. Its sibling, the
dedup case, depends on the first one having run. Neither has a cleanup that
removes what it imported.

The fix is a fixture generated per run — `import.generic-csv.spec.ts` already
writes a temporary CSV, so the pattern exists next door — or an explicit
teardown. Not done here: it is a different defect from the one AUD-098 names,
and merging it into that work would have hidden it.

**Remaining E2E failures after the AUD-098 rewrite**, measured 2026-09-14
against a live dev stack, 103 cases over three engines: 54 passed, 24 skipped
with a stated reason, 25 failed — 18 in `dashboard-multi-domain.spec.ts`
(looking for the retired "Modus" button, which Codex lists separately in the
same finding), 4 in `import.fr24.spec.ts` and 3 in `import.generic-csv.spec.ts`
(CAMP-04). The three files the finding is actually about have no failures.

**CAMP-05 — a restored dashboard mode does not reach the URL.**
`CLAUDE.md` says the dashboard URL carries tab and mode
(`/dashboard/<tab>?mode=<mode>`) and that `localStorage` remembers the last
mode per domain. Measured 2026-09-14: switching away from a tab and back
restores the remembered mode in the interface and leaves the address bar
without a mode. So the screen shows Heatmap while the link says default, and
copying it hands someone else a different view.

Either the URL should be rewritten when a mode is restored, or the URL is
deliberately an override and the documentation overstates it. That is a product
decision, not a test's to make — the E2E case asserts only the restoration and
says in place why it stops there.

**CAMP-07 — the E2E suite shared one account and ran fully parallel.**
Every spec signs in as the same user, several of them WRITE, and the config had
`fullyParallel: true`. Measured 2026-09-14: the cruise deep-link case passes
alone and fails in a full run, in all three engines, because an importer's
commits and cleanups land underneath specs reading the same account. A suite
that answers differently depending on what else is running cannot be trusted
about anything.

Serialised for now (`workers: 1`), which costs about three minutes. Per-spec
accounts would restore the parallelism and are the better answer.

**CAMP-06 — the two import E2E specs were stale in layers.**
Closing AUD-098 made the importer reachable for the first time, and what it
found was a file whose every assumption had aged: the login it performed
itself, English labels against a de-DE config, a bare `locator('select')` that
matched the settings section picker, a flight list that moved off the
dashboard, and a fixture with no teardown. Each was fixed; each revealed the
next.

One remains, marked `test.fail()` so the expectation stays written down and
turns red the day it works: the FR24 golden fixture previews as
"5 bereit · 0 Duplikate · 3 Probleme" where all eight rows should be ready. All
fourteen airports it names are in the catalogue, so it is not a lookup miss;
what flags the three is unknown.

The generic-CSV case was fixed rather than marked, and its cause is worth
keeping: the test clicked commit and navigated away immediately, aborting the
POST. Firefox and WebKit happened to be slow enough that the write landed
anyway; Chromium was not. The same test therefore wrote a flight in two engines
and silently wrote nothing in the third, then failed looking for it. It waits
for the success state now.

None of this was visible before AUD-098: the old suite failed at a login it
never performed.

### Block A detail — dependency majors

Done: multer 2.3.0 → the process-killing upload (AUD-097), plus `npm update`
inside the existing semver ranges across both trees. Backend production
vulnerabilities went 4 → 0.

Still open, each a real migration rather than a bump, so each gets its own
branch and its own verification:

| Bump | Why it is not a bump | Dependabot |
|---|---|---|
| prisma 5.22 → 7.10 | major, touches every query and the generated client | #295 |
| zod 3 → 4 | major, every boundary schema in `backend/src/schemas` | #312 |
| zustand 4 → 5 | major, every store | #311 |
| @types/node 22 → 26 | ahead of the runtime the container actually uses | #309 |
| vitest 3 → 4 (tools) | tooling only, low risk | #327, #326 |
| maplibre-gl 5 → 6 (sea-route-lab) | lab only, not wired into the app; MapLibre 6 has a known silent worker failure under Vite | #323 |

The frontend still reports 13 advisories, all inside `@luma.gl/*` under
deck.gl. deck.gl is pinned at `~9.3.11` on purpose — 9.4.0 renders 8-bit
colours as floats. Reachability was assessed separately in `DEPENDENCIES.md`;
that assessment is what decides whether this is acted on, not the count.

## Branches to land

Measured 2026-09-14. `origin` and `github` are the same GitHub URL — a
duplicate remote, not two targets.

| Branch | Ahead of main | Note |
|---|---|---|
| `fix/audit-round-2` | 11 | this round's fixes; closes #331, #332 |
| `chore/deps-2026-09-14` | 1 | AUD-097 |
| `dev/v2.7` | 14 | forward line — collapsing it into main is a product decision |
| `feat/pwa-manifest` | 14 | not contained in `dev/v2.7` |
| `feat/cruise-template-parser` | 14 | not contained in `dev/v2.7` |
| `dev/design-system` | 33 | the redesign; owner's call |
| `dev/cruise-tracks` | 1 | |
| `fix/rc-identity-after-clone` | 1 | |
| `fix/pairing-code-visible` | 1 | forgejo only |
| `wip/2026-09-06-pc`, `wip/2026-09-07-pc` | 1 each | forgejo only |
| `feat/flight-form-phase1-times` | 3 | forgejo only, since 2026-08-01 |
| `fix/flight-day-shift-2.5` | 3 | forgejo only, since 2026-08-11 |
| `fix/flight-lookup-local-date` | 3 | forgejo only, since 2026-08-11 |
| `feat/lodging-rating-categories`, `feat/poi-phase-d-spec`, `docs/mirror-sync-routine` | 1 each | forgejo only |

Already contained in `main` and safe to delete: `chore/i18next-26`,
`fix/airports-include-closed`, `fix/audit-2026-09-09`,
`fix/v2.6.1-flight-times-and-stays-scroll`, and roughly twenty Forgejo
branches. Three of them are checked out in worktrees — **do not run
`git worktree remove` here**, it follows the `node_modules` junction and
deletes the real directory.

## Issues

34 open on Forgejo `dennis/TravStats`, 3 on `dennis/TravStatsCompanion`, 5 on
GitHub, 14 Dependabot PRs.

**Not every open issue is a defect.** Several are product scope: they have to
be built, not cleared. The owner decided on 2026-09-14 that these are built and
ship in the same release:

| Issue | What it actually is | Shape of the work |
|---|---|---|
| forgejo#40 | server-to-server links between instances | a feature with a protocol, an auth story and a privacy boundary — the largest single item in this plan |
| forgejo#42 | thin client: the counting rules the Companion still duplicates | server endpoints first, then the Companion stops computing; needs `dennis/TravStatsCompanion` to move in step |
| forgejo#53 | passport, records, country detail and wrapped have no screen | four screens against endpoints that already exist |
| forgejo#61 | format the whole tree once | one mechanical commit plus a `.git-blame-ignore-revs` entry; must land in a quiet window or it conflicts with everything |
| forgejo#62 | measure coverage and ratchet it | a check, a baseline, and a number the project is willing to defend |

Each open issue is marked *defect*, *chore* or *product* as it is touched, so
the remainder stays legible.

Ordering note: **#61 goes last among the chores.** A whole-tree reformat
touching every file would conflict with every other open branch in this plan,
so it belongs after the merges, not before them.
