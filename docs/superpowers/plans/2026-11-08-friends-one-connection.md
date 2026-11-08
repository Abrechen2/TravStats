# Friends: one connection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** a friend is one connection (local or remote) that carries comparison, trip sharing,
plans, achievements and statistics, shown per friend on `/freunde`.

**Spec:** `docs/superpowers/specs/2026-11-07-friends-page-design.md` §11 (read 11.2–11.8 in full;
11.7 overrides earlier lines where they differ). Background: `2026-11-02-user-connections.md`.

**Base:** `feat/friends-compare`. Packages F1 (backend) and F2 (web) run in parallel; F2 codes
against the §11.4 contract and mocks it. F3 is the integration.

## Global Constraints

- `/sharing/connections` and every Companion-facing response stay byte-compatible (additive only).
- No migration widens a grant (§11.3, §11.7). Hand-written data migration ⇒ replay test on old-shape
  rows (CLAUDE.md "Prisma migrations"); `check:drift` green.
- New router `/api/v1/friends` is enveloped `{success, data}`; register it in the response-shape
  ratchet baseline and the OpenAPI spec (coverage + response-schema tests).
- DE first, EN mirrored; no `title=` attributes (helpReachability); touch sizing via `useCoarsePointer`.
- Stable error codes, mapped to DE/EN copy; no raw server strings in the UI.

## Review Focus

1. Crossed requests: A asks B while B asks A → one `active` connection, no duplicate.
2. Switching leaderboard off then on restores the stored scope, never "everything".
3. Removing a friend: no new offers/invitations; delivered linked copies and joined plans still open.
4. A forwarded invite link redeemed by a stranger → only a request the inviter can decline; the
   link is then burnt.
5. A peer server without the `connections` feature → friend with comparison only, "älterer Server".

---

## Package F1 — backend (one worker)

### Task 1.1: `local_connections` table + model service
- Files: `backend/prisma/schema.prisma`, new migration via `migrate dev` (in a throwaway clone, see
  memory: shared dev DB is `migrate deploy` only), `backend/src/services/friends/localConnections.ts`.
- One row per unordered pair (§11.3). Transitions: request, crossed request → active, accept,
  decline, revoke, re-request after revoke; stale accept on a revoked row → `SHARE_REMOTE_CONNECTION_STATE`-style 409 (`FRIENDS_CONNECTION_STATE`).
- Tests: every transition incl. Review Focus 1, plus switch updates leave the other side's set untouched.

### Task 1.2: data migration (local + remote)
- Hand-written SQL migration per §11.3/§11.7; test `backend/src/__tests__/migration.friendsOneConnection.test.ts`
  seeds old-shape rows: accepted / pending / withdrawn ShareConsent in both directions, accepted and
  pending LeaderboardConsent with a restricted scope, plan members active/invited/left, a
  LeaderboardRemote with and without `leaderboard_remote_id` link. Asserts exact switches per side,
  scope verbatim, nothing pending became a grant, no username merges.

### Task 1.3: `/api/v1/friends` router
- Files: `backend/src/routes/friends.ts`, `services/friends/*.ts`, `schemas/friends.ts`, mounts, OpenAPI.
- Endpoints exactly as §11.4 including `/scope`, `/trips`, `/plans`. Remote keys delegate to the
  `/sharing/connections` services. Defaults ON for new connections (§11.2.3).
- Fix `leaderboardBridge.ts` so a switch update keeps the scope (Review Focus 2); missing scope fails closed.
- Federation gate for remote requests = federation enabled + peer feature `connections`; otherwise
  legacy leaderboard pairing fallback (Review Focus 5).

### Task 1.4: authorisation reads the connection
- Local trip offers (`services/sharing`) and plan access (`services/travplan/access.ts`) check
  `local_connections` switches; comparison reads (`/comparison/compare`, achievements) check the
  connection switches; achievements switch keeps meaning earned-only (§11.7).
- Tests: Review Focus 3 (both: new offer refused, old linked copy + joined plan still readable).

### Task 1.5: invitation link → connection request
- New link version carries the inviter's switches; old links/codes → leaderboard-only (§11.7).
- Redeem creates a request, inviter confirms (§11.8); decline burns the link. Test Review Focus 4.

Acceptance F1: backend tsc + lint + Jest green (the rail suites that are red on `forgejo/main` are
known), `npm run check` green, one Codex review, report ≤ 15 lines naming every contract deviation.

## Package F2 — web (one worker, parallel to F1)

### Task 2.1: API client + types for `/friends` (mocked in tests per §11.4)
### Task 2.2: per-friend view
- Files: `frontend/src/components/friends/*` (split, ≤ 400 lines each), i18n `friends` namespace.
- Head (avatar, name, server, state, gear → reuse `ConnectionSwitchesForm` incl. scope),
  Vergleich with head cards + two-bar rows (who leads visible without a sign), Erfolge grid with one
  shared denominator grouped "ihr beide / nur du / nur <Name>", Geteilte Reisen (both directions,
  "Reise teilen" opens the existing share flow pre-filled), Gemeinsame Pläne ("Zu Plan einladen").
- Sections follow the data owner's switch and say so when off (§11.7).
### Task 2.3: achievement info popover
- Hover AND tap, keyboard-focusable, closes on Escape/outside tap; shows name, description, points,
  progress only when the comparison grant includes achievements. Test: tap opens it on coarse pointer.
### Task 2.4: requests incl. redeemed links (§11.8), Settings → Verbindungen links to `/freunde`.
### Task 2.5: browser look at 1366 and 820 (dev server against F1 branch when available, otherwise mocks);
  investigate "Tage unterwegs / Länder: unbekannt" for a local friend and report the cause.

Acceptance F2: frontend tsc + lint + Vitest green, coverage ratchet holds, one Codex review,
screenshots at 1366/820 saved under the worktree's `tmp/` (not committed), report ≤ 15 lines.

## Package F3 — integration (coordinator + one worker after F1/F2 merge)

- Merge F1 then F2 into `feat/friends-compare`; fix seams.
- Update `scripts/e2e/friends-federation.mjs`: link → admission → redeem → inviter confirms →
  connection active → share a trip → linked copy arrives on the other server → plan invite → compare.
- Full Build Checks, coverage ratchet, Codex once, spec phase table §11.6 updated.
