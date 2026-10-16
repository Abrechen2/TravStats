# Comparison Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the friend leaderboard on server-built aggregates (consent per person, signed server-to-server pull across instances) and move the full-record E2E transfer, unchanged, behind its own beta key at `/encrypted-share`.
**Architecture:** A new `services/comparison/**` builds versioned totals snapshots from the existing stats loaders and serves them to consented viewers — same instance by a direct server-side read, other instances by a new `aggregate` action on the existing Ed25519 peer endpoint. The E2E cookie API moves to `/api/v1/encrypted-share`; the server identity moves from env-only to `admin_settings` with the env as override, administered in Admin → Instanz. The page is rebuilt from `components/ui` primitives like `/stats`.
**Tech Stack:** Express 4 + TypeScript, Prisma 7 / Postgres 16 + PostGIS, Zod 4 (`schemas/zod.ts`), Jest + supertest; React 19 + Vite + Tailwind, Vitest + Testing Library, react-i18next (DE primary, EN mirror).
**Spec:** docs/superpowers/specs/2026-10-16-comparison-rework-design.md

## Global Constraints

- Branch: `dev/comparison-rework` off `main` once `fix/ct142-federation` is merged; never commit to `main`; merge is the owner's isolated decision.
- Never edit `backend/VERSION` or `CHANGELOG.md` on the branch.
- Test database (yours alone): `postgresql://fix:fixpw@localhost:5440/fix_comparison_test`; run `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" npx prisma migrate deploy` after every migration task before running tests.
- Backend tests run serially, one file set at a time, never the whole suite in parallel with other agents.
- Every schema module imports `z` from `backend/src/schemas/zod.ts` (`import { z } from "./zod"`), never from `"zod"`.
- Prisma types and `Prisma` come from `backend/src/prisma.ts`; the logger is the default export of `utils/logger`.
- Migrations: edit `schema.prisma`, then `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" npx prisma migrate dev --create-only --name <name>`, review/extend the SQL, `npx prisma migrate deploy`, then `npm run check:drift` with the same `DATABASE_URL` must pass. Never edit an applied migration.
- File size: no source file above 800 lines (`node scripts/check-file-size.mjs` from the repo root).
- Response families (ADR 0001): `routes/comparison.ts` enveloped, `routes/encryptedShare.ts` + `routes/encryptedShareSealed.ts` enveloped, `routes/admin/federation.ts` bare, `routes/comparisonPeer.ts` bare.
- Limits: 50 local + 20 remote leaderboard rows; 20 open invitations per user, 72 h validity; peer packet body ≤ 8 192 bytes (unchanged); read limiter 60/min, write limiter 30/h.
- Snapshot wire identity: `schema: "travstats-leaderboard"`, `version: 1`; served versions `[1]`.
- Error codes (all `COMPARISON_*`, added to `ApiErrorCode` in Task 2): `DISABLED`, `TOKEN_REFUSED`, `USER_NOT_FOUND`, `SELF`, `DUPLICATE`, `NOT_FOUND`, `NOT_PENDING`, `INVITE_INVALID`, `INVITE_LIMIT`, `FEDERATION_OFF`, `FEDERATION_ENV`, `PEER_UNKNOWN`, `PEER_UNREACHABLE`, `PEER_OUTDATED`, `PEER_KEY_INVALID`, `BOARD_NOT_FOUND`, `BOARD_MEMBER_INVALID`, `YEAR_NOT_SHARED`.
- Beta keys: `comparison` gates `/compare` throughout (never removed here); `encryptedShare` is new and gates `/encrypted-share`.
- UI copy: German first, English mirrored in the same change, informal "du"; `localeKeyParity.test.ts` must stay green.
- `useTranslation` is imported from `hooks/useTranslation`; numbers via `formatNumber`/`formatDistance` (`lib/units.ts`), durations via `formatDuration` (`lib/formatters.ts`), dates via `useDisplayFormat` (`lib/displayFormat.ts`), domain colours via `useDomainColors`.
- Commits: Conventional Commits, English, ending with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N`.
- After every task: `cd backend && npx tsc --noEmit && npm run lint` and/or `cd frontend && npx tsc --noEmit && npm run lint` for each touched tree, and `frontend/node_modules/.bin/prettier --write <changed files>`.

## Review Focus

1. **Deactivated owner keeps leaking numbers** — the old `currentGrant` checked `owner.isActive`; a new read path that forgets it shows a disabled account's totals. Pinned in Task 13 ("drops a deactivated owner") and Task 11 (`aggregate` for an inactive owner → `notShared`).
2. **Year scope widened by "all"** — a consent limited to 2024 must not answer the lifetime view (`year: null`) with lifetime totals. Pinned in Task 7 ("refuses lifetime for a one-year consent") and Task 13.
3. **Cross-origin channel use** — a second verified peer replaying a channel that belongs to another peer must get `unknown-channel`, not the snapshot. Pinned in Task 11 ("refuses a channel from another origin").
4. **Board IDOR and stale members** — another user's board id must 404, and a member whose consent was withdrawn must vanish from the board's rows. Pinned in Task 10 ("another user's board is not found") and Task 13 ("a withdrawn member leaves the board").
5. **Hostile metric record from a remote server** — `__proto__`/`constructor` keys or more than 64 metrics must fail validation before reaching the UI. Pinned in Task 6 (schema test) and Task 12 (`pullRemote` maps an invalid reply to `unreachable`).

---

## File Structure

### Backend — created
| Path | Responsibility |
|---|---|
| `backend/src/routes/encryptedShare.ts` (git mv of `routes/comparison.ts`) | E2E cookie API (links, invites, grants, circles, preview), minus boards/audit/peers |
| `backend/src/routes/encryptedShareSealed.ts` (git mv of `routes/comparisonSealed.ts`) | E2E sealed publications sub-router |
| `backend/src/routes/comparison.ts` (new content) | Leaderboard cookie API (enveloped, documented) |
| `backend/src/routes/admin/federation.ts` | Admin: server identity, key generation, peer pinning/verify/suspend (bare) |
| `backend/src/services/federation/refusal.ts` | `PeerRefusal`, `PeerRefusalKind`, `refused()`, `hash()` |
| `backend/src/services/federation/identity.ts` | `loadIdentity()`, `envOverrideActive()`, `resetIdentityCache()` |
| `backend/src/services/comparison/errors.ts` | `comparisonError()` — logged `AppError` with a `COMPARISON_*` code |
| `backend/src/shared/comparisonMetrics.ts` | Metric catalogue (mirrored in frontend) |
| `backend/src/schemas/comparison.ts` | Scope, snapshot v1, peer messages, cookie API shapes |
| `backend/src/schemas/federationAdmin.ts` | Admin federation bodies, ping reply |
| `backend/src/services/comparison/domainAggregates.ts` | Per-domain totals from existing loaders |
| `backend/src/services/comparison/aggregates.ts` | `buildLeaderboardSnapshot()` |
| `backend/src/services/comparison/consents.ts` | Request/accept/decline/update/end, `listPeople`, `personView`, key helpers |
| `backend/src/services/comparison/boards.ts` | Named sets of visible people |
| `backend/src/services/comparison/peerActions.ts` | Serve `aggregate`, `lb-claim`, `lb-state` |
| `backend/src/services/comparison/remote.ts` | Invites, claim, pull, readiness, end remote |
| `backend/src/services/comparison/leaderboard.ts` | `readLeaderboard()` |
| `backend/src/services/openapi/paths/comparison.ts` | OpenAPI for the cookie API |
| tests under `backend/src/routes/__tests__/`, `backend/src/routes/admin/__tests__/`, `backend/src/services/comparison/__tests__/`, `backend/src/services/federation/__tests__/`, `backend/src/schemas/__tests__/` | one per task |

### Backend — modified
| Path | Change |
|---|---|
| `backend/prisma/schema.prisma` | drop `ComparisonGroup`; `AdminSettings` + 3 federation columns; `ComparisonPeer.leaderboardVersions`; 5 `Leaderboard*` models; `User` relations |
| `backend/src/routes/mounts.ts` | `encrypted-share` mount; new `comparison` mount |
| `backend/src/routes/admin/index.ts` | mount `/federation` |
| `backend/src/routes/comparisonPeer.ts` | refusal kinds in the log; ping advertises versions; leaderboard actions |
| `backend/src/services/federation/security.ts` | identity removed (→ `identity.ts`), `envelope(body, destination, local, nonce?)`, kinds |
| `backend/src/services/federation/contract.ts` | `packetBody` gains `aggregate`, `lb-claim`, `lb-state` |
| `backend/src/services/federation/links.ts` | `invite()` awaits `loadIdentity()` |
| `backend/src/services/federation/restore.ts` | leaderboard consents → pending, invites deleted |
| `backend/src/services/openapi/coverage.ts` | `encrypted-share` undocumented with reason; `comparison` documented |
| `backend/src/services/openapi/paths/index.ts` | import `./comparison` |
| `backend/src/middleware/errorHandler.ts` | `COMPARISON_*` codes |
| `backend/src/middleware/rateLimit.ts` | `comparisonReadLimiter`, `comparisonWriteLimiter` |
| `backend/src/services/export/allDataExport.ts` | exclusions |
| `backend/src/__tests__/apiResponseShape.baseline.json` | families |
| `backend/src/services/federation/__tests__/routes.test.ts` | path → `/api/v1/encrypted-share` |
| `scripts/federation-sandbox/server.ts` | `loadIdentity()`, new `envelope` signature |

### Backend — deleted
`backend/src/services/federation/groups.ts`.

### Frontend — created
| Path | Responsibility |
|---|---|
| `frontend/src/shared/comparisonMetrics.ts` | Metric catalogue mirror |
| `frontend/src/lib/comparison/types.ts` | Wire types of the cookie API |
| `frontend/src/lib/api/comparison.ts` (new content) | `comparisonApi`, `comparisonFailureCode` |
| `frontend/src/lib/comparison/ranking.ts` | `rankPeople`, `explainUnranked` |
| `frontend/src/lib/comparison/formatMetric.ts` | `formatMetricValue` |
| `frontend/src/lib/comparison/years.ts` | `recentYears` |
| `frontend/src/lib/api/federationAdmin.ts` | Admin federation client |
| `frontend/src/components/Admin/FederationSettings.tsx` | Admin → Instanz card |
| `frontend/src/components/comparison/ConsentDialog.tsx` | The one consent dialog |
| `frontend/src/components/comparison/LeaderboardTile.tsx` | Metric card with ranking |
| `frontend/src/components/comparison/PeopleSection.tsx` | Requests + people table |
| `frontend/src/components/comparison/AddPersonCard.tsx` | Username request, invite create/claim |
| `frontend/src/components/comparison/BoardsSection.tsx` | Named groups |
| `frontend/src/components/comparison/LeaderboardPage.tsx` | Page composition |
| `frontend/src/pages/EncryptedSharePage.tsx` | E2E page behind `encryptedShare` |
| `frontend/src/i18n/resources/{de,en}/comparison.json` (new content) | Leaderboard copy |

### Frontend — moved (git mv, E2E, behaviour unchanged)
`components/comparison/*` → `components/encryptedShare/*`, `lib/comparison/*` → `lib/encryptedShare/*`, `lib/api/comparison.ts` → `lib/api/encryptedShare.ts`, `i18n/resources/{de,en}/comparison.json` → `encryptedShare.json`, `comparison.css` → `encryptedShare.css`.

### Frontend — modified / deleted
`App.tsx` (route), `pages/ComparisonPage.tsx`, `components/Nav/useNavItems.ts`, `components/ui/icons/lucide.ts` (`users`), `config/betaFeatures.ts`, `i18n/config.ts`, `pages/Admin/AdminSectionSwitch.tsx`, `i18n/resources/{de,en}/admin.json`, `components/encryptedShare/SealedWorkspace.tsx` (leaderboard half and peers tab removed). Deleted: `components/comparison/PeerManager.tsx` (before the move), `components/encryptedShare/ranking.ts` + its test.

### Docs
`docs/superpowers/specs/2026-10-16-comparison-rework-design.md`, `docs/superpowers/plans/2026-10-16-comparison-rework.md` (Task 1), `docs/FEDERATION_DEV.md`, `docs/FEDERATION_E2E.md`, `docs/superpowers/specs/2026-10-10-federation-threat-model.md`, `CLAUDE.md` (Task 22).

---

### Task 1: Move the E2E cookie API to `/api/v1/encrypted-share` and drop boards/audit

**Files:**
- Move: `backend/src/routes/comparison.ts` → `backend/src/routes/encryptedShare.ts`; `backend/src/routes/comparisonSealed.ts` → `backend/src/routes/encryptedShareSealed.ts`
- Modify: `backend/src/routes/encryptedShare.ts` (lines 1, 39, 153-184 of the old file), `backend/src/routes/mounts.ts:2,172`, `backend/src/services/openapi/coverage.ts:42`, `backend/src/__tests__/apiResponseShape.baseline.json`, `backend/prisma/schema.prisma` (`ComparisonGroup`, `User.comparisonGroups`), `backend/src/services/export/allDataExport.ts:194`, `backend/src/services/federation/__tests__/routes.test.ts:7,23` and every `/api/v1/comparison/` string in it, `frontend/src/lib/api/comparison.ts:74-79,90-98`
- Delete: `backend/src/services/federation/groups.ts`
- Create: `backend/src/routes/__tests__/encryptedShare.mount.test.ts`, `docs/superpowers/specs/2026-10-16-comparison-rework-design.md`, `docs/superpowers/plans/2026-10-16-comparison-rework.md`
- Migration: `*_drop_comparison_groups`

**Interfaces:** Consumes: `apiMounts` (`routes/mounts.ts`), `listMountedEndpoints`, `UNDOCUMENTED_MOUNTS` (`services/openapi/coverage.ts`). Produces: mount `{ id: "encrypted-share", base: "/api/v1/encrypted-share" }`; frontend E2E client prefix `/encrypted-share`.

- [ ] **Step 1: Write the failing test**

`backend/src/routes/__tests__/encryptedShare.mount.test.ts`:
```ts
import { apiMounts } from "../mounts";
import { listMountedEndpoints, UNDOCUMENTED_MOUNTS } from "../../services/openapi/coverage";

describe("the encrypted share lives apart from the comparison page", () => {
  it("serves the E2E cookie API under /encrypted-share", () => {
    expect(apiMounts.find((m) => m.id === "encrypted-share")?.base).toBe(
      "/api/v1/encrypted-share"
    );
    const served = listMountedEndpoints().map((e) => `${e.method} ${e.path}`);
    expect(served).toContain("get /encrypted-share/links");
    expect(served).toContain("post /encrypted-share/sealed/read");
    // The friendship endpoints of the E2E transfer never answer under /comparison again.
    expect(served.filter((p) => p.includes(" /comparison/links"))).toEqual([]);
  });

  it("drops the board and audit endpoints nothing ever called", () => {
    const served = listMountedEndpoints().map((e) => e.path);
    expect(served.filter((p) => /\/(boards|audit)$/.test(p) && p.startsWith("/encrypted-share"))).toEqual(
      []
    );
  });

  it("says why the E2E API is outside the published spec", () => {
    expect(UNDOCUMENTED_MOUNTS.get("encrypted-share")).toMatch(/beta/i);
    expect(UNDOCUMENTED_MOUNTS.has("comparison")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/routes/__tests__/encryptedShare.mount.test.ts`
Expected: FAIL — `expect(received).toBe(expected)` with `received: undefined` for the `encrypted-share` base.

- [ ] **Step 3: Write minimal implementation**

```bash
mkdir -p docs/superpowers/plans
cp "C:/Users/DENNIS~1/AppData/Local/Temp/claude/D--TravStats-Projekt-TravStats/f3a339e3-6a14-4bf2-a7b7-08d55fe2964f/scratchpad/plans/2026-10-16-comparison-rework-design.md" docs/superpowers/specs/
cp "C:/Users/DENNIS~1/AppData/Local/Temp/claude/D--TravStats-Projekt-TravStats/f3a339e3-6a14-4bf2-a7b7-08d55fe2964f/scratchpad/plans/2026-10-16-comparison-rework.md" docs/superpowers/plans/
git mv backend/src/routes/comparison.ts backend/src/routes/encryptedShare.ts
git mv backend/src/routes/comparisonSealed.ts backend/src/routes/encryptedShareSealed.ts
git rm backend/src/services/federation/groups.ts
```
(The planning session wrote both files there; they become the repository copies.)

In `backend/src/routes/encryptedShare.ts`:
- line 1: `import sealedRouter from "./encryptedShareSealed";`
- delete line 39 (`import { saveBoard } from "../services/federation/groups";`)
- delete the three handlers `router.get("/audit", …)`, `router.get("/boards", …)`, `router.post("/boards", …)` (old lines 153-184).
- add above `const router = Router();`:
```ts
/**
 * The full-record, device-encrypted transfer (protocol v2, docs/FEDERATION_E2E.md), moved here
 * from /comparison on 2026-10-16 so the leaderboard no longer depends on it. Behind its own beta
 * key `encryptedShare` until the owner keeps or cuts it. Behaviour unchanged.
 */
```

In `backend/src/routes/encryptedShareSealed.ts` line 1 comment: `/** Mounted AFTER the encrypted-share cookie/beta/demo/rate guards. Never mount directly. */`

`backend/src/routes/mounts.ts`:
```ts
import encryptedShareRoutes from "./encryptedShare";
import comparisonPeerRoutes from "./comparisonPeer";
```
(replacing the `comparisonRoutes` import) and in `apiMounts`:
```ts
  { id: "encrypted-share", base: "/api/v1/encrypted-share", router: encryptedShareRoutes },
  { id: "comparison-peer", base: "/api/v1/comparison-peer", router: comparisonPeerRoutes },
```

`backend/src/services/openapi/coverage.ts` — replace the `comparison` entry:
```ts
  [
    "encrypted-share",
    "Beta, cookie-session-only device-encrypted transfer (protocol v2) under independent review; no integration contract",
  ],
```

`backend/src/__tests__/apiResponseShape.baseline.json` — in `enveloped`, replace `"comparison.ts"` with `"encryptedShare.ts"` and `"comparisonSealed.ts"` with `"encryptedShareSealed.ts"` (keep the array sorted).

`backend/src/services/federation/__tests__/routes.test.ts`: `import comparison from "../../../routes/encryptedShare";`, `app.use("/api/v1/encrypted-share", comparison);`, and replace every `"/api/v1/comparison/` with `"/api/v1/encrypted-share/` (and the template literals `` `/api/v1/comparison/ `` likewise). Delete the test cases that call `/boards` or `/audit` if present.

`backend/prisma/schema.prisma`: delete the `ComparisonGroup` model (lines 4750-4759) and the `comparisonGroups ComparisonGroup[]` line in `model User`. Then:
```bash
cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" npx prisma migrate dev --create-only --name drop_comparison_groups
```
The generated SQL must be exactly a `DROP TABLE "comparison_groups";` (plus its FK drop if Prisma emits one). Prepend the comment:
```sql
-- Comparison boards (forgejo#40) had no UI and no reader: GET/POST /comparison/boards were never
-- called by the frontend. Their rows are dropped with the table; nobody can have seen them.
-- Leaderboard groups are LeaderboardBoard (comparison rework 2026-10-16).
```
Apply: `npx prisma migrate deploy && npx prisma generate`.

`backend/src/services/export/allDataExport.ts`: delete the line `comparisonGroups: "private comparison audiences, re-established after restore",`.

`frontend/src/lib/api/comparison.ts`: delete `interface Board` (lines 74-79) and change the three helpers:
```ts
/** The E2E transfer's own API (moved from /comparison, 2026-10-16). */
const BASE = "/encrypted-share";
export async function comparisonGet<T>(path: string): Promise<T> {
  return (await api.get<{ success: true; data: T }>(`${BASE}${path}`)).data.data;
}
export async function comparisonPost<T>(path: string, body: unknown = {}): Promise<T> {
  return (await api.post<{ success: true; data: T }>(`${BASE}${path}`, body)).data.data;
}
export async function comparisonDelete(path: string): Promise<void> {
  await api.delete(`${BASE}${path}`);
}
```
Run `grep -rn "\"/comparison\|'/comparison\|\`/comparison" frontend/src/lib/comparison` — any hard-coded `/comparison/` URL there (e.g. in `transport.ts` for `/sealed/asset`) becomes `/encrypted-share/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/routes/__tests__/encryptedShare.mount.test.ts src/services/federation/__tests__ src/__tests__/apiResponseShape.ratchet.test.ts src/__tests__/openapi.coverage.test.ts src/routes/admin/__tests__/exportAllData.test.ts`
Expected: PASS. Then `cd frontend && npx vitest --run src/components/comparison` → PASS, and `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" npm run check:drift` → no drift.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-16-comparison-rework-design.md docs/superpowers/plans/2026-10-16-comparison-rework.md backend/src/routes backend/src/services/openapi/coverage.ts backend/src/__tests__/apiResponseShape.baseline.json backend/prisma backend/src/services/export/allDataExport.ts backend/src/services/federation frontend/src/lib/api/comparison.ts frontend/src/lib/comparison
git commit -m "refactor(comparison): move the encrypted transfer to /encrypted-share and drop unused boards

The leaderboard is being rebuilt on aggregates (spec 2026-10-16). The device-encrypted
transfer keeps working unchanged under its own path; boards and the audit read had no
caller and go, with the comparison_groups table.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 2: Error vocabulary — `COMPARISON_*` codes, `comparisonError`, peer refusal kinds

**Files:**
- Create: `backend/src/services/federation/refusal.ts`, `backend/src/services/comparison/errors.ts`, `backend/src/services/comparison/__tests__/errors.test.ts`
- Modify: `backend/src/middleware/errorHandler.ts` (union `ApiErrorCode`, after the `SHARE_*` members ~line 416), `backend/src/services/federation/security.ts` (lines 1-20 imports/`refused`/`hash`, `verifyEnvelope`, `authenticatePeer`, `consumeNonce`), `backend/src/routes/comparisonPeer.ts`, `backend/src/services/federation/__tests__/peerRoute.test.ts`

**Interfaces:**
Produces:
```ts
// services/federation/refusal.ts
export type PeerRefusalKind = "beta-off" | "packet-too-large" | "malformed" | "unknown-peer" | "bad-signature" | "stale" | "unverified-peer" | "replay" | "unknown-channel" | "federation-off" | "refused";
export class PeerRefusal extends AppError { kind: PeerRefusalKind }
export function refused(kind?: PeerRefusalKind): PeerRefusal;
export function hash(value: string): string;
// services/comparison/errors.ts
export type ComparisonErrorCode = Extract<ApiErrorCode, `COMPARISON_${string}`>;
export function comparisonError(code: ComparisonErrorCode, status: number, message: string, context?: Record<string, unknown>): AppError;
```

- [ ] **Step 1: Write the failing test**

`backend/src/services/comparison/__tests__/errors.test.ts`:
```ts
import logger from "../../../utils/logger";
import { AppError } from "../../../middleware/errorHandler";
import { comparisonError } from "../errors";
import { PeerRefusal, refused } from "../../federation/refusal";

describe("comparison error vocabulary", () => {
  it("names the cause in a code and logs it before the error is thrown", () => {
    const info = jest.spyOn(logger, "info").mockImplementation(() => undefined as never);
    const error = comparisonError("COMPARISON_SELF", 400, "Cannot compare with yourself", {
      userId: "u1",
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 400, code: "COMPARISON_SELF" });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "comparison_refused", code: "COMPARISON_SELF", userId: "u1" }),
      "Cannot compare with yourself"
    );
    info.mockRestore();
  });

  it("keeps the peer's answer generic while the kind says why", () => {
    const error = refused("replay");
    expect(error).toBeInstanceOf(PeerRefusal);
    expect(error).toMatchObject({ statusCode: 403, kind: "replay", message: "Comparison request refused" });
    expect(refused().kind).toBe("refused");
  });
});
```

Append to `backend/src/services/federation/__tests__/peerRoute.test.ts`:
```ts
it("logs the refusal kind for an unverified peer's non-ping packet", async () => {
  const warn = jest.spyOn(logger, "warn");
  const state = signed(
    JSON.stringify({
      action: "state",
      channel: "00000000-0000-4000-8000-000000000000",
      confirmed: true,
      revoked: false,
    })
  );
  expect((await request(app).post("/api/v1/comparison-peer").send(state)).status).toBe(403);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "comparison_peer_refused", kind: "unverified-peer" }),
    "Comparison peer packet refused"
  );
  warn.mockRestore();
});

it("logs packet-too-large for an oversized body", async () => {
  const warn = jest.spyOn(logger, "warn");
  const huge = signed(JSON.stringify({ action: "ping", pad: "x".repeat(20_000) }));
  await request(app).post("/api/v1/comparison-peer").send(huge);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "packet-too-large" }),
    "Comparison peer packet refused"
  );
  warn.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/errors.test.ts src/services/federation/__tests__/peerRoute.test.ts`
Expected: FAIL — `Cannot find module '../errors'`; the peer-route cases fail on `expect.objectContaining({ kind: … })` (the log carries no `kind`).

- [ ] **Step 3: Write minimal implementation**

`backend/src/middleware/errorHandler.ts` — append to `ApiErrorCode` after the last `SHARE_*` member:
```ts
  /** Comparison (leaderboard) — rework 2026-10-16. The beta switch is off. */
  | "COMPARISON_DISABLED"
  /** A personal access token: the comparison is a browser-session feature. */
  | "COMPARISON_TOKEN_REFUSED"
  | "COMPARISON_USER_NOT_FOUND"
  | "COMPARISON_SELF"
  /** The caller already shares with that person. */
  | "COMPARISON_DUPLICATE"
  | "COMPARISON_NOT_FOUND"
  | "COMPARISON_NOT_PENDING"
  /** An invitation code that is malformed, unknown, used or expired. */
  | "COMPARISON_INVITE_INVALID"
  | "COMPARISON_INVITE_LIMIT"
  /** This server has no federation identity. */
  | "COMPARISON_FEDERATION_OFF"
  /** The identity is set by environment variables and cannot be changed in the UI. */
  | "COMPARISON_FEDERATION_ENV"
  /** The admin has not pinned and verified that server. */
  | "COMPARISON_PEER_UNKNOWN"
  | "COMPARISON_PEER_UNREACHABLE"
  /** The other server predates the leaderboard protocol. */
  | "COMPARISON_PEER_OUTDATED"
  | "COMPARISON_PEER_KEY_INVALID"
  | "COMPARISON_BOARD_NOT_FOUND"
  | "COMPARISON_BOARD_MEMBER_INVALID"
  | "COMPARISON_YEAR_NOT_SHARED"
```

`backend/src/services/federation/refusal.ts`:
```ts
import { createHash } from "crypto";
import { AppError } from "../../middleware/errorHandler";

/**
 * Why a peer packet was turned away. The peer itself always reads the same 403 — it learns
 * nothing — but the operator's log names the kind, which one generic `refused()` never did.
 */
export type PeerRefusalKind =
  | "beta-off"
  | "packet-too-large"
  | "malformed"
  | "unknown-peer"
  | "bad-signature"
  | "stale"
  | "unverified-peer"
  | "replay"
  | "unknown-channel"
  | "federation-off"
  | "refused";

export class PeerRefusal extends AppError {
  kind: PeerRefusalKind;
  constructor(kind: PeerRefusalKind) {
    super("Comparison request refused", 403);
    this.kind = kind;
    this.name = "PeerRefusal";
  }
}

/** `refused()` without a kind is the E2E code path's spelling and stays valid. */
export const refused = (kind: PeerRefusalKind = "refused"): PeerRefusal => new PeerRefusal(kind);
export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
```

`backend/src/services/federation/security.ts`: remove the local `refused`/`hash` definitions and `createHash` from the `crypto` import; add
```ts
import { refused, hash } from "./refusal";
export { refused, hash, PeerRefusal, type PeerRefusalKind } from "./refusal";
```
Give the existing throws their kinds:
- `verifyEnvelope`: destination mismatch → `refused("bad-signature")`; time skew → `refused("stale")`; key/verify failure (both throws inside the try and the catch) → `refused("bad-signature")`.
- `authenticatePeer`: `if (!peer?.enabled) throw refused("unknown-peer");`
- `consumeNonce`: `catch { throw refused("replay"); }`
- `identity()`: both throws → `refused("federation-off")`.

`backend/src/services/comparison/errors.ts`:
```ts
import logger from "../../utils/logger";
import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";

export type ComparisonErrorCode = Extract<ApiErrorCode, `COMPARISON_${string}`>;

/**
 * Every leaderboard refusal goes through here: a named code the frontend branches on, and a log
 * line, so "why can't Anna see Ben" is answered from the log instead of from a guess. The old
 * comparison router answered every refusal with one bare 403 and logged none of them.
 */
export function comparisonError(
  code: ComparisonErrorCode,
  status: number,
  message: string,
  context: Record<string, unknown> = {}
): AppError {
  logger.info({ operation: "comparison_refused", code, ...context }, message);
  return new AppError(message, status, code);
}
```

`backend/src/routes/comparisonPeer.ts`:
- imports: `import { ZodError } from "zod";` and `import { authenticatePeer, consumeNonce, envelope, refused, PeerRefusal } from "../services/federation/security";`
- `if (!(await getInstanceSettings()).betaFeaturesEnabled) throw refused("beta-off");`
- the size guard: `throw refused("packet-too-large");`
- `if (body.action !== "ping" && !peer.verifiedAt) throw refused("unverified-peer");`
- the two `if (!link) throw refused();` → `throw refused("unknown-channel");`
- the catch:
```ts
  } catch (error) {
    // The peer learns nothing; the operator learns why a federation partner is being turned away.
    const kind =
      error instanceof PeerRefusal
        ? error.kind
        : error instanceof ZodError || error instanceof SyntaxError
          ? "malformed"
          : "refused";
    logger.warn(
      {
        operation: "comparison_peer_refused",
        kind,
        reason: error instanceof Error ? error.message : String(error),
      },
      "Comparison peer packet refused"
    );
    res.status(403).json({ error: "COMPARISON_REFUSED" });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/errors.test.ts src/services/federation/__tests__`
Expected: PASS (all federation tests, including the unchanged E2E ones).

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/errorHandler.ts backend/src/services/federation backend/src/services/comparison backend/src/routes/comparisonPeer.ts
git commit -m "feat(comparison): name every refusal — COMPARISON_* codes and peer refusal kinds

One generic refused() 403 left operators guessing why a friend or a peer server was turned
away. Peers still see the same 403; the log now carries the kind.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 3: Server identity from `admin_settings`, env as override

**Files:**
- Create: `backend/src/services/federation/identity.ts`, `backend/src/services/federation/__tests__/identity.test.ts`
- Modify: `backend/prisma/schema.prisma` (`AdminSettings` after `shareLinksEnabled` ~line 1196; `ComparisonPeer`), `backend/src/services/federation/security.ts` (`identity`, `envelope`, `exchange`, `authenticatePeer`), `backend/src/routes/comparisonPeer.ts`, `backend/src/services/federation/links.ts:29-34`, `backend/src/routes/encryptedShare.ts` (`/peers` handlers' `identity()` calls), `scripts/federation-sandbox/server.ts:95-96,219`
- Migration: `*_federation_admin_settings`

**Interfaces:**
Produces:
```ts
export type IdentitySource = "env" | "settings";
export interface Identity { origin: string; key: KeyObject; publicKey: string; fingerprint: string; source: IdentitySource }
export function envOverrideActive(): boolean;
export function resetIdentityCache(): void;
export async function loadIdentity(): Promise<Identity>;          // throws PeerRefusal("federation-off")
// security.ts
export function envelope(body: unknown, destination: string, local: Identity, nonce?: string): Envelope;
export async function authenticatePeer(value: unknown): Promise<{ message: Envelope; peer: ComparisonPeer; local: Identity }>;
```
Prisma: `AdminSettings.federationEnabled Boolean`, `federationOrigin String?`, `federationPrivateKey String?`; `ComparisonPeer.leaderboardVersions Int[]`.

- [ ] **Step 1: Write the failing test**

`backend/src/services/federation/__tests__/identity.test.ts`:
```ts
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync } from "crypto";
import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { ensureAdminSettingsRow } from "../../adminSettingsRow";
import { loadIdentity, resetIdentityCache } from "../identity";

const ENV = ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"];
const pem = () =>
  generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
let rowId: number;

beforeAll(async () => {
  rowId = await ensureAdminSettingsRow();
});
beforeEach(() => {
  for (const key of ENV) delete process.env[key];
  resetIdentityCache();
});
afterAll(async () => {
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
  });
  await prisma.$disconnect();
});

it("refuses with federation-off while nothing is configured", async () => {
  await prisma.adminSettings.update({ where: { id: rowId }, data: { federationEnabled: false } });
  await expect(loadIdentity()).rejects.toMatchObject({ kind: "federation-off" });
});

it("uses the key an admin generated, stored encrypted in admin_settings", async () => {
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: {
      federationEnabled: true,
      federationOrigin: "https://settings.identity.test",
      federationPrivateKey: encryptApiKey(pem()),
    },
  });
  const identity = await loadIdentity();
  expect(identity).toMatchObject({ origin: "https://settings.identity.test", source: "settings" });
  expect(identity.fingerprint).toMatch(/^[a-f0-9]{64}$/);
});

it("lets the env override win, so existing installs keep their key", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-"));
  fs.writeFileSync(path.join(dir, "k.pem"), pem());
  process.env.FEDERATION_ENABLED = "1";
  process.env.FEDERATION_PUBLIC_ORIGIN = "https://env.identity.test";
  process.env.FEDERATION_KEY_FILE = path.join(dir, "k.pem");
  expect(await loadIdentity()).toMatchObject({ origin: "https://env.identity.test", source: "env" });
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/federation/__tests__/identity.test.ts`
Expected: FAIL — `Cannot find module '../identity'`.

- [ ] **Step 3: Write minimal implementation**

`backend/prisma/schema.prisma`, in `model AdminSettings` after `shareLinksEnabled`:
```prisma
  /// Server-to-server connections (comparison rework 2026-10-16). Until then the identity came
  /// only from FEDERATION_* env vars; those still win when FEDERATION_ENABLED=1 (identity.ts).
  federationEnabled    Boolean @default(false) @map("federation_enabled")
  /// This server's public https origin, as peers address it.
  federationOrigin     String? @map("federation_origin")
  /// Ed25519 private key, PKCS#8 PEM, encrypted at application level like the push secret.
  federationPrivateKey String? @map("federation_private_key")
```
In `model ComparisonPeer`:
```prisma
  /// Leaderboard snapshot versions the peer advertised in its last ping; [] = predates them.
  leaderboardVersions Int[] @default([]) @map("leaderboard_versions")
```
```bash
cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" npx prisma migrate dev --create-only --name federation_admin_settings && npx prisma migrate deploy && npx prisma generate
```

`backend/src/services/federation/identity.ts`:
```ts
import { createPrivateKey, createPublicKey, type KeyObject } from "crypto";
import fs from "fs";
import { isAbsolute } from "path";
import { prisma } from "../../db";
import { decryptApiKey } from "../../utils/encryption";
import { origin as originSchema } from "./contract";
import { hash, refused } from "./refusal";

export type IdentitySource = "env" | "settings";
export interface Identity {
  origin: string;
  key: KeyObject;
  publicKey: string;
  fingerprint: string;
  source: IdentitySource;
}

// Every signed packet re-read and re-parsed the key file once, blocking the event loop per
// request. The key is parsed once per configuration; a new key or origin changes the config.
let cached: { config: string; value: Identity } | null = null;

export function resetIdentityCache(): void {
  cached = null;
}

/** FEDERATION_ENABLED=1 keeps an install configured before 2026-10-16 exactly as it was. */
export function envOverrideActive(): boolean {
  return process.env.FEDERATION_ENABLED === "1";
}

function parse(origin: string, pem: string | Buffer, source: IdentitySource, config: string) {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw refused("federation-off");
  const publicKey = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  const value: Identity = { origin, key, publicKey, fingerprint: hash(publicKey), source };
  cached = { config, value };
  return value;
}

export async function loadIdentity(): Promise<Identity> {
  if (envOverrideActive()) {
    const origin = originSchema.safeParse(process.env.FEDERATION_PUBLIC_ORIGIN);
    const file = process.env.FEDERATION_KEY_FILE;
    if (!origin.success || origin.data === "local" || !file || !isAbsolute(file))
      throw refused("federation-off");
    const config = `env|${origin.data}|${file}`;
    if (cached?.config === config) return cached.value;
    return parse(origin.data, fs.readFileSync(file), "env", config);
  }
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { federationEnabled: true, federationOrigin: true, federationPrivateKey: true },
  });
  if (!row?.federationEnabled || !row.federationOrigin || !row.federationPrivateKey)
    throw refused("federation-off");
  const config = `settings|${row.federationOrigin}|${hash(row.federationPrivateKey)}`;
  if (cached?.config === config) return cached.value;
  const pem = decryptApiKey(row.federationPrivateKey);
  if (!pem) throw refused("federation-off");
  return parse(row.federationOrigin, pem, "settings", config);
}
```

`backend/src/services/federation/security.ts`:
- delete `type Identity`, `cachedIdentity`, `identity()`, and the `fs`/`isAbsolute`/`createPrivateKey`/`KeyObject` imports they used; add `import { loadIdentity, type Identity } from "./identity";` and `export { loadIdentity } from "./identity";`
- `envelope`:
```ts
export function envelope(
  body: unknown,
  destination: string,
  local: Identity,
  nonce = randomBytes(32).toString("hex")
): Envelope {
  const unsigned = { origin: local.origin, destination, nonce, time: Date.now(), body: JSON.stringify(body) };
  const signature = sign(null, Buffer.from(JSON.stringify(unsigned)), local.key).toString("base64");
  return { ...unsigned, signature };
}
```
- `exchange`: `const local = await loadIdentity();` and `const outgoing = envelope(body, remoteOrigin, local);`
- `authenticatePeer`:
```ts
export async function authenticatePeer(value: unknown) {
  const local = await loadIdentity();
  const candidate = signedEnvelope.parse(value);
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin: candidate.origin } });
  if (!peer?.enabled) throw refused("unknown-peer");
  return { message: verifyEnvelope(candidate, peer.publicKey, local.origin), peer, local };
}
```

`backend/src/routes/comparisonPeer.ts`: `const { message, peer, local } = await authenticatePeer(raw);` and `const signed = envelope(data, message.origin, local, message.nonce);`

`backend/src/services/federation/links.ts` lines 29-34:
```ts
  let origin = "local";
  try {
    origin = (await loadIdentity()).origin;
  } catch {
    /* Local-only comparison remains available. */
  }
```
with `import { exchange, hash, loadIdentity, refused } from "./security";` (drop `identity`).

`backend/src/routes/encryptedShare.ts` (`/peers` handlers, removed in Task 4): `const i = await loadIdentity();` and `(await loadIdentity()).origin`, importing `loadIdentity` instead of `identity`.

`scripts/federation-sandbox/server.ts`: import `loadIdentity` instead of `identity`; lines 95-96 become `origin: (await loadIdentity()).origin, publicKey: (await loadIdentity()).publicKey,` (the surrounding handler is already `async`); line 219: `const signed = envelope({ action: "ping" }, p.origin, await loadIdentity());`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/federation/__tests__`
Expected: PASS — including `peerRoute.test.ts` "reads the instance key once, not on every packet" (env path unchanged) and `httpsExchange.test.ts`. Then `npm run check:drift` → no drift.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma backend/src/services/federation backend/src/routes/comparisonPeer.ts backend/src/routes/encryptedShare.ts scripts/federation-sandbox/server.ts
git commit -m "feat(federation): keep the server identity in admin settings, env as override

Admins can now connect servers without shell access to write a key file. FEDERATION_ENABLED=1
keeps existing installs on their configured key.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 4: Admin federation API — identity, key generation, peers

**Files:**
- Create: `backend/src/schemas/federationAdmin.ts`, `backend/src/routes/admin/federation.ts`, `backend/src/routes/admin/__tests__/federation.test.ts`
- Modify: `backend/src/routes/admin/index.ts` (import + `router.use("/federation", federationAdminRouter);` after `/push`), `backend/src/routes/encryptedShare.ts` (delete `/peers`, `/peers/verify`, `/peers/suspend` and the now-unused `createPublicKey`, `requireAdmin`, `hash`, `exchange`, `loadIdentity`, `origin` imports), `backend/src/__tests__/apiResponseShape.baseline.json` (`bare` += `"admin/federation.ts"`), `backend/src/routes/__tests__/encryptedShare.mount.test.ts`

**Interfaces:**
Consumes: `loadIdentity`, `envOverrideActive`, `resetIdentityCache` (Task 3), `exchange`, `hash`, `PeerRefusal` (security), `comparisonError` (Task 2), `ensureAdminSettingsRow` (`services/adminSettingsRow`), `encryptApiKey` (`utils/encryption`).
Produces:
```ts
// schemas/federationAdmin.ts
export const httpsOriginSchema: z.ZodType<string>;
export const federationSettingsSchema: z.ZodObject<{ enabled; origin }>;
export const peerPinSchema: z.ZodObject<{ origin; publicKey; fingerprint; enabled }>;
export const peerOriginSchema: z.ZodObject<{ origin }>;
export const pingReplySchema: z.ZodObject<{ ready: true; leaderboard?: number[] }>;
export interface FederationState { source: "env" | "settings" | null; enabled: boolean; origin: string | null; publicKey: string | null; fingerprint: string | null; peers: Array<{ origin: string; fingerprint: string; enabled: boolean; verifiedAt: string | null; leaderboardVersions: number[] }> }
```
Routes (bare): `GET /admin/federation`, `PUT /admin/federation`, `POST /admin/federation/key`, `POST /admin/federation/peers`, `POST /admin/federation/peers/verify`, `POST /admin/federation/peers/suspend` — each answers `FederationState` except verify/suspend (`{ verified: true }` / `{ suspended: true }`).

- [ ] **Step 1: Write the failing test**

`backend/src/routes/admin/__tests__/federation.test.ts`:
```ts
import express from "express";
import request from "supertest";
import { generateKeyPairSync } from "crypto";
import { prisma } from "../../../db";
import { errorHandler } from "../../../middleware/errorHandler";
import { ensureAdminSettingsRow } from "../../../services/adminSettingsRow";
import { resetIdentityCache } from "../../../services/federation/identity";
import { hash } from "../../../services/federation/refusal";
import federation from "../federation";

// The parent admin router applies authenticate + requireAdmin + requireWriteScope.
const app = express();
app.use(express.json());
app.use("/api/v1/admin/federation", federation);
app.use(errorHandler);
const PEER = "https://peer.admin-federation.test";
let rowId: number;

beforeAll(async () => {
  rowId = await ensureAdminSettingsRow();
});
beforeEach(() => {
  delete process.env.FEDERATION_ENABLED;
  resetIdentityCache();
});
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: PEER } });
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
  });
  await prisma.$disconnect();
});

it("turns federation on with a key generated in the UI", async () => {
  const put = await request(app)
    .put("/api/v1/admin/federation")
    .send({ enabled: true, origin: "https://me.admin-federation.test" });
  expect(put.status).toBe(200);
  expect(put.body).toMatchObject({ source: null, fingerprint: null });
  const key = await request(app).post("/api/v1/admin/federation/key").send({});
  expect(key.status).toBe(200);
  expect(key.body).toMatchObject({ source: "settings", enabled: true, origin: "https://me.admin-federation.test" });
  expect(key.body.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
  expect(row.federationPrivateKey).not.toContain("PRIVATE KEY");
});

it("refuses changes while the env override holds the identity", async () => {
  process.env.FEDERATION_ENABLED = "1";
  const res = await request(app).post("/api/v1/admin/federation/key").send({});
  expect(res.status).toBe(409);
  expect(res.body.code).toBe("COMPARISON_FEDERATION_ENV");
});

it("pins a peer only when its fingerprint matches its key", async () => {
  const pem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  const bad = await request(app)
    .post("/api/v1/admin/federation/peers")
    .send({ origin: PEER, publicKey: pem, fingerprint: "0".repeat(64), enabled: true });
  expect(bad.status).toBe(400);
  expect(bad.body.code).toBe("COMPARISON_PEER_KEY_INVALID");
  const good = await request(app)
    .post("/api/v1/admin/federation/peers")
    .send({ origin: PEER, publicKey: pem, fingerprint: hash(pem), enabled: true });
  expect(good.status).toBe(200);
  expect(good.body.peers).toEqual(
    expect.arrayContaining([expect.objectContaining({ origin: PEER, verifiedAt: null })])
  );
});

it("refuses http origins and ports", async () => {
  for (const origin of ["http://x.example", "https://x.example:8443", "local"]) {
    const res = await request(app).put("/api/v1/admin/federation").send({ enabled: true, origin });
    expect(res.status).toBe(400);
  }
});
```

Add to `backend/src/routes/__tests__/encryptedShare.mount.test.ts`:
```ts
  it("keeps peer administration out of the user-facing API", () => {
    const served = listMountedEndpoints().map((e) => `${e.method} ${e.path}`);
    expect(served.filter((p) => p.includes("/encrypted-share/peers"))).toEqual([]);
    expect(served).toContain("post /admin/federation/peers");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/routes/admin/__tests__/federation.test.ts src/routes/__tests__/encryptedShare.mount.test.ts`
Expected: FAIL — `Cannot find module '../federation'`; the mount test lists `post /encrypted-share/peers`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/schemas/federationAdmin.ts`:
```ts
import { z } from "./zod";
import { origin } from "../services/federation/contract";

/** A peer address: https, no port, path or credentials, never the "local" placeholder. */
export const httpsOriginSchema = z
  .string()
  .max(250)
  .refine((v) => v !== "local" && origin.safeParse(v).success, {
    message: "An https origin without port, path or credentials",
  });

export const federationSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  origin: httpsOriginSchema,
});

export const peerPinSchema = z.strictObject({
  origin: httpsOriginSchema,
  publicKey: z.string().min(40).max(500),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(),
});

export const peerOriginSchema = z.strictObject({ origin: httpsOriginSchema });

/** `leaderboard` is absent on servers that predate the leaderboard protocol (spec §10). */
export const pingReplySchema = z.object({
  ready: z.literal(true),
  leaderboard: z.array(z.number().int().positive()).max(8).optional(),
});

export interface FederationState {
  source: "env" | "settings" | null;
  enabled: boolean;
  origin: string | null;
  publicKey: string | null;
  fingerprint: string | null;
  peers: Array<{
    origin: string;
    fingerprint: string;
    enabled: boolean;
    verifiedAt: string | null;
    leaderboardVersions: number[];
  }>;
}
```

`backend/src/routes/admin/federation.ts`:
```ts
/**
 * Admin: this server's federation identity and the peers it trusts (comparison rework
 * 2026-10-16). Mounted under /api/v1/admin/federation; the parent applies authenticate +
 * requireAdmin + requireWriteScope. Outside the published spec with the whole `admin` mount.
 * The peer routes moved here unchanged from the comparison router, where any admin
 * reached them through a user page.
 */
import { Router, type Response, type NextFunction } from "express";
import { createPublicKey, generateKeyPairSync } from "crypto";
import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import logger from "../../utils/logger";
import { encryptApiKey } from "../../utils/encryption";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import {
  envOverrideActive,
  loadIdentity,
  resetIdentityCache,
  type Identity,
} from "../../services/federation/identity";
import { exchange, hash, PeerRefusal } from "../../services/federation/security";
import { comparisonError } from "../../services/comparison/errors";
import {
  federationSettingsSchema,
  peerOriginSchema,
  peerPinSchema,
  pingReplySchema,
  type FederationState,
} from "../../schemas/federationAdmin";

const router = Router();
type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle = (fn: Handler) => (req: AuthRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

async function currentIdentity(): Promise<Identity | null> {
  try {
    return await loadIdentity();
  } catch (error) {
    if (error instanceof PeerRefusal) return null;
    throw error;
  }
}

async function state(): Promise<FederationState> {
  const id = await ensureAdminSettingsRow();
  const row = await prisma.adminSettings.findUniqueOrThrow({
    where: { id },
    select: { federationEnabled: true, federationOrigin: true },
  });
  const local = await currentIdentity();
  const peers = await prisma.comparisonPeer.findMany({ orderBy: { origin: "asc" } });
  return {
    source: local?.source ?? null,
    enabled: envOverrideActive() || row.federationEnabled,
    origin: local?.origin ?? row.federationOrigin,
    publicKey: local?.publicKey ?? null,
    fingerprint: local?.fingerprint ?? null,
    peers: peers.map((p) => ({
      origin: p.origin,
      fingerprint: hash(p.publicKey),
      enabled: p.enabled,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      leaderboardVersions: p.leaderboardVersions,
    })),
  };
}

const envHoldsIdentity = () =>
  comparisonError(
    "COMPARISON_FEDERATION_ENV",
    409,
    "The server identity is set by FEDERATION_* environment variables"
  );

router.get(
  "/",
  handle(async (_req, res) => {
    res.json(await state());
  })
);

router.put(
  "/",
  handle(async (req, res) => {
    if (envOverrideActive()) throw envHoldsIdentity();
    const body = federationSettingsSchema.parse(req.body);
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: { federationEnabled: body.enabled, federationOrigin: body.origin },
    });
    resetIdentityCache();
    res.json(await state());
  })
);

router.post(
  "/key",
  handle(async (req, res) => {
    if (envOverrideActive()) throw envHoldsIdentity();
    const pem = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: { federationPrivateKey: encryptApiKey(pem) },
    });
    resetIdentityCache();
    // Peers pinned the old key: they refuse this server until their admins pin the new one.
    logger.info({ operation: "federation_key_generated", userId: req.userId }, "Federation key generated");
    res.json(await state());
  })
);

router.post(
  "/peers",
  handle(async (req, res) => {
    const body = peerPinSchema.parse(req.body);
    const own = await currentIdentity();
    if (own && body.origin === own.origin)
      throw comparisonError("COMPARISON_PEER_KEY_INVALID", 400, "A server cannot pin itself");
    let pem: string;
    try {
      const key = createPublicKey(body.publicKey);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
      pem = key.export({ type: "spki", format: "pem" }).toString();
    } catch {
      throw comparisonError("COMPARISON_PEER_KEY_INVALID", 400, "Not an Ed25519 public key", {
        origin: body.origin,
      });
    }
    if (hash(pem) !== body.fingerprint)
      throw comparisonError("COMPARISON_PEER_KEY_INVALID", 400, "Fingerprint does not match the key", {
        origin: body.origin,
      });
    const previous = await prisma.comparisonPeer.findUnique({ where: { origin: body.origin } });
    if (previous && previous.publicKey !== pem) {
      // A replaced key ends every E2E friendship through it, exactly as before the move.
      await prisma.comparisonLink.updateMany({ where: { origin: body.origin }, data: { revoked: true } });
    }
    await prisma.comparisonPeer.upsert({
      where: { origin: body.origin },
      create: { origin: body.origin, publicKey: pem, enabled: body.enabled },
      update: { publicKey: pem, enabled: body.enabled, verifiedAt: null, leaderboardVersions: [] },
    });
    res.json(await state());
  })
);

router.post(
  "/peers/verify",
  handle(async (req, res) => {
    const { origin } = peerOriginSchema.parse(req.body);
    let reply;
    try {
      reply = pingReplySchema.parse(await exchange(origin, { action: "ping" }));
    } catch (error) {
      throw comparisonError("COMPARISON_PEER_UNREACHABLE", 502, "The peer did not answer the ping", {
        origin,
        kind: error instanceof PeerRefusal ? error.kind : "error",
      });
    }
    await prisma.comparisonPeer.update({
      where: { origin },
      data: { verifiedAt: new Date(), leaderboardVersions: reply.leaderboard ?? [] },
    });
    res.json({ verified: true });
  })
);

router.post(
  "/peers/suspend",
  handle(async (req, res) => {
    const { origin } = peerOriginSchema.parse(req.body);
    await prisma.comparisonPeer.update({
      where: { origin },
      data: { enabled: false, verifiedAt: null },
    });
    res.json({ suspended: true });
  })
);

export default router;
```

`backend/src/routes/admin/index.ts`: `import federationAdminRouter from "./federation";` and `router.use("/federation", federationAdminRouter);` after the `/push` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/routes/admin/__tests__/federation.test.ts src/routes/__tests__/encryptedShare.mount.test.ts src/services/federation/__tests__/routes.test.ts src/__tests__/apiResponseShape.ratchet.test.ts src/__tests__/openapi.coverage.test.ts`
Expected: PASS. (Delete the `routes.test.ts` case "does not allow an ordinary account to admit peers" — the endpoint left that router; admin access is enforced by the admin parent router.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/schemas/federationAdmin.ts backend/src/routes/admin backend/src/routes/encryptedShare.ts backend/src/routes/__tests__/encryptedShare.mount.test.ts backend/src/services/federation/__tests__/routes.test.ts backend/src/__tests__/apiResponseShape.baseline.json
git commit -m "feat(admin): manage the server identity and trusted peers in the admin console

Key generation and peer pinning lived in a user page and env files. They are instance
administration and now sit under /admin/federation.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 5: Admin → Instanz "Server-Verbindungen" card; peers tab leaves the E2E workspace

**Files:**
- Create: `frontend/src/lib/api/federationAdmin.ts`, `frontend/src/components/Admin/FederationSettings.tsx`, `frontend/src/components/Admin/__tests__/FederationSettings.test.tsx`
- Modify: `frontend/src/lib/api/index.ts` (re-export), `frontend/src/pages/Admin/AdminSectionSwitch.tsx` (`case "instance"`, after `<ShareLinksSettings />`), `frontend/src/i18n/resources/de/admin.json`, `frontend/src/i18n/resources/en/admin.json`, `frontend/src/components/comparison/SealedWorkspace.tsx` (lines 26, 192, 236)
- Delete: `frontend/src/components/comparison/PeerManager.tsx`

**Interfaces:**
Produces:
```ts
export interface FederationState { source: "env" | "settings" | null; enabled: boolean; origin: string | null; publicKey: string | null; fingerprint: string | null; peers: FederationPeer[] }
export interface FederationPeer { origin: string; fingerprint: string; enabled: boolean; verifiedAt: string | null; leaderboardVersions: number[] }
export const federationAdminApi: {
  get(): Promise<FederationState>;
  update(body: { enabled: boolean; origin: string }): Promise<FederationState>;
  generateKey(): Promise<FederationState>;
  pinPeer(body: { origin: string; publicKey: string; fingerprint: string; enabled: boolean }): Promise<FederationState>;
  verifyPeer(origin: string): Promise<void>;
  suspendPeer(origin: string): Promise<void>;
};
export default function FederationSettings(): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

`frontend/src/components/Admin/__tests__/FederationSettings.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FederationSettings from "../FederationSettings";
import { federationAdminApi, type FederationState } from "../../../lib/api/federationAdmin";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/federationAdmin", async (original) => ({
  ...(await original<typeof import("../../../lib/api/federationAdmin")>()),
  federationAdminApi: {
    get: vi.fn(),
    update: vi.fn(),
    generateKey: vi.fn(),
    pinPeer: vi.fn(),
    verifyPeer: vi.fn(),
    suspendPeer: vi.fn(),
  },
}));

const base: FederationState = {
  source: null,
  enabled: true,
  origin: "https://me.example",
  publicKey: null,
  fingerprint: null,
  peers: [],
};

describe("FederationSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates the server key from the UI and shows the fingerprint to hand on", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(base);
    vi.mocked(federationAdminApi.generateKey).mockResolvedValue({
      ...base,
      source: "settings",
      publicKey: "-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----\n",
      fingerprint: "ab".repeat(32),
    });
    render(<FederationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "federation.generateKey" }));
    expect(await screen.findByText("ab".repeat(32))).toBeInTheDocument();
    expect(federationAdminApi.generateKey).toHaveBeenCalledTimes(1);
  });

  it("is read-only while the env override holds the identity", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue({
      ...base,
      source: "env",
      fingerprint: "cd".repeat(32),
    });
    render(<FederationSettings />);
    expect(await screen.findByText("federation.envNote")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "federation.generateKey" })).toBeNull();
  });

  it("pins a peer from origin, key and fingerprint", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue({ ...base, source: "settings", fingerprint: "ef".repeat(32) });
    vi.mocked(federationAdminApi.pinPeer).mockResolvedValue(base);
    render(<FederationSettings />);
    fireEvent.change(await screen.findByLabelText("federation.peerOrigin"), {
      target: { value: "https://friend.example" },
    });
    fireEvent.change(screen.getByLabelText("federation.peerKey"), { target: { value: "KEY" } });
    fireEvent.change(screen.getByLabelText("federation.peerFingerprint"), {
      target: { value: "12".repeat(32) },
    });
    fireEvent.click(screen.getByRole("button", { name: "federation.pin" }));
    await waitFor(() =>
      expect(federationAdminApi.pinPeer).toHaveBeenCalledWith({
        origin: "https://friend.example",
        publicKey: "KEY",
        fingerprint: "12".repeat(32),
        enabled: true,
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Admin/__tests__/FederationSettings.test.tsx`
Expected: FAIL — `Failed to resolve import "../FederationSettings"`.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/lib/api/federationAdmin.ts`:
```ts
import { api } from "./client";

export interface FederationPeer {
  origin: string;
  fingerprint: string;
  enabled: boolean;
  verifiedAt: string | null;
  /** Leaderboard snapshot versions the peer serves; empty = its server needs an update. */
  leaderboardVersions: number[];
}

export interface FederationState {
  source: "env" | "settings" | null;
  enabled: boolean;
  origin: string | null;
  publicKey: string | null;
  fingerprint: string | null;
  peers: FederationPeer[];
}

const BASE = "/admin/federation";

export const federationAdminApi = {
  get: async (): Promise<FederationState> => (await api.get<FederationState>(BASE)).data,
  update: async (body: { enabled: boolean; origin: string }): Promise<FederationState> =>
    (await api.put<FederationState>(BASE, body)).data,
  generateKey: async (): Promise<FederationState> =>
    (await api.post<FederationState>(`${BASE}/key`)).data,
  pinPeer: async (body: {
    origin: string;
    publicKey: string;
    fingerprint: string;
    enabled: boolean;
  }): Promise<FederationState> => (await api.post<FederationState>(`${BASE}/peers`, body)).data,
  verifyPeer: async (origin: string): Promise<void> => {
    await api.post(`${BASE}/peers/verify`, { origin });
  },
  suspendPeer: async (origin: string): Promise<void> => {
    await api.post(`${BASE}/peers/suspend`, { origin });
  },
};
```
`frontend/src/lib/api/index.ts`: add `export * from "./federationAdmin";`

`frontend/src/components/Admin/FederationSettings.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { federationAdminApi, type FederationState } from "../../lib/api/federationAdmin";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { Button, Field, Input, Switch, ListRow, SectionLabel } from "../ui";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";

const NS = "federation";

/** Admin → Instanz: this server's identity and the servers it trusts (comparison rework 2026-10-16). */
export default function FederationSettings(): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const fmt = useDisplayFormat();
  const [state, setState] = useState<FederationState | null>(null);
  const [origin, setOrigin] = useState("");
  const [peer, setPeer] = useState({ origin: "", publicKey: "", fingerprint: "" });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    federationAdminApi.get().then(
      (s) => {
        if (!alive) return;
        setState(s);
        setOrigin(s.origin ?? "");
      },
      (error: unknown) => {
        logger.debug("failed to load federation settings", error);
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const run = async (action: () => Promise<FederationState | void>): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      const next = await action();
      setState(next ?? (await federationAdminApi.get()));
    } catch (error) {
      logger.debug("federation settings action failed", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const readOnly = state?.source === "env";
  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
      {state && readOnly && <p className="t-caption">{t(`${NS}.envNote`)}</p>}
      {state && !readOnly && (
        <>
          <Switch
            id="federation-enabled"
            checked={state.enabled}
            disabled={busy || !origin}
            onChange={(on) => void run(() => federationAdminApi.update({ enabled: on, origin }))}
            label={t(`${NS}.enabled`)}
            sub={t(`${NS}.enabledSub`)}
          />
          <Field label={t(`${NS}.origin`)} htmlFor="federation-origin" hint={t(`${NS}.originHint`)}>
            <Input
              id="federation-origin"
              value={origin}
              placeholder="https://travstats.example.org"
              onChange={(e) => setOrigin(e.target.value)}
              onBlur={() =>
                origin && void run(() => federationAdminApi.update({ enabled: state.enabled, origin }))
              }
            />
          </Field>
          <Button variant="secondary" disabled={busy} onClick={() => void run(federationAdminApi.generateKey)}>
            {t(`${NS}.generateKey`)}
          </Button>
          {state.fingerprint && <p className="t-caption">{t(`${NS}.rotateWarning`)}</p>}
        </>
      )}
      {state?.fingerprint && (
        <div>
          <p className="t-caption">{t(`${NS}.fingerprint`)}</p>
          <code className="break-all">{state.fingerprint}</code>
          {state.publicKey && <pre className="t-caption whitespace-pre-wrap break-all">{state.publicKey}</pre>}
        </div>
      )}
      {state?.fingerprint && (
        <>
          <SectionLabel>{t(`${NS}.peers`)}</SectionLabel>
          {state.peers.map((p) => (
            <ListRow
              key={p.origin}
              dense
              title={p.origin}
              subtitle={
                p.verifiedAt
                  ? t(`${NS}.verifiedAt`, { date: fmt.date(p.verifiedAt) }) +
                    (p.leaderboardVersions.includes(1) ? "" : ` · ${t(`${NS}.outdated`)}`)
                  : t(`${NS}.unverified`)
              }
              trailing={
                <span className="flex" style={{ gap: "var(--ts-space-xs)" }}>
                  <Button variant="secondary" disabled={busy} onClick={() => void run(() => federationAdminApi.verifyPeer(p.origin))}>
                    {t(`${NS}.verify`)}
                  </Button>
                  <Button variant="danger" disabled={busy || !p.enabled} onClick={() => void run(() => federationAdminApi.suspendPeer(p.origin))}>
                    {t(`${NS}.suspend`)}
                  </Button>
                </span>
              }
            />
          ))}
          <Field label={t(`${NS}.peerOrigin`)} htmlFor="peer-origin">
            <Input id="peer-origin" value={peer.origin} onChange={(e) => setPeer({ ...peer, origin: e.target.value })} />
          </Field>
          <Field label={t(`${NS}.peerKey`)} htmlFor="peer-key">
            <Input id="peer-key" value={peer.publicKey} onChange={(e) => setPeer({ ...peer, publicKey: e.target.value })} />
          </Field>
          <Field label={t(`${NS}.peerFingerprint`)} htmlFor="peer-fingerprint" hint={t(`${NS}.peerFingerprintHint`)}>
            <Input id="peer-fingerprint" value={peer.fingerprint} onChange={(e) => setPeer({ ...peer, fingerprint: e.target.value.trim() })} />
          </Field>
          <Button
            disabled={busy || !peer.origin || !peer.publicKey || !peer.fingerprint}
            onClick={() => void run(() => federationAdminApi.pinPeer({ ...peer, enabled: true }))}
          >
            {t(`${NS}.pin`)}
          </Button>
        </>
      )}
      {failed && <p role="alert">{t(`${NS}.failed`)}</p>}
    </SectionCard>
  );
}
```
(`ListRow`'s `trailing` accepts a node; the `Input` primitive forwards `onBlur`.)

`frontend/src/pages/Admin/AdminSectionSwitch.tsx`: `import FederationSettings from "../../components/Admin/FederationSettings";` and in `case "instance"` directly after `<ShareLinksSettings />`: `<FederationSettings />`.

`frontend/src/i18n/resources/de/admin.json` — add top-level key:
```json
  "federation": {
    "title": "Server-Verbindungen",
    "description": "Verbinde diesen Server mit anderen TravStats-Servern, damit sich Leute über Servergrenzen hinweg vergleichen können. Es gehen nur Summen über die Leitung, signiert, aber nicht Ende-zu-Ende-verschlüsselt.",
    "envNote": "Über Umgebungsvariablen festgelegt (FEDERATION_*). Ändern geht nur dort.",
    "enabled": "Mit anderen Servern verbinden",
    "enabledSub": "Ohne diese Einstellung bleibt der Vergleich auf diesen Server beschränkt.",
    "origin": "Öffentliche Adresse dieses Servers",
    "originHint": "https, ohne Port und Pfad – so, wie andere Server ihn erreichen.",
    "generateKey": "Schlüssel erzeugen",
    "rotateWarning": "Ein neuer Schlüssel ersetzt den alten. Verbundene Server müssen ihn neu hinterlegen.",
    "fingerprint": "Fingerabdruck – gib ihn dem Admin des anderen Servers auf einem zweiten Weg (z. B. am Telefon):",
    "peers": "Vertraute Server",
    "verifiedAt": "geprüft am {{date}}",
    "unverified": "noch nicht geprüft",
    "outdated": "muss aktualisiert werden",
    "verify": "Prüfen",
    "suspend": "Sperren",
    "peerOrigin": "Adresse des anderen Servers",
    "peerKey": "Öffentlicher Schlüssel des anderen Servers",
    "peerFingerprint": "Fingerabdruck des anderen Servers",
    "peerFingerprintHint": "Vergleiche ihn mit dem, den dir der andere Admin genannt hat.",
    "pin": "Server hinterlegen",
    "failed": "Das hat nicht geklappt. Prüfe die Angaben und versuch es noch einmal."
  }
```
`frontend/src/i18n/resources/en/admin.json`:
```json
  "federation": {
    "title": "Server connections",
    "description": "Connect this server to other TravStats servers so people can compare across servers. Only totals travel, signed but not end-to-end encrypted.",
    "envNote": "Set by environment variables (FEDERATION_*). Change it there.",
    "enabled": "Connect to other servers",
    "enabledSub": "Without this, comparing stays on this server.",
    "origin": "Public address of this server",
    "originHint": "https, no port or path — the way other servers reach it.",
    "generateKey": "Generate key",
    "rotateWarning": "A new key replaces the old one. Connected servers have to pin it again.",
    "fingerprint": "Fingerprint — give it to the other server's admin through a second channel (e.g. a phone call):",
    "peers": "Trusted servers",
    "verifiedAt": "verified on {{date}}",
    "unverified": "not verified yet",
    "outdated": "needs an update",
    "verify": "Verify",
    "suspend": "Suspend",
    "peerOrigin": "Address of the other server",
    "peerKey": "Public key of the other server",
    "peerFingerprint": "Fingerprint of the other server",
    "peerFingerprintHint": "Compare it with the one the other admin told you.",
    "pin": "Pin server",
    "failed": "That did not work. Check the details and try again."
  }
```

`frontend/src/components/comparison/SealedWorkspace.tsx`: delete line 26 (`import PeerManager …`), remove `...(user.isAdmin ? ["peers"] : []),` from the tab list (line 192) and the line `{tab === "peers" && user.isAdmin && <PeerManager />}` (line 236). `git rm frontend/src/components/comparison/PeerManager.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/Admin/__tests__/FederationSettings.test.tsx src/i18n/__tests__/localeKeyParity.test.ts src/components/comparison`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/federationAdmin.ts frontend/src/lib/api/index.ts frontend/src/components/Admin/FederationSettings.tsx frontend/src/components/Admin/__tests__/FederationSettings.test.tsx frontend/src/pages/Admin/AdminSectionSwitch.tsx frontend/src/i18n/resources/de/admin.json frontend/src/i18n/resources/en/admin.json frontend/src/components/comparison
git commit -m "feat(admin): server connections card in Admin → Instanz

Admins generate the server key and pin peers in the console; the peers tab on the comparison
page, reachable only by admins through a user screen, is gone.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---
### Task 6: Metric catalogue (mirrored) and the leaderboard wire schemas

**Files:**
- Create: `backend/src/shared/comparisonMetrics.ts`, `frontend/src/shared/comparisonMetrics.ts` (byte-identical), `backend/src/schemas/comparison.ts`, `backend/src/schemas/__tests__/comparison.test.ts`, `frontend/src/shared/__tests__/comparisonMetrics.mirror.test.ts`

**Interfaces:**
Produces (`shared/comparisonMetrics.ts`, both sides):
```ts
export const METRIC_GROUPS: readonly ["distance", "trips", "time", "places"];
export type MetricGroup; export type MetricUnit = "km" | "count" | "minutes" | "days" | "nights";
export interface MetricDef { key: string; group: MetricGroup; domain: DomainKey | null; unit: MetricUnit }
export const LEADERBOARD_METRICS; export type MetricKey; export const METRIC_KEYS: readonly MetricKey[];
export function isMetricKey(value: string): value is MetricKey;
```
Produces (`schemas/comparison.ts`): `LEADERBOARD_SCHEMA`, `SERVED_VERSIONS`, `leaderboardScopeSchema`, `leaderboardSnapshotSchema`, `aggregateRequestSchema`, `aggregateReplySchema`, `lbClaimRequestSchema`, `lbClaimReplySchema`, `lbStateRequestSchema`, `personKeySchema`, `uuidParamSchema`, `leaderboardQuerySchema`, `consentRequestBodySchema`, `scopeBodySchema`, `claimBodySchema`, `boardBodySchema`, `personSchema`, `rowStatusSchema`, `consentStatusSchema`, `leaderboardRowSchema`, `leaderboardResponseSchema`, `personViewSchema`, `requestViewSchema`, `boardViewSchema`, `peopleResponseSchema`, `inviteResponseSchema`, and the inferred types `LeaderboardScope`, `LeaderboardSnapshot`, `AggregateRequest`, `AggregateReply`, `LbClaimRequest`, `LbClaimReply`, `LbStateRequest`, `Person`, `RowStatus`, `ConsentStatus`, `LeaderboardRow`, `LeaderboardResponse`, `PersonView`, `RequestView`, `BoardView`.

- [ ] **Step 1: Write the failing test**

`backend/src/schemas/__tests__/comparison.test.ts`:
```ts
import {
  aggregateReplySchema,
  leaderboardScopeSchema,
  leaderboardSnapshotSchema,
  personKeySchema,
} from "../comparison";

const snapshot = {
  schema: "travstats-leaderboard",
  version: 1,
  asOf: "2026-10-16T10:00:00.000Z",
  year: null,
  domains: ["flight"],
  metrics: { flightKm: 1200, flights: 3 },
  partial: [],
};

describe("leaderboard wire schemas", () => {
  it("accepts a metric this server does not know, so adding one needs no new version", () => {
    const parsed = leaderboardSnapshotSchema.parse({
      ...snapshot,
      metrics: { ...snapshot.metrics, hikeKm: 4 },
    });
    expect(parsed.metrics.hikeKm).toBe(4);
  });

  it("rejects prototype names and oversized metric records from a remote server", () => {
    for (const raw of ['{"__proto__":1}', '{"constructor":1}', '{"toString":1}', '{"a-b":1}']) {
      expect(
        leaderboardSnapshotSchema.safeParse({ ...snapshot, metrics: JSON.parse(raw) }).success
      ).toBe(false);
    }
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`m${"abcdefghij"[Math.floor(i / 10)]}${"abcdefghij"[i % 10]}`, 1])
    );
    expect(leaderboardSnapshotSchema.safeParse({ ...snapshot, metrics: many }).success).toBe(false);
    expect(
      leaderboardSnapshotSchema.safeParse({ ...snapshot, metrics: { flights: -1 } }).success
    ).toBe(false);
  });

  it("needs at least one group and one domain, without duplicates", () => {
    expect(leaderboardScopeSchema.safeParse({ groups: [], domains: ["flight"], year: null }).success).toBe(false);
    expect(leaderboardScopeSchema.safeParse({ groups: ["trips"], domains: [], year: null }).success).toBe(false);
    expect(
      leaderboardScopeSchema.safeParse({ groups: ["trips", "trips"], domains: ["flight"], year: null }).success
    ).toBe(false);
    expect(leaderboardScopeSchema.parse({ groups: ["trips"], domains: ["flight"], year: 2025 })).toEqual({
      groups: ["trips"],
      domains: ["flight"],
      year: 2025,
    });
  });

  it("addresses a person by kind and uuid only", () => {
    expect(personKeySchema.safeParse("local:0b9b3f9e-2c47-4f0e-9a0f-3c1d2b4a5e6f").success).toBe(true);
    expect(personKeySchema.safeParse("self").success).toBe(false);
    expect(personKeySchema.safeParse("remote:../../etc").success).toBe(false);
  });

  it("knows exactly the five aggregate answers", () => {
    expect(aggregateReplySchema.safeParse({ status: "leaked" }).success).toBe(false);
    expect(aggregateReplySchema.parse({ status: "yearNotShared", year: 2024 })).toEqual({
      status: "yearNotShared",
      year: 2024,
    });
  });
});
```

`frontend/src/shared/__tests__/comparisonMetrics.mirror.test.ts`:
```ts
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

describe("leaderboard metric catalogue", () => {
  it("is byte-identical on both sides", () => {
    const read = (file: string) => fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
    const front = read(path.join(__dirname, "..", "comparisonMetrics.ts"));
    const back = read(
      path.join(__dirname, "..", "..", "..", "..", "backend", "src", "shared", "comparisonMetrics.ts")
    );
    expect(front).toBe(back);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/schemas/__tests__/comparison.test.ts` and `cd frontend && npx vitest --run src/shared/__tests__/comparisonMetrics.mirror.test.ts`
Expected: FAIL — `Cannot find module '../comparison'`; vitest `ENOENT … comparisonMetrics.ts`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/shared/comparisonMetrics.ts` (copy the identical file to `frontend/src/shared/comparisonMetrics.ts`):
```ts
/**
 * The leaderboard's metric catalogue (comparison rework 2026-10-16): which totals a snapshot
 * may carry, how they group, which domain colours them, and their unit.
 *
 * MIRRORED byte-for-byte between backend/src/shared and frontend/src/shared; change both
 * together. frontend/src/shared/__tests__/comparisonMetrics.mirror.test.ts fails when they differ.
 *
 * Adding a metric is NOT a snapshot version change (spec §10): a receiver ignores keys its own
 * catalogue does not know. Changing what a key MEANS is.
 */
import type { DomainKey } from "./domains";

export const METRIC_GROUPS = ["distance", "trips", "time", "places"] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];
export type MetricUnit = "km" | "count" | "minutes" | "days" | "nights";

export interface MetricDef {
  key: string;
  group: MetricGroup;
  /** null: a cross-domain figure, derivable only when every visible domain is shared. */
  domain: DomainKey | null;
  unit: MetricUnit;
}

export const LEADERBOARD_METRICS = [
  { key: "flightKm", group: "distance", domain: "flight", unit: "km" },
  { key: "cruiseKm", group: "distance", domain: "cruise", unit: "km" },
  { key: "railKm", group: "distance", domain: "rail", unit: "km" },
  { key: "busKm", group: "distance", domain: "bus", unit: "km" },
  { key: "rentalKm", group: "distance", domain: "rental", unit: "km" },
  { key: "ferryKm", group: "distance", domain: "ferry", unit: "km" },
  { key: "tourKm", group: "distance", domain: "roadtrip", unit: "km" },
  { key: "flights", group: "trips", domain: "flight", unit: "count" },
  { key: "cruises", group: "trips", domain: "cruise", unit: "count" },
  { key: "stays", group: "trips", domain: "lodging", unit: "count" },
  { key: "railRides", group: "trips", domain: "rail", unit: "count" },
  { key: "busRides", group: "trips", domain: "bus", unit: "count" },
  { key: "rentals", group: "trips", domain: "rental", unit: "count" },
  { key: "ferryCrossings", group: "trips", domain: "ferry", unit: "count" },
  { key: "tours", group: "trips", domain: "roadtrip", unit: "count" },
  { key: "placeVisits", group: "trips", domain: "poi", unit: "count" },
  { key: "flightMinutes", group: "time", domain: "flight", unit: "minutes" },
  { key: "nights", group: "time", domain: "lodging", unit: "nights" },
  { key: "rentalDays", group: "time", domain: "rental", unit: "days" },
  { key: "daysAway", group: "time", domain: null, unit: "days" },
  { key: "countries", group: "places", domain: null, unit: "count" },
  { key: "cruisePorts", group: "places", domain: "cruise", unit: "count" },
  { key: "places", group: "places", domain: "poi", unit: "count" },
] as const satisfies readonly MetricDef[];

export type MetricKey = (typeof LEADERBOARD_METRICS)[number]["key"];
export const METRIC_KEYS: readonly MetricKey[] = LEADERBOARD_METRICS.map((m) => m.key);

export function isMetricKey(value: string): value is MetricKey {
  return (METRIC_KEYS as readonly string[]).includes(value);
}
```

`backend/src/schemas/comparison.ts`:
```ts
/**
 * The leaderboard's shapes (comparison rework 2026-10-16, spec §9): the consent scope, the
 * versioned totals snapshot that may cross a server boundary, the three leaderboard peer
 * messages and the cookie API. Totals only — nothing here can carry a record, a name of a
 * trip or place, a date or a cost.
 */
import { z } from "./zod";
import { AVAILABLE_DOMAINS, type DomainKey } from "../shared/domains";
import { METRIC_GROUPS } from "../shared/comparisonMetrics";

const unique = <T>(list: readonly T[]) => new Set(list).size === list.length;
const year = z.number().int().min(1900).max(2200);
const uuid = z.string().uuid();

export const LEADERBOARD_SCHEMA = "travstats-leaderboard" as const;
/** Snapshot versions this server reads and serves. */
export const SERVED_VERSIONS = [1] as const;

export const leaderboardScopeSchema = z.strictObject({
  groups: z.array(z.enum(METRIC_GROUPS)).min(1).max(METRIC_GROUPS.length).refine(unique, "No duplicates"),
  domains: z
    .array(z.enum(AVAILABLE_DOMAINS as [DomainKey, ...DomainKey[]]))
    .min(1)
    .max(AVAILABLE_DOMAINS.length)
    .refine(unique, "No duplicates"),
  /** null: every year and the lifetime view; a number: that year only. */
  year: year.nullable(),
});

const metricName = z.string().regex(/^[a-zA-Z]{1,40}$/);
const notPrototypeName = (record: Record<string, unknown>) =>
  !Object.keys(record).some((k) => Object.prototype.hasOwnProperty.call(Object.prototype, k));

export const leaderboardSnapshotSchema = z.strictObject({
  schema: z.literal(LEADERBOARD_SCHEMA),
  version: z.literal(1),
  asOf: z.string().datetime(),
  year: year.nullable(),
  domains: z.array(z.string().max(30)).max(20),
  /**
   * A record, not an object of known keys: a newer server may send a metric this one does not
   * know, and the receiver shows only the keys of its own catalogue. Absent = not shared;
   * null = shared but not derivable; never 0 for "unknown".
   */
  metrics: z
    .record(metricName, z.number().finite().nonnegative().nullable())
    .refine((m) => Object.keys(m).length <= 64, "At most 64 metrics")
    .refine(notPrototypeName, "Reserved metric name"),
  /** Metrics that are a lower bound (some rides carry no distance). */
  partial: z.array(metricName).max(64),
});

export const aggregateRequestSchema = z.strictObject({
  action: z.literal("aggregate"),
  channel: uuid,
  year: year.nullable(),
  accept: z.array(z.number().int().positive()).min(1).max(8),
});
export const lbClaimRequestSchema = z.strictObject({
  action: z.literal("lb-claim"),
  code: z.string().regex(/^[a-f0-9]{64}$/),
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(160),
});
export const lbStateRequestSchema = z.strictObject({
  action: z.literal("lb-state"),
  channel: uuid,
  status: z.literal("withdrawn"),
});

export const aggregateReplySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok"), snapshot: leaderboardSnapshotSchema }),
  z.strictObject({ status: z.literal("notShared") }),
  z.strictObject({ status: z.literal("withdrawn") }),
  z.strictObject({ status: z.literal("yearNotShared"), year }),
  z.strictObject({
    status: z.literal("unsupportedVersion"),
    supported: z.array(z.number().int().positive()).max(8),
  }),
]);
export const lbClaimReplySchema = z.union([
  z.strictObject({
    accepted: z.literal(true),
    channel: uuid,
    username: z.string().max(80),
    displayName: z.string().max(160),
  }),
  z.strictObject({ accepted: z.literal(false) }),
]);

export const personKeySchema = z
  .string()
  .regex(/^(local|remote):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const uuidParamSchema = uuid;
export const leaderboardQuerySchema = z.strictObject({
  year: z.union([z.literal("all"), z.coerce.number().int().min(1900).max(2200)]).default("all"),
  board: uuid.optional(),
});
export const consentRequestBodySchema = z.strictObject({
  username: z.string().trim().min(1).max(80),
  scope: leaderboardScopeSchema,
});
export const scopeBodySchema = z.strictObject({ scope: leaderboardScopeSchema });
export const claimBodySchema = z.strictObject({
  code: z.string().trim().min(1).max(400),
  scope: leaderboardScopeSchema,
});
export const boardBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  members: z.array(personKeySchema).max(70),
});

export const personSchema = z.strictObject({
  key: z.string(),
  kind: z.enum(["self", "local", "remote"]),
  username: z.string(),
  displayName: z.string(),
  /** The other server's origin; null on this server. */
  origin: z.string().nullable(),
});
export const rowStatusSchema = z.enum([
  "ok",
  "notShared",
  "yearNotShared",
  "withdrawn",
  "unreachable",
  "outdated",
  "federationOff",
]);
export const consentStatusSchema = z.enum(["pending", "accepted", "declined", "withdrawn"]);
export const leaderboardRowSchema = z.strictObject({
  person: personSchema,
  status: rowStatusSchema,
  snapshot: leaderboardSnapshotSchema.nullable(),
  /** The one year this person shares, when they share only one. */
  sharedYear: year.nullable(),
});
export const leaderboardResponseSchema = z.strictObject({
  year: year.nullable(),
  rows: z.array(leaderboardRowSchema),
});
export const personViewSchema = z.strictObject({
  person: personSchema,
  /** The caller's own consent to this person. */
  mine: z
    .strictObject({
      consentId: uuid,
      status: consentStatusSchema,
      scope: leaderboardScopeSchema.nullable(),
    })
    .nullable(),
  /** This person's consent to the caller; null for a remote person (their server holds it). */
  theirs: z.strictObject({ status: consentStatusSchema }).nullable(),
});
export const requestViewSchema = z.strictObject({
  consentId: uuid,
  person: personSchema,
  createdAt: z.string().datetime(),
});
export const boardViewSchema = z.strictObject({
  id: uuid,
  name: z.string(),
  members: z.array(personKeySchema),
});
export const peopleResponseSchema = z.strictObject({
  requests: z.array(requestViewSchema),
  people: z.array(personViewSchema),
  boards: z.array(boardViewSchema),
});
export const inviteResponseSchema = z.strictObject({
  code: z.string(),
  expiresAt: z.string().datetime(),
});

export type LeaderboardScope = z.infer<typeof leaderboardScopeSchema>;
export type LeaderboardSnapshot = z.infer<typeof leaderboardSnapshotSchema>;
export type AggregateRequest = z.infer<typeof aggregateRequestSchema>;
export type AggregateReply = z.infer<typeof aggregateReplySchema>;
export type LbClaimRequest = z.infer<typeof lbClaimRequestSchema>;
export type LbClaimReply = z.infer<typeof lbClaimReplySchema>;
export type LbStateRequest = z.infer<typeof lbStateRequestSchema>;
export type Person = z.infer<typeof personSchema>;
export type RowStatus = z.infer<typeof rowStatusSchema>;
export type ConsentStatus = z.infer<typeof consentStatusSchema>;
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
export type PersonView = z.infer<typeof personViewSchema>;
export type RequestView = z.infer<typeof requestViewSchema>;
export type BoardView = z.infer<typeof boardViewSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run the two commands from Step 2 plus `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/schemas/__tests__/openapiExtension.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/shared/comparisonMetrics.ts frontend/src/shared/comparisonMetrics.ts backend/src/schemas/comparison.ts backend/src/schemas/__tests__/comparison.test.ts frontend/src/shared/__tests__/comparisonMetrics.mirror.test.ts
git commit -m "feat(comparison): metric catalogue and versioned leaderboard snapshot schema

Totals only, versioned for mixed-version servers; a new metric needs no version bump because
receivers ignore keys they do not know. The catalogue is mirrored and the mirror is checked.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 7: Build a person's totals snapshot from the existing loaders (incl. ferry, tours, places)

**Files:**
- Create: `backend/src/services/comparison/domainAggregates.ts`, `backend/src/services/comparison/aggregates.ts`, `backend/src/services/comparison/__tests__/aggregates.test.ts`

**Interfaces:**
Consumes: `buildWhere`, `computeSummary` (`services/stats/summary`), `loadCruiseStatsData`, `loadLodgingStatsData`, `calculateCruiseStats` (`utils/cruiseStats`), `calculateLodgingStats` (`utils/lodgingStats`), `loadRailStats`, `loadBusStats`, `rentalStatsFor`, `countableFerryWhere`, `ferryYear` (`shared/ferryCounting`), `loadTourFacts` (`services/stats/insights`), `classifyPlace`, `classifyVisit`, `countCompletedVisits`, `visitCountsForYear` (`shared/placeCounting`), `loadPassport`, `loadDaysAway`, `loadVisibleDomains` (`services/domainVisibility`), `comparisonError`.
Produces:
```ts
export interface DomainFigures { values: Partial<Record<MetricKey, number | null>>; partial: MetricKey[] }
export const DOMAIN_AGGREGATES: Record<DomainKey, (userId: string, year: number | null) => Promise<DomainFigures>>;
export async function buildLeaderboardSnapshot(userId: string, scope: LeaderboardScope, year: number | null): Promise<LeaderboardSnapshot>;
```

- [ ] **Step 1: Write the failing test**

`backend/src/services/comparison/__tests__/aggregates.test.ts`:
```ts
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { loadVisibleDomains } from "../../domainVisibility";
import { buildLeaderboardSnapshot } from "../aggregates";
import type { LeaderboardScope } from "../../../schemas/comparison";

jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const ALL: LeaderboardScope = {
  groups: ["distance", "trips", "time", "places"],
  domains: ["ferry", "poi"],
  year: null,
};
let userId: string;
const ferry = (departure: string, distanceKm: number | null) => ({
  userId,
  depStationName: "Kiel",
  depLat: 54.32,
  depLon: 10.13,
  arrStationName: "Oslo",
  arrLat: 59.91,
  arrLon: 10.75,
  departureTime: new Date(departure),
  status: "completed",
  distanceKm,
});

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { username: `lb-agg-${randomUUID()}`, passwordHash: "test-only" } })
  ).id;
  await prisma.ferryJourney.createMany({
    data: [ferry("2025-06-01T12:00:00Z", 670), ferry("2025-07-01T12:00:00Z", null), ferry("2024-05-01T12:00:00Z", 100)],
  });
  await prisma.place.create({
    data: {
      userId,
      name: "Nidarosdom",
      lat: 63.43,
      lon: 10.4,
      visited: true,
      visits: { create: [{ userId, visitedAt: new Date("2025-06-03T10:00:00Z") }] },
    },
  });
});
beforeEach(() => {
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry", "poi"]);
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

it("counts ferry crossings and marks the km a lower bound when one has no distance", async () => {
  const s = await buildLeaderboardSnapshot(userId, ALL, 2025);
  expect(s).toMatchObject({ schema: "travstats-leaderboard", version: 1, year: 2025 });
  expect(s.metrics).toMatchObject({ ferryCrossings: 2, ferryKm: 670, placeVisits: 1, places: 1 });
  expect(s.partial).toEqual(["ferryKm"]);
});

it("leaves what the consent does not cover absent, never zero", async () => {
  const s = await buildLeaderboardSnapshot(userId, { groups: ["trips"], domains: ["ferry"], year: null }, null);
  expect(s.metrics).toEqual({ ferryCrossings: 3 });
  expect(Object.keys(s.metrics)).not.toContain("ferryKm");
  expect(Object.keys(s.metrics)).not.toContain("placeVisits");
});

it("abstains from cross-domain figures when the consent leaves a visible domain out", async () => {
  jest.mocked(loadVisibleDomains).mockResolvedValue(["flight", "ferry", "poi"]);
  const s = await buildLeaderboardSnapshot(userId, { ...ALL, domains: ["ferry", "poi"] }, 2025);
  expect(s.metrics.daysAway).toBeNull();
  expect(s.metrics.countries).toBeNull();
});

it("refuses a year the consent does not cover, including the lifetime view", async () => {
  const one = { ...ALL, year: 2024 };
  await expect(buildLeaderboardSnapshot(userId, one, 2025)).rejects.toMatchObject({
    code: "COMPARISON_YEAR_NOT_SHARED",
  });
  await expect(buildLeaderboardSnapshot(userId, one, null)).rejects.toMatchObject({
    code: "COMPARISON_YEAR_NOT_SHARED",
  });
  expect((await buildLeaderboardSnapshot(userId, one, 2024)).metrics.ferryCrossings).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/aggregates.test.ts`
Expected: FAIL — `Cannot find module '../aggregates'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/services/comparison/domainAggregates.ts`:
```ts
/**
 * One domain's leaderboard totals, read through the SAME loaders the statistics pages use —
 * a leaderboard that counted differently from /stats would rank people on numbers they cannot
 * find on their own statistics page. Only scalar totals leave; the loaders' records do not.
 * The E2E transfer keeps its own copy (services/federation/domainMetrics.ts); see spec §6.
 */
import { prisma } from "../../db";
import type { DomainKey } from "../../shared/domains";
import type { MetricKey } from "../../shared/comparisonMetrics";
import { countableFerryWhere, ferryYear } from "../../shared/ferryCounting";
import {
  classifyPlace,
  classifyVisit,
  countCompletedVisits,
  visitCountsForYear,
} from "../../shared/placeCounting";
import { now } from "../../shared/time/clock";
import { buildWhere, computeSummary } from "../stats/summary";
import { loadCruiseStatsData } from "../stats/cruiseStatsData";
import { loadLodgingStatsData } from "../stats/lodgingStatsData";
import { loadTourFacts } from "../stats/insights";
import { loadRailStats } from "../rail/railStats";
import { loadBusStats } from "../bus/busStats";
import { rentalStatsFor } from "../rental/rentalStats";
import { calculateCruiseStats } from "../../utils/cruiseStats";
import { calculateLodgingStats } from "../../utils/lodgingStats";

export interface DomainFigures {
  values: Partial<Record<MetricKey, number | null>>;
  /** Metrics that are a lower bound. */
  partial: MetricKey[];
}
type Loader = (userId: string, year: number | null) => Promise<DomainFigures>;

/** Σ of the known values: 0 for no rows, null when no row knows it, partial when some do not. */
function sumKnown(values: ReadonlyArray<number | null>): { total: number | null; partial: boolean } {
  if (values.length === 0) return { total: 0, partial: false };
  const known = values.filter((v): v is number => v !== null);
  return {
    total: known.length ? known.reduce((s, v) => s + v, 0) : null,
    partial: known.length > 0 && known.length < values.length,
  };
}

const flight: Loader = async (userId, year) => {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { baseCurrency: true },
  });
  const where = await buildWhere(userId, undefined, undefined, year ?? undefined);
  const { stats } = await computeSummary(where, settings?.baseCurrency ?? "EUR");
  return {
    values: {
      flights: stats.totalFlights ?? null,
      flightKm: stats.totalDistance ?? null,
      flightMinutes: stats.totalFlightTime ?? null,
    },
    partial: [],
  };
};

const cruise: Loader = async (userId, year) => {
  const loaded = await loadCruiseStatsData(userId, year ?? undefined);
  const stats = calculateCruiseStats(
    loaded.rows.map((r) => r.input),
    loaded.userBirthday
  );
  return {
    values: {
      cruises: stats.cruisesCount,
      cruiseKm: stats.totalDistanceKm,
      cruisePorts: stats.cruisePortsUnique,
    },
    partial: [],
  };
};

const lodging: Loader = async (userId, year) => {
  const loaded = await loadLodgingStatsData(userId, year ?? undefined);
  const stats = calculateLodgingStats(loaded.stays, loaded.baseCurrency, loaded.lodgingRecords);
  return { values: { stays: stats.staysCount, nights: stats.totalNights }, partial: [] };
};

const rail: Loader = async (userId, year) => {
  const s = await loadRailStats(userId, year);
  const unknown = s.journeys > 0 && s.distance.unmeasuredJourneys === s.journeys;
  return {
    values: { railRides: s.journeys, railKm: unknown ? null : s.distance.totalKm },
    partial: !unknown && s.distance.unmeasuredJourneys > 0 ? ["railKm"] : [],
  };
};

const bus: Loader = async (userId, year) => {
  const s = await loadBusStats(userId, year);
  const unknown = s.rides > 0 && s.distance.unmeasuredRides === s.rides;
  return {
    values: { busRides: s.rides, busKm: unknown ? null : s.distance.totalKm },
    partial: !unknown && s.distance.unmeasuredRides > 0 ? ["busKm"] : [],
  };
};

const rental: Loader = async (userId, year) => {
  const s = await rentalStatsFor(userId, year);
  return {
    values: { rentals: s.rentals, rentalDays: s.days, rentalKm: s.km.total },
    partial: s.km.total !== null && s.km.covered < s.km.of ? ["rentalKm"] : [],
  };
};

const ferry: Loader = async (userId, year) => {
  const rows = await prisma.ferryJourney.findMany({
    where: { userId, ...countableFerryWhere() },
    select: {
      departureTime: true,
      arrivalTime: true,
      depTimezone: true,
      arrTimezone: true,
      distanceKm: true,
    },
  });
  const counted = year === null ? rows : rows.filter((r) => ferryYear(r) === year);
  const km = sumKnown(counted.map((r) => r.distanceKm));
  return {
    values: { ferryCrossings: counted.length, ferryKm: km.total },
    partial: km.partial ? ["ferryKm"] : [],
  };
};

/** Day tours (`TripRoute` kind "tour") that happened, by `shared/tour/tourCounting`. */
const roadtrip: Loader = async (userId, year) => {
  const done = (await loadTourFacts(userId, now(), { withElevation: false })).filter(
    (f) => f.state === "completed" && (year === null || f.year === year)
  );
  const km = sumKnown(done.map((f) => f.km));
  return { values: { tours: done.length, tourKm: km.total }, partial: km.partial ? ["tourKm"] : [] };
};

const poi: Loader = async (userId, year) => {
  const places = await prisma.place.findMany({
    where: { userId },
    select: {
      visited: true,
      visits: { select: { visitedAt: true, visitedAtUtc: true, visitedZone: true } },
    },
  });
  const at = now();
  if (year === null) {
    const visited = places.filter(
      (p) =>
        classifyPlace({
          visited: p.visited,
          plannedVisitCount: p.visits.filter((v) => classifyVisit(v, at) === "planned").length,
        }) === "visited"
    );
    return {
      values: {
        places: visited.length,
        placeVisits: places.reduce((n, p) => n + countCompletedVisits(p.visits, at), 0),
      },
      partial: [],
    };
  }
  const perPlace = places.map((p) => p.visits.filter((v) => visitCountsForYear(v, year, at)).length);
  return {
    values: {
      placeVisits: perPlace.reduce((s, n) => s + n, 0),
      places: perPlace.filter((n) => n > 0).length,
    },
    partial: [],
  };
};

export const DOMAIN_AGGREGATES: Record<DomainKey, Loader> = {
  flight,
  cruise,
  lodging,
  poi,
  roadtrip,
  rail,
  rental,
  bus,
  ferry,
};
```

`backend/src/services/comparison/aggregates.ts`:
```ts
import { LEADERBOARD_METRICS, type MetricKey } from "../../shared/comparisonMetrics";
import {
  LEADERBOARD_SCHEMA,
  leaderboardSnapshotSchema,
  type LeaderboardScope,
  type LeaderboardSnapshot,
} from "../../schemas/comparison";
import { loadVisibleDomains } from "../domainVisibility";
import { loadPassport } from "../stats/passportLoader";
import { loadDaysAway } from "../stats/daysAwayLoader";
import { DOMAIN_AGGREGATES } from "./domainAggregates";
import { comparisonError } from "./errors";

/**
 * One person's totals under one consent scope (spec §8).
 *
 * A metric whose group or domain the consent leaves out is ABSENT; one in scope that cannot be
 * derived is null. Cross-domain figures (days away, countries) are only derivable when the
 * consent covers every domain the owner has visible: their loaders have no domain mask, and a
 * whole-account figure would leak the domains the owner kept back — the rule snapshots.ts
 * already applied. `countries` has no per-year loader and is null for a year.
 */
export async function buildLeaderboardSnapshot(
  userId: string,
  scope: LeaderboardScope,
  year: number | null
): Promise<LeaderboardSnapshot> {
  if (scope.year !== null && scope.year !== year)
    throw comparisonError("COMPARISON_YEAR_NOT_SHARED", 403, "Shared for another year only", {
      userId,
      year,
      sharedYear: scope.year,
    });
  const visible = await loadVisibleDomains(userId);
  const domains = visible.filter((d) => scope.domains.includes(d));
  const wholeAccount = domains.length === visible.length;
  const allowed = LEADERBOARD_METRICS.filter(
    (m) => scope.groups.includes(m.group) && (m.domain === null || domains.includes(m.domain))
  );
  const allowedKeys = new Set<string>(allowed.map((m) => m.key));
  const values: Partial<Record<MetricKey, number | null>> = {};
  const partial: MetricKey[] = [];
  for (const domain of domains) {
    if (!allowed.some((m) => m.domain === domain)) continue;
    const figures = await DOMAIN_AGGREGATES[domain](userId, year);
    for (const [key, value] of Object.entries(figures.values) as Array<[MetricKey, number | null]>)
      if (allowedKeys.has(key)) values[key] = value;
    partial.push(...figures.partial.filter((k) => allowedKeys.has(k)));
  }
  if (allowedKeys.has("daysAway"))
    values.daysAway = wholeAccount
      ? (await loadDaysAway(userId, { year: year ?? undefined })).total
      : null;
  if (allowedKeys.has("countries"))
    values.countries =
      wholeAccount && year === null ? (await loadPassport(userId)).summary.countries : null;
  return leaderboardSnapshotSchema.parse({
    schema: LEADERBOARD_SCHEMA,
    version: 1,
    asOf: new Date().toISOString(),
    year,
    domains,
    metrics: values,
    partial,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/comparison/domainAggregates.ts backend/src/services/comparison/aggregates.ts backend/src/services/comparison/__tests__/aggregates.test.ts
git commit -m "feat(comparison): build totals snapshots from the stats loaders, with ferry, tours and places

The leaderboard ranks people on the numbers their own statistics pages show. Absent means
not shared, null means not derivable, a partial distance is marked as a lower bound.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 8: Leaderboard tables, CHECK constraints and the copy of existing local grants

**Files:**
- Modify: `backend/prisma/schema.prisma` (5 models after `ComparisonChunk`; `User` relations), `backend/src/services/export/allDataExport.ts` (`EXPORT_EXCLUDED_USER_RELATIONS`)
- Create: migration `*_leaderboard_tables`, `backend/src/services/comparison/__tests__/leaderboardMigration.test.ts`

**Interfaces:** Produces Prisma models `LeaderboardConsent`, `LeaderboardRemote`, `LeaderboardInvite`, `LeaderboardBoard`, `LeaderboardBoardMember` exactly as in spec §7.1 (compound uniques `ownerId_viewerId`, `ownerId_remoteId`, `origin_channel`, `boardId_consentId`, `boardId_remoteId`); `User.leaderboardConsentsOwned`, `leaderboardConsentsViewed`, `leaderboardRemotes`, `leaderboardInvites`, `leaderboardBoards`.

- [ ] **Step 1: Write the failing test**

`backend/src/services/comparison/__tests__/leaderboardMigration.test.ts`:
```ts
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import type { Prisma } from "../../../prisma";

const MIGRATIONS = path.join(__dirname, "..", "..", "..", "..", "prisma", "migrations");
const dir = fs.readdirSync(MIGRATIONS).find((d) => d.endsWith("_leaderboard_tables"));
const sql = dir ? fs.readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8") : "";
const copy = sql.slice(
  sql.indexOf("-- BEGIN LEADERBOARD DATA COPY"),
  sql.indexOf("-- END LEADERBOARD DATA COPY")
);
const users: string[] = [];

const oldScope = (statistics: boolean) =>
  ({
    statistics,
    details: false,
    costs: true,
    personal: false,
    photos: false,
    documents: false,
    domains: ["flight", "rail"],
    tripIds: [],
    futureTrips: true,
    year: null,
    precision: "exact",
    expiresAt: null,
    acceptedAt: new Date().toISOString(),
    allExisting: false,
  }) as unknown as Prisma.InputJsonValue;

async function user(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `lb-mig-${randomUUID()}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
async function friends(a: string, b: string, statistics: boolean, revoked = false) {
  const channel = randomUUID();
  const common = { channel, origin: "local", confirmed: true, remoteConfirmed: true, revoked };
  const fromA = await prisma.comparisonLink.create({ data: { ...common, userId: a, label: "b" } });
  await prisma.comparisonLink.create({ data: { ...common, userId: b, label: "a" } });
  await prisma.comparisonGrant.create({
    data: { linkId: fromA.id, audience: "", scope: oldScope(statistics) },
  });
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("ships the data copy between its markers", () => {
  expect(dir).toBeDefined();
  expect(copy).toContain('INSERT INTO "leaderboard_consents"');
});

it("carries an active statistics grant over as an accepted consent, exactly once", async () => {
  const [a, b, c, d] = [await user(), await user(), await user(), await user()];
  await friends(a, b, true);
  await friends(a, c, false);
  await friends(a, d, true, true);
  await prisma.$executeRawUnsafe(copy);
  await prisma.$executeRawUnsafe(copy);
  const rows = await prisma.leaderboardConsent.findMany({ where: { ownerId: a } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ viewerId: b, remoteId: null, status: "accepted" });
  expect(rows[0].scope).toEqual({
    groups: ["distance", "trips", "time", "places"],
    domains: ["flight", "rail"],
    year: null,
  });
});

it("holds exactly one viewer kind and a known status per consent", async () => {
  const a = await user();
  await expect(
    prisma.$executeRawUnsafe(
      `INSERT INTO "leaderboard_consents" ("id","owner_id","status") VALUES ('${randomUUID()}','${a}','pending')`
    )
  ).rejects.toThrow();
  await expect(
    prisma.$executeRawUnsafe(
      `INSERT INTO "leaderboard_consents" ("id","owner_id","viewer_id","status") VALUES ('${randomUUID()}','${a}','${a}','maybe')`
    )
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/leaderboardMigration.test.ts`
Expected: FAIL — `expect(received).toBeDefined()` (no `_leaderboard_tables` migration) and a TypeScript error on `prisma.leaderboardConsent`.

- [ ] **Step 3: Write minimal implementation**

`backend/prisma/schema.prisma` — append after `model ComparisonChunk { … }` the five models from spec §7.1 verbatim (`LeaderboardConsent`, `LeaderboardRemote`, `LeaderboardInvite`, `LeaderboardBoard`, `LeaderboardBoardMember`). In `model User`, below `comparisonCircles ComparisonCircle[]`:
```prisma
  leaderboardConsentsOwned  LeaderboardConsent[] @relation("LeaderboardConsentOwner")
  leaderboardConsentsViewed LeaderboardConsent[] @relation("LeaderboardConsentViewer")
  leaderboardRemotes        LeaderboardRemote[]
  leaderboardInvites        LeaderboardInvite[]
  leaderboardBoards         LeaderboardBoard[]
```
```bash
cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" npx prisma migrate dev --create-only --name leaderboard_tables
```
Append to the generated `migration.sql`:
```sql
-- Prisma cannot express these; check:drift does not compare CHECK constraints.
ALTER TABLE "leaderboard_consents"
  ADD CONSTRAINT "leaderboard_consents_one_viewer" CHECK (("viewer_id" IS NULL) <> ("remote_id" IS NULL));
ALTER TABLE "leaderboard_consents"
  ADD CONSTRAINT "leaderboard_consents_status" CHECK ("status" IN ('pending', 'accepted', 'declined', 'withdrawn'));
ALTER TABLE "leaderboard_board_members"
  ADD CONSTRAINT "leaderboard_board_members_one_member" CHECK (("consent_id" IS NULL) <> ("remote_id" IS NULL));

-- Existing beta data (spec §7.3). A LOCAL friendship whose granter shared statistics directly
-- (audience '') becomes "granter's totals may be seen by the friend". Costs, trips, precision
-- and expiry have no counterpart in the new scope and are not carried. Remote friendships,
-- group grants and grants without statistics are NOT copied: their users ask again. The E2E
-- tables themselves stay untouched.
-- BEGIN LEADERBOARD DATA COPY
DO $$
DECLARE copied integer;
BEGIN
  INSERT INTO "leaderboard_consents" ("id", "owner_id", "viewer_id", "status", "scope", "created_at", "decided_at")
  SELECT gen_random_uuid()::text, l."user_id", c."user_id", 'accepted',
         jsonb_build_object(
           'groups', '["distance","trips","time","places"]'::jsonb,
           'domains', g."scope"->'domains',
           'year', g."scope"->'year'),
         NOW(), NOW()
  FROM "comparison_links" l
  JOIN "comparison_links" c
    ON c."channel" = l."channel" AND c."id" <> l."id" AND c."origin" = 'local' AND NOT c."revoked"
  JOIN "comparison_grants" g ON g."link_id" = l."id" AND g."audience" = ''
  JOIN "users" ou ON ou."id" = l."user_id" AND ou."is_active"
  WHERE l."origin" = 'local'
    AND l."confirmed" AND l."remote_confirmed" AND NOT l."revoked"
    AND l."user_id" <> c."user_id"
    AND g."active" AND (g."expires_at" IS NULL OR g."expires_at" > NOW())
    AND (g."scope"->>'statistics')::boolean IS TRUE
  ON CONFLICT ("owner_id", "viewer_id") DO NOTHING;
  GET DIAGNOSTICS copied = ROW_COUNT;
  RAISE NOTICE 'leaderboard: % consents copied from comparison grants', copied;
END $$;
-- END LEADERBOARD DATA COPY
```
Apply: `npx prisma migrate deploy && npx prisma generate`, then `npm run check:drift`.

`backend/src/services/export/allDataExport.ts` — add to `EXPORT_EXCLUDED_USER_RELATIONS`:
```ts
  leaderboardConsentsOwned: "leaderboard permissions, re-given after restore",
  leaderboardConsentsViewed: "other accounts' leaderboard permissions naming this user",
  leaderboardRemotes: "friendships with accounts on other servers, bound to server keys",
  leaderboardInvites: "single-use credentials",
  leaderboardBoards: "private leaderboard groups of consented people",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/leaderboardMigration.test.ts src/routes/admin/__tests__/exportAllData.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma backend/src/services/export/allDataExport.ts backend/src/services/comparison/__tests__/leaderboardMigration.test.ts
git commit -m "feat(comparison): leaderboard consent, remote friend, invite and board tables

Local friends who already shared statistics keep seeing each other: their direct grants are
copied into accepted consents. Remote friendships and group grants are not carried and are
asked again (spec §7.3).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 9: Consents — ask by username, answer in one dialog, end both ways

**Files:**
- Create: `backend/src/services/comparison/consents.ts`, `backend/src/services/comparison/__tests__/consents.test.ts`

**Interfaces:**
Consumes: `PERSON_SELECT`, `toPerson` (`services/sharing/people`), `leaderboardScopeSchema` + types (Task 6), `comparisonError` (Task 2).
Produces:
```ts
export const localKey: (userId: string) => string;            // "local:<id>"
export const remoteKey: (remoteId: string) => string;         // "remote:<id>"
export const scopeJson: (scope: LeaderboardScope) => Prisma.InputJsonValue;
export function localPerson(user: { id: string; username: string; firstName: string | null; lastName: string | null }): Person;
export function remotePerson(remote: { id: string; username: string; displayName: string; origin: string }): Person;
export async function requestComparison(requesterId: string, username: string, scope: LeaderboardScope): Promise<PersonView>;
export async function acceptConsent(ownerId: string, consentId: string, scope: LeaderboardScope): Promise<PersonView>;
export async function declineConsent(ownerId: string, consentId: string): Promise<{ declined: true }>;
export async function updateScope(ownerId: string, consentId: string, scope: LeaderboardScope): Promise<PersonView>;
export async function endLocal(userId: string, otherUserId: string): Promise<void>;
export async function listPeople(userId: string): Promise<{ requests: RequestView[]; people: PersonView[] }>;
export async function personView(userId: string, key: string): Promise<PersonView>;
```

- [ ] **Step 1: Write the failing test**

`backend/src/services/comparison/__tests__/consents.test.ts`:
```ts
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import type { LeaderboardScope } from "../../../schemas/comparison";
import {
  acceptConsent,
  declineConsent,
  endLocal,
  listPeople,
  requestComparison,
} from "../consents";

const SCOPE: LeaderboardScope = { groups: ["distance", "trips"], domains: ["flight"], year: null };
const users: Array<{ id: string; username: string }> = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `lb-c-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u);
  return u;
}
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.$disconnect();
});

it("shares the asker's numbers at once and asks the other side", async () => {
  const [a, b] = [await user(), await user()];
  const view = await requestComparison(a.id, b.username.toUpperCase(), SCOPE);
  expect(view).toMatchObject({
    person: { key: `local:${b.id}`, kind: "local", origin: null },
    mine: { status: "accepted", scope: SCOPE },
    theirs: { status: "pending" },
  });
  const forB = await listPeople(b.id);
  expect(forB.requests).toEqual([
    expect.objectContaining({ person: expect.objectContaining({ key: `local:${a.id}` }) }),
  ]);
});

it("refuses self, unknown names and a second request with named codes", async () => {
  const [a, b] = [await user(), await user()];
  await expect(requestComparison(a.id, a.username, SCOPE)).rejects.toMatchObject({ code: "COMPARISON_SELF" });
  await expect(requestComparison(a.id, "nobody-by-that-name", SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_USER_NOT_FOUND",
  });
  await requestComparison(a.id, b.username, SCOPE);
  await expect(requestComparison(a.id, b.username, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_DUPLICATE",
  });
});

it("lets the asked side accept with its own scope, or decline and be asked again", async () => {
  const [a, b] = [await user(), await user()];
  await requestComparison(a.id, b.username, SCOPE);
  const request = (await listPeople(b.id)).requests[0];
  await declineConsent(b.id, request.consentId);
  await expect(declineConsent(b.id, request.consentId)).rejects.toMatchObject({
    code: "COMPARISON_NOT_PENDING",
  });
  await expect(acceptConsent(a.id, request.consentId, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_NOT_FOUND",
  });
  await prisma.leaderboardConsent.updateMany({
    where: { ownerId: a.id, viewerId: b.id },
    data: { status: "withdrawn" },
  });
  await requestComparison(a.id, b.username, SCOPE);
  const again = (await listPeople(b.id)).requests[0];
  const accepted = await acceptConsent(b.id, again.consentId, { ...SCOPE, year: 2025 });
  expect(accepted.mine).toMatchObject({ status: "accepted", scope: { year: 2025 } });
  expect((await listPeople(a.id)).people[0].theirs).toEqual({ status: "accepted" });
});

it("ends the comparison in both directions with one action", async () => {
  const [a, b] = [await user(), await user()];
  await requestComparison(a.id, b.username, SCOPE);
  await endLocal(b.id, a.id);
  const rows = await prisma.leaderboardConsent.findMany({
    where: { OR: [{ ownerId: a.id, viewerId: b.id }, { ownerId: b.id, viewerId: a.id }] },
  });
  expect(rows.map((r) => r.status)).toEqual(["withdrawn", "withdrawn"]);
  expect((await listPeople(a.id)).people).toEqual([]);
  await expect(endLocal(b.id, a.id)).rejects.toMatchObject({ code: "COMPARISON_NOT_FOUND" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/consents.test.ts`
Expected: FAIL — `Cannot find module '../consents'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/services/comparison/consents.ts`:
```ts
/**
 * "X may see my numbers" (spec §5, §9.1). Uses the sharing people model (`SharePerson`,
 * `PERSON_SELECT`, `toPerson`) and its state machine (pending → accepted | declined;
 * withdrawn ends; a declined pair may be asked again), but NOT the `ShareConsent` row: that row
 * means "may push trips into my account" and its withdrawal detaches trip copies. A comparison
 * must authorise neither.
 *
 * One row is one direction: the owner's totals, one viewer. Asking is consenting — the asker's
 * own dialog has already said "B sieht diese Zahlen" — so a request writes the asker's row as
 * accepted and the other side's as pending.
 */
import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import {
  leaderboardScopeSchema,
  type ConsentStatus,
  type LeaderboardScope,
  type Person,
  type PersonView,
  type RequestView,
} from "../../schemas/comparison";
import { comparisonError } from "./errors";

export const localKey = (userId: string): string => `local:${userId}`;
export const remoteKey = (remoteId: string): string => `remote:${remoteId}`;
export const scopeJson = (scope: LeaderboardScope): Prisma.InputJsonValue =>
  scope as unknown as Prisma.InputJsonValue;

export function localPerson(user: Parameters<typeof toPerson>[0]): Person {
  const p = toPerson(user);
  return { key: localKey(p.id), kind: "local", username: p.username, displayName: p.displayName, origin: null };
}

export function remotePerson(remote: {
  id: string;
  username: string;
  displayName: string;
  origin: string;
}): Person {
  return {
    key: remoteKey(remote.id),
    kind: "remote",
    username: remote.username,
    displayName: remote.displayName,
    origin: remote.origin,
  };
}

const notFound = (userId: string, consentId?: string) =>
  comparisonError("COMPARISON_NOT_FOUND", 404, "No such comparison", { userId, consentId });

export async function requestComparison(
  requesterId: string,
  username: string,
  scope: LeaderboardScope
): Promise<PersonView> {
  const parsed = leaderboardScopeSchema.parse(scope);
  const target = await prisma.user.findFirst({
    where: { username: { equals: username.trim(), mode: "insensitive" }, isActive: true },
    select: PERSON_SELECT,
  });
  if (!target)
    throw comparisonError("COMPARISON_USER_NOT_FOUND", 404, "No such user on this server", {
      userId: requesterId,
    });
  if (target.id === requesterId)
    throw comparisonError("COMPARISON_SELF", 400, "Cannot compare with yourself", { userId: requesterId });
  await prisma.$transaction(async (tx) => {
    const mineKey = { ownerId_viewerId: { ownerId: requesterId, viewerId: target.id } };
    const mine = await tx.leaderboardConsent.findUnique({ where: mineKey });
    if (mine?.status === "accepted")
      throw comparisonError("COMPARISON_DUPLICATE", 409, "Already sharing with this person", {
        userId: requesterId,
      });
    const decidedAt = new Date();
    await tx.leaderboardConsent.upsert({
      where: mineKey,
      create: { ownerId: requesterId, viewerId: target.id, status: "accepted", scope: scopeJson(parsed), decidedAt },
      update: { status: "accepted", scope: scopeJson(parsed), decidedAt },
    });
    const theirsKey = { ownerId_viewerId: { ownerId: target.id, viewerId: requesterId } };
    const theirs = await tx.leaderboardConsent.findUnique({ where: theirsKey });
    if (!theirs)
      await tx.leaderboardConsent.create({ data: { ownerId: target.id, viewerId: requesterId } });
    else if (theirs.status === "declined" || theirs.status === "withdrawn")
      // The answer belongs to the asked side; a new question deserves a new answer.
      await tx.leaderboardConsent.update({
        where: { id: theirs.id },
        data: { status: "pending", createdAt: new Date(), decidedAt: null },
      });
  });
  return personView(requesterId, localKey(target.id));
}

async function ownedConsent(ownerId: string, consentId: string) {
  const row = await prisma.leaderboardConsent.findFirst({ where: { id: consentId, ownerId } });
  if (!row) throw notFound(ownerId, consentId);
  return row;
}
const keyOf = (row: { viewerId: string | null; remoteId: string | null }) =>
  row.viewerId ? localKey(row.viewerId) : remoteKey(row.remoteId as string);

export async function acceptConsent(
  ownerId: string,
  consentId: string,
  scope: LeaderboardScope
): Promise<PersonView> {
  const row = await ownedConsent(ownerId, consentId);
  if (row.status !== "pending")
    throw comparisonError("COMPARISON_NOT_PENDING", 409, "Not waiting for an answer", { userId: ownerId, consentId });
  await prisma.leaderboardConsent.update({
    where: { id: row.id },
    data: { status: "accepted", scope: scopeJson(leaderboardScopeSchema.parse(scope)), decidedAt: new Date() },
  });
  return personView(ownerId, keyOf(row));
}

export async function declineConsent(ownerId: string, consentId: string): Promise<{ declined: true }> {
  const row = await ownedConsent(ownerId, consentId);
  if (row.status !== "pending")
    throw comparisonError("COMPARISON_NOT_PENDING", 409, "Not waiting for an answer", { userId: ownerId, consentId });
  await prisma.leaderboardConsent.update({
    where: { id: row.id },
    data: { status: "declined", decidedAt: new Date() },
  });
  return { declined: true };
}

export async function updateScope(
  ownerId: string,
  consentId: string,
  scope: LeaderboardScope
): Promise<PersonView> {
  const row = await ownedConsent(ownerId, consentId);
  if (row.status !== "accepted") throw notFound(ownerId, consentId);
  await prisma.leaderboardConsent.update({
    where: { id: row.id },
    data: { scope: scopeJson(leaderboardScopeSchema.parse(scope)), decidedAt: new Date() },
  });
  return personView(ownerId, keyOf(row));
}

/** Either side ends a local comparison; both directions stop in one step. */
export async function endLocal(userId: string, otherUserId: string): Promise<void> {
  const ended = await prisma.leaderboardConsent.updateMany({
    where: {
      status: { not: "withdrawn" },
      OR: [
        { ownerId: userId, viewerId: otherUserId },
        { ownerId: otherUserId, viewerId: userId },
      ],
    },
    data: { status: "withdrawn", decidedAt: new Date() },
  });
  if (ended.count === 0) throw notFound(userId);
}

export async function listPeople(
  userId: string
): Promise<{ requests: RequestView[]; people: PersonView[] }> {
  const [owned, viewed, remotes] = await Promise.all([
    prisma.leaderboardConsent.findMany({
      where: { ownerId: userId },
      include: { viewer: { select: PERSON_SELECT }, remote: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.leaderboardConsent.findMany({
      where: { viewerId: userId, owner: { isActive: true } },
      include: { owner: { select: PERSON_SELECT } },
      take: 200,
    }),
    prisma.leaderboardRemote.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  const personOf = (c: (typeof owned)[number]) =>
    c.viewer ? localPerson(c.viewer) : remotePerson(c.remote as NonNullable<typeof c.remote>);
  const requests = owned
    .filter((c) => c.status === "pending")
    .map((c) => ({ consentId: c.id, person: personOf(c), createdAt: c.createdAt.toISOString() }));
  const people = new Map<string, PersonView>();
  const entry = (person: Person): PersonView => people.get(person.key) ?? { person, mine: null, theirs: null };
  for (const c of owned) {
    if (c.status === "pending") continue; // listed as a request, not yet as a person
    const person = personOf(c);
    people.set(person.key, {
      ...entry(person),
      mine: {
        consentId: c.id,
        status: c.status as ConsentStatus,
        scope: c.scope ? leaderboardScopeSchema.parse(c.scope) : null,
      },
    });
  }
  for (const c of viewed) {
    const person = localPerson(c.owner);
    people.set(person.key, { ...entry(person), theirs: { status: c.status as ConsentStatus } });
  }
  for (const r of remotes) {
    const person = remotePerson(r);
    if (!people.has(person.key)) people.set(person.key, entry(person));
  }
  const live = [...people.values()].filter(
    (p) =>
      p.person.kind === "remote" ||
      p.mine?.status === "accepted" ||
      p.theirs?.status === "accepted" ||
      p.theirs?.status === "pending"
  );
  return { requests, people: live };
}

export async function personView(userId: string, key: string): Promise<PersonView> {
  const found = (await listPeople(userId)).people.find((p) => p.person.key === key);
  if (!found) throw notFound(userId);
  return found;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/comparison/consents.ts backend/src/services/comparison/__tests__/consents.test.ts
git commit -m "feat(comparison): consent per person — ask by username, answer once, end both ways

Same-instance comparison needs no keys any more: the server reads a friend's totals under
the consent that friend gave. A separate table from trip-sharing consent, because accepting
a comparison must never authorise trip pushes.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 10: Boards — named sets of people the owner can see

**Files:**
- Create: `backend/src/services/comparison/boards.ts`, `backend/src/services/comparison/__tests__/boards.test.ts`

**Interfaces:**
Consumes: `localKey`, `remoteKey` (Task 9), `comparisonError`.
Produces:
```ts
export async function listBoards(userId: string): Promise<BoardView[]>;
export async function saveBoard(userId: string, input: { name: string; members: string[] }, boardId?: string): Promise<BoardView>;
export async function deleteBoard(userId: string, boardId: string): Promise<{ deleted: true }>;
export async function boardMemberKeys(userId: string, boardId: string): Promise<Set<string>>;
```

- [ ] **Step 1: Write the failing test**

`backend/src/services/comparison/__tests__/boards.test.ts`:
```ts
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { boardMemberKeys, deleteBoard, listBoards, saveBoard } from "../boards";

const users: string[] = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `lb-b-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("groups people whose numbers the owner can see", async () => {
  const [a, b] = [await user(), await user()];
  await prisma.leaderboardConsent.create({
    data: { ownerId: b, viewerId: a, status: "accepted", scope: { groups: ["trips"], domains: ["flight"], year: null } },
  });
  const board = await saveBoard(a, { name: "Familie", members: [`local:${b}`] });
  expect(board).toMatchObject({ name: "Familie", members: [`local:${b}`] });
  expect(await boardMemberKeys(a, board.id)).toEqual(new Set([`local:${b}`]));
  const renamed = await saveBoard(a, { name: "Family", members: [] }, board.id);
  expect(renamed).toMatchObject({ id: board.id, name: "Family", members: [] });
  expect(await listBoards(a)).toHaveLength(1);
});

it("refuses a member whose numbers the owner cannot see", async () => {
  const [a, c] = [await user(), await user()];
  await expect(saveBoard(a, { name: "X", members: [`local:${c}`] })).rejects.toMatchObject({
    code: "COMPARISON_BOARD_MEMBER_INVALID",
  });
});

it("does not find another user's board", async () => {
  const [a, b] = [await user(), await user()];
  const board = await saveBoard(a, { name: "Mine", members: [] });
  await expect(deleteBoard(b, board.id)).rejects.toMatchObject({ code: "COMPARISON_BOARD_NOT_FOUND" });
  await expect(boardMemberKeys(b, board.id)).rejects.toMatchObject({ code: "COMPARISON_BOARD_NOT_FOUND" });
  await expect(saveBoard(b, { name: "Theirs", members: [] }, board.id)).rejects.toMatchObject({
    code: "COMPARISON_BOARD_NOT_FOUND",
  });
  expect(await deleteBoard(a, board.id)).toEqual({ deleted: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/boards.test.ts`
Expected: FAIL — `Cannot find module '../boards'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/services/comparison/boards.ts`:
```ts
/**
 * Leaderboard groups (spec §5): a private, named filter over people whose consent the owner
 * already holds. Nothing is relayed and nobody is asked — unlike the E2E circles, a board
 * grants no one anything. A withdrawn consent keeps its member row (FK) but its person drops
 * out of the rows, because the leaderboard reads accepted consents only.
 */
import { prisma } from "../../db";
import type { BoardView } from "../../schemas/comparison";
import { localKey, remoteKey } from "./consents";
import { comparisonError } from "./errors";

const boardNotFound = (userId: string, boardId: string) =>
  comparisonError("COMPARISON_BOARD_NOT_FOUND", 404, "No such group", { userId, boardId });

export async function listBoards(userId: string): Promise<BoardView[]> {
  const boards = await prisma.leaderboardBoard.findMany({
    where: { userId },
    include: { members: { include: { consent: { select: { ownerId: true } } } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return boards.map((b) => ({
    id: b.id,
    name: b.name,
    members: b.members.map((m) => (m.consent ? localKey(m.consent.ownerId) : remoteKey(m.remoteId as string))),
  }));
}

async function resolveMembers(userId: string, keys: readonly string[]) {
  const unique = [...new Set(keys)];
  const localIds = unique.filter((k) => k.startsWith("local:")).map((k) => k.slice("local:".length));
  const remoteIds = unique.filter((k) => k.startsWith("remote:")).map((k) => k.slice("remote:".length));
  const [consents, remotes] = await Promise.all([
    prisma.leaderboardConsent.findMany({
      where: { viewerId: userId, ownerId: { in: localIds }, status: "accepted" },
      select: { id: true },
    }),
    prisma.leaderboardRemote.findMany({ where: { userId, id: { in: remoteIds } }, select: { id: true } }),
  ]);
  if (consents.length !== localIds.length || remotes.length !== remoteIds.length)
    throw comparisonError(
      "COMPARISON_BOARD_MEMBER_INVALID",
      400,
      "A group holds only people whose numbers you can see",
      { userId }
    );
  return [...consents.map((c) => ({ consentId: c.id })), ...remotes.map((r) => ({ remoteId: r.id }))];
}

export async function saveBoard(
  userId: string,
  input: { name: string; members: string[] },
  boardId?: string
): Promise<BoardView> {
  if (boardId && !(await prisma.leaderboardBoard.findFirst({ where: { id: boardId, userId } })))
    throw boardNotFound(userId, boardId);
  const members = await resolveMembers(userId, input.members);
  let id = boardId;
  if (id) {
    await prisma.$transaction([
      prisma.leaderboardBoardMember.deleteMany({ where: { boardId: id } }),
      prisma.leaderboardBoard.update({
        where: { id },
        data: { name: input.name, members: { create: members } },
      }),
    ]);
  } else {
    id = (
      await prisma.leaderboardBoard.create({
        data: { userId, name: input.name, members: { create: members } },
      })
    ).id;
  }
  const saved = (await listBoards(userId)).find((b) => b.id === id);
  if (!saved) throw boardNotFound(userId, id);
  return saved;
}

export async function deleteBoard(userId: string, boardId: string): Promise<{ deleted: true }> {
  const removed = await prisma.leaderboardBoard.deleteMany({ where: { id: boardId, userId } });
  if (removed.count === 0) throw boardNotFound(userId, boardId);
  return { deleted: true };
}

export async function boardMemberKeys(userId: string, boardId: string): Promise<Set<string>> {
  const board = (await listBoards(userId)).find((b) => b.id === boardId);
  if (!board) throw boardNotFound(userId, boardId);
  return new Set(board.members);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/comparison/boards.ts backend/src/services/comparison/__tests__/boards.test.ts
git commit -m "feat(comparison): leaderboard groups as named sets of consented people

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---
### Task 11: Peer side — serve `aggregate`, `lb-claim`, `lb-state`; advertise versions in the ping

**Files:**
- Create: `backend/src/services/comparison/peerActions.ts`, `backend/src/services/comparison/__tests__/peerActions.test.ts`
- Modify: `backend/src/services/federation/contract.ts:58-73` (`packetBody`), `backend/src/routes/comparisonPeer.ts` (dispatch, ping reply)

**Interfaces:**
Consumes: `hash`, `refused` (Task 2), `buildLeaderboardSnapshot` (Task 7), schemas (Task 6), `PERSON_SELECT`, `toPerson`.
Produces:
```ts
export async function serveAggregate(origin: string, body: AggregateRequest): Promise<AggregateReply>;
export async function serveClaim(origin: string, body: LbClaimRequest): Promise<LbClaimReply>;
export async function serveState(origin: string, body: LbStateRequest): Promise<{ ok: true }>;
```
`packetBody` accepts `{action:"aggregate"|"lb-claim"|"lb-state", …}`; ping replies `{ ready: true, leaderboard: [1] }`.

- [ ] **Step 1: Write the failing test**

`backend/src/services/comparison/__tests__/peerActions.test.ts`:
```ts
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "crypto";
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { getInstanceSettings } from "../../instanceSettingsService";
import { loadVisibleDomains } from "../../domainVisibility";
import { hash } from "../../federation/refusal";
import { resetIdentityCache } from "../../federation/identity";
import peer from "../../../routes/comparisonPeer";

jest.mock("../../instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const LOCAL = "https://local.lb-peer.test";
const REMOTE = "https://remote.lb-peer.test";
const OTHER = "https://other.lb-peer.test";
const keys = {
  local: generateKeyPairSync("ed25519"),
  remote: generateKeyPairSync("ed25519"),
  other: generateKeyPairSync("ed25519"),
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-peer-"));
const app = express();
app.use(express.json());
app.use("/api/v1/comparison-peer", peer);
let ownerId: string;

function packet(from: "remote" | "other", body: unknown) {
  const unsigned = {
    origin: from === "remote" ? REMOTE : OTHER,
    destination: LOCAL,
    nonce: randomBytes(32).toString("hex"),
    time: Date.now(),
    body: JSON.stringify(body),
  };
  const signature = sign(null, Buffer.from(JSON.stringify(unsigned)), keys[from].privateKey);
  return { ...unsigned, signature: signature.toString("base64") };
}
async function send(from: "remote" | "other", body: unknown) {
  const res = await request(app).post("/api/v1/comparison-peer").send(packet(from, body));
  return { status: res.status, data: res.status === 200 ? JSON.parse(res.body.body) : null };
}
async function invite(): Promise<string> {
  const code = randomBytes(32).toString("hex");
  await prisma.leaderboardInvite.create({
    data: { hash: hash(code), userId: ownerId, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return code;
}
async function claimed(username: string): Promise<string> {
  const reply = await send("remote", { action: "lb-claim", code: await invite(), username, displayName: username });
  return reply.data.channel as string;
}

beforeAll(async () => {
  fs.writeFileSync(path.join(dir, "local.key"), keys.local.privateKey.export({ type: "pkcs8", format: "pem" }));
  process.env.FEDERATION_ENABLED = "1";
  process.env.FEDERATION_PUBLIC_ORIGIN = LOCAL;
  process.env.FEDERATION_KEY_FILE = path.join(dir, "local.key");
  resetIdentityCache();
  for (const [origin, pair] of [
    [REMOTE, keys.remote],
    [OTHER, keys.other],
  ] as const) {
    const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    await prisma.comparisonPeer.upsert({
      where: { origin },
      create: { origin, publicKey, enabled: true, verifiedAt: new Date() },
      update: { publicKey, enabled: true, verifiedAt: new Date() },
    });
  }
  ownerId = (
    await prisma.user.create({
      data: { username: `lb-owner-${randomUUID().slice(0, 8)}`, passwordHash: "test-only", firstName: "Anna" },
    })
  ).id;
});
beforeEach(() => {
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: true } as never);
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry"]);
});
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: { in: [REMOTE, OTHER] } } });
  await prisma.user.delete({ where: { id: ownerId } });
  for (const key of ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"])
    delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

it("advertises the snapshot versions it serves in the ping", async () => {
  expect((await send("remote", { action: "ping" })).data).toEqual({ ready: true, leaderboard: [1] });
});

it("redeems an invitation once and asks the inviter before anything is shared", async () => {
  const code = await invite();
  const first = await send("remote", { action: "lb-claim", code, username: "ben", displayName: "Ben B" });
  expect(first.data).toMatchObject({ accepted: true, displayName: "Anna" });
  const remote = await prisma.leaderboardRemote.findUniqueOrThrow({
    where: { origin_channel: { origin: REMOTE, channel: first.data.channel } },
    include: { consents: true },
  });
  expect(remote).toMatchObject({ userId: ownerId, username: "ben", displayName: "Ben B" });
  expect(remote.consents.map((c) => c.status)).toEqual(["pending"]);
  const again = await send("remote", { action: "lb-claim", code, username: "eve", displayName: "Eve" });
  expect(again.data).toEqual({ accepted: false });
});

it("serves totals only after the owner accepted, and only in a version the asker reads", async () => {
  const channel = await claimed("cleo");
  const ask = (accept: number[], year: number | null = null) =>
    send("remote", { action: "aggregate", channel, year, accept });
  expect((await ask([1])).data).toEqual({ status: "notShared" });
  await prisma.leaderboardConsent.updateMany({
    where: { remote: { channel } },
    data: { status: "accepted", scope: { groups: ["trips"], domains: ["ferry"], year: 2025 } },
  });
  expect((await ask([1], 2025)).data).toMatchObject({
    status: "ok",
    snapshot: { schema: "travstats-leaderboard", version: 1, year: 2025, metrics: { ferryCrossings: 0 } },
  });
  expect((await ask([1], null)).data).toEqual({ status: "yearNotShared", year: 2025 });
  expect((await ask([2], 2025)).data).toEqual({ status: "unsupportedVersion", supported: [1] });
});

it("answers notShared for a deactivated owner", async () => {
  const channel = await claimed("dora");
  await prisma.leaderboardConsent.updateMany({
    where: { remote: { channel } },
    data: { status: "accepted", scope: { groups: ["trips"], domains: ["ferry"], year: null } },
  });
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: false } });
  const reply = await send("remote", { action: "aggregate", channel, year: null, accept: [1] });
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: true } });
  expect(reply.data).toEqual({ status: "notShared" });
});

it("refuses a channel from another origin and logs unknown-channel", async () => {
  const channel = await claimed("finn");
  const warn = jest.spyOn(logger, "warn");
  const reply = await send("other", { action: "aggregate", channel, year: null, accept: [1] });
  expect(reply.status).toBe(403);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "unknown-channel" }),
    "Comparison peer packet refused"
  );
  warn.mockRestore();
});

it("drops the friendship when the other server reports it ended", async () => {
  const channel = await claimed("gus");
  expect((await send("remote", { action: "lb-state", channel, status: "withdrawn" })).data).toEqual({ ok: true });
  expect(await prisma.leaderboardRemote.findFirst({ where: { channel } })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/peerActions.test.ts`
Expected: FAIL — the ping test gets `{ ready: true }` without `leaderboard`; the `lb-claim` packets are refused (403, `data` null → `TypeError: Cannot read properties of null`).

- [ ] **Step 3: Write minimal implementation**

`backend/src/services/comparison/peerActions.ts`:
```ts
/**
 * The leaderboard half of the signed peer endpoint (spec §9.3). Owner decision 2026-10-16:
 * these totals cross servers WITHOUT end-to-end encryption, over the Ed25519-signed link of two
 * admin-pinned servers. Nothing here returns a record.
 *
 * A remote friend is addressed by (origin of the signed envelope, channel). The channel is a
 * random UUID this server minted at the claim, so a second admitted peer cannot use a channel
 * that belongs to another one — the lookup includes the origin.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../db";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import { hash, refused } from "../federation/refusal";
import {
  SERVED_VERSIONS,
  leaderboardScopeSchema,
  type AggregateReply,
  type AggregateRequest,
  type LbClaimReply,
  type LbClaimRequest,
  type LbStateRequest,
} from "../../schemas/comparison";
import { buildLeaderboardSnapshot } from "./aggregates";

export async function serveAggregate(origin: string, body: AggregateRequest): Promise<AggregateReply> {
  const remote = await prisma.leaderboardRemote.findUnique({
    where: { origin_channel: { origin, channel: body.channel } },
  });
  if (!remote) throw refused("unknown-channel");
  if (!SERVED_VERSIONS.some((v) => body.accept.includes(v)))
    return { status: "unsupportedVersion", supported: [...SERVED_VERSIONS] };
  const consent = await prisma.leaderboardConsent.findUnique({
    where: { ownerId_remoteId: { ownerId: remote.userId, remoteId: remote.id } },
    include: { owner: { select: { isActive: true } } },
  });
  if (!consent || !consent.owner.isActive) return { status: "notShared" };
  if (consent.status === "withdrawn") return { status: "withdrawn" };
  if (consent.status !== "accepted" || !consent.scope) return { status: "notShared" };
  const scope = leaderboardScopeSchema.parse(consent.scope);
  if (scope.year !== null && scope.year !== body.year)
    return { status: "yearNotShared", year: scope.year };
  return { status: "ok", snapshot: await buildLeaderboardSnapshot(remote.userId, scope, body.year) };
}

/**
 * Someone on the asking server redeemed one of our users' invitation codes. The inviter is
 * asked (pending) before their totals are served; the claimant's server asserted the
 * claimant's name under its signature.
 */
export async function serveClaim(origin: string, body: LbClaimRequest): Promise<LbClaimReply> {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.leaderboardInvite.findUnique({
      where: { hash: hash(body.code) },
      include: { user: { select: { ...PERSON_SELECT, isActive: true } } },
    });
    if (!invite || invite.usedAt || invite.expiresAt <= new Date() || !invite.user.isActive)
      return { accepted: false as const };
    const used = await tx.leaderboardInvite.updateMany({
      where: { hash: invite.hash, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) return { accepted: false as const };
    const channel = randomUUID();
    const remote = await tx.leaderboardRemote.create({
      data: { userId: invite.userId, origin, channel, username: body.username, displayName: body.displayName },
    });
    await tx.leaderboardConsent.create({ data: { ownerId: invite.userId, remoteId: remote.id } });
    const inviter = toPerson(invite.user);
    return { accepted: true as const, channel, username: inviter.username, displayName: inviter.displayName };
  });
}

export async function serveState(origin: string, body: LbStateRequest): Promise<{ ok: true }> {
  const removed = await prisma.leaderboardRemote.deleteMany({ where: { origin, channel: body.channel } });
  if (removed.count === 0) throw refused("unknown-channel");
  return { ok: true };
}
```

`backend/src/services/federation/contract.ts`:
```ts
import { aggregateRequestSchema, lbClaimRequestSchema, lbStateRequestSchema } from "../../schemas/comparison";
```
and append the three schemas as the last members of `z.discriminatedUnion("action", [ … ])`.

`backend/src/routes/comparisonPeer.ts`:
```ts
import { SERVED_VERSIONS } from "../schemas/comparison";
import { serveAggregate, serveClaim, serveState } from "../services/comparison/peerActions";
```
Replace `if (body.action === "ping") data = { ready: true };` with
```ts
    // `leaderboard` tells a newer server which snapshot versions this one serves; a server
    // from before 2026-10-16 answers without it, which is how "needs an update" is detected.
    if (body.action === "ping") data = { ready: true, leaderboard: [...SERVED_VERSIONS] };
    else if (body.action === "aggregate") data = await serveAggregate(message.origin, body);
    else if (body.action === "lb-claim") data = await serveClaim(message.origin, body);
    else if (body.action === "lb-state") data = await serveState(message.origin, body);
```
keeping the existing `claim`/`state`/`sealed`/`circle` branches after them.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/peerActions.test.ts src/services/federation/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/comparison/peerActions.ts backend/src/services/comparison/__tests__/peerActions.test.ts backend/src/services/federation/contract.ts backend/src/routes/comparisonPeer.ts
git commit -m "feat(comparison): serve leaderboard totals to admitted peer servers

Owner decision 2026-10-16: aggregates travel signed but not end-to-end encrypted; full
records never do. The ping now says which snapshot versions this server serves.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 12: Client side — invitations, claim, pull, peer readiness, ending a remote friendship

**Files:**
- Create: `backend/src/services/comparison/remote.ts`, `backend/src/services/comparison/__tests__/remote.test.ts`

**Interfaces:**
Consumes: `exchange`, `PeerRefusal` (`services/federation/security`), `loadIdentity` (`services/federation/identity`), `origin` (`services/federation/contract`), `hash`, `pingReplySchema` (Task 4), `aggregateReplySchema`, `lbClaimReplySchema`, `SERVED_VERSIONS` (Task 6), `personView`, `remoteKey`, `scopeJson` (Task 9), `PERSON_SELECT`, `toPerson`.
Produces:
```ts
export type PeerReadiness = "ready" | "outdated" | "unknown" | "unreachable";
export type RemoteResult = { status: "ok"; snapshot: LeaderboardSnapshot } | { status: Exclude<RowStatus, "ok">; sharedYear?: number };
export function parseInviteCode(code: string): { origin: string; secret: string } | null;
export async function peerReadiness(origin: string): Promise<PeerReadiness>;
export async function pullRemote(remote: LeaderboardRemote, year: number | null): Promise<RemoteResult>;
export async function createInvite(userId: string): Promise<{ code: string; expiresAt: string }>;
export async function claimInvite(userId: string, code: string, scope: LeaderboardScope): Promise<PersonView>;
export async function endRemote(userId: string, remoteId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

`backend/src/services/comparison/__tests__/remote.test.ts`:
```ts
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { exchange } from "../../federation/security";
import { loadIdentity } from "../../federation/identity";
import { refused } from "../../federation/refusal";
import type { LeaderboardScope } from "../../../schemas/comparison";
import { claimInvite, createInvite, parseInviteCode, pullRemote } from "../remote";

jest.mock("../../federation/security", () => ({
  ...jest.requireActual("../../federation/security"),
  exchange: jest.fn(),
}));
jest.mock("../../federation/identity", () => ({
  ...jest.requireActual("../../federation/identity"),
  loadIdentity: jest.fn(),
}));

const PEER = "https://peer.lb-remote.test";
const SCOPE: LeaderboardScope = { groups: ["trips"], domains: ["flight"], year: null };
let userId: string;

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { username: `lb-r-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" } })
  ).id;
  await prisma.comparisonPeer.upsert({
    where: { origin: PEER },
    create: { origin: PEER, publicKey: "unused-in-this-test", enabled: true, verifiedAt: new Date() },
    update: { enabled: true, verifiedAt: new Date() },
  });
});
beforeEach(async () => {
  jest.mocked(exchange).mockReset();
  jest.mocked(loadIdentity).mockResolvedValue({ origin: "https://me.lb-remote.test" } as never);
  await prisma.comparisonPeer.update({ where: { origin: PEER }, data: { leaderboardVersions: [] } });
});
afterAll(async () => {
  await prisma.comparisonPeer.delete({ where: { origin: PEER } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

it("reads an invitation code as origin and secret", () => {
  const secret = "a".repeat(64);
  expect(parseInviteCode(` ${PEER}#${secret} `)).toEqual({ origin: PEER, secret });
  for (const bad of [`http://x.example#${secret}`, `https://x.example:8443#${secret}`, `${PEER}#short`, secret])
    expect(parseInviteCode(bad)).toBeNull();
});

it("says the other server needs an update when its ping knows no leaderboard", async () => {
  jest.mocked(exchange).mockResolvedValueOnce({ ready: true });
  await expect(claimInvite(userId, `${PEER}#${"b".repeat(64)}`, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_PEER_OUTDATED",
  });
  expect(jest.mocked(exchange)).toHaveBeenCalledTimes(1);
});

it("records the remote friend together with the claimant's own consent", async () => {
  jest
    .mocked(exchange)
    .mockResolvedValueOnce({ ready: true, leaderboard: [1] })
    .mockResolvedValueOnce({ accepted: true, channel: randomUUID(), username: "anna", displayName: "Anna A" });
  const view = await claimInvite(userId, `${PEER}#${"c".repeat(64)}`, SCOPE);
  expect(view).toMatchObject({
    person: { kind: "remote", username: "anna", origin: PEER },
    mine: { status: "accepted", scope: SCOPE },
    theirs: null,
  });
  expect((await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: PEER } })).leaderboardVersions).toEqual([1]);
});

it("maps the other server's answers onto row statuses", async () => {
  await prisma.comparisonPeer.update({ where: { origin: PEER }, data: { leaderboardVersions: [1] } });
  const remote = {
    id: randomUUID(),
    userId,
    origin: PEER,
    channel: randomUUID(),
    username: "x",
    displayName: "X",
    createdAt: new Date(),
  };
  jest.mocked(exchange).mockResolvedValueOnce({ status: "unsupportedVersion", supported: [2] });
  expect(await pullRemote(remote, null)).toEqual({ status: "outdated" });
  jest.mocked(exchange).mockResolvedValueOnce({ status: "yearNotShared", year: 2024 });
  expect(await pullRemote(remote, 2025)).toEqual({ status: "yearNotShared", sharedYear: 2024 });
  jest.mocked(exchange).mockRejectedValueOnce(new Error("socket hang up"));
  expect(await pullRemote(remote, null)).toEqual({ status: "unreachable" });
  jest.mocked(exchange).mockResolvedValueOnce({
    status: "ok",
    snapshot: {
      schema: "travstats-leaderboard",
      version: 1,
      asOf: "2026-10-16T00:00:00.000Z",
      year: null,
      domains: [],
      metrics: JSON.parse('{"__proto__": 1}'),
      partial: [],
    },
  });
  expect(await pullRemote(remote, null)).toEqual({ status: "unreachable" });
});

it("refuses to mint an invitation while this server is not connected", async () => {
  jest.mocked(loadIdentity).mockRejectedValueOnce(refused("federation-off"));
  await expect(createInvite(userId)).rejects.toMatchObject({ code: "COMPARISON_FEDERATION_OFF" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/remote.test.ts`
Expected: FAIL — `Cannot find module '../remote'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/services/comparison/remote.ts`:
```ts
/**
 * Friends on other servers (spec §9.1, §10). The invitation code is `<origin>#<64 hex>`: the
 * secret is single-use and 72 h valid; the origin says which admitted peer to ask. A pull asks
 * the friend's server for the friend's totals under the consent that friend gave there.
 */
import { randomBytes } from "crypto";
import { prisma } from "../../db";
import type { LeaderboardRemote } from "../../prisma";
import logger from "../../utils/logger";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import { exchange, PeerRefusal } from "../federation/security";
import { loadIdentity } from "../federation/identity";
import { origin as originSchema } from "../federation/contract";
import { hash } from "../federation/refusal";
import { pingReplySchema } from "../../schemas/federationAdmin";
import {
  SERVED_VERSIONS,
  aggregateReplySchema,
  lbClaimReplySchema,
  type LeaderboardScope,
  type LeaderboardSnapshot,
  type PersonView,
  type RowStatus,
} from "../../schemas/comparison";
import { personView, remoteKey, scopeJson } from "./consents";
import { comparisonError } from "./errors";

const INVITE_TTL_MS = 72 * 3_600_000;
const OPEN_INVITES = 20;

export type PeerReadiness = "ready" | "outdated" | "unknown" | "unreachable";
export type RemoteResult =
  | { status: "ok"; snapshot: LeaderboardSnapshot }
  | { status: Exclude<RowStatus, "ok">; sharedYear?: number };

const failureKind = (error: unknown) => (error instanceof PeerRefusal ? error.kind : "error");

export function parseInviteCode(code: string): { origin: string; secret: string } | null {
  const text = code.trim();
  const at = text.lastIndexOf("#");
  if (at < 0) return null;
  const origin = text.slice(0, at);
  const secret = text.slice(at + 1);
  if (origin === "local" || !originSchema.safeParse(origin).success) return null;
  return /^[a-f0-9]{64}$/.test(secret) ? { origin, secret } : null;
}

/**
 * Whether a peer can be asked for totals. A stored version list is trusted; an empty one is
 * re-checked with one ping, because the other admin may have updated since the last check.
 */
export async function peerReadiness(origin: string): Promise<PeerReadiness> {
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  if (!peer?.enabled || !peer.verifiedAt) return "unknown";
  if (peer.leaderboardVersions.some((v) => (SERVED_VERSIONS as readonly number[]).includes(v))) return "ready";
  let versions: number[];
  try {
    versions = pingReplySchema.parse(await exchange(origin, { action: "ping" })).leaderboard ?? [];
  } catch (error) {
    logger.warn({ operation: "comparison_peer_ping_failed", origin, kind: failureKind(error) }, "Peer did not answer");
    return "unreachable";
  }
  await prisma.comparisonPeer.update({ where: { origin }, data: { leaderboardVersions: versions } });
  return versions.some((v) => (SERVED_VERSIONS as readonly number[]).includes(v)) ? "ready" : "outdated";
}

export async function pullRemote(remote: LeaderboardRemote, year: number | null): Promise<RemoteResult> {
  try {
    await loadIdentity();
  } catch {
    return { status: "federationOff" };
  }
  const readiness = await peerReadiness(remote.origin);
  if (readiness === "outdated") return { status: "outdated" };
  if (readiness !== "ready") return { status: "unreachable" };
  try {
    const reply = aggregateReplySchema.parse(
      await exchange(remote.origin, {
        action: "aggregate",
        channel: remote.channel,
        year,
        accept: [...SERVED_VERSIONS],
      })
    );
    if (reply.status === "ok") return { status: "ok", snapshot: reply.snapshot };
    if (reply.status === "yearNotShared") return { status: "yearNotShared", sharedYear: reply.year };
    if (reply.status === "unsupportedVersion") return { status: "outdated" };
    return { status: reply.status };
  } catch (error) {
    // A malformed reply is treated like no reply: nothing unvalidated reaches the page.
    logger.warn(
      { operation: "comparison_pull_failed", origin: remote.origin, kind: failureKind(error) },
      "A remote friend's totals could not be read"
    );
    return { status: "unreachable" };
  }
}

async function connectedIdentity(userId: string) {
  try {
    return await loadIdentity();
  } catch {
    throw comparisonError("COMPARISON_FEDERATION_OFF", 409, "This server is not connected to other servers", {
      userId,
    });
  }
}

export async function createInvite(userId: string): Promise<{ code: string; expiresAt: string }> {
  const local = await connectedIdentity(userId);
  const open = await prisma.leaderboardInvite.count({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
  });
  if (open >= OPEN_INVITES)
    throw comparisonError("COMPARISON_INVITE_LIMIT", 429, "Too many open invitations", { userId });
  const secret = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await prisma.leaderboardInvite.create({ data: { hash: hash(secret), userId, expiresAt } });
  return { code: `${local.origin}#${secret}`, expiresAt: expiresAt.toISOString() };
}

export async function claimInvite(userId: string, code: string, scope: LeaderboardScope): Promise<PersonView> {
  const parsed = parseInviteCode(code);
  if (!parsed) throw comparisonError("COMPARISON_INVITE_INVALID", 400, "Not an invitation code", { userId });
  const local = await connectedIdentity(userId);
  if (parsed.origin === local.origin)
    throw comparisonError("COMPARISON_INVITE_INVALID", 400, "A code from this server: add the person by username", {
      userId,
    });
  const readiness = await peerReadiness(parsed.origin);
  if (readiness === "unknown")
    throw comparisonError("COMPARISON_PEER_UNKNOWN", 403, "The admin has not connected that server", {
      userId,
      origin: parsed.origin,
    });
  if (readiness === "outdated")
    throw comparisonError("COMPARISON_PEER_OUTDATED", 409, "That server needs an update", { userId, origin: parsed.origin });
  if (readiness === "unreachable")
    throw comparisonError("COMPARISON_PEER_UNREACHABLE", 502, "That server does not answer", {
      userId,
      origin: parsed.origin,
    });
  const me = toPerson(await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PERSON_SELECT }));
  let reply;
  try {
    reply = lbClaimReplySchema.parse(
      await exchange(parsed.origin, {
        action: "lb-claim",
        code: parsed.secret,
        username: me.username,
        displayName: me.displayName,
      })
    );
  } catch (error) {
    throw comparisonError("COMPARISON_PEER_UNREACHABLE", 502, "That server does not answer", {
      userId,
      origin: parsed.origin,
      kind: failureKind(error),
    });
  }
  if (!reply.accepted)
    throw comparisonError("COMPARISON_INVITE_INVALID", 400, "Unknown, used or expired code", { userId });
  const remote = await prisma.leaderboardRemote.create({
    data: {
      userId,
      origin: parsed.origin,
      channel: reply.channel,
      username: reply.username,
      displayName: reply.displayName,
      consents: { create: { ownerId: userId, status: "accepted", scope: scopeJson(scope), decidedAt: new Date() } },
    },
  });
  return personView(userId, remoteKey(remote.id));
}

/** Ends a remote friendship here at once; the other server is told best-effort. */
export async function endRemote(userId: string, remoteId: string): Promise<void> {
  const remote = await prisma.leaderboardRemote.findFirst({ where: { id: remoteId, userId } });
  if (!remote) throw comparisonError("COMPARISON_NOT_FOUND", 404, "No such comparison", { userId, remoteId });
  await prisma.leaderboardRemote.delete({ where: { id: remote.id } });
  try {
    await exchange(remote.origin, { action: "lb-state", channel: remote.channel, status: "withdrawn" });
  } catch (error) {
    // Its pulls are refused (unknown channel) from now on, so nothing more is served.
    logger.warn(
      { operation: "comparison_remote_end_unsent", origin: remote.origin, kind: failureKind(error) },
      "The other server was not told that a comparison ended"
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/comparison/remote.ts backend/src/services/comparison/__tests__/remote.test.ts
git commit -m "feat(comparison): invite, claim and pull friends on other servers

Mixed versions get a clear answer: a server whose ping knows no leaderboard is reported as
needing an update, not as broken. A malformed reply is never shown.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 13: Read the leaderboard — self, consented friends, remote friends, by board

**Files:**
- Create: `backend/src/services/comparison/leaderboard.ts`, `backend/src/services/comparison/__tests__/leaderboard.test.ts`

**Interfaces:**
Consumes: `buildLeaderboardSnapshot` (Task 7), `localPerson`, `remotePerson`, `remoteKey` (Task 9), `boardMemberKeys` (Task 10), `pullRemote`, `RemoteResult` (Task 12), `loadVisibleDomains`, `PERSON_SELECT`.
Produces:
```ts
export const LOCAL_ROW_CAP = 50;
export const REMOTE_ROW_CAP = 20;
export async function readLeaderboard(
  viewerId: string,
  query: { year: number | null; boardId?: string },
  pull?: (remote: LeaderboardRemote, year: number | null) => Promise<RemoteResult>
): Promise<LeaderboardResponse>;
```

- [ ] **Step 1: Write the failing test**

`backend/src/services/comparison/__tests__/leaderboard.test.ts`:
```ts
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { loadVisibleDomains } from "../../domainVisibility";
import { saveBoard } from "../boards";
import { readLeaderboard } from "../leaderboard";

jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const TRIPS = { groups: ["trips"], domains: ["ferry"], year: null };
const users: string[] = [];
let viewer: string, ben: string, cleo: string, dora: string, emil: string, remoteId: string;
const pull = jest.fn().mockResolvedValue({ status: "outdated" });

async function user(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `lb-l-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
async function shares(ownerId: string, scope: object, status = "accepted", ageMs = 0) {
  await prisma.leaderboardConsent.create({
    data: { ownerId, viewerId: viewer, status, scope, decidedAt: new Date(Date.now() - 10_000 + ageMs) },
  });
}

beforeAll(async () => {
  [viewer, ben, cleo, dora, emil] = [await user(), await user(), await user(), await user(), await user()];
  await shares(ben, TRIPS, "accepted", 0);
  await shares(cleo, { ...TRIPS, year: 2024 }, "accepted", 1);
  await shares(dora, TRIPS, "accepted", 2);
  await shares(emil, TRIPS, "withdrawn", 3);
  await prisma.user.update({ where: { id: dora }, data: { isActive: false } });
  await prisma.ferryJourney.create({
    data: {
      userId: ben,
      depStationName: "Puttgarden",
      depLat: 54.5,
      depLon: 11.23,
      arrStationName: "Rødby",
      arrLat: 54.65,
      arrLon: 11.35,
      departureTime: new Date("2025-08-01T08:00:00Z"),
      status: "completed",
      distanceKm: 19,
    },
  });
  remoteId = (
    await prisma.leaderboardRemote.create({
      data: { userId: viewer, origin: "https://far.lb-board.test", channel: randomUUID(), username: "far", displayName: "Far" },
    })
  ).id;
});
beforeEach(() => {
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry"]);
  pull.mockClear();
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("lists self, consented friends and remote friends; drops deactivated and withdrawn ones", async () => {
  const res = await readLeaderboard(viewer, { year: 2025 }, pull);
  expect(res.rows.map((r) => [r.person.key, r.status])).toEqual([
    ["self", "ok"],
    [`local:${ben}`, "ok"],
    [`local:${cleo}`, "yearNotShared"],
    [`remote:${remoteId}`, "outdated"],
  ]);
  expect(res.rows[1].snapshot?.metrics).toEqual({ ferryCrossings: 1 });
  expect(res.rows[2].sharedYear).toBe(2024);
  expect(pull).toHaveBeenCalledWith(expect.objectContaining({ id: remoteId }), 2025);
});

it("does not answer a one-year consent with lifetime totals", async () => {
  const res = await readLeaderboard(viewer, { year: null }, pull);
  expect(res.rows.find((r) => r.person.key === `local:${cleo}`)).toMatchObject({
    status: "yearNotShared",
    snapshot: null,
  });
});

it("shows only a board's members, and a withdrawn member leaves the board", async () => {
  const board = await saveBoard(viewer, { name: "Fähre", members: [`local:${ben}`] });
  expect((await readLeaderboard(viewer, { year: 2025, boardId: board.id }, pull)).rows.map((r) => r.person.key)).toEqual([
    "self",
    `local:${ben}`,
  ]);
  await prisma.leaderboardConsent.updateMany({ where: { ownerId: ben, viewerId: viewer }, data: { status: "withdrawn" } });
  expect((await readLeaderboard(viewer, { year: 2025, boardId: board.id }, pull)).rows.map((r) => r.person.key)).toEqual([
    "self",
  ]);
  expect(pull).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/comparison/__tests__/leaderboard.test.ts`
Expected: FAIL — `Cannot find module '../leaderboard'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/services/comparison/leaderboard.ts`:
```ts
/**
 * The leaderboard for one viewer (spec §6). Same-instance friends are read here, server-side,
 * under the consent each gave — no keys, no decryption. Remote friends are pulled in parallel.
 * A friend whose consent is not accepted, or whose account is deactivated, is not a row at all.
 */
import { prisma } from "../../db";
import type { LeaderboardRemote } from "../../prisma";
import logger from "../../utils/logger";
import { METRIC_GROUPS } from "../../shared/comparisonMetrics";
import { PERSON_SELECT } from "../sharing/people";
import { loadVisibleDomains } from "../domainVisibility";
import {
  leaderboardResponseSchema,
  leaderboardScopeSchema,
  type LeaderboardResponse,
  type LeaderboardRow,
} from "../../schemas/comparison";
import { buildLeaderboardSnapshot } from "./aggregates";
import { boardMemberKeys } from "./boards";
import { localPerson, remoteKey, remotePerson } from "./consents";
import { pullRemote, type RemoteResult } from "./remote";

export const LOCAL_ROW_CAP = 50;
export const REMOTE_ROW_CAP = 20;
type Pull = (remote: LeaderboardRemote, year: number | null) => Promise<RemoteResult>;

export async function readLeaderboard(
  viewerId: string,
  query: { year: number | null; boardId?: string },
  pull: Pull = pullRemote
): Promise<LeaderboardResponse> {
  const { year } = query;
  const members = query.boardId ? await boardMemberKeys(viewerId, query.boardId) : null;
  const me = await prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: PERSON_SELECT });
  const visible = await loadVisibleDomains(viewerId);
  const rows: LeaderboardRow[] = [
    {
      person: { ...localPerson(me), key: "self", kind: "self" },
      status: "ok",
      snapshot: await buildLeaderboardSnapshot(viewerId, { groups: [...METRIC_GROUPS], domains: visible, year: null }, year),
      sharedYear: null,
    },
  ];

  const consents = await prisma.leaderboardConsent.findMany({
    where: { viewerId, status: "accepted", owner: { isActive: true } },
    include: { owner: { select: PERSON_SELECT } },
    orderBy: { decidedAt: "asc" },
    take: LOCAL_ROW_CAP,
  });
  for (const consent of consents) {
    const person = localPerson(consent.owner);
    if (members && !members.has(person.key)) continue;
    const scope = leaderboardScopeSchema.parse(consent.scope);
    if (scope.year !== null && scope.year !== year) {
      rows.push({ person, status: "yearNotShared", snapshot: null, sharedYear: scope.year });
      continue;
    }
    try {
      rows.push({
        person,
        status: "ok",
        snapshot: await buildLeaderboardSnapshot(consent.ownerId, scope, year),
        sharedYear: scope.year,
      });
    } catch (error) {
      // One friend's failing loader must not blank everyone's board; it is logged, not hidden.
      logger.error({ operation: "comparison_snapshot_failed", ownerId: consent.ownerId, err: error }, "Totals not built");
      rows.push({ person, status: "unreachable", snapshot: null, sharedYear: scope.year });
    }
  }

  const remotes = (
    await prisma.leaderboardRemote.findMany({
      where: { userId: viewerId },
      orderBy: { createdAt: "asc" },
      take: REMOTE_ROW_CAP,
    })
  ).filter((r) => !members || members.has(remoteKey(r.id)));
  const pulled = await Promise.all(remotes.map((r) => pull(r, year)));
  remotes.forEach((remote, i) => {
    const result = pulled[i];
    rows.push({
      person: remotePerson(remote),
      status: result.status,
      snapshot: result.status === "ok" ? result.snapshot : null,
      sharedYear: result.status === "ok" ? null : (result.sharedYear ?? null),
    });
  });
  return leaderboardResponseSchema.parse({ year, rows });
}
```
(If the viewer has no visible domain, `buildLeaderboardSnapshot` returns an empty `metrics` record — the `domains: visible` array is passed straight through, not re-validated against `min(1)`.)

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/comparison/leaderboard.ts backend/src/services/comparison/__tests__/leaderboard.test.ts
git commit -m "feat(comparison): read the leaderboard server-side under each friend's consent

The board no longer waits for device keys and a full decryption of every friend's data to
show one number.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 14: The cookie API `/api/v1/comparison`, its limiters and its OpenAPI

**Files:**
- Create: `backend/src/routes/comparison.ts` (new file — the old one moved in Task 1), `backend/src/services/openapi/paths/comparison.ts`, `backend/src/routes/__tests__/comparison.routes.test.ts`
- Modify: `backend/src/middleware/rateLimit.ts` (append two limiters), `backend/src/routes/mounts.ts` (import + entry after `encrypted-share`), `backend/src/services/openapi/paths/index.ts` (`import "./comparison";`), `backend/src/services/openapi/coverage.ts` (comment for `comparison-peer`), `backend/src/__tests__/apiResponseShape.baseline.json` (`enveloped` += `"comparison.ts"`)

**Interfaces:**
Consumes: everything from Tasks 7, 9, 10, 12, 13; `authenticate`, `AuthRequest` (`middleware/auth`), `rejectDemo` (`middleware/demoGuard`), `getInstanceSettings`, `userOrIpKey`, `patAwareMax`.
Produces: `export const comparisonReadLimiter`, `export const comparisonWriteLimiter` (`middleware/rateLimit.ts`); the 13 routes of spec §9.1; mount `{ id: "comparison", base: "/api/v1/comparison" }`.

- [ ] **Step 1: Write the failing test**

`backend/src/routes/__tests__/comparison.routes.test.ts`:
```ts
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { prisma } from "../../db";
import { errorHandler } from "../../middleware/errorHandler";
import { getInstanceSettings } from "../../services/instanceSettingsService";
import { loadVisibleDomains } from "../../services/domainVisibility";
import comparison from "../comparison";

jest.mock("../../middleware/auth", () => ({
  ...jest.requireActual("../../middleware/auth"),
  authenticate: (
    req: express.Request & { userId?: string; apiToken?: unknown },
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = req.header("x-test-user");
    if (req.header("x-test-pat")) req.apiToken = { id: "test", scope: "write" };
    next();
  },
}));
jest.mock("../../services/instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
jest.mock("../../services/domainVisibility", () => ({
  ...jest.requireActual("../../services/domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use("/api/v1/comparison", comparison);
app.use(errorHandler);
const SCOPE = { groups: ["trips"], domains: ["ferry"], year: null };
const users: Array<{ id: string; username: string }> = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `lb-route-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u);
  return u;
}

beforeEach(() => {
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: true } as never);
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry"]);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.$disconnect();
});

it("refuses tokens and a switched-off beta with named codes", async () => {
  const a = await user();
  const pat = await request(app).get("/api/v1/comparison/people").set("x-test-user", a.id).set("x-test-pat", "1");
  expect(pat.status).toBe(403);
  expect(pat.body.code).toBe("COMPARISON_TOKEN_REFUSED");
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: false } as never);
  const off = await request(app).get("/api/v1/comparison/people").set("x-test-user", a.id);
  expect(off.status).toBe(403);
  expect(off.body.code).toBe("COMPARISON_DISABLED");
});

it("runs the same-instance flow: ask, accept, rank, end", async () => {
  const [a, b] = [await user(), await user()];
  const asked = await request(app)
    .post("/api/v1/comparison/requests")
    .set("x-test-user", a.id)
    .send({ username: b.username, scope: SCOPE });
  expect(asked.status).toBe(201);
  expect(asked.body).toMatchObject({ success: true, data: { mine: { status: "accepted" } } });

  const forB = await request(app).get("/api/v1/comparison/people").set("x-test-user", b.id);
  const consentId = forB.body.data.requests[0].consentId as string;
  const accepted = await request(app)
    .post(`/api/v1/comparison/consents/${consentId}/accept`)
    .set("x-test-user", b.id)
    .send({ scope: SCOPE });
  expect(accepted.status).toBe(200);

  const board = await request(app).get("/api/v1/comparison/leaderboard?year=all").set("x-test-user", a.id);
  expect(board.status).toBe(200);
  expect(board.body.data.rows.map((r: { person: { key: string } }) => r.person.key)).toEqual([
    "self",
    `local:${b.id}`,
  ]);

  const ended = await request(app)
    .delete(`/api/v1/comparison/people/${encodeURIComponent(`local:${b.id}`)}`)
    .set("x-test-user", a.id);
  expect(ended.body).toEqual({ success: true, data: { ended: true } });
});

it("validates path keys and bodies at the boundary", async () => {
  const a = await user();
  expect((await request(app).delete("/api/v1/comparison/people/self").set("x-test-user", a.id)).status).toBe(400);
  expect(
    (await request(app).post("/api/v1/comparison/preview").set("x-test-user", a.id).send({ groups: [], domains: [], year: null }))
      .status
  ).toBe(400);
  const missing = await request(app)
    .post("/api/v1/comparison/requests")
    .set("x-test-user", a.id)
    .send({ username: "no-such-user-here", scope: SCOPE });
  expect(missing.status).toBe(404);
  expect(missing.body.code).toBe("COMPARISON_USER_NOT_FOUND");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/routes/__tests__/comparison.routes.test.ts`
Expected: FAIL — `Cannot find module '../comparison'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/middleware/rateLimit.ts` — append:
```ts
/**
 * The leaderboard (comparison rework 2026-10-16). A read builds up to ~9 loaders per friend
 * and pulls remote servers, so 60/min per user; asking people, minting invitations and
 * redeeming them is 30/h — enough for real use, too few to probe usernames or burn codes.
 */
export const comparisonReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: patAwareMax(60),
  message: "Too many comparison requests — please slow down",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

export const comparisonWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: patAwareMax(30),
  message: "Too many comparison requests in an hour",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
```

`backend/src/routes/comparison.ts`:
```ts
/**
 * The leaderboard's cookie API (spec 2026-10-16 §9.1). Enveloped family. Browser sessions
 * only: a personal access token is refused, as is everything while the instance beta switch
 * is off. Every refusal carries a COMPARISON_* code and is logged (services/comparison/errors).
 */
import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { comparisonReadLimiter, comparisonWriteLimiter } from "../middleware/rateLimit";
import { getInstanceSettings } from "../services/instanceSettingsService";
import { comparisonError } from "../services/comparison/errors";
import { buildLeaderboardSnapshot } from "../services/comparison/aggregates";
import {
  acceptConsent,
  declineConsent,
  endLocal,
  listPeople,
  requestComparison,
  updateScope,
} from "../services/comparison/consents";
import { deleteBoard, listBoards, saveBoard } from "../services/comparison/boards";
import { claimInvite, createInvite, endRemote } from "../services/comparison/remote";
import { readLeaderboard } from "../services/comparison/leaderboard";
import {
  boardBodySchema,
  claimBodySchema,
  consentRequestBodySchema,
  leaderboardQuerySchema,
  leaderboardScopeSchema,
  personKeySchema,
  scopeBodySchema,
  uuidParamSchema,
} from "../schemas/comparison";

const router = Router();
type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle = (fn: Handler) => (req: AuthRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};
const send = (res: Response, data: unknown, status = 200): void => {
  res.status(status).json({ success: true, data });
};

router.use(authenticate, rejectDemo);
router.use((req: AuthRequest, _res, next) => {
  if (req.apiToken) {
    next(comparisonError("COMPARISON_TOKEN_REFUSED", 403, "Comparison is a browser feature", { userId: req.userId }));
    return;
  }
  void getInstanceSettings()
    .then((s) =>
      next(
        s.betaFeaturesEnabled
          ? undefined
          : comparisonError("COMPARISON_DISABLED", 403, "Comparison is off on this server", { userId: req.userId })
      )
    )
    .catch(next);
});

router.get(
  "/leaderboard",
  comparisonReadLimiter,
  handle(async (req, res) => {
    const q = leaderboardQuerySchema.parse(req.query);
    send(res, await readLeaderboard(req.userId!, { year: q.year === "all" ? null : q.year, boardId: q.board }));
  })
);
router.post(
  "/preview",
  comparisonReadLimiter,
  handle(async (req, res) => {
    const scope = leaderboardScopeSchema.parse(req.body);
    send(res, await buildLeaderboardSnapshot(req.userId!, scope, scope.year));
  })
);
router.get(
  "/people",
  comparisonReadLimiter,
  handle(async (req, res) => {
    send(res, { ...(await listPeople(req.userId!)), boards: await listBoards(req.userId!) });
  })
);
router.post(
  "/requests",
  comparisonWriteLimiter,
  handle(async (req, res) => {
    const body = consentRequestBodySchema.parse(req.body);
    send(res, await requestComparison(req.userId!, body.username, body.scope), 201);
  })
);
router.post(
  "/consents/:id/accept",
  handle(async (req, res) => {
    const { scope } = scopeBodySchema.parse(req.body);
    send(res, await acceptConsent(req.userId!, uuidParamSchema.parse(req.params.id), scope));
  })
);
router.post(
  "/consents/:id/decline",
  handle(async (req, res) => {
    send(res, await declineConsent(req.userId!, uuidParamSchema.parse(req.params.id)));
  })
);
router.put(
  "/consents/:id",
  handle(async (req, res) => {
    const { scope } = scopeBodySchema.parse(req.body);
    send(res, await updateScope(req.userId!, uuidParamSchema.parse(req.params.id), scope));
  })
);
router.delete(
  "/people/:key",
  handle(async (req, res) => {
    const key = personKeySchema.parse(req.params.key);
    if (key.startsWith("local:")) await endLocal(req.userId!, key.slice("local:".length));
    else await endRemote(req.userId!, key.slice("remote:".length));
    send(res, { ended: true });
  })
);
router.post(
  "/invites",
  comparisonWriteLimiter,
  handle(async (req, res) => {
    send(res, await createInvite(req.userId!), 201);
  })
);
router.post(
  "/invites/claim",
  comparisonWriteLimiter,
  handle(async (req, res) => {
    const body = claimBodySchema.parse(req.body);
    send(res, await claimInvite(req.userId!, body.code, body.scope), 201);
  })
);
router.post(
  "/boards",
  comparisonWriteLimiter,
  handle(async (req, res) => {
    send(res, await saveBoard(req.userId!, boardBodySchema.parse(req.body)), 201);
  })
);
router.put(
  "/boards/:id",
  handle(async (req, res) => {
    send(res, await saveBoard(req.userId!, boardBodySchema.parse(req.body), uuidParamSchema.parse(req.params.id)));
  })
);
router.delete(
  "/boards/:id",
  handle(async (req, res) => {
    send(res, await deleteBoard(req.userId!, uuidParamSchema.parse(req.params.id)));
  })
);

export default router;
```

`backend/src/routes/mounts.ts`: `import comparisonRoutes from "./comparison";` and directly after the `encrypted-share` entry:
```ts
  { id: "comparison", base: "/api/v1/comparison", router: comparisonRoutes },
```

`backend/src/services/openapi/coverage.ts` — the `comparison-peer` reason becomes:
```ts
  [
    "comparison-peer",
    "Server-to-server protocol between admin-pinned peers (Ed25519-signed envelopes); no user token reaches it",
  ],
```

`backend/src/services/openapi/paths/comparison.ts`:
```ts
/**
 * The leaderboard (`routes/comparison.ts`, spec 2026-10-16). Enveloped. Browser sessions only:
 * a personal access token is refused with `COMPARISON_TOKEN_REFUSED`.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  boardBodySchema,
  boardViewSchema,
  claimBodySchema,
  consentRequestBodySchema,
  inviteResponseSchema,
  leaderboardResponseSchema,
  leaderboardScopeSchema,
  leaderboardSnapshotSchema,
  peopleResponseSchema,
  personViewSchema,
  scopeBodySchema,
} from "../../../schemas/comparison";

const tags = ["Comparison"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
});
const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { "application/json": { schema } } });
const gate = err("`COMPARISON_TOKEN_REFUSED`: a personal access token; `COMPARISON_DISABLED`: beta switch off");
const idParam = z.object({ id: z.string().uuid() });
const notFound = err("`COMPARISON_NOT_FOUND`: no such comparison of the caller");

registry.registerPath({
  method: "get",
  path: "/comparison/leaderboard",
  summary: "The caller's leaderboard: own totals and every consented friend's",
  description:
    "Same-instance friends are read under their consent; friends on other servers are pulled over the signed peer link. A row whose totals are unavailable carries a status instead of numbers.",
  tags,
  request: {
    query: z.object({
      year: z.string().optional().describe("A year (1900-2200) or `all` (default) for the lifetime view"),
      board: z.string().uuid().optional().describe("Restrict the rows to one of the caller's groups"),
    }),
  },
  responses: {
    200: ok("The rows, the caller first", leaderboardResponseSchema),
    403: gate,
    404: err("`COMPARISON_BOARD_NOT_FOUND`: no such group of the caller"),
  },
});

registry.registerPath({
  method: "post",
  path: "/comparison/preview",
  summary: "The caller's own totals under a consent scope — what the consent dialog shows",
  tags,
  request: { body: json(leaderboardScopeSchema) },
  responses: { 200: ok("Exactly what that scope would share", leaderboardSnapshotSchema), 403: gate },
});

registry.registerPath({
  method: "get",
  path: "/comparison/people",
  summary: "Requests waiting for the caller, the people the caller compares with, and the caller's groups",
  tags,
  responses: { 200: ok("People, requests and groups", peopleResponseSchema), 403: gate },
});

registry.registerPath({
  method: "post",
  path: "/comparison/requests",
  summary: "Share the caller's totals with an account on this server and ask for theirs",
  description: "Limited to 30 requests an hour. A declined or ended pair may be asked again.",
  tags,
  request: { body: json(consentRequestBodySchema) },
  responses: {
    201: ok("The person, as the caller now sees them", personViewSchema),
    400: err("`COMPARISON_SELF`: the caller's own username; or invalid input"),
    403: gate,
    404: err("`COMPARISON_USER_NOT_FOUND`: no active account of that name"),
    409: err("`COMPARISON_DUPLICATE`: the caller already shares with that person"),
  },
});

for (const action of ["accept", "decline"] as const) {
  registry.registerPath({
    method: "post",
    path: `/comparison/consents/{id}/${action}`,
    summary: action === "accept" ? "Let the asking person see the caller's totals" : "Decline a request",
    tags,
    request: action === "accept" ? { params: idParam, body: json(scopeBodySchema) } : { params: idParam },
    responses: {
      200:
        action === "accept"
          ? ok("The person", personViewSchema)
          : ok("Declined", z.object({ declined: z.literal(true) })),
      403: gate,
      404: notFound,
      409: err("`COMPARISON_NOT_PENDING`: already answered"),
    },
  });
}

registry.registerPath({
  method: "put",
  path: "/comparison/consents/{id}",
  summary: "Change what an accepted consent shares",
  tags,
  request: { params: idParam, body: json(scopeBodySchema) },
  responses: { 200: ok("The person", personViewSchema), 403: gate, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/comparison/people/{key}",
  summary: "End the comparison with a person, in both directions",
  tags,
  request: { params: z.object({ key: z.string().describe("`local:<userId>` or `remote:<id>`") }) },
  responses: { 200: ok("Ended", z.object({ ended: z.literal(true) })), 403: gate, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/comparison/invites",
  summary: "Create a single-use invitation code for a person on another server (72 h)",
  tags,
  responses: {
    201: ok("The code to pass on", inviteResponseSchema),
    403: gate,
    409: err("`COMPARISON_FEDERATION_OFF`: this server is not connected to other servers"),
    429: err("`COMPARISON_INVITE_LIMIT`: 20 open invitations"),
  },
});

registry.registerPath({
  method: "post",
  path: "/comparison/invites/claim",
  summary: "Redeem an invitation from another server, sharing the caller's totals under a scope",
  tags,
  request: { body: json(claimBodySchema) },
  responses: {
    201: ok("The remote person", personViewSchema),
    400: err("`COMPARISON_INVITE_INVALID`: malformed, unknown, used or expired code"),
    403: err("`COMPARISON_PEER_UNKNOWN`: the admin has not connected that server; or the session gate"),
    409: err("`COMPARISON_PEER_OUTDATED`: that server needs an update; `COMPARISON_FEDERATION_OFF`"),
    502: err("`COMPARISON_PEER_UNREACHABLE`: that server does not answer"),
  },
});

registry.registerPath({
  method: "post",
  path: "/comparison/boards",
  summary: "Create a group of people the caller can see",
  tags,
  request: { body: json(boardBodySchema) },
  responses: {
    201: ok("The group", boardViewSchema),
    400: err("`COMPARISON_BOARD_MEMBER_INVALID`: a member whose totals the caller cannot see"),
    403: gate,
  },
});

registry.registerPath({
  method: "put",
  path: "/comparison/boards/{id}",
  summary: "Rename a group or change its members",
  tags,
  request: { params: idParam, body: json(boardBodySchema) },
  responses: {
    200: ok("The group", boardViewSchema),
    400: err("`COMPARISON_BOARD_MEMBER_INVALID`"),
    403: gate,
    404: err("`COMPARISON_BOARD_NOT_FOUND`"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/comparison/boards/{id}",
  summary: "Delete a group",
  tags,
  request: { params: idParam },
  responses: {
    200: ok("Deleted", z.object({ deleted: z.literal(true) })),
    403: gate,
    404: err("`COMPARISON_BOARD_NOT_FOUND`"),
  },
});
```
`backend/src/services/openapi/paths/index.ts`: add `import "./comparison";` in alphabetical position. `apiResponseShape.baseline.json`: add `"comparison.ts"` to `enveloped` (sorted).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/routes/__tests__/comparison.routes.test.ts src/routes/__tests__/encryptedShare.mount.test.ts src/__tests__/openapi.coverage.test.ts src/__tests__/openapi.responseSchema.test.ts src/__tests__/openapi.test.ts src/__tests__/apiResponseShape.ratchet.test.ts src/__tests__/apiNoStore.test.ts`
Expected: PASS. (`openapi.coverage` failed before the paths file existed — "documents every endpoint in scope" listed the 13 routes.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/comparison.ts backend/src/routes/__tests__/comparison.routes.test.ts backend/src/middleware/rateLimit.ts backend/src/routes/mounts.ts backend/src/services/openapi backend/src/__tests__/apiResponseShape.baseline.json
git commit -m "feat(comparison): documented leaderboard API with per-user limits and named refusals

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 15: A restored backup asks again instead of reviving consents

**Files:**
- Modify: `backend/src/services/federation/restore.ts`
- Create: `backend/src/services/federation/__tests__/restore.test.ts`

**Interfaces:** Consumes: `suspendComparisonAfterRestore()` (unchanged signature). Produces: after it runs, every `LeaderboardConsent` with `status = "accepted"` is `pending` with `decidedAt = null`, and `LeaderboardInvite` is empty.

- [ ] **Step 1: Write the failing test**

`backend/src/services/federation/__tests__/restore.test.ts`:
```ts
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { suspendComparisonAfterRestore } from "../restore";

const users: string[] = [];
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("turns accepted leaderboard consents back into questions and voids invitations", async () => {
  const [a, b] = await Promise.all(
    [0, 1].map(async () => {
      const u = await prisma.user.create({ data: { username: `lb-rs-${randomUUID().slice(0, 8)}`, passwordHash: "x" } });
      users.push(u.id);
      return u.id;
    })
  );
  await prisma.leaderboardConsent.create({
    data: { ownerId: a, viewerId: b, status: "accepted", scope: { groups: ["trips"], domains: ["flight"], year: null }, decidedAt: new Date() },
  });
  await prisma.leaderboardInvite.create({ data: { hash: randomUUID(), userId: a, expiresAt: new Date(Date.now() + 60_000) } });
  await suspendComparisonAfterRestore();
  expect(await prisma.leaderboardConsent.findFirst({ where: { ownerId: a } })).toMatchObject({
    status: "pending",
    decidedAt: null,
  });
  expect(await prisma.leaderboardInvite.count({ where: { userId: a } })).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://fix:fixpw@localhost:5440/fix_comparison_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit src/services/federation/__tests__/restore.test.ts`
Expected: FAIL — `status: "accepted"` received where `"pending"` expected.

- [ ] **Step 3: Write minimal implementation**

`backend/src/services/federation/restore.ts`:
```ts
import { prisma } from "../../db";
/**
 * Restoring an older consent must never restore a permission that has since been revoked.
 * E2E permissions are revoked outright; a leaderboard consent goes back to "pending", so its
 * owner confirms it again in one dialog instead of losing the friendship (spec §7.4).
 */
export async function suspendComparisonAfterRestore(): Promise<void> {
  await prisma.$transaction([
    prisma.comparisonDevice.updateMany({ data: { revoked: true } }),
    prisma.comparisonPublication.deleteMany(),
    prisma.comparisonGrant.updateMany({ data: { active: false, revision: { increment: 1 } } }),
    prisma.comparisonLink.updateMany({ data: { revoked: true } }),
    prisma.comparisonPeer.updateMany({ data: { enabled: false, verifiedAt: null } }),
    prisma.comparisonInvite.updateMany({ where: { usedAt: null }, data: { usedAt: new Date() } }),
    prisma.leaderboardConsent.updateMany({
      where: { status: "accepted" },
      data: { status: "pending", decidedAt: null },
    }),
    prisma.leaderboardInvite.deleteMany(),
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/federation/restore.ts backend/src/services/federation/__tests__/restore.test.ts
git commit -m "fix(comparison): a restored backup re-asks leaderboard consents instead of reviving them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---
### Task 16: Move the E2E frontend to `encryptedShare` (behaviour unchanged, still on `/compare`)

**Files:**
- Move (git mv): `frontend/src/components/comparison` → `frontend/src/components/encryptedShare`; `frontend/src/lib/comparison` → `frontend/src/lib/encryptedShare`; `frontend/src/lib/api/comparison.ts` → `frontend/src/lib/api/encryptedShare.ts`; `frontend/src/i18n/resources/{de,en}/comparison.json` → `encryptedShare.json`; `components/encryptedShare/comparison.css` → `components/encryptedShare/encryptedShare.css`
- Create: `frontend/src/i18n/resources/de/comparison.json`, `frontend/src/i18n/resources/en/comparison.json` (title only, filled in Task 17), `frontend/src/components/comparison/__tests__/separation.test.ts` (it moves with the directory to `components/encryptedShare/__tests__/separation.test.ts` in Step 3)
- Modify: `frontend/src/i18n/config.ts` (imports lines 1-2, resources ~161/207), `frontend/src/pages/ComparisonPage.tsx`, every moved file's imports (sed below)

**Interfaces:** Produces: `encryptedShareGet<T>(path)`, `encryptedSharePost<T>(path, body?)`, `encryptedShareDelete(path)` in `lib/api/encryptedShare.ts` (renamed from `comparisonGet/Post/Delete`); i18n namespace `encryptedShare`; CSS class `encrypted-share-surface`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/comparison/__tests__/separation.test.ts` (written into the E2E directory that Step 3 renames, so it ends up at `components/encryptedShare/__tests__/`):
```ts
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import i18n from "../../../i18n/config";

const SRC = path.join(__dirname, "..", "..", "..");

function sources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("the encrypted share stands apart from the leaderboard", () => {
  it("speaks its own namespace in both languages", () => {
    expect(i18n.hasResourceBundle("de", "encryptedShare")).toBe(true);
    expect(i18n.hasResourceBundle("en", "encryptedShare")).toBe(true);
  });

  it("is never imported by the leaderboard", () => {
    const leaderboard = [
      ...sources(path.join(SRC, "components", "comparison")),
      ...sources(path.join(SRC, "lib", "comparison")),
      path.join(SRC, "lib", "api", "comparison.ts"),
    ].filter((file) => fs.existsSync(file));
    const offenders = leaderboard.filter((file) => /encryptedShare/.test(fs.readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/comparison/__tests__/separation.test.ts`
Expected: FAIL — `expected false to be true` for `hasResourceBundle("de", "encryptedShare")`.

- [ ] **Step 3: Write minimal implementation**

```bash
cd frontend/src
git add components/comparison/__tests__/separation.test.ts
git mv components/comparison components/encryptedShare
git mv components/encryptedShare/comparison.css components/encryptedShare/encryptedShare.css
git mv lib/comparison lib/encryptedShare
git mv lib/api/comparison.ts lib/api/encryptedShare.ts
git mv i18n/resources/de/comparison.json i18n/resources/de/encryptedShare.json
git mv i18n/resources/en/comparison.json i18n/resources/en/encryptedShare.json
grep -rl -e "comparison" components/encryptedShare lib/encryptedShare lib/api/encryptedShare.ts pages/ComparisonPage.tsx \
  | xargs sed -i \
    -e 's#api/comparison"#api/encryptedShare"#g' \
    -e 's#lib/comparison/#lib/encryptedShare/#g' \
    -e 's#components/comparison/#components/encryptedShare/#g' \
    -e 's#useTranslation("comparison")#useTranslation("encryptedShare")#g' \
    -e 's#comparisonGet#encryptedShareGet#g' \
    -e 's#comparisonPost#encryptedSharePost#g' \
    -e 's#comparisonDelete#encryptedShareDelete#g' \
    -e 's#comparison-surface#encrypted-share-surface#g' \
    -e 's#comparison\.css#encryptedShare.css#g'
grep -rn '"comparison\|comparison:' components/encryptedShare lib/encryptedShare lib/api/encryptedShare.ts
```
The last `grep` must print nothing but protocol literals such as `travstats-comparison-1` (the E2E wire format keeps its name). In `lib/api/encryptedShare.ts`, rename the helpers' doc comment to "The E2E transfer's own API (moved from /comparison, 2026-10-16)."

`frontend/src/i18n/config.ts` — replace lines 1-2 and add the new namespace:
```ts
import enComparison from "./resources/en/comparison.json";
import deComparison from "./resources/de/comparison.json";
import enEncryptedShare from "./resources/en/encryptedShare.json";
import deEncryptedShare from "./resources/de/encryptedShare.json";
```
and next to `comparison: enComparison,` / `comparison: deComparison,`:
```ts
    encryptedShare: enEncryptedShare,
```
```ts
    encryptedShare: deEncryptedShare,
```

`frontend/src/i18n/resources/de/comparison.json`:
```json
{
  "title": "Vergleich mit Freunden"
}
```
`frontend/src/i18n/resources/en/comparison.json`:
```json
{
  "title": "Compare with friends"
}
```

`frontend/src/pages/ComparisonPage.tsx` after the sed reads:
```tsx
import "../components/encryptedShare/encryptedShare.css";
import { Navigate } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import { useAuthStore } from "../store/authStore";
import SealedWorkspace from "../components/encryptedShare/SealedWorkspace";
```
(body unchanged — `/compare` still shows the E2E workspace until Task 22).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/encryptedShare src/i18n/__tests__/localeKeyParity.test.ts src/components/Nav && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/components/encryptedShare frontend/src/components/comparison frontend/src/lib/encryptedShare frontend/src/lib/comparison frontend/src/lib/api/encryptedShare.ts frontend/src/lib/api/comparison.ts frontend/src/i18n frontend/src/pages/ComparisonPage.tsx
git commit -m "refactor(encrypted-share): move the device-encrypted transfer's UI under its own name

Behaviour unchanged; the leaderboard that replaces /compare is built beside it and must never
import it (guarded).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 17: Leaderboard client — types, API, ranking, formatting, copy

**Files:**
- Create: `frontend/src/lib/comparison/types.ts`, `frontend/src/lib/api/comparison.ts`, `frontend/src/lib/comparison/ranking.ts`, `frontend/src/lib/comparison/formatMetric.ts`, `frontend/src/lib/comparison/years.ts`, `frontend/src/lib/comparison/__tests__/ranking.test.ts`, `frontend/src/lib/comparison/__tests__/formatMetric.test.ts`
- Modify: `frontend/src/i18n/resources/de/comparison.json`, `frontend/src/i18n/resources/en/comparison.json` (full copy)

**Interfaces:**
Produces:
```ts
// types.ts
export interface LeaderboardScope { groups: MetricGroup[]; domains: DomainKey[]; year: number | null }
export interface LeaderboardSnapshot { schema: "travstats-leaderboard"; version: 1; asOf: string; year: number | null; domains: string[]; metrics: Record<string, number | null>; partial: string[] }
export interface Person { key: string; kind: "self" | "local" | "remote"; username: string; displayName: string; origin: string | null }
export type RowStatus = "ok" | "notShared" | "yearNotShared" | "withdrawn" | "unreachable" | "outdated" | "federationOff";
export type ConsentStatus = "pending" | "accepted" | "declined" | "withdrawn";
export interface LeaderboardRow { person: Person; status: RowStatus; snapshot: LeaderboardSnapshot | null; sharedYear: number | null }
export interface LeaderboardResponse { year: number | null; rows: LeaderboardRow[] }
export interface PersonView { person: Person; mine: { consentId: string; status: ConsentStatus; scope: LeaderboardScope | null } | null; theirs: { status: ConsentStatus } | null }
export interface RequestView { consentId: string; person: Person; createdAt: string }
export interface BoardView { id: string; name: string; members: string[] }
export interface PeopleResponse { requests: RequestView[]; people: PersonView[]; boards: BoardView[] }
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];
// api/comparison.ts
export const comparisonApi: { leaderboard(year, board?), preview(scope), people(), request(username, scope), accept(consentId, scope), decline(consentId), updateScope(consentId, scope), end(key), createInvite(), claimInvite(code, scope), saveBoard(input, id?), deleteBoard(id) };
export type ComparisonFailureCode; export function comparisonFailureCode(error: unknown): ComparisonFailureCode;
// ranking.ts
export type UnrankedReason = Exclude<RowStatus, "ok"> | "metricNotShared" | "unknown" | "otherYear" | "notComparable";
export interface RankedEntry { row: LeaderboardRow; value: number | null; rank: number | null; partial: boolean; reason: UnrankedReason | null }
export function rankPeople(rows: readonly LeaderboardRow[], metric: MetricKey, year: number | null): RankedEntry[];
// formatMetric.ts
export type Translate = (key: string, options?: Record<string, unknown>) => string;
export function formatMetricValue(value: number, unit: MetricUnit, ctx: { distanceUnit: DistanceUnit; t: Translate; language: string }): string;
// years.ts
export function recentYears(now?: Date, count?: number): number[];
```

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/comparison/__tests__/ranking.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { rankPeople } from "../ranking";
import type { LeaderboardRow, RowStatus } from "../types";

function row(
  key: string,
  metrics: Record<string, number | null>,
  extra: { year?: number | null; domains?: string[]; partial?: string[] } = {},
  status: RowStatus = "ok"
): LeaderboardRow {
  return {
    person: { key, kind: key === "self" ? "self" : "local", username: key, displayName: key, origin: null },
    status,
    sharedYear: null,
    snapshot:
      status === "ok"
        ? {
            schema: "travstats-leaderboard",
            version: 1,
            asOf: "2026-10-16T00:00:00.000Z",
            year: extra.year === undefined ? 2025 : extra.year,
            domains: extra.domains ?? ["flight"],
            metrics,
            partial: extra.partial ?? [],
          }
        : null,
  };
}

describe("rankPeople", () => {
  it("shares ranks on ties and never turns a missing value into zero", () => {
    const ranked = rankPeople(
      [row("self", { flights: 10 }), row("b", { flights: 10 }), row("c", { flights: 5 }), row("d", { flights: null })],
      "flights",
      2025
    );
    expect(ranked.map((e) => [e.row.person.key, e.rank])).toEqual([
      ["b", 1],
      ["self", 1],
      ["c", 3],
      ["d", null],
    ]);
    expect(ranked[3].reason).toBe("unknown");
  });

  it("ranks only the requested year and says why a row is unranked", () => {
    const ranked = rankPeople(
      [
        row("self", { flights: 1 }),
        row("old", { flights: 9 }, { year: 2024 }),
        row("quiet", {}),
        row("away", {}, {}, "unreachable"),
      ],
      "flights",
      2025
    );
    const why = Object.fromEntries(ranked.map((e) => [e.row.person.key, e.reason]));
    expect(why).toEqual({ self: null, old: "otherYear", quiet: "metricNotShared", away: "unreachable" });
  });

  it("compares cross-domain figures only between equal domain sets", () => {
    const ranked = rankPeople(
      [row("self", { daysAway: 40 }), row("rail", { daysAway: 90 }, { domains: ["flight", "rail"] })],
      "daysAway",
      2025
    );
    expect(ranked.find((e) => e.row.person.key === "rail")?.reason).toBe("notComparable");
  });

  it("ranks a lower bound and marks it partial", () => {
    const [first] = rankPeople([row("self", { railKm: 10 }), row("b", { railKm: 50 }, { partial: ["railKm"] })], "railKm", 2025);
    expect(first).toMatchObject({ rank: 1, partial: true, value: 50 });
  });
});
```

`frontend/src/lib/comparison/__tests__/formatMetric.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatMetricValue } from "../formatMetric";
import { recentYears } from "../years";

const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key);

describe("formatMetricValue", () => {
  it("prints distances in the reader's unit", () => {
    expect(formatMetricValue(1609.344, "km", { distanceUnit: "miles", t, language: "en" })).toBe(
      "1,000 stats:distance.miles"
    );
  });
  it("prints flight time as a duration and counts in the reader's language", () => {
    const ctx = { distanceUnit: "kilometers" as const, t, language: "de" };
    expect(formatMetricValue(125, "minutes", ctx)).toBe("2h 5min");
    expect(formatMetricValue(12345, "count", ctx)).toBe("12.345");
    expect(formatMetricValue(3, "nights", ctx)).toBe('comparison:unit.nights:{"count":3,"value":"3"}');
  });
});

describe("recentYears", () => {
  it("counts back from this year", () => {
    expect(recentYears(new Date("2026-10-16T12:00:00Z"), 3)).toEqual([2026, 2025, 2024]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/lib/comparison/__tests__`
Expected: FAIL — `Failed to resolve import "../ranking"` / `"../formatMetric"`.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/lib/comparison/types.ts`:
```ts
/** Wire types of /api/v1/comparison — the frontend mirror of backend/src/schemas/comparison.ts. */
import type { DomainKey } from "../../shared/domains";
import type { LEADERBOARD_METRICS, MetricGroup } from "../../shared/comparisonMetrics";

export interface LeaderboardScope {
  groups: MetricGroup[];
  domains: DomainKey[];
  year: number | null;
}
export interface LeaderboardSnapshot {
  schema: "travstats-leaderboard";
  version: 1;
  asOf: string;
  year: number | null;
  domains: string[];
  /** Absent = not shared; null = shared but not derivable. Unknown keys are ignored. */
  metrics: Record<string, number | null>;
  partial: string[];
}
export interface Person {
  key: string;
  kind: "self" | "local" | "remote";
  username: string;
  displayName: string;
  origin: string | null;
}
export type RowStatus =
  | "ok"
  | "notShared"
  | "yearNotShared"
  | "withdrawn"
  | "unreachable"
  | "outdated"
  | "federationOff";
export type ConsentStatus = "pending" | "accepted" | "declined" | "withdrawn";
export interface LeaderboardRow {
  person: Person;
  status: RowStatus;
  snapshot: LeaderboardSnapshot | null;
  sharedYear: number | null;
}
export interface LeaderboardResponse {
  year: number | null;
  rows: LeaderboardRow[];
}
export interface PersonView {
  person: Person;
  mine: { consentId: string; status: ConsentStatus; scope: LeaderboardScope | null } | null;
  theirs: { status: ConsentStatus } | null;
}
export interface RequestView {
  consentId: string;
  person: Person;
  createdAt: string;
}
export interface BoardView {
  id: string;
  name: string;
  members: string[];
}
export interface PeopleResponse {
  requests: RequestView[];
  people: PersonView[];
  boards: BoardView[];
}
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];
```

`frontend/src/lib/api/comparison.ts`:
```ts
import { isAxiosError } from "axios";
import { api } from "./client";
import type {
  BoardView,
  LeaderboardResponse,
  LeaderboardScope,
  LeaderboardSnapshot,
  PeopleResponse,
  PersonView,
} from "../comparison/types";

const BASE = "/comparison";
type Envelope<T> = { success: true; data: T };

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  return (await api.get<Envelope<T>>(`${BASE}${path}`, { params })).data.data;
}
async function post<T>(path: string, body: unknown = {}): Promise<T> {
  return (await api.post<Envelope<T>>(`${BASE}${path}`, body)).data.data;
}
async function put<T>(path: string, body: unknown): Promise<T> {
  return (await api.put<Envelope<T>>(`${BASE}${path}`, body)).data.data;
}
async function del<T>(path: string): Promise<T> {
  return (await api.delete<Envelope<T>>(`${BASE}${path}`)).data.data;
}

export const comparisonApi = {
  leaderboard: (year: number | null, board?: string) =>
    get<LeaderboardResponse>("/leaderboard", { year: year === null ? "all" : String(year), ...(board ? { board } : {}) }),
  preview: (scope: LeaderboardScope) => post<LeaderboardSnapshot>("/preview", scope),
  people: () => get<PeopleResponse>("/people"),
  request: (username: string, scope: LeaderboardScope) => post<PersonView>("/requests", { username, scope }),
  accept: (consentId: string, scope: LeaderboardScope) => post<PersonView>(`/consents/${consentId}/accept`, { scope }),
  decline: (consentId: string) => post<{ declined: true }>(`/consents/${consentId}/decline`),
  updateScope: (consentId: string, scope: LeaderboardScope) => put<PersonView>(`/consents/${consentId}`, { scope }),
  end: (key: string) => del<{ ended: true }>(`/people/${encodeURIComponent(key)}`),
  createInvite: () => post<{ code: string; expiresAt: string }>("/invites"),
  claimInvite: (code: string, scope: LeaderboardScope) => post<PersonView>("/invites/claim", { code, scope }),
  saveBoard: (input: { name: string; members: string[] }, id?: string) =>
    id ? put<BoardView>(`/boards/${id}`, input) : post<BoardView>("/boards", input),
  deleteBoard: (id: string) => del<{ deleted: true }>(`/boards/${id}`),
};

/** The codes the page has words for (`comparison:error.*`); anything else is "unknown". */
const KNOWN_CODES = [
  "COMPARISON_USER_NOT_FOUND",
  "COMPARISON_SELF",
  "COMPARISON_DUPLICATE",
  "COMPARISON_INVITE_INVALID",
  "COMPARISON_INVITE_LIMIT",
  "COMPARISON_FEDERATION_OFF",
  "COMPARISON_PEER_UNKNOWN",
  "COMPARISON_PEER_UNREACHABLE",
  "COMPARISON_PEER_OUTDATED",
] as const;
export type ComparisonFailureCode = (typeof KNOWN_CODES)[number] | "unknown";

export function comparisonFailureCode(error: unknown): ComparisonFailureCode {
  if (!isAxiosError(error)) return "unknown";
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && (KNOWN_CODES as readonly string[]).includes(code)
    ? (code as ComparisonFailureCode)
    : "unknown";
}
```

`frontend/src/lib/comparison/ranking.ts`:
```ts
/**
 * Like-for-like ranking (spec §8). A value ranks only when the row answered, for the year asked,
 * with a number; cross-domain figures only between equal domain sets. Withheld or unknown never
 * becomes 0. A lower bound ranks — it is true as far as it goes — and is marked partial.
 */
import { LEADERBOARD_METRICS, type MetricKey } from "../../shared/comparisonMetrics";
import type { LeaderboardRow, RowStatus } from "./types";

export type UnrankedReason =
  | Exclude<RowStatus, "ok">
  | "metricNotShared"
  | "unknown"
  | "otherYear"
  | "notComparable";

export interface RankedEntry {
  row: LeaderboardRow;
  value: number | null;
  rank: number | null;
  partial: boolean;
  reason: UnrankedReason | null;
}

const CROSS_DOMAIN: ReadonlySet<string> = new Set(
  LEADERBOARD_METRICS.filter((m) => m.domain === null).map((m) => m.key)
);
const domainSet = (domains: readonly string[]) => [...domains].sort().join(",");

function judge(
  row: LeaderboardRow,
  metric: MetricKey,
  year: number | null,
  selfDomains: string | null
): { value: number | null; reason: UnrankedReason | null } {
  if (row.status !== "ok") return { value: null, reason: row.status };
  const snapshot = row.snapshot;
  if (!snapshot) return { value: null, reason: "unknown" };
  if (snapshot.year !== year) return { value: null, reason: "otherYear" };
  if (!Object.prototype.hasOwnProperty.call(snapshot.metrics, metric))
    return { value: null, reason: "metricNotShared" };
  const value = snapshot.metrics[metric];
  if (typeof value !== "number") return { value: null, reason: "unknown" };
  if (CROSS_DOMAIN.has(metric) && selfDomains !== null && domainSet(snapshot.domains) !== selfDomains)
    return { value: null, reason: "notComparable" };
  return { value, reason: null };
}

export function rankPeople(
  rows: readonly LeaderboardRow[],
  metric: MetricKey,
  year: number | null
): RankedEntry[] {
  const self = rows.find((r) => r.person.kind === "self");
  const selfDomains = self?.snapshot ? domainSet(self.snapshot.domains) : null;
  const entries = rows.map((row) => ({
    row,
    ...judge(row, metric, year, selfDomains),
    partial: row.snapshot?.partial.includes(metric) ?? false,
  }));
  const sorted = [...entries].sort((a, b) => {
    if (a.value === null || b.value === null) {
      if (a.value !== null) return -1;
      if (b.value !== null) return 1;
      return a.row.person.displayName.localeCompare(b.row.person.displayName);
    }
    return b.value - a.value || a.row.person.displayName.localeCompare(b.row.person.displayName);
  });
  let last: number | null = null;
  let rank = 0;
  return sorted.map((entry, index) => {
    if (entry.value !== null && entry.value !== last) rank = index + 1;
    if (entry.value !== null) last = entry.value;
    return { ...entry, rank: entry.value === null ? null : rank };
  });
}
```

`frontend/src/lib/comparison/formatMetric.ts`:
```ts
import { formatDistance, formatNumber, type DistanceUnit } from "../units";
import { formatDuration } from "../formatters";
import type { MetricUnit } from "../../shared/comparisonMetrics";

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One leaderboard value as the statistics pages print it: the reader's unit and language. */
export function formatMetricValue(
  value: number,
  unit: MetricUnit,
  ctx: { distanceUnit: DistanceUnit; t: Translate; language: string }
): string {
  const whole = formatNumber(value, { maximumFractionDigits: 0 }, ctx.language);
  switch (unit) {
    case "km":
      return formatDistance(value, ctx.distanceUnit, ctx.t, ctx.language);
    case "minutes":
      return formatDuration(value);
    case "days":
      return ctx.t("comparison:unit.days", { count: value, value: whole });
    case "nights":
      return ctx.t("comparison:unit.nights", { count: value, value: whole });
    case "count":
      return whole;
  }
}
```

`frontend/src/lib/comparison/years.ts`:
```ts
/** The years a period picker offers: this one and the ones before it. */
export function recentYears(now: Date = new Date(), count = 15): number[] {
  const year = now.getFullYear();
  return Array.from({ length: count }, (_, i) => year - i);
}
```

`frontend/src/i18n/resources/de/comparison.json`:
```json
{
  "title": "Vergleich mit Freunden",
  "subtitle": "Nur Summen, nie einzelne Reisen",
  "you": "Du",
  "addPerson": "Person hinzufügen",
  "loadFailed": "Der Vergleich konnte nicht geladen werden.",
  "period": { "label": "Zeitraum", "all": "Gesamt" },
  "board": { "label": "Gruppe", "all": "Alle Personen" },
  "group": { "label": "Kennzahlen", "distance": "Strecke", "trips": "Reisen", "time": "Zeit", "places": "Orte" },
  "metric": {
    "flightKm": "Flugstrecke",
    "cruiseKm": "Kreuzfahrt-Strecke",
    "railKm": "Bahnstrecke",
    "busKm": "Busstrecke",
    "rentalKm": "Mietwagen-Strecke",
    "ferryKm": "Fährstrecke",
    "tourKm": "Touren-Strecke",
    "flights": "Flüge",
    "cruises": "Kreuzfahrten",
    "stays": "Unterkünfte",
    "railRides": "Bahnfahrten",
    "busRides": "Busfahrten",
    "rentals": "Mietwagen",
    "ferryCrossings": "Fährfahrten",
    "tours": "Touren",
    "placeVisits": "Ortsbesuche",
    "flightMinutes": "Flugzeit",
    "nights": "Übernachtungen",
    "rentalDays": "Miettage",
    "daysAway": "Tage unterwegs",
    "countries": "Länder",
    "cruisePorts": "Häfen",
    "places": "Orte"
  },
  "unit": {
    "days_one": "{{value}} Tag",
    "days_other": "{{value}} Tage",
    "nights_one": "{{value}} Nacht",
    "nights_other": "{{value}} Nächte"
  },
  "tile": {
    "ranking": "Rangliste: {{metric}}",
    "partialHint": "„≥“ heißt mindestens: nicht jede Fahrt hat eine Strecke."
  },
  "status": {
    "notShared": "teilt das (noch) nicht",
    "metricNotShared": "teilt diese Zahl nicht",
    "yearNotShared": "teilt nur {{year}}",
    "withdrawn": "hat das Teilen beendet",
    "unreachable": "gerade nicht erreichbar",
    "outdated": "Server muss aktualisiert werden",
    "federationOff": "dein Server ist nicht mit anderen verbunden",
    "unknown": "unbekannt",
    "otherYear": "anderer Zeitraum",
    "notComparable": "nicht vergleichbar (andere Bereiche)"
  },
  "empty": {
    "title": "Noch niemand zum Vergleichen",
    "description": "Lade jemanden ein – ihr seht dann gegenseitig eure Summen."
  },
  "consent": {
    "title": "{{name}} sieht diese Zahlen",
    "share": "Teilen",
    "domains": "Bereiche",
    "period": "Zeitraum",
    "allYears": "Alle Jahre",
    "onlyYear": "Nur {{year}}",
    "preview": "Das wird geteilt",
    "nothingChosen": "Wähle mindestens eine Kennzahl und einen Bereich.",
    "previewFailed": "Die Vorschau konnte nicht geladen werden.",
    "finePrint": "Nur Summen – keine Reisen, Orte, Daten oder Kosten. Du kannst das jederzeit ändern oder beenden.",
    "remoteNotice": "Die Zahlen gehen an den Server {{origin}}. Wer diesen Server betreibt, kann sie lesen."
  },
  "requests": {
    "title": "Anfragen",
    "asks": "{{name}} möchte deine Zahlen sehen",
    "accept": "Annehmen",
    "decline": "Ablehnen"
  },
  "people": {
    "title": "Personen",
    "name": "Name",
    "server": "Server",
    "sees": "Sieht von dir",
    "shares": "Teilt mit dir",
    "thisServer": "dieser Server",
    "sharing": "ja",
    "notSharing": "nichts",
    "waiting": "wartet auf Antwort",
    "change": "Ändern",
    "end": "Beenden",
    "endConfirm": "Vergleich beenden",
    "endTitle": "Vergleich mit {{name}} beenden?",
    "endBody": "Ihr seht dann gegenseitig keine Zahlen mehr.",
    "remoteFriend": "Person auf einem anderen Server"
  },
  "add": {
    "title": "Person hinzufügen",
    "username": "Benutzername auf diesem Server",
    "ask": "Anfragen",
    "inviteTitle": "Person auf einem anderen Server",
    "createInvite": "Einladungscode erstellen",
    "inviteHint": "Gib diesen Code weiter. Er gilt 72 Stunden und nur einmal.",
    "claimLabel": "Einladungscode",
    "claim": "Code einlösen"
  },
  "boards": {
    "title": "Gruppen",
    "create": "Gruppe anlegen",
    "name": "Name",
    "members": "Personen",
    "save": "Speichern",
    "delete": "Löschen",
    "empty": "Noch keine Gruppen."
  },
  "error": {
    "COMPARISON_USER_NOT_FOUND": "Diesen Benutzernamen gibt es auf diesem Server nicht.",
    "COMPARISON_SELF": "Mit dir selbst kannst du dich nicht vergleichen.",
    "COMPARISON_DUPLICATE": "Du teilst deine Zahlen schon mit dieser Person.",
    "COMPARISON_INVITE_INVALID": "Dieser Code ist ungültig, abgelaufen oder schon benutzt.",
    "COMPARISON_INVITE_LIMIT": "Du hast zu viele offene Einladungen.",
    "COMPARISON_FEDERATION_OFF": "Dein Server ist nicht mit anderen Servern verbunden. Frag deinen Admin.",
    "COMPARISON_PEER_UNKNOWN": "Dein Admin hat diesen Server noch nicht verbunden.",
    "COMPARISON_PEER_UNREACHABLE": "Der andere Server antwortet gerade nicht.",
    "COMPARISON_PEER_OUTDATED": "Der andere Server muss aktualisiert werden.",
    "unknown": "Das hat nicht geklappt. Versuch es noch einmal."
  }
}
```

`frontend/src/i18n/resources/en/comparison.json`:
```json
{
  "title": "Compare with friends",
  "subtitle": "Totals only, never single trips",
  "you": "You",
  "addPerson": "Add person",
  "loadFailed": "The comparison could not be loaded.",
  "period": { "label": "Period", "all": "All time" },
  "board": { "label": "Group", "all": "Everyone" },
  "group": { "label": "Figures", "distance": "Distance", "trips": "Trips", "time": "Time", "places": "Places" },
  "metric": {
    "flightKm": "Flight distance",
    "cruiseKm": "Cruise distance",
    "railKm": "Rail distance",
    "busKm": "Bus distance",
    "rentalKm": "Rental car distance",
    "ferryKm": "Ferry distance",
    "tourKm": "Tour distance",
    "flights": "Flights",
    "cruises": "Cruises",
    "stays": "Stays",
    "railRides": "Train rides",
    "busRides": "Bus rides",
    "rentals": "Rental cars",
    "ferryCrossings": "Ferry crossings",
    "tours": "Tours",
    "placeVisits": "Place visits",
    "flightMinutes": "Time in the air",
    "nights": "Nights",
    "rentalDays": "Rental days",
    "daysAway": "Days away",
    "countries": "Countries",
    "cruisePorts": "Ports",
    "places": "Places"
  },
  "unit": {
    "days_one": "{{value}} day",
    "days_other": "{{value}} days",
    "nights_one": "{{value}} night",
    "nights_other": "{{value}} nights"
  },
  "tile": {
    "ranking": "Ranking: {{metric}}",
    "partialHint": "“≥” means at least: not every ride has a distance."
  },
  "status": {
    "notShared": "not shared (yet)",
    "metricNotShared": "does not share this figure",
    "yearNotShared": "shares {{year}} only",
    "withdrawn": "stopped sharing",
    "unreachable": "not reachable right now",
    "outdated": "server needs an update",
    "federationOff": "your server is not connected to others",
    "unknown": "unknown",
    "otherYear": "different period",
    "notComparable": "not comparable (different areas)"
  },
  "empty": {
    "title": "Nobody to compare with yet",
    "description": "Invite someone — you will then see each other's totals."
  },
  "consent": {
    "title": "{{name}} sees these numbers",
    "share": "Share",
    "domains": "Areas",
    "period": "Period",
    "allYears": "All years",
    "onlyYear": "Only {{year}}",
    "preview": "This is what will be shared",
    "nothingChosen": "Pick at least one figure and one area.",
    "previewFailed": "The preview could not be loaded.",
    "finePrint": "Totals only — no trips, places, dates or costs. You can change or stop this at any time.",
    "remoteNotice": "The numbers go to the server {{origin}}. Whoever runs that server can read them."
  },
  "requests": {
    "title": "Requests",
    "asks": "{{name}} would like to see your numbers",
    "accept": "Accept",
    "decline": "Decline"
  },
  "people": {
    "title": "People",
    "name": "Name",
    "server": "Server",
    "sees": "Sees of yours",
    "shares": "Shares with you",
    "thisServer": "this server",
    "sharing": "yes",
    "notSharing": "nothing",
    "waiting": "waiting for an answer",
    "change": "Change",
    "end": "Stop",
    "endConfirm": "Stop comparing",
    "endTitle": "Stop comparing with {{name}}?",
    "endBody": "Neither of you will see the other's numbers any more.",
    "remoteFriend": "Person on another server"
  },
  "add": {
    "title": "Add person",
    "username": "Username on this server",
    "ask": "Ask",
    "inviteTitle": "Person on another server",
    "createInvite": "Create invitation code",
    "inviteHint": "Pass this code on. It is valid for 72 hours and only once.",
    "claimLabel": "Invitation code",
    "claim": "Redeem code"
  },
  "boards": {
    "title": "Groups",
    "create": "Create group",
    "name": "Name",
    "members": "People",
    "save": "Save",
    "delete": "Delete",
    "empty": "No groups yet."
  },
  "error": {
    "COMPARISON_USER_NOT_FOUND": "There is no such username on this server.",
    "COMPARISON_SELF": "You cannot compare with yourself.",
    "COMPARISON_DUPLICATE": "You already share your numbers with this person.",
    "COMPARISON_INVITE_INVALID": "This code is invalid, expired or already used.",
    "COMPARISON_INVITE_LIMIT": "You have too many open invitations.",
    "COMPARISON_FEDERATION_OFF": "Your server is not connected to other servers. Ask your admin.",
    "COMPARISON_PEER_UNKNOWN": "Your admin has not connected that server yet.",
    "COMPARISON_PEER_UNREACHABLE": "The other server is not answering right now.",
    "COMPARISON_PEER_OUTDATED": "The other server needs an update.",
    "unknown": "That did not work. Please try again."
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/lib/comparison/__tests__ src/i18n/__tests__/localeKeyParity.test.ts src/components/encryptedShare/__tests__/separation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/comparison frontend/src/lib/api/comparison.ts frontend/src/i18n/resources/de/comparison.json frontend/src/i18n/resources/en/comparison.json
git commit -m "feat(comparison): leaderboard client — like-for-like ranking, unit-aware values, copy

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 18: The one consent dialog — "X sieht diese Zahlen"

**Files:**
- Create: `frontend/src/components/comparison/ConsentDialog.tsx`, `frontend/src/components/comparison/__tests__/ConsentDialog.test.tsx`

**Interfaces:**
Consumes: `comparisonApi.preview`, `comparisonFailureCode` (Task 17), `formatMetricValue`, `recentYears`, `LEADERBOARD_METRICS`, `METRIC_GROUPS`, `DOMAINS`, `useEnabledDomains`, `useSettingsStore`, primitives `Dialog`, `Button`, `Chip`, `Field`, `Select`.
Produces:
```ts
export interface ConsentDialogProps {
  open: boolean;
  onClose: () => void;
  person: { displayName: string; origin: string | null };
  initialScope?: LeaderboardScope | null;
  onConfirm: (scope: LeaderboardScope) => Promise<void>;
}
export default function ConsentDialog(props: ConsentDialogProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

`frontend/src/components/comparison/__tests__/ConsentDialog.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ConsentDialog from "../ConsentDialog";
import { comparisonApi } from "../../../lib/api/comparison";
import type { LeaderboardSnapshot } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "name" in o ? `${k}:${String(o.name)}` : o && "origin" in o ? `${k}:${String(o.origin)}` : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "ferry"], isEnabled: () => true }),
}));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: { preview: vi.fn() },
}));

const snapshot: LeaderboardSnapshot = {
  schema: "travstats-leaderboard",
  version: 1,
  asOf: "2026-10-16T00:00:00.000Z",
  year: null,
  domains: ["flight", "ferry"],
  metrics: { flights: 12, ferryCrossings: 2 },
  partial: [],
};

describe("ConsentDialog", () => {
  beforeEach(() => {
    vi.mocked(comparisonApi.preview).mockResolvedValue(snapshot);
  });

  it("shows the numbers the scope would share and confirms exactly that scope", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConsentDialog open person={{ displayName: "Ben", origin: null }} onClose={() => {}} onConfirm={onConfirm} />);
    expect(screen.getByText("consent.title:Ben")).toBeInTheDocument();
    expect(await screen.findByText("metric.flights")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "group.time", pressed: true }));
    await waitFor(() =>
      expect(comparisonApi.preview).toHaveBeenLastCalledWith({
        groups: ["distance", "trips", "places"],
        domains: ["flight", "ferry"],
        year: null,
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: "consent.share" }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        groups: ["distance", "trips", "places"],
        domains: ["flight", "ferry"],
        year: null,
      })
    );
  });

  it("says in plain words that another server reads the numbers", async () => {
    render(
      <ConsentDialog open person={{ displayName: "Far", origin: "https://far.example" }} onClose={() => {}} onConfirm={vi.fn()} />
    );
    expect(await screen.findByText("consent.remoteNotice:https://far.example")).toBeInTheDocument();
  });

  it("cannot share nothing", async () => {
    render(<ConsentDialog open person={{ displayName: "Ben", origin: null }} onClose={() => {}} onConfirm={vi.fn()} />);
    for (const group of ["distance", "trips", "time", "places"])
      fireEvent.click(screen.getByRole("button", { name: `group.${group}` }));
    expect(await screen.findByText("consent.nothingChosen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "consent.share" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/comparison/__tests__/ConsentDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "../ConsentDialog"`.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/components/comparison/ConsentDialog.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Button, Chip, Dialog, Field, Select } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";
import { DOMAINS, type DomainKey } from "../../shared/domains";
import { LEADERBOARD_METRICS, METRIC_GROUPS } from "../../shared/comparisonMetrics";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import type { LeaderboardScope, LeaderboardSnapshot } from "../../lib/comparison/types";
import { formatMetricValue } from "../../lib/comparison/formatMetric";
import { recentYears } from "../../lib/comparison/years";
import { logger } from "../../lib/logger";

export interface ConsentDialogProps {
  open: boolean;
  onClose: () => void;
  /** Who will see the numbers; `origin` is set for a person on another server. */
  person: { displayName: string; origin: string | null };
  initialScope?: LeaderboardScope | null;
  onConfirm: (scope: LeaderboardScope) => Promise<void>;
}

const toggle = <T,>(list: readonly T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

/**
 * The one consent question of the comparison (spec §11.2): who, which figures, which period —
 * and the actual numbers that answer would share, from the server, under exactly that scope.
 * Chips rather than switches: nothing takes effect until "Teilen".
 */
export default function ConsentDialog({
  open,
  onClose,
  person,
  initialScope,
  onConfirm,
}: ConsentDialogProps): JSX.Element {
  const { t, i18n } = useTranslation(["comparison", "common", "stats"]);
  const { enabled } = useEnabledDomains();
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const [scope, setScope] = useState<LeaderboardScope>(
    () => initialScope ?? { groups: [...METRIC_GROUPS], domains: [...enabled], year: null }
  );
  const [preview, setPreview] = useState<LeaderboardSnapshot | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = scope.groups.length > 0 && scope.domains.length > 0;
  const tr = (key: string, options?: Record<string, unknown>): string => String(t(key, options ?? {}));

  useEffect(() => {
    if (!open || !valid) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreviewFailed(false);
    comparisonApi.preview(scope).then(
      (snapshot) => {
        if (alive) setPreview(snapshot);
      },
      (failure: unknown) => {
        logger.debug("comparison preview failed", failure);
        if (alive) setPreviewFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [open, scope, valid]);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(scope);
    } catch (failure) {
      setError(tr(`error.${comparisonFailureCode(failure)}`));
    } finally {
      setBusy(false);
    }
  };

  const shown = preview
    ? LEADERBOARD_METRICS.filter((m) => Object.prototype.hasOwnProperty.call(preview.metrics, m.key))
    : [];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={tr("consent.title", { name: person.displayName })}
      dismissLabel={tr("common:buttons.cancel")}
      action={
        <Button disabled={!valid || busy || !preview} onClick={() => void confirm()}>
          {tr("consent.share")}
        </Button>
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        <div role="group" aria-label={tr("group.label")} className="flex flex-wrap" style={{ gap: "var(--ts-space-xs)" }}>
          {METRIC_GROUPS.map((g) => (
            <Chip key={g} active={scope.groups.includes(g)} onClick={() => setScope((s) => ({ ...s, groups: toggle(s.groups, g) }))}>
              {tr(`group.${g}`)}
            </Chip>
          ))}
        </div>
        <div role="group" aria-label={tr("consent.domains")} className="flex flex-wrap" style={{ gap: "var(--ts-space-xs)" }}>
          {enabled.map((d: DomainKey) => (
            <Chip key={d} active={scope.domains.includes(d)} onClick={() => setScope((s) => ({ ...s, domains: toggle(s.domains, d) }))}>
              {tr(`common:${DOMAINS[d].i18nKey}`)}
            </Chip>
          ))}
        </div>
        <Field label={tr("consent.period")} htmlFor="consent-period">
          <Select
            id="consent-period"
            value={scope.year === null ? "all" : String(scope.year)}
            onChange={(e) => setScope((s) => ({ ...s, year: e.target.value === "all" ? null : Number(e.target.value) }))}
          >
            <option value="all">{tr("consent.allYears")}</option>
            {recentYears().map((y) => (
              <option key={y} value={y}>
                {tr("consent.onlyYear", { year: y })}
              </option>
            ))}
          </Select>
        </Field>
        {!valid && <p className="t-caption">{tr("consent.nothingChosen")}</p>}
        {valid && preview && (
          <dl aria-label={tr("consent.preview")} className="grid grid-cols-2" style={{ gap: "var(--ts-space-xs)" }}>
            {shown.map((m) => {
              const value = preview.metrics[m.key];
              return (
                <div key={m.key} className="contents">
                  <dt className="t-caption">{tr(`metric.${m.key}`)}</dt>
                  <dd>
                    {typeof value === "number"
                      ? formatMetricValue(value, m.unit, { distanceUnit, t: tr, language: i18n.language })
                      : "—"}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {previewFailed && <p role="alert">{tr("consent.previewFailed")}</p>}
        <p className="t-caption">{tr("consent.finePrint")}</p>
        {person.origin && (
          <p className="t-caption" role="note">
            {tr("consent.remoteNotice", { origin: person.origin })}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/comparison/ConsentDialog.tsx frontend/src/components/comparison/__tests__/ConsentDialog.test.tsx
git commit -m "feat(comparison): one plain-language consent dialog with the real numbers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 19: A metric card with its people ranked — `LeaderboardTile`

**Files:**
- Create: `frontend/src/components/comparison/LeaderboardTile.tsx`, `frontend/src/components/comparison/__tests__/LeaderboardTile.test.tsx`

**Interfaces:**
Consumes: `rankPeople`, `RankedEntry` (Task 17), `formatMetricValue`, `useDomainColors` (`hooks/useDomainColors`), `Card`, `StatTile`, `ListRow`.
Produces: `export default function LeaderboardTile({ metric, rows, year }: { metric: LeaderboardMetric; rows: readonly LeaderboardRow[]; year: number | null }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/comparison/__tests__/LeaderboardTile.test.tsx`:
```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import LeaderboardTile from "../LeaderboardTile";
import { LEADERBOARD_METRICS } from "../../../shared/comparisonMetrics";
import type { LeaderboardRow } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const snap = (metrics: Record<string, number>, partial: string[] = []) => ({
  schema: "travstats-leaderboard" as const,
  version: 1 as const,
  asOf: "2026-10-16T00:00:00.000Z",
  year: 2025,
  domains: ["flight"],
  metrics,
  partial,
});
const person = (key: string, kind: "self" | "local") => ({ key, kind, username: key, displayName: key, origin: null });
const rows: LeaderboardRow[] = [
  { person: person("self", "self"), status: "ok", snapshot: snap({ flightKm: 100 }), sharedYear: null },
  { person: person("ben", "local"), status: "ok", snapshot: snap({ flightKm: 200 }, ["flightKm"]), sharedYear: null },
  { person: person("cleo", "local"), status: "unreachable", snapshot: null, sharedYear: null },
];

describe("LeaderboardTile", () => {
  it("leads with the reader's own value and ranks everyone under it", () => {
    const flightKm = LEADERBOARD_METRICS.find((m) => m.key === "flightKm")!;
    render(<LeaderboardTile metric={flightKm} rows={rows} year={2025} />);
    const card = screen.getByTestId("metric-flightKm");
    expect(within(card).getByText("metric.flightKm")).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "tile.ranking" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("ben"),
      expect.stringContaining("you"),
      expect.stringContaining("cleo"),
    ]);
    expect(items[0]).toHaveTextContent("≥ 200 stats:distance.kilometers");
    expect(items[2]).toHaveTextContent("status.unreachable");
    expect(items[2]).toHaveTextContent("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/comparison/__tests__/LeaderboardTile.test.tsx`
Expected: FAIL — `Failed to resolve import "../LeaderboardTile"`.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/components/comparison/LeaderboardTile.tsx`:
```tsx
import type { JSX } from "react";
import { Card, ListRow, StatTile } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useSettingsStore } from "../../store/settingsStore";
import { rankPeople, type RankedEntry } from "../../lib/comparison/ranking";
import { formatMetricValue } from "../../lib/comparison/formatMetric";
import type { LeaderboardMetric, LeaderboardRow } from "../../lib/comparison/types";

interface Props {
  metric: LeaderboardMetric;
  rows: readonly LeaderboardRow[];
  year: number | null;
}

/**
 * One figure, the way /stats shows it — a StatTile with the reader's own value — and the
 * people ranked under it. The left edge carries the domain colour from the colour store
 * (never a hard-coded swatch); cross-domain figures use the accent.
 */
export default function LeaderboardTile({ metric, rows, year }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["comparison", "stats"]);
  const { colorOf } = useDomainColors();
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const tr = (key: string, options?: Record<string, unknown>): string => String(t(key, options ?? {}));
  const ranked = rankPeople(rows, metric.key, year);
  const show = (entry: RankedEntry | undefined): string =>
    !entry || entry.value === null
      ? "—"
      : `${entry.partial ? "≥ " : ""}${formatMetricValue(entry.value, metric.unit, { distanceUnit, t: tr, language: i18n.language })}`;
  const label = tr(`metric.${metric.key}`);
  return (
    <Card
      data-testid={`metric-${metric.key}`}
      style={{ borderLeft: `4px solid ${metric.domain ? colorOf(metric.domain) : "var(--ts-accent)"}` }}
    >
      <StatTile value={show(ranked.find((e) => e.row.person.kind === "self"))} label={label} />
      <ol aria-label={tr("tile.ranking", { metric: label })} style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {ranked.map((entry) => (
          <li key={entry.row.person.key}>
            <ListRow
              dense
              mark={<span className="t-stat-number">{entry.rank ?? "–"}</span>}
              title={entry.row.person.kind === "self" ? tr("you") : entry.row.person.displayName}
              subtitle={entry.reason ? tr(`status.${entry.reason}`, { year: entry.row.sharedYear }) : undefined}
              trailing={show(entry)}
            />
          </li>
        ))}
      </ol>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/comparison/LeaderboardTile.tsx frontend/src/components/comparison/__tests__/LeaderboardTile.test.tsx
git commit -m "feat(comparison): metric card with the people ranked under it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 20: People, requests, adding people, groups

**Files:**
- Create: `frontend/src/components/comparison/PeopleSection.tsx`, `frontend/src/components/comparison/AddPersonCard.tsx`, `frontend/src/components/comparison/BoardsSection.tsx`, `frontend/src/components/comparison/__tests__/PeopleSection.test.tsx`, `frontend/src/components/comparison/__tests__/AddPersonCard.test.tsx`, `frontend/src/components/comparison/__tests__/BoardsSection.test.tsx`

**Interfaces:**
Consumes: `comparisonApi`, `comparisonFailureCode` (Task 17), `ConsentDialog` (Task 18), primitives `Table`, `TableRow`, `TableColumn`, `ListRow`, `Button`, `Dialog`, `Field`, `Input`, `Chip`, `SectionLabel`, `Card`.
Produces:
```ts
export default function PeopleSection(props: { people: PeopleResponse; onChanged: () => void }): JSX.Element;
export default function AddPersonCard(props: { onChanged: () => void }): JSX.Element;
export default function BoardsSection(props: { boards: BoardView[]; people: PersonView[]; onChanged: () => void }): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Shared header of each of the three test files (`vi.hoisted` because `vi.mock` factories run before module-level constants):
```tsx
const SCOPE = vi.hoisted(() => ({ groups: ["trips"], domains: ["flight"], year: null }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../ConsentDialog", () => ({
  default: ({ open, onConfirm }: { open: boolean; onConfirm: (s: unknown) => Promise<void> }) =>
    open ? <button onClick={() => void onConfirm(SCOPE)}>confirm-dialog</button> : null,
}));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: {
    accept: vi.fn().mockResolvedValue({}),
    decline: vi.fn().mockResolvedValue({}),
    updateScope: vi.fn().mockResolvedValue({}),
    end: vi.fn().mockResolvedValue({ ended: true }),
    request: vi.fn().mockResolvedValue({}),
    createInvite: vi.fn().mockResolvedValue({ code: "https://me.example#" + "a".repeat(64), expiresAt: "2026-10-19T00:00:00.000Z" }),
    claimInvite: vi.fn().mockResolvedValue({}),
    saveBoard: vi.fn().mockResolvedValue({}),
    deleteBoard: vi.fn().mockResolvedValue({ deleted: true }),
  },
}));
```

`frontend/src/components/comparison/__tests__/PeopleSection.test.tsx` (with the mocks above, imports `render, screen, fireEvent, waitFor` from Testing Library, `describe, it, expect, vi` from vitest, `PeopleSection` from `../PeopleSection`, `comparisonApi` from `../../../lib/api/comparison`, `PeopleResponse` type):
```tsx
const ben = { key: "local:11111111-1111-4111-8111-111111111111", kind: "local" as const, username: "ben", displayName: "Ben", origin: null };
const people: PeopleResponse = {
  requests: [{ consentId: "c-1", person: ben, createdAt: "2026-10-16T00:00:00.000Z" }],
  people: [{ person: ben, mine: { consentId: "c-2", status: "accepted", scope: SCOPE as never }, theirs: { status: "accepted" } }],
  boards: [],
};

describe("PeopleSection", () => {
  it("accepts a request with the scope chosen in the dialog", async () => {
    const onChanged = vi.fn();
    render(<PeopleSection people={people} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "requests.accept" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.accept).toHaveBeenCalledWith("c-1", SCOPE));
    expect(onChanged).toHaveBeenCalled();
  });

  it("asks before ending, then ends with the person's key", async () => {
    const onChanged = vi.fn();
    render(<PeopleSection people={people} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "people.end" }));
    fireEvent.click(await screen.findByRole("button", { name: "people.endConfirm" }));
    await waitFor(() => expect(comparisonApi.end).toHaveBeenCalledWith(ben.key));
    expect(onChanged).toHaveBeenCalled();
  });
});
```

`frontend/src/components/comparison/__tests__/AddPersonCard.test.tsx` (same mocks; imports `AddPersonCard` from `../AddPersonCard`):
```tsx
describe("AddPersonCard", () => {
  it("asks a person on this server by username with the dialog's scope", async () => {
    const onChanged = vi.fn();
    render(<AddPersonCard onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText("add.username"), { target: { value: "ben" } });
    fireEvent.click(screen.getByRole("button", { name: "add.ask" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.request).toHaveBeenCalledWith("ben", SCOPE));
    expect(onChanged).toHaveBeenCalled();
  });

  it("creates an invitation code to pass on", async () => {
    render(<AddPersonCard onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "add.createInvite" }));
    expect(await screen.findByDisplayValue("https://me.example#" + "a".repeat(64))).toBeInTheDocument();
  });

  it("redeems a code from another server through the dialog", async () => {
    render(<AddPersonCard onChanged={vi.fn()} />);
    const code = "https://far.example#" + "b".repeat(64);
    fireEvent.change(screen.getByLabelText("add.claimLabel"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "add.claim" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.claimInvite).toHaveBeenCalledWith(code, SCOPE));
  });
});
```

`frontend/src/components/comparison/__tests__/BoardsSection.test.tsx` (same mocks; imports `BoardsSection` from `../BoardsSection`):
```tsx
const ben = { key: "local:11111111-1111-4111-8111-111111111111", kind: "local" as const, username: "ben", displayName: "Ben", origin: null };

describe("BoardsSection", () => {
  it("creates a named group from the people the reader can see", async () => {
    const onChanged = vi.fn();
    render(
      <BoardsSection boards={[]} people={[{ person: ben, mine: null, theirs: { status: "accepted" } }]} onChanged={onChanged} />
    );
    fireEvent.click(screen.getByRole("button", { name: "boards.create" }));
    fireEvent.change(await screen.findByLabelText("boards.name"), { target: { value: "Familie" } });
    fireEvent.click(screen.getByRole("button", { name: "Ben" }));
    fireEvent.click(screen.getByRole("button", { name: "boards.save" }));
    await waitFor(() =>
      expect(comparisonApi.saveBoard).toHaveBeenCalledWith({ name: "Familie", members: [ben.key] }, undefined)
    );
    expect(onChanged).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/comparison/__tests__/PeopleSection.test.tsx src/components/comparison/__tests__/AddPersonCard.test.tsx src/components/comparison/__tests__/BoardsSection.test.tsx`
Expected: FAIL — the three component modules do not resolve.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/components/comparison/PeopleSection.tsx`:
```tsx
import { useMemo, useState } from "react";
import type { JSX } from "react";
import { Button, Dialog, ListRow, SectionLabel, Table, TableRow, type TableColumn } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import type { LeaderboardScope, PeopleResponse, Person, PersonView } from "../../lib/comparison/types";
import ConsentDialog from "./ConsentDialog";

type Question =
  | { kind: "accept"; consentId: string; person: Person }
  | { kind: "change"; consentId: string; person: Person; scope: LeaderboardScope | null };

/** Requests to answer and the people the reader compares with. */
export default function PeopleSection({ people, onChanged }: { people: PeopleResponse; onChanged: () => void }): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string => String(t(key, options ?? {}));
  const [question, setQuestion] = useState<Question | null>(null);
  const [ending, setEnding] = useState<Person | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const columns = useMemo<TableColumn[]>(
    () => [
      { key: "name", label: tr("people.name"), min: 140, grow: 2, priority: 1, onNarrow: "title" },
      { key: "server", label: tr("people.server"), min: 120, grow: 1, priority: 3, onNarrow: "subtitle" },
      { key: "sees", label: tr("people.sees"), min: 140, grow: 2, priority: 2, onNarrow: "hide" },
      { key: "shares", label: tr("people.shares"), min: 120, priority: 2, onNarrow: "hide" },
      { key: "actions", label: "", min: 200, priority: 1, align: "end", onNarrow: "trailing" },
    ],
    [t]
  );

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setFailed(null);
    try {
      await fn();
      onChanged();
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    }
  };
  const sees = (p: PersonView): string =>
    p.mine?.status === "accepted" && p.mine.scope
      ? p.mine.scope.groups.map((g) => tr(`group.${g}`)).join(", ")
      : tr("people.notSharing");
  const shares = (p: PersonView): string =>
    p.person.kind === "remote"
      ? "—"
      : p.theirs?.status === "accepted"
        ? tr("people.sharing")
        : p.theirs?.status === "pending"
          ? tr("people.waiting")
          : tr("people.notSharing");
  const actions = (p: PersonView): JSX.Element => {
    const mine = p.mine;
    return (
      <span className="flex" style={{ gap: "var(--ts-space-xs)" }}>
        {mine?.status === "accepted" && (
          <Button
            variant="secondary"
            onClick={() => setQuestion({ kind: "change", consentId: mine.consentId, person: p.person, scope: mine.scope })}
          >
            {tr("people.change")}
          </Button>
        )}
        <Button variant="danger" onClick={() => setEnding(p.person)}>
          {tr("people.end")}
        </Button>
      </span>
    );
  };

  return (
    <section className="flex flex-col" style={{ gap: "var(--ts-space-lg)", marginTop: "var(--ts-space-2xl)" }}>
      {people.requests.length > 0 && (
        <div>
          <SectionLabel>{tr("requests.title")}</SectionLabel>
          {people.requests.map((r) => (
            <ListRow
              key={r.consentId}
              title={tr("requests.asks", { name: r.person.displayName })}
              subtitle={r.person.origin ?? undefined}
              trailing={
                <span className="flex" style={{ gap: "var(--ts-space-xs)" }}>
                  <Button onClick={() => setQuestion({ kind: "accept", consentId: r.consentId, person: r.person })}>
                    {tr("requests.accept")}
                  </Button>
                  <Button variant="secondary" onClick={() => void act(() => comparisonApi.decline(r.consentId))}>
                    {tr("requests.decline")}
                  </Button>
                </span>
              }
            />
          ))}
        </div>
      )}
      {people.people.length > 0 && (
        <div>
          <SectionLabel>{tr("people.title")}</SectionLabel>
          <Table columns={columns} label={tr("people.title")}>
            {people.people.map((p) => (
              <TableRow
                key={p.person.key}
                columns={columns}
                cells={[p.person.displayName, p.person.origin ?? tr("people.thisServer"), sees(p), shares(p), actions(p)]}
              />
            ))}
          </Table>
        </div>
      )}
      {failed && <p role="alert">{failed}</p>}
      {question && (
        <ConsentDialog
          open
          person={question.person}
          initialScope={question.kind === "change" ? question.scope : null}
          onClose={() => setQuestion(null)}
          onConfirm={async (scope) => {
            if (question.kind === "accept") await comparisonApi.accept(question.consentId, scope);
            else await comparisonApi.updateScope(question.consentId, scope);
            setQuestion(null);
            onChanged();
          }}
        />
      )}
      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={tr("people.endTitle", { name: ending?.displayName ?? "" })}
        dismissLabel={tr("common:buttons.cancel")}
        action={
          <Button
            variant="danger"
            onClick={() => {
              const person = ending;
              setEnding(null);
              if (person) void act(() => comparisonApi.end(person.key));
            }}
          >
            {tr("people.endConfirm")}
          </Button>
        }
      >
        <p>{tr("people.endBody")}</p>
      </Dialog>
    </section>
  );
}
```

`frontend/src/components/comparison/AddPersonCard.tsx`:
```tsx
import { useState } from "react";
import type { JSX } from "react";
import { Button, Card, Field, Input, SectionLabel } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import ConsentDialog from "./ConsentDialog";

type Pending = { kind: "username"; username: string } | { kind: "code"; code: string; origin: string | null };

/** Same server: ask by username. Another server: pass on a code, or redeem one. */
export default function AddPersonCard({ onChanged }: { onChanged: () => void }): JSX.Element {
  const { t } = useTranslation(["comparison"]);
  const tr = (key: string, options?: Record<string, unknown>): string => String(t(key, options ?? {}));
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const createInvite = async (): Promise<void> => {
    setFailed(null);
    try {
      setInvite((await comparisonApi.createInvite()).code);
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    }
  };

  return (
    <Card style={{ marginTop: "var(--ts-space-2xl)" }}>
      <SectionLabel>{tr("add.title")}</SectionLabel>
      <Field label={tr("add.username")} htmlFor="comparison-username">
        <Input id="comparison-username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Button disabled={!username.trim()} onClick={() => setPending({ kind: "username", username: username.trim() })}>
        {tr("add.ask")}
      </Button>
      <SectionLabel>{tr("add.inviteTitle")}</SectionLabel>
      <Button variant="secondary" onClick={() => void createInvite()}>
        {tr("add.createInvite")}
      </Button>
      {invite && (
        <Field label={tr("add.inviteTitle")} htmlFor="comparison-invite" hint={tr("add.inviteHint")}>
          <Input id="comparison-invite" readOnly value={invite} onFocus={(e) => e.target.select()} />
        </Field>
      )}
      <Field label={tr("add.claimLabel")} htmlFor="comparison-claim">
        <Input id="comparison-claim" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button
        variant="secondary"
        disabled={!code.includes("#")}
        onClick={() => setPending({ kind: "code", code: code.trim(), origin: code.trim().split("#")[0] || null })}
      >
        {tr("add.claim")}
      </Button>
      {failed && <p role="alert">{failed}</p>}
      {pending && (
        <ConsentDialog
          open
          person={
            pending.kind === "username"
              ? { displayName: pending.username, origin: null }
              : { displayName: tr("people.remoteFriend"), origin: pending.origin }
          }
          onClose={() => setPending(null)}
          onConfirm={async (scope) => {
            if (pending.kind === "username") await comparisonApi.request(pending.username, scope);
            else await comparisonApi.claimInvite(pending.code, scope);
            setPending(null);
            setUsername("");
            setCode("");
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
```

`frontend/src/components/comparison/BoardsSection.tsx`:
```tsx
import { useState } from "react";
import type { JSX } from "react";
import { Button, Chip, Dialog, Field, Input, ListRow, SectionLabel } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import type { BoardView, PersonView } from "../../lib/comparison/types";

interface Draft {
  id?: string;
  name: string;
  members: string[];
}

/** Named groups of people whose numbers the reader can see — a private filter, nobody is asked. */
export default function BoardsSection({
  boards,
  people,
  onChanged,
}: {
  boards: BoardView[];
  people: PersonView[];
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string => String(t(key, options ?? {}));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const visible = people.filter((p) => p.person.kind === "remote" || p.theirs?.status === "accepted");
  const nameOf = (key: string) => people.find((p) => p.person.key === key)?.person.displayName ?? key;

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setFailed(null);
    try {
      await fn();
      setDraft(null);
      onChanged();
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    }
  };

  return (
    <section style={{ marginTop: "var(--ts-space-2xl)" }}>
      <SectionLabel>{tr("boards.title")}</SectionLabel>
      {boards.length === 0 && <p className="t-caption">{tr("boards.empty")}</p>}
      {boards.map((b) => (
        <ListRow
          key={b.id}
          title={b.name}
          subtitle={b.members.map(nameOf).join(", ")}
          trailing={
            <span className="flex" style={{ gap: "var(--ts-space-xs)" }}>
              <Button variant="secondary" onClick={() => setDraft({ id: b.id, name: b.name, members: b.members })}>
                {tr("people.change")}
              </Button>
              <Button variant="danger" onClick={() => void run(() => comparisonApi.deleteBoard(b.id))}>
                {tr("boards.delete")}
              </Button>
            </span>
          }
        />
      ))}
      <Button variant="secondary" disabled={visible.length === 0} onClick={() => setDraft({ name: "", members: [] })}>
        {tr("boards.create")}
      </Button>
      {failed && <p role="alert">{failed}</p>}
      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={tr("boards.title")}
        dismissLabel={tr("common:buttons.cancel")}
        action={
          <Button
            disabled={!draft?.name.trim()}
            onClick={() =>
              draft && void run(() => comparisonApi.saveBoard({ name: draft.name.trim(), members: draft.members }, draft.id))
            }
          >
            {tr("boards.save")}
          </Button>
        }
      >
        {draft && (
          <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
            <Field label={tr("boards.name")} htmlFor="board-name">
              <Input id="board-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <div role="group" aria-label={tr("boards.members")} className="flex flex-wrap" style={{ gap: "var(--ts-space-xs)" }}>
              {visible.map((p) => (
                <Chip
                  key={p.person.key}
                  active={draft.members.includes(p.person.key)}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      members: draft.members.includes(p.person.key)
                        ? draft.members.filter((k) => k !== p.person.key)
                        : [...draft.members, p.person.key],
                    })
                  }
                >
                  {p.person.displayName}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/comparison/PeopleSection.tsx frontend/src/components/comparison/AddPersonCard.tsx frontend/src/components/comparison/BoardsSection.tsx frontend/src/components/comparison/__tests__/PeopleSection.test.tsx frontend/src/components/comparison/__tests__/AddPersonCard.test.tsx frontend/src/components/comparison/__tests__/BoardsSection.test.tsx
git commit -m "feat(comparison): requests, people, invitations and groups on the comparison page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 21: The page — `LeaderboardPage`

**Files:**
- Create: `frontend/src/components/comparison/LeaderboardPage.tsx`, `frontend/src/components/comparison/__tests__/LeaderboardPage.test.tsx`

**Interfaces:**
Consumes: `comparisonApi.leaderboard`, `comparisonApi.people` (Task 17), `LeaderboardTile` (19), `PeopleSection`, `AddPersonCard`, `BoardsSection` (20), `Segmented` (`components/ui/Segmented`), `AppShell`, `PageHeader`, `EmptyState`, `Field`, `Select`, `Button`, `useEnabledDomains`, `recentYears`, `logger`.
Produces: `export default function LeaderboardPage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/comparison/__tests__/LeaderboardPage.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LeaderboardPage from "../LeaderboardPage";
import { comparisonApi } from "../../../lib/api/comparison";
import type { LeaderboardResponse } from "../../../lib/comparison/types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: () => true }),
}));
vi.mock("../PeopleSection", () => ({ default: () => null }));
vi.mock("../AddPersonCard", () => ({ default: () => null }));
vi.mock("../BoardsSection", () => ({ default: () => null }));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: { leaderboard: vi.fn(), people: vi.fn() },
}));

const snap = (metrics: Record<string, number>) => ({
  schema: "travstats-leaderboard" as const,
  version: 1 as const,
  asOf: "2026-10-16T00:00:00.000Z",
  year: null,
  domains: ["flight"],
  metrics,
  partial: [],
});
const self = { key: "self", kind: "self" as const, username: "me", displayName: "Me", origin: null };
const ben = { key: "local:1", kind: "local" as const, username: "ben", displayName: "Ben", origin: null };
const two: LeaderboardResponse = {
  year: null,
  rows: [
    { person: self, status: "ok", snapshot: snap({ flightKm: 100, flights: 2 }), sharedYear: null },
    { person: ben, status: "ok", snapshot: snap({ flightKm: 300, flights: 5 }), sharedYear: null },
  ],
};

describe("LeaderboardPage", () => {
  beforeEach(() => {
    vi.mocked(comparisonApi.people).mockResolvedValue({ requests: [], people: [], boards: [] });
  });

  it("shows one card per metric of the chosen group, like the statistics pages", async () => {
    vi.mocked(comparisonApi.leaderboard).mockResolvedValue(two);
    render(<LeaderboardPage />);
    expect(await screen.findByTestId("metric-flightKm")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-flights")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "group.trips" }));
    expect(await screen.findByTestId("metric-flights")).toBeInTheDocument();
  });

  it("asks for a year when the period changes", async () => {
    vi.mocked(comparisonApi.leaderboard).mockResolvedValue(two);
    render(<LeaderboardPage />);
    await screen.findByTestId("metric-flightKm");
    const year = String(new Date().getFullYear());
    fireEvent.change(screen.getByLabelText("period.label"), { target: { value: year } });
    await waitFor(() => expect(comparisonApi.leaderboard).toHaveBeenLastCalledWith(Number(year), undefined));
  });

  it("invites instead of ranking when nobody else is there", async () => {
    vi.mocked(comparisonApi.leaderboard).mockResolvedValue({ year: null, rows: [two.rows[0]] });
    render(<LeaderboardPage />);
    expect(await screen.findByText("empty.title")).toBeInTheDocument();
  });

  it("says the load failed instead of showing zeros", async () => {
    vi.mocked(comparisonApi.leaderboard).mockRejectedValue(new Error("down"));
    render(<LeaderboardPage />);
    expect(await screen.findByText("loadFailed")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-flightKm")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/comparison/__tests__/LeaderboardPage.test.tsx`
Expected: FAIL — `Failed to resolve import "../LeaderboardPage"`.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/components/comparison/LeaderboardPage.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { AppShell, Button, EmptyState, Field, PageHeader, Select } from "../ui";
import { Segmented } from "../ui/Segmented";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { LEADERBOARD_METRICS, METRIC_GROUPS, type MetricGroup } from "../../shared/comparisonMetrics";
import { comparisonApi } from "../../lib/api/comparison";
import type { LeaderboardResponse, PeopleResponse } from "../../lib/comparison/types";
import { recentYears } from "../../lib/comparison/years";
import { logger } from "../../lib/logger";
import LeaderboardTile from "./LeaderboardTile";
import PeopleSection from "./PeopleSection";
import AddPersonCard from "./AddPersonCard";
import BoardsSection from "./BoardsSection";

/**
 * /compare (spec 2026-10-16 §11): totals only, ranked per figure, built from server-side
 * aggregates under each friend's consent. No keys, no decryption — that is /encrypted-share.
 */
export default function LeaderboardPage(): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string): string => String(t(key));
  const { enabled } = useEnabledDomains();
  const [group, setGroup] = useState<MetricGroup>("distance");
  const [year, setYear] = useState<number | null>(null);
  const [board, setBoard] = useState("");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [people, setPeople] = useState<PeopleResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    Promise.all([comparisonApi.leaderboard(year, board || undefined), comparisonApi.people()]).then(
      ([nextData, nextPeople]) => {
        if (!alive) return;
        setData(nextData);
        setPeople(nextPeople);
      },
      (failure: unknown) => {
        logger.error("comparison: load failed", failure);
        // A failed load says so; empty tiles would claim "nobody travelled".
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [year, board, version]);

  const reload = (): void => setVersion((v) => v + 1);
  // `scrollIntoView` is missing in jsdom, hence the second `?.`.
  const addPerson = (): void => addRef.current?.scrollIntoView?.({ behavior: "smooth" });
  const rows = data?.rows ?? [];
  const metrics = LEADERBOARD_METRICS.filter(
    (m) =>
      m.group === group &&
      (m.domain === null ||
        enabled.includes(m.domain) ||
        rows.some((r) => r.snapshot && Object.prototype.hasOwnProperty.call(r.snapshot.metrics, m.key)))
  );

  return (
    <AppShell width="list">
      <PageHeader title={tr("title")} meta={tr("subtitle")} actions={<Button onClick={addPerson}>{tr("addPerson")}</Button>} />
      <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-lg)", marginBottom: "var(--ts-space-xl)" }}>
        <Segmented
          label={tr("group.label")}
          value={group}
          onChange={setGroup}
          options={METRIC_GROUPS.map((g) => ({ value: g, label: tr(`group.${g}`) }))}
        />
        <Field label={tr("period.label")} htmlFor="comparison-year">
          <Select
            id="comparison-year"
            value={year === null ? "all" : String(year)}
            onChange={(e) => setYear(e.target.value === "all" ? null : Number(e.target.value))}
          >
            <option value="all">{tr("period.all")}</option>
            {recentYears().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        {people && people.boards.length > 0 && (
          <Field label={tr("board.label")} htmlFor="comparison-board">
            <Select id="comparison-board" value={board} onChange={(e) => setBoard(e.target.value)}>
              <option value="">{tr("board.all")}</option>
              {people.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {failed ? (
        <EmptyState
          kind="degraded"
          title={tr("loadFailed")}
          action={<Button onClick={reload}>{tr("common:buttons.retry")}</Button>}
        />
      ) : !data ? (
        <p className="t-caption">{tr("common:loading.default")}</p>
      ) : rows.length <= 1 ? (
        <EmptyState
          title={tr("empty.title")}
          description={tr("empty.description")}
          action={<Button onClick={addPerson}>{tr("addPerson")}</Button>}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {metrics.map((m) => (
              <LeaderboardTile key={m.key} metric={m} rows={rows} year={data.year} />
            ))}
          </div>
          <p className="t-caption">{tr("tile.partialHint")}</p>
        </>
      )}
      {people && <PeopleSection people={people} onChanged={reload} />}
      <div ref={addRef}>
        <AddPersonCard onChanged={reload} />
      </div>
      {people && <BoardsSection boards={people.boards} people={people.people} onChanged={reload} />}
    </AppShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/comparison/LeaderboardPage.tsx frontend/src/components/comparison/__tests__/LeaderboardPage.test.tsx
git commit -m "feat(comparison): leaderboard page built from the stats primitives

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

---

### Task 22: Switch `/compare` to the leaderboard; `/encrypted-share` behind `encryptedShare`; nav, registry, docs

**Files:**
- Create: `frontend/src/pages/EncryptedSharePage.tsx`
- Modify: `frontend/src/pages/ComparisonPage.tsx`, `frontend/src/App.tsx:28,237`, `frontend/src/components/Nav/useNavItems.ts` (lines 80-102, 168-185, the `tools` list, deps), `frontend/src/components/Nav/__tests__/useNavItems.test.ts`, `frontend/src/components/ui/icons/lucide.ts` (after `user`), `frontend/src/config/betaFeatures.ts` (`comparison` entry, new `encryptedShare` entry), `frontend/src/components/encryptedShare/SealedWorkspace.tsx`, `frontend/src/i18n/resources/{de,en}/encryptedShare.json` (`title`, `nav`, `e2e.data`), `docs/FEDERATION_DEV.md`, `docs/FEDERATION_E2E.md`, `docs/superpowers/specs/2026-10-10-federation-threat-model.md`, `CLAUDE.md`
- Delete: `frontend/src/components/encryptedShare/ranking.ts`, `frontend/src/components/encryptedShare/__tests__/ranking.test.ts`

**Interfaces:** Consumes: `LeaderboardPage` (Task 21), `SealedWorkspace`, `BetaFeatureRouteGuard`, `useBetaFeatures().isFeatureVisible`. Produces: routes `/compare` (leaderboard, key `comparison`) and `/encrypted-share` (E2E, key `encryptedShare`); nav leaves `comparison` (icon `users`) and `encrypted-share` (icon `key-round`); Lucide icon `users`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/Nav/__tests__/useNavItems.test.ts`:
```ts
describe("comparison and encrypted share (rework 2026-10-16)", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
  });

  it("gives the comparison its own icon, apart from the achievements trophy", () => {
    const collections = section(run().more, "collections");
    expect(collections.find((l) => l.id === "comparison")).toMatchObject({ path: "/compare", icon: "users" });
    expect(collections.find((l) => l.id === "achievements")?.icon).toBe("trophy");
    const ids = collections.map((l) => l.id);
    expect(ids.indexOf("comparison")).toBe(ids.indexOf("wrapped") + 1);
  });

  it("offers the encrypted share as a tool behind its own key", () => {
    expect(section(run().more, "tools").find((l) => l.id === "encrypted-share")).toMatchObject({
      path: "/encrypted-share",
      icon: "key-round",
      label: "encryptedShare:nav",
    });
  });

  it("hides both while the beta switch is off", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    const all = run().more.flatMap((s) => s.items.map((l) => l.id));
    expect(all).not.toContain("comparison");
    expect(all).not.toContain("encrypted-share");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/Nav/__tests__/useNavItems.test.ts`
Expected: FAIL — `icon: "trophy"` received for `comparison`; no `encrypted-share` leaf.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/components/ui/icons/lucide.ts` — after the `user` entry:
```ts
  users: [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: "9", cy: "7", r: "4" }],
    ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
    ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }],
  ],
```

`frontend/src/config/betaFeatures.ts` — replace the `comparison` entry and add `encryptedShare` after it:
```ts
  comparison: Object.freeze({
    reason: "beta",
    why: "The friend leaderboard was rebuilt on 2026-10-16 from server-side totals under per-person consent (spec docs/superpowers/specs/2026-10-16-comparison-rework-design.md). Across servers the totals travel signed but not end-to-end encrypted, by owner decision; that, and the load of ~9 loaders per friend, wants an RC look first (forgejo#40).",
    returnsWhen:
      "The owner accepts the rebuilt leaderboard on the RC — same-instance and one cross-server pair — and the leaderboard load is measured there.",
  }),
  encryptedShare: Object.freeze({
    reason: "beta",
    why: "The full-record, device-encrypted transfer (protocol v2, docs/FEDERATION_E2E.md) was split off the comparison page on 2026-10-16 and kept, unchanged, until the owner decides to keep or cut it. It has had no independent cryptographic review.",
    returnsWhen:
      "The owner decides to keep it AND an independent review of protocol v2 is done; if the owner cuts it, the entry goes with the code.",
  }),
```

`frontend/src/pages/EncryptedSharePage.tsx`:
```tsx
import "../components/encryptedShare/encryptedShare.css";
import { Navigate } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import { useAuthStore } from "../store/authStore";
import SealedWorkspace from "../components/encryptedShare/SealedWorkspace";

/** The device-encrypted full-record transfer, behind its own key since 2026-10-16. */
export default function EncryptedSharePage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  return user ? (
    <BetaFeatureRouteGuard feature="encryptedShare" redirectTo="/compare">
      <SealedWorkspace />
    </BetaFeatureRouteGuard>
  ) : (
    <Navigate to="/login" />
  );
}
```

`frontend/src/pages/ComparisonPage.tsx`:
```tsx
import { Navigate } from "react-router-dom";
import { BetaFeatureRouteGuard } from "../components/BetaFeatureRouteGuard";
import { useAuthStore } from "../store/authStore";
import LeaderboardPage from "../components/comparison/LeaderboardPage";

export default function ComparisonPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  return user ? (
    <BetaFeatureRouteGuard feature="comparison" redirectTo="/dashboard">
      <LeaderboardPage />
    </BetaFeatureRouteGuard>
  ) : (
    <Navigate to="/login" />
  );
}
```

`frontend/src/App.tsx`: below line 28 `const EncryptedSharePage = lazy(() => import("./pages/EncryptedSharePage"));`; below line 237 `<Route path="/encrypted-share" element={<EncryptedSharePage />} />`.

`frontend/src/components/Nav/useNavItems.ts`:
- add `"encryptedShare"` to the `useTranslation([...])` list;
- below `const comparisonVisible = isFeatureVisible("comparison");` add `const encryptedShareVisible = isFeatureVisible("encryptedShare");`;
- delete the `...(comparisonVisible ? [ … icon: "trophy" … ] : [])` block at the top of `collections`;
- after the `...(isEnabled("flight") ? [ passport, wrapped ] : [])` spread, insert:
```ts
      // Friends' totals beside the year in review: the other "how am I doing" page. Its own
      // icon — the trophy belongs to the achievements (rework 2026-10-16).
      ...(comparisonVisible
        ? [
            {
              kind: "leaf" as const,
              id: "comparison",
              path: "/compare",
              label: t("comparison:title"),
              icon: "users" as const,
            },
          ]
        : []),
```
- in `tools`, after the parser entry:
```ts
      ...(encryptedShareVisible
        ? [
            {
              kind: "leaf" as const,
              id: "encrypted-share",
              path: "/encrypted-share",
              label: t("encryptedShare:nav"),
              icon: "key-round" as const,
            },
          ]
        : []),
```
- add `encryptedShareVisible` to the `useMemo` dependency list.

`frontend/src/i18n/resources/de/encryptedShare.json`: set `"title": "Verschlüsselt teilen"`, add `"nav": "Verschlüsselt teilen"` and inside `"e2e"` add `"data": "Daten vergleichen"`. `en/encryptedShare.json`: `"title": "Encrypted sharing"`, `"nav": "Encrypted sharing"`, `"e2e"."data": "Compare data"`.

`frontend/src/components/encryptedShare/SealedWorkspace.tsx` — the leaderboard half leaves:
- delete the import `import { rankRows, type Metric, type ComparisonRow } from "./ranking";` and `COMPARISON_METRICS` from the `lib/api/encryptedShare` import;
- delete the states `[rows, setRows]` and `[metric, setMetric]` and every `setRows([])` call;
- in `refresh`, delete `nextRows` and every `nextRows.push(...)`; keep `nextPeople` and the per-member `try` with an empty `catch {}` replaced by `catch { /* An unpublished or unreadable source simply has no data column. */ }`; delete `setRows(nextRows)`;
- delete the `ranked` constant;
- the tab list `"leaderboard"` → `"data"`, `useState("leaderboard")` → `useState("data")`, and the label mapping gains `key === "data" ? "e2e.data" :`;
- replace the block `{(tab === "leaderboard" || tab === "sharing") && ( … )}` with:
```tsx
      {(tab === "data" || tab === "sharing") && (
        <section className="space-y-5 mt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <label>
              {t("year")}
              <input
                type="number"
                min={1900}
                max={2200}
                placeholder={t("lifetime")}
                value={year ?? ""}
                onChange={(e) => {
                  setYear(e.target.value ? Number(e.target.value) : null);
                  setPeople([]);
                }}
              />
            </label>
            <Button disabled={busy} onClick={() => void run(() => refresh(tab === "sharing" && !!circle))}>
              {t("refresh")}
            </Button>
          </div>
          <p>{t("e2e.freshness")}</p>
          {people.length > 0 && <TravelComparison people={people} />}
        </section>
      )}
```
```bash
git rm frontend/src/components/encryptedShare/ranking.ts frontend/src/components/encryptedShare/__tests__/ranking.test.ts
```

Docs:
- `docs/FEDERATION_DEV.md`: title "Encrypted sharing and server connections — DEV forgejo#40"; replace "The UI entry is `/comparison` under More" with "The UI entry is `/encrypted-share` under Tools, behind the beta key `encryptedShare`"; replace "The cookie UI API is `/api/v1/comparison`; encrypted publication routes are nested under `/sealed`." with "The cookie UI API is `/api/v1/encrypted-share`; encrypted publication routes are nested under `/sealed`. The friend leaderboard at `/compare` is a separate feature (spec 2026-10-16) and needs no device keys."; replace the dotenv paragraph's lead-in with "Cross-instance communication needs a server identity. Since 2026-10-16 an admin sets it in **Admin → Instanz → Server-Verbindungen** (origin, key generated in the UI, peers pinned there). `FEDERATION_ENABLED=1` with the variables below still overrides the UI, so existing installs keep their key:".
- `docs/FEDERATION_E2E.md`, after the paragraph starting "There is no plaintext fallback.", add:
```markdown
**Amendment 2026-10-16 (owner decision).** The leaderboard is no longer built on this protocol.
Its aggregate totals travel WITHOUT end-to-end encryption over the signed server-to-server peer
link; this lifts "no plaintext fallback" for leaderboard aggregates only (snapshot schema
`travstats-leaderboard` v1, `backend/src/schemas/comparison.ts` — totals, no records). Full
records never travel unencrypted. This protocol now lives at `/encrypted-share` behind the beta
key `encryptedShare`.
```
- `docs/superpowers/specs/2026-10-10-federation-threat-model.md`, after the status block, add a section `## Implementation update: comparison rework (2026-10-16)` with the two owner decisions verbatim (spec §2) and a link to `2026-10-16-comparison-rework-design.md`.
- `CLAUDE.md`, in "Critical Gotchas" after the Immich bullet:
```markdown
- **Comparison is two features since 2026-10-16** — `/compare` is a leaderboard of
  server-built totals (`services/comparison/**`, one `LeaderboardConsent` per direction). Across
  servers those totals travel Ed25519-signed but NOT end-to-end encrypted (owner decision
  2026-10-16) — and they are totals only: `leaderboardSnapshotSchema` has no field that can hold
  a record. Full records travel only through the device-encrypted transfer at
  `/encrypted-share` (beta key `encryptedShare`), which the leaderboard must never import. A
  comparison consent is NOT a `ShareConsent`: that row authorises trip pushes into an account.
  The server identity lives in `admin_settings` (Admin → Instanz); `FEDERATION_ENABLED=1`
  env vars override it.
```
and in the "Enforced" table:
```markdown
| The leaderboard never imports the encrypted share | `frontend/src/components/encryptedShare/__tests__/separation.test.ts` |
| The leaderboard metric catalogue is the same on both sides | `frontend/src/shared/__tests__/comparisonMetrics.mirror.test.ts` |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/Nav src/__tests__/config/betaFeatures.test.ts src/components/encryptedShare src/components/comparison src/i18n/__tests__/localeKeyParity.test.ts src/content/__tests__/whatsNew.guard.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS. Then from the repo root `node scripts/check-file-size.mjs` → PASS. Then the browser check (CLAUDE.md: a visible change gets a browser look): start the dev stack against the test DB with the beta switch on, log in as two seeded users, ask one by username, accept in the other session, and confirm `/compare` shows both in the Strecke/Reisen tiles and `/encrypted-share` still opens the E2E workspace.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages frontend/src/App.tsx frontend/src/components/Nav frontend/src/components/ui/icons/lucide.ts frontend/src/config/betaFeatures.ts frontend/src/components/encryptedShare frontend/src/i18n/resources docs CLAUDE.md
git commit -m "feat(comparison): /compare shows the new leaderboard; encrypted sharing moves to its own page

The leaderboard is behind the existing comparison switch; the device-encrypted transfer keeps
working at /encrypted-share behind its own beta key until the owner keeps or cuts it.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019k3MqF2H8eBhQvfbykfZ3N"
```

After this task: rebuild the Leitstand board (`D:\Projekte\CC\tools\leitstand\leitstand.cmd --no-open`) and add/adjust the forgejo#40 item in `roadmap.local.yaml` (gitignored, never committed). Report the branch as done and ask the merge question in isolation.

---

## Self-Review

**Spec coverage.**
| Spec section | Task(s) |
|---|---|
| §2 owner decisions | 11 (signed, unencrypted aggregates), 16/22 (E2E behind `encryptedShare`), 22 (docs carry them verbatim) |
| §5 corrected review claims (ShareConsent, circles) | 9 (separate consent table, people model reused), 1 (circles stay, groups dropped) |
| §6 architecture / ownership | 1, 3, 7, 11-14 |
| §7.1 tables + CHECKs | 8 |
| §7.2 admin_settings, peer versions, drop groups | 3, 1 |
| §7.3 data copy and what users see | 8 (copy + test), 22 (copy in registry/docs) |
| §7.4 restore | 15 |
| §7.5 export | 1, 8 |
| §8 metrics incl. ferry/tours/places, absent vs null, partial, ranking | 6, 7, 17 |
| §9.1 cookie API, family, limiters, codes, OpenAPI | 2, 14 |
| §9.2 admin API | 4 |
| §9.3 peer protocol, refusal kinds | 2, 11 |
| §10 mixed versions | 4 (versions stored on verify), 11 (ping advertises), 12 (outdated detection) |
| §11 UI, consent dialog, admin card, nav, removed CSS/PeerManager | 5, 16-22 |
| §12 rollout order | task order: separation (1-5) → backend (6-15) → frontend unrouted (16-21) → switch (22) |
| §13 deletions | 1 (boards/audit/groups), 4 (peers routes), 5 (PeerManager), 22 (ranking) |

**Placeholder scan.** No "TBD"/"similar to". Migration directory names are generated by Prisma (`*_name`); the tests locate them by suffix, not by a guessed timestamp. Every code step carries the final code; no step says "adjust as needed".

**Type consistency.** `LeaderboardScope`/`LeaderboardSnapshot`/`PersonView`/`BoardView`/`RowStatus` are defined in Task 6 (backend) and mirrored in Task 17 (frontend); `RemoteResult` (Task 12) feeds `readLeaderboard` (Task 13); `comparisonError`/`ComparisonErrorCode` (Task 2) are used from Task 4 on; `PeerRefusal.kind` (Task 2) is asserted in Tasks 2, 3, 11; `Identity.source` (Task 3) feeds `FederationState.source` (Task 4) and the admin card (Task 5); `envelope(body, destination, local, nonce?)` changes in Task 3 together with its two callers and the sandbox script; `SERVED_VERSIONS` (Task 6) is used by Tasks 11 and 12; `LeaderboardMetric` (Task 17) is the tile's prop type in Task 19.

**Review focus.** All five failure modes have a pinning test in the named task: deactivated owner (11 "answers notShared for a deactivated owner", 13 first test), year widening (7 "refuses a year … including the lifetime view", 13 second test), cross-origin channel (11 "refuses a channel from another origin"), board IDOR + withdrawn member (10 "does not find another user's board", 13 third test), hostile metric record (6 "rejects prototype names…", 12 last `pullRemote` case).

**Known judgement calls (for the reviewer).** (1) `countries` stays lifetime-only, as `snapshots.ts` already decided. (2) The leaderboard cap (50+20 rows) and limiter numbers are first values to measure on the RC, as the registry's `returnsWhen` says. (3) `comparison.css` is moved, not deleted: the frozen E2E forms still need it.
