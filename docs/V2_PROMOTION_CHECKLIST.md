# V2 Promotion Checklist — `dev/multi-domain-v1` → `main`

This is the gate every V2 promotion has to walk through before the
branch can fast-forward / merge to `main` and become a candidate for
`/deploy`. Tick every box. If a box can't be ticked, the promotion is
blocked until it is or until the entry is consciously waived (with a
note explaining why).

## 1. Code-quality gates

- [ ] `cd backend && npx tsc --noEmit` — clean
- [ ] `cd backend && npm run lint` — zero warnings
- [ ] `cd backend && npm test -- --forceExit` — every suite green
- [ ] `cd frontend && npx tsc --noEmit` — clean
- [ ] `cd frontend && npm run lint` — zero warnings
- [ ] `cd frontend && npx vitest --run` — every suite green
- [ ] `npx playwright test e2e/` — at minimum the multi-domain dashboard
  spec (`e2e/dashboard-multi-domain.spec.ts`) passes

## 2. Database migrations

- [ ] `cd backend && npx prisma migrate status` — clean, no drift
- [ ] All hand-written migrations in `prisma/migrations/` are reviewed
  for forward-compat: do they run cleanly on
  - a fresh dev DB
  - the existing prod DB (CT 100, dump-restored locally)
  - the beta DB on CT 106
- [ ] `post_v2_drift_fix` migration applied successfully against the
  prod-data dump
- [ ] No `CREATE EXTENSION` statements that were silently introduced
  by V2-cycle migrations (PostGIS was removed from `post_v2_drift_fix`
  on 2026-04-30 — do not regress). **Grandfathered exception:** the
  initial `20251120163643_init` migration carries
  `CREATE EXTENSION IF NOT EXISTS "postgis"` from V1 days. Both the
  prod compose on CT 100 and the dev compose pin
  `postgis/postgis:15-3.4`, so the statement always succeeds. Schema
  uses no geometry types; the extension is unused but harmless.
  Cleanup (DROP EXTENSION + plain `postgres:15-alpine` pin) deferred
  to a V2.1 housekeeping pass.

## 3. Asset / runtime requirements

- [ ] `backend/data/marnet/marnet.geojson` is committed (not just
  present locally)
- [ ] `Dockerfile` `COPY` lines for every required runtime asset:
  - `backend/data/marnet/marnet.geojson`
  - any new seed CSVs added to `backend/seedData/`
- [ ] Container boots without falling back to coarse routing (check
  startup log for "marnet graph loaded" — not "ENOENT")

## 4. Multi-domain registry consistency

- [ ] `frontend/src/shared/domains.ts` and `backend/src/shared/domains.ts`
  agree semantically (`DOMAIN_KEYS`, `DOMAINS` table, `available`
  flags) — quote style and helper-function differences are OK
- [ ] `PARSER_SUPPORTED_DOMAINS` in `backend/src/shared/domains.ts`
  matches the actual parser dispatch in `routes/emailParse.ts` /
  `pdfParse.ts` / `boardingpassParse.ts`
- [ ] No new hardcoded `'flight'` / `'cruise'` literals leaked in —
  grep for `z.enum\(\[.flight.,.cruise.]\)` and similar; everything
  domain-aware should iterate `AVAILABLE_DOMAINS` or
  `PARSER_SUPPORTED_DOMAINS`
- [ ] `tokens.css` `--domain-*` colors are in sync with the domain
  registry hex values

## 5. Cruise-domain end-to-end smoke

- [ ] Demo seed (`npm run seed:dev-admin` + `seedDemoAccount.ts`) runs
  cleanly on a freshly-pushed dev DB
- [ ] Cruise CRUD (create / edit / list / delete) works in the UI
- [ ] Cruise route geometry renders in the dashboard (no ports linked
  by Bezier-arc fallback for whitelisted seas)
- [ ] Cruise stats page (`/stats?tab=cruise`) renders all KPIs
- [ ] Cross-domain Gesamt tab (`/stats`) shows both flight + cruise in
  KPIs / chart / heatmap / per-domain cards

## 6. Sample-PDF parser regression

- [ ] Each PDF in `test-samples/Kreuzfahrt-emails/` parses without
  throwing when uploaded via `/api/v1/parse-pdf` against a real
  Ollama instance
- [ ] At least the booking reference + ship name + first / last port
  match expectations on every sample
- [ ] Parser test suite (`backend/src/services/__tests__/cruiseBookingParser.test.ts`)
  covers the regression cases that triggered fixes during V2

## 7. Sync hygiene

- [ ] Last `main → dev/multi-domain-v1` merge is < 1 week old (per
  CLAUDE.md: "early + often")
- [ ] `CHANGELOG.md` and `backend/VERSION` were NOT touched on the dev
  branch (only via main merges) — `git log dev/multi-domain-v1
  ^main -- CHANGELOG.md backend/VERSION` should be empty
- [ ] No leftover conflict markers (`grep -rn "<<<<<<< HEAD" backend/
  frontend/`)

## 8. Memory + docs hygiene

- [ ] `CLAUDE.md` claims still match the V2 reality (the cruise-parser
  claim was outdated through 2026-05-10 — do not let staleness
  re-accumulate)
- [ ] Auto-memory entries for V2-only state live under
  `~/.claude/projects/D--TravStats-Projekt-TravStats/memory/` —
  remove ones that became inaccurate (`feedback_settings_folder_casing.md`
  was deleted on 2026-05-10)
- [ ] `docs/V2_PROMOTION_CHECKLIST.md` itself is in sync with the
  branching workflow described in `CLAUDE.md`

## 9. Beta-track validation (Cardinal CT 106)

- [ ] `:2.0.0-beta.X` image deployed to CT 106
- [ ] At least one full user-flow tested on the beta with real data:
  - email import → flight + cruise parsing
  - dashboard navigation across all enabled tabs
  - stats page with year filter + compare
- [ ] No 5xx bursts or container crash-loops in the beta logs for 24h

## 10. RC strategy on `main`

V2 enters main as a Release Candidate, not a final tag. The first
`/deploy` on main after the V2 merge cuts `:2.0.0-rc.1`.

- [ ] `/deploy` runs cleanly after merge — RC tag pushed to GHCR + git
  + GH Pre-release
- [ ] RC running on CT 100 (Underworld) for ≥48h with no regressions
- [ ] User confirms promotion in writing (`mach den echten Release` /
  `final`) — only then does the final `:2.0.0` / `:latest` /
  `:stable` get cut via `docker buildx imagetools create`

## Rollback plan

If V2 lands on prod and breaks anything that wasn't caught by §1–§9:

1. `ssh root@<pve-node3> "pct exec 100 -- bash -c 'cd /opt/travstats
   && APP_VERSION=1.5.0 docker compose pull && docker compose up -d'"`
2. Confirm `/health` still returns 200 on the rollback tag.
3. File a `gsd:debug` session against the regression and continue
   forward-fix on a fresh `fix/<slug>` branch off main, NOT on V2 —
   V2's diff is too big to bisect cleanly under prod pressure.
