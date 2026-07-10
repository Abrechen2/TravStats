# Usage-Stats Client + Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in, instance-wide anonymous usage ping: consent storage, a pure payload builder, a best-effort daily cron, server-side erasure on withdrawal, and three consent surfaces (setup, What's-New, admin toggle).

**Architecture:** Two new `AdminSettings` columns hold consent state and a random install id. `buildUsagePayload()` is a pure aggregation over Prisma with zero network I/O, which is what makes the no-PII test possible. A `node-cron` job pings daily with jitter and swallows every error — telemetry must never affect the running app. Flipping consent to `denied` fires one `DELETE` so erasure needs no e-mail.

**Tech Stack:** Express, Prisma, Zod, node-cron, Jest (backend); React 19, Zustand, Vitest (frontend).

## Global Constraints

- Specs: `docs/superpowers/specs/2026-07-10-anonymous-usage-stats-design.md`. **Read §3 (GDPR) and §5 (payload provenance table) before writing any code.** The provenance table is authoritative; the brainstorm was wrong about five fields.
- **Depends on Plan 1** (`WhatsNewModal` with its `extraSlot` prop). Task 6 will not compile without it.
- Branch `dev/usage-stats`, worktree `.claude/worktrees/usage-stats`. Never `rebase main`.
- **Never touch `backend/VERSION` or `CHANGELOG.md`.**
- `any` is FORBIDDEN — `unknown` + type guards.
- `import { logger } from '../utils/logger'`. Never `console.log`.
- Prisma JSON fields: cast via `as unknown as Prisma.InputJsonValue`.
- Frontend: `useTranslation` from `"../hooks/useTranslation"`, never `react-i18next`.
- i18n: DE primary + EN mirror, always in the same change.
- **`TRAVSTATS_STATS_ENDPOINT` holds a BASE URL** (default `https://stats.travstats.de`). The client appends `/v1/ping` and `/v1/install/<id>`. An empty string disables all sending regardless of consent.
- **Telemetry never throws.** Every network path swallows, logs at `debug`, returns.
- Build gates: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`; `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`.

## Facts learned while building Plan 1 — these bind this plan

Plan 1 shipped. Its code is on this branch and its final review surfaced things that
change how the consent card must be written. Do not rediscover these.

- **The modal's `onClose` fires from BOTH the `×` and the dismiss button, and both
  persist `whatsNewSeenVersion`.** Therefore: **never hang consent persistence off
  modal close.** The consent card persists the moment the user picks Yes or No.
  "Modal closed without interacting" means **no consent — stays `unset`, nothing is
  sent.** That is the GDPR-safe default and it is not negotiable.
- Once `whatsNewSeenVersion` is stamped for a version, **the modal never returns for
  that version.** A user who closes it without deciding is never re-asked *there*.
  That is acceptable **only because** the Admin toggle is always available (Task 8,
  Step 3). Do not add a second nag surface.
- **`whatsNewSeenVersion` is version-scoped, not consent-scoped.** Do not overload it
  to remember the consent decision. Consent lives in `AdminSettings.usageStatsConsent`.
- The modal deliberately has **no Escape handler and no overlay-click close** — a
  consent surface must not be dismissable by a stray keypress. Do not "fix" that.
- **`extraSlot` renders inside the modal's scrollable body** (`max-h-[90vh]`,
  `overflow-y-auto`), below the highlights, above the pinned footer. A tall consent
  card scrolls. Keep it short enough that both buttons are reachable without hunting.
- **The frontend has NO icon library.** `lucide-react` is not a dependency. Use emoji
  glyphs, as `shared/domains.ts` does. **`--color-accent` and `--text-on-accent` do
  not exist**; primary buttons use Tailwind `bg-blue-600 text-white hover:bg-blue-700`.
- **`UserSettings.data` is read-modify-write with last-write-wins**, and Plan 1's
  `dismiss()` added an automatic login-time writer. This plan writes consent to
  `AdminSettings` columns, not to that blob — keep it that way and the collision
  window stays where it was.
- **`[role="dialog"]` is used by ~10 components** (`FlightPanel` renders one on the
  dashboard). Any browser test must anchor on a specific `id`, never the bare role.
- The `AdminSettings` singleton is **the first row** (`findFirst()`), because `id` is
  an autoincrement `Int`. Never hard-code `id: 1`.

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/schema.prisma` | **Modify.** Two `AdminSettings` columns. |
| `backend/prisma/migrations/<ts>_usage_stats_consent/migration.sql` | **Create (hand-written).** See Task 1 — do **not** let `prisma migrate dev` author it. |
| `backend/src/services/usageStats/consent.ts` | **Create.** Consent state + install id. Nothing else. |
| `backend/src/services/usageStats/buckets.ts` | **Create.** Pure bucket + rounding functions. No I/O. |
| `backend/src/services/usageStats/payload.ts` | **Create.** `buildUsagePayload()` — pure DB aggregation, no network. |
| `backend/src/services/usageStats/transport.ts` | **Create.** `sendPing` / `sendErasure` — the only files that touch the network. |
| `backend/src/services/usageStats/index.ts` | **Create.** Barrel re-export. |
| `backend/src/jobs/usageStatsScheduler.ts` | **Create.** `startUsageStatsScheduler()` / `stopUsageStatsScheduler()`. |
| `backend/src/index.ts` | **Modify.** Start/stop wiring. |
| `backend/src/routes/admin/usageStats.ts` | **Create.** Admin GET/PUT consent. |
| `backend/src/routes/admin/index.ts` | **Modify.** Mount the router. |
| `backend/src/routes/setup.ts` | **Modify.** Accept `usageStatsConsent` at first boot. |
| `frontend/src/lib/api/usageStats.ts` | **Create.** `usageStatsApi`. |
| `frontend/src/lib/api/index.ts` | **Modify.** Re-export. |
| `frontend/src/components/UsageStatsConsentCard.tsx` | **Create.** Shared consent UI, used by setup + What's-New. |
| `frontend/src/components/Admin/UsageStatsSettings.tsx` | **Create.** Permanent admin toggle + install-id display. |

The service is split into four small files rather than one `usageStats.ts`, because
`payload.ts` must be trivially testable in isolation — it is the file the no-PII test
guards, and mixing network code into it would force network mocks into that test.

---

### Task 1: Schema + hand-written migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260710120000_usage_stats_consent/migration.sql`

**Interfaces:**
- Produces: `AdminSettings.usageStatsConsent: String @default("unset")` and `AdminSettings.usageStatsInstallId: String?`. Every later task reads these exact names.

> **Do not run `npx prisma migrate dev`.** `schema.prisma` carries known
> pre-existing drift versus the migration history (NOT-NULL flips on
> `flights.has_live_tracking` and `user_settings.historical_enrichment_*`, plus
> unrelated `DROP INDEX` reconciliations). `migrate dev` would bundle that drift
> into this migration and break production on deploy. Hand-write the SQL, exactly
> as the cruise migrations did. See the "Cruise migrations" note in `CLAUDE.md`.

- [ ] **Step 1: Add the columns to the schema**

In `backend/prisma/schema.prisma`, inside `model AdminSettings`, after the logging
block and before `createdAt`:

```prisma
  // === ANONYMOUS USAGE STATISTICS (opt-in) ===
  // Consent is instance-wide and admin-only. 'unset' | 'granted' | 'denied'.
  // Only 'granted' ever sends. The install id is a purely random uuid4 — never
  // derived from IP, hostname, MAC, or paths.
  usageStatsConsent   String  @default("unset") @map("usage_stats_consent")
  usageStatsInstallId String? @map("usage_stats_install_id")
```

- [ ] **Step 2: Hand-write the migration**

Create `backend/prisma/migrations/20260710120000_usage_stats_consent/migration.sql`:

```sql
-- Anonymous usage statistics: instance-wide opt-in consent + random install id.
-- Hand-written (not `prisma migrate dev`) to avoid bundling pre-existing
-- schema drift into this migration. See CLAUDE.md, "Cruise migrations".

ALTER TABLE "admin_settings"
  ADD COLUMN "usage_stats_consent" TEXT NOT NULL DEFAULT 'unset',
  ADD COLUMN "usage_stats_install_id" TEXT;
```

- [ ] **Step 3: Apply and regenerate**

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx prisma migrate deploy
npx prisma generate
```

Expected: "1 migration applied". If `prisma generate` fails with
`EPERM ... query_engine-windows.dll.node`, a backend process holds the DLL — see
the Prisma-DLL-lock workaround in `CLAUDE.local.md`. Do **not** run `taskkill`.

- [ ] **Step 4: Verify the column landed and nothing else moved**

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx prisma migrate status
```
Expected: "Database schema is up to date!" and **no** drift warning naming tables
other than `admin_settings`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260710120000_usage_stats_consent/
git commit -m "feat(usage-stats): add instance consent + install-id columns to AdminSettings"
```

---

### Task 2: Pure buckets and rounding

**Files:**
- Create: `backend/src/services/usageStats/buckets.ts`
- Test: `backend/src/services/usageStats/__tests__/buckets.test.ts`

**Interfaces:**
- Consumes: nothing. Zero imports. This file must stay I/O-free.
- Produces: `bucketUsers(n: number): UsersBucket`, `bucketFlights(n: number): FlightsBucket`, `bucketCruises(n: number): CruisesBucket`, `roundKm(km: number): number`, `detectArch(): "amd64" | "arm64" | string`, and the exported bucket union types. Task 4 imports all of them.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/usageStats/__tests__/buckets.test.ts`. Boundaries are
where bucket bugs live, so every boundary is asserted on both sides.

```typescript
import { bucketUsers, bucketFlights, bucketCruises, roundKm } from "../buckets";

describe("bucketUsers", () => {
  it.each([
    [1, "1"],
    [2, "2-5"],
    [5, "2-5"],
    [6, "6-20"],
    [20, "6-20"],
    [21, "20+"],
  ])("maps %i to %s", (n, expected) => {
    expect(bucketUsers(n)).toBe(expected);
  });
});

describe("bucketFlights", () => {
  it.each([
    [0, "<50"],
    [49, "<50"],
    [50, "50-250"],
    [250, "50-250"],
    [251, "250-1k"],
    [1000, "250-1k"],
    [1001, "1k+"],
  ])("maps %i to %s", (n, expected) => {
    expect(bucketFlights(n)).toBe(expected);
  });
});

describe("bucketCruises", () => {
  it("has an explicit zero bucket", () => {
    expect(bucketCruises(0)).toBe("0");
  });
  it.each([
    [1, "1-5"],
    [5, "1-5"],
    [6, "6-20"],
    [20, "6-20"],
    [21, "20+"],
  ])("maps %i to %s", (n, expected) => {
    expect(bucketCruises(n)).toBe(expected);
  });
});

describe("roundKm", () => {
  it("rounds to the nearest 100", () => {
    expect(roundKm(128_437)).toBe(128_400);
    expect(roundKm(128_450)).toBe(128_500);
    expect(roundKm(49)).toBe(0);
    expect(roundKm(0)).toBe(0);
  });
  it("never returns a fractional value", () => {
    expect(Number.isInteger(roundKm(1234.567))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- --forceExit buckets
```
Expected: FAIL — "Cannot find module '../buckets'".

- [ ] **Step 3: Implement**

`backend/src/services/usageStats/buckets.ts`:

```typescript
/**
 * Pure, I/O-free coarsening helpers for the anonymous usage payload.
 *
 * Exact counts are never sent. Distances are rounded so that an exact odd
 * number cannot act as a de-facto instance fingerprint across pings.
 */

export type UsersBucket = "1" | "2-5" | "6-20" | "20+";
export type FlightsBucket = "<50" | "50-250" | "250-1k" | "1k+";
export type CruisesBucket = "0" | "1-5" | "6-20" | "20+";

export function bucketUsers(n: number): UsersBucket {
  if (n <= 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  return "20+";
}

export function bucketFlights(n: number): FlightsBucket {
  if (n < 50) return "<50";
  if (n <= 250) return "50-250";
  if (n <= 1000) return "250-1k";
  return "1k+";
}

/** Zero is its own bucket: "domain enabled but never used" is the signal we want. */
export function bucketCruises(n: number): CruisesBucket {
  if (n === 0) return "0";
  if (n <= 5) return "1-5";
  if (n <= 20) return "6-20";
  return "20+";
}

/** Round to the nearest 100 km. */
export function roundKm(km: number): number {
  return Math.round(km / 100) * 100;
}

const ARCH_MAP: Record<string, string> = {
  x64: "amd64",
  x86_64: "amd64",
  arm64: "arm64",
  aarch64: "arm64",
};

export function detectArch(): string {
  return ARCH_MAP[process.arch] ?? process.arch;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- --forceExit buckets
```
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/usageStats/buckets.ts backend/src/services/usageStats/__tests__/buckets.test.ts
git commit -m "feat(usage-stats): add pure bucket + rounding helpers"
```

---

### Task 3: Consent state + install id

**Files:**
- Create: `backend/src/services/usageStats/consent.ts`
- Test: `backend/src/services/usageStats/__tests__/consent.test.ts`

**Interfaces:**
- Consumes: `prisma` from `backend/src/db`.
- Produces: `getConsent(): Promise<ConsentState>`, `setConsent(value: ConsentState): Promise<void>`, `getOrCreateInstallId(): Promise<string>`, `getInstallId(): Promise<string | null>`, `getStatsBaseUrl(): string`, and `type ConsentState = "unset" | "granted" | "denied"`. Tasks 4, 5, 6, 7 all import from here.

The `AdminSettings` singleton is **the first row**, found via `findFirst()` — its
`id` is an autoincrement `Int`, so never hard-code `id: 1`. Mirror the
`ensureAdminSettings()` helper in `backend/src/services/instanceSettingsService.ts`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/usageStats/__tests__/consent.test.ts`:

```typescript
jest.mock("../../../db", () => ({
  prisma: {
    adminSettings: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  },
}));

import { getConsent, setConsent, getOrCreateInstallId, getStatsBaseUrl } from "../consent";
import { prisma } from "../../../db";

const mockPrisma = prisma as unknown as {
  adminSettings: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.TRAVSTATS_STATS_ENDPOINT;
});

describe("getConsent", () => {
  it("returns the stored state", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsConsent: "granted" });
    await expect(getConsent()).resolves.toBe("granted");
  });

  it("defaults to unset when no settings row exists", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue(null);
    await expect(getConsent()).resolves.toBe("unset");
  });

  it("coerces an unrecognised value to unset", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsConsent: "yolo" });
    await expect(getConsent()).resolves.toBe("unset");
  });
});

describe("setConsent", () => {
  it("rejects an invalid value without touching the DB", async () => {
    await expect(setConsent("maybe" as never)).rejects.toThrow(/invalid consent/i);
    expect(mockPrisma.adminSettings.update).not.toHaveBeenCalled();
  });

  it("updates the singleton by its real id", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7 });
    await setConsent("denied");
    expect(mockPrisma.adminSettings.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { usageStatsConsent: "denied" },
    });
  });
});

describe("getOrCreateInstallId", () => {
  it("returns the existing id without writing", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsInstallId: "abc123" });
    await expect(getOrCreateInstallId()).resolves.toBe("abc123");
    expect(mockPrisma.adminSettings.update).not.toHaveBeenCalled();
  });

  it("generates and persists a 32-char hex id on first call", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsInstallId: null });
    const id = await getOrCreateInstallId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(mockPrisma.adminSettings.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { usageStatsInstallId: id },
    });
  });

  it("is stable across calls", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsInstallId: "stable99" });
    expect(await getOrCreateInstallId()).toBe(await getOrCreateInstallId());
  });
});

describe("getStatsBaseUrl", () => {
  it("defaults to the public endpoint", () => {
    expect(getStatsBaseUrl()).toBe("https://stats.travstats.de");
  });

  it("returns an empty string when explicitly disabled", () => {
    process.env.TRAVSTATS_STATS_ENDPOINT = "";
    expect(getStatsBaseUrl()).toBe("");
  });

  it("strips a trailing slash so path joins stay clean", () => {
    process.env.TRAVSTATS_STATS_ENDPOINT = "https://example.test/";
    expect(getStatsBaseUrl()).toBe("https://example.test");
  });
});
```

Note the empty-string case: `process.env.X = ""` is distinguishable from unset
(`delete process.env.X`), and the kill-switch depends on that distinction. `??` would
NOT work here — an empty string is not nullish. Use an explicit `undefined` check.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- --forceExit usageStats/__tests__/consent
```
Expected: FAIL — "Cannot find module '../consent'".

- [ ] **Step 3: Implement**

`backend/src/services/usageStats/consent.ts`:

```typescript
import { randomUUID } from "crypto";
import { prisma } from "../../db";

export type ConsentState = "unset" | "granted" | "denied";

const VALID_CONSENT: readonly ConsentState[] = ["unset", "granted", "denied"];
const DEFAULT_BASE_URL = "https://stats.travstats.de";

function isConsentState(value: unknown): value is ConsentState {
  return typeof value === "string" && (VALID_CONSENT as readonly string[]).includes(value);
}

/** The AdminSettings singleton is the first row — its id is autoincrement, never 1 by contract. */
async function ensureAdminSettings(): Promise<{ id: number }> {
  const existing = await prisma.adminSettings.findFirst();
  if (existing) return existing;
  return prisma.adminSettings.create({ data: {} });
}

export async function getConsent(): Promise<ConsentState> {
  const row = await prisma.adminSettings.findFirst();
  return isConsentState(row?.usageStatsConsent) ? row.usageStatsConsent : "unset";
}

export async function setConsent(value: ConsentState): Promise<void> {
  if (!isConsentState(value)) {
    throw new Error(`invalid consent value: ${String(value)}`);
  }
  const row = await ensureAdminSettings();
  await prisma.adminSettings.update({
    where: { id: row.id },
    data: { usageStatsConsent: value },
  });
}

export async function getInstallId(): Promise<string | null> {
  const row = await prisma.adminSettings.findFirst();
  return row?.usageStatsInstallId ?? null;
}

/**
 * The anonymous dedup key. A purely random uuid4 — never derived from IP,
 * hostname, MAC, database id, or any filesystem path.
 */
export async function getOrCreateInstallId(): Promise<string> {
  const row = await ensureAdminSettings();
  const existing = await prisma.adminSettings.findFirst();
  if (existing?.usageStatsInstallId) return existing.usageStatsInstallId;

  const newId = randomUUID().replace(/-/g, "");
  await prisma.adminSettings.update({
    where: { id: row.id },
    data: { usageStatsInstallId: newId },
  });
  return newId;
}

/**
 * Base URL of the stats service. An **empty string disables all sending**,
 * regardless of consent — the self-hoster override and kill-switch.
 */
export function getStatsBaseUrl(): string {
  const raw = process.env.TRAVSTATS_STATS_ENDPOINT;
  const value = raw === undefined ? DEFAULT_BASE_URL : raw;
  return value.replace(/\/+$/, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- --forceExit usageStats/__tests__/consent
```
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/usageStats/consent.ts backend/src/services/usageStats/__tests__/consent.test.ts
git commit -m "feat(usage-stats): add consent state, random install id and endpoint kill-switch"
```

---

### Task 4: `buildUsagePayload()` — pure aggregation

**Files:**
- Create: `backend/src/services/usageStats/payload.ts`
- Test: `backend/src/services/usageStats/__tests__/payload.test.ts`

**Interfaces:**
- Consumes: `buckets.ts` (Task 2), `consent.ts` (Task 3), `prisma`, `appVersion` from `backend/src/utils/version.ts`.
- Produces: `buildUsagePayload(): Promise<UsagePayload>` and `export interface UsagePayload`. Task 5 sends it; Plan 3's Zod schema must accept exactly this shape.

**Every field's source is fixed by the provenance table in §5 of the spec.** Do not
improvise. In particular: `enabled_domains`, `historical_enrichment` and `locale`
are per-**user** and must be aggregated; there is no Immich integration; and
`live_tracking` is a per-flight boolean.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/usageStats/__tests__/payload.test.ts`. The last test is
the important one — it scans for PII rather than asserting expected keys, because
asserting presence cannot catch an accidental *addition*.

```typescript
jest.mock("../../../db", () => ({
  prisma: {
    adminSettings: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    user: { count: jest.fn() },
    flight: { count: jest.fn(), aggregate: jest.fn(), findFirst: jest.fn() },
    cruise: { count: jest.fn() },
    cruiseLeg: { aggregate: jest.fn() },
    userAchievement: { count: jest.fn(), findMany: jest.fn() },
    userSettings: { findMany: jest.fn() },
  },
}));

jest.mock("../../../utils/version", () => ({ appVersion: "2.4.0" }));

import { buildUsagePayload } from "../payload";
import { prisma } from "../../../db";

/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles only */
const p = prisma as any;

function happyPath(): void {
  p.adminSettings.findFirst.mockResolvedValue({
    id: 3,
    usageStatsInstallId: "aaaaaaaabbbbccccddddeeeeffff0000",
    ollamaUrl: "http://ollama:11434",
    globalOpenaiApiKey: null,
    globalClaudeApiKey: null,
    globalAirlabsApiKey: "enc",
    globalAviationstackApiKey: null,
    globalAerodataboxApiKey: null,
    globalOpenskyClientId: "enc",
    backupEnabled: true,
    webdavSyncEnabled: false,
  });
  p.user.count.mockResolvedValue(3);
  p.flight.count.mockResolvedValue(120);
  p.cruise.count.mockResolvedValue(0);
  p.flight.aggregate.mockResolvedValue({ _sum: { routeDistance: 128_437.2 } });
  p.cruiseLeg.aggregate.mockResolvedValue({ _sum: { distanceKm: 9_183.4 } });
  p.userAchievement.count.mockResolvedValue(87);
  p.userAchievement.findMany.mockResolvedValue([
    { achievement: { code: "globetrotter" } },
    { achievement: { code: "night_owl" } },
    { achievement: { code: "globetrotter" } },
  ]);
  p.flight.findFirst.mockResolvedValue({ id: "f1" }); // some flight has live tracking
  p.userSettings.findMany.mockResolvedValue([
    { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: { display: { language: "de" } } },
    { enabledDomains: ["flight", "cruise"], historicalEnrichmentEnabled: true, data: { display: { language: "de" } } },
    { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: { display: { language: "en" } } },
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  happyPath();
});

describe("buildUsagePayload", () => {
  it("reports the stripped app version", async () => {
    expect((await buildUsagePayload()).version).toBe("2.4.0");
  });

  it("unions enabled domains across users", async () => {
    expect((await buildUsagePayload()).enabled_domains.sort()).toEqual(["cruise", "flight"]);
  });

  it("buckets counts instead of reporting them exactly", async () => {
    const payload = await buildUsagePayload();
    expect(payload.users_bucket).toBe("2-5");
    expect(payload.flights_bucket).toBe("50-250");
    expect(payload.cruises_bucket).toBe("0");
  });

  it("rounds distances to the nearest 100 km", async () => {
    const payload = await buildUsagePayload();
    expect(payload.distance_km.flight).toBe(128_400);
    expect(payload.distance_km.cruise).toBe(9_200);
  });

  it("treats a null distance sum as zero", async () => {
    p.flight.aggregate.mockResolvedValue({ _sum: { routeDistance: null } });
    expect((await buildUsagePayload()).distance_km.flight).toBe(0);
  });

  it("deduplicates achievement codes and reports the total separately", async () => {
    const payload = await buildUsagePayload();
    expect(payload.achievements.unlocked_total).toBe(87);
    expect(payload.achievements.keys.sort()).toEqual(["globetrotter", "night_owl"]);
  });

  it("derives llm_parser from ollamaUrl or a global LLM key", async () => {
    expect((await buildUsagePayload()).features.llm_parser).toBe(true);
    p.adminSettings.findFirst.mockResolvedValue({
      id: 3, usageStatsInstallId: "x", ollamaUrl: null,
      globalOpenaiApiKey: null, globalClaudeApiKey: null,
      backupEnabled: false, webdavSyncEnabled: false,
    });
    expect((await buildUsagePayload()).features.llm_parser).toBe(false);
  });

  it("reports historical_enrichment when ANY user enabled it", async () => {
    expect((await buildUsagePayload()).features.historical_enrichment).toBe(true);
  });

  it("reports live_tracking from the existence of a tracked flight", async () => {
    expect((await buildUsagePayload()).features.live_tracking).toBe(true);
    p.flight.findFirst.mockResolvedValue(null);
    expect((await buildUsagePayload()).features.live_tracking).toBe(false);
  });

  it("lists configured provider names only, never key values", async () => {
    const payload = await buildUsagePayload();
    expect(payload.flight_api_providers.sort()).toEqual(["airlabs", "opensky"]);
    expect(JSON.stringify(payload)).not.toContain("enc");
  });

  it("picks the majority locale, breaking ties toward en", async () => {
    expect((await buildUsagePayload()).locale).toBe("de");
    p.userSettings.findMany.mockResolvedValue([
      { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: { display: { language: "de" } } },
      { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: { display: { language: "en" } } },
    ]);
    expect((await buildUsagePayload()).locale).toBe("en");
  });

  it("survives a malformed settings data blob", async () => {
    p.userSettings.findMany.mockResolvedValue([
      { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: null },
      { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: "not-an-object" },
    ]);
    await expect(buildUsagePayload()).resolves.toBeDefined();
  });

  it("contains NO personally identifying data", async () => {
    const serialized = JSON.stringify(await buildUsagePayload()).toLowerCase();
    const forbidden = [
      "password", "username", "@", "http://", "https://", "/app/", "c:\\",
      "hostname", "apikey", "api_key", "token", "secret", "email",
    ];
    for (const needle of forbidden) {
      expect(serialized, `payload leaked ${needle}`).not.toContain(needle);
    }
  });
});
```

Note the `"https://"` needle: it is why the payload must never echo `ollamaUrl` — only
the derived boolean.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- --forceExit usageStats/__tests__/payload
```
Expected: FAIL — "Cannot find module '../payload'".

- [ ] **Step 3: Implement**

`backend/src/services/usageStats/payload.ts`:

```typescript
import { prisma } from "../../db";
import { appVersion } from "../../utils/version";
import {
  bucketCruises,
  bucketFlights,
  bucketUsers,
  detectArch,
  roundKm,
  type CruisesBucket,
  type FlightsBucket,
  type UsersBucket,
} from "./buckets";
import { getOrCreateInstallId } from "./consent";

export interface UsagePayload {
  install_id: string;
  version: string;
  arch: string;
  enabled_domains: string[];
  users_bucket: UsersBucket;
  flights_bucket: FlightsBucket;
  cruises_bucket: CruisesBucket;
  distance_km: { flight: number; cruise: number };
  achievements: { unlocked_total: number; keys: string[] };
  features: {
    llm_parser: boolean;
    backups: boolean;
    webdav_sync: boolean;
    historical_enrichment: boolean;
    live_tracking: boolean;
  };
  flight_api_providers: string[];
  locale: string;
  reported_at: string;
}

/** Read `data.display.language` out of the free-form UserSettings JSON blob. */
function readLanguage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const display = (data as Record<string, unknown>).display;
  if (typeof display !== "object" || display === null) return null;
  const language = (display as Record<string, unknown>).language;
  return typeof language === "string" ? language : null;
}

/** Most frequent language across users; ties resolve to "en". */
function majorityLocale(languages: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const lang of languages) counts.set(lang, (counts.get(lang) ?? 0) + 1);

  let best = "en";
  let bestCount = 0;
  for (const [lang, count] of counts) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Build the anonymous usage payload.
 *
 * Pure aggregation over the database — no network I/O, which is what makes the
 * no-PII assertion in the tests meaningful. Never include IP, hostname, paths,
 * airport/port/ship/airline names, travel dates, usernames, or API keys.
 */
export async function buildUsagePayload(): Promise<UsagePayload> {
  const [
    installId,
    admin,
    userCount,
    flightCount,
    cruiseCount,
    flightDistance,
    cruiseDistance,
    achievementTotal,
    achievementRows,
    trackedFlight,
    allUserSettings,
  ] = await Promise.all([
    getOrCreateInstallId(),
    prisma.adminSettings.findFirst(),
    prisma.user.count(),
    prisma.flight.count(),
    prisma.cruise.count(),
    prisma.flight.aggregate({ _sum: { routeDistance: true } }),
    prisma.cruiseLeg.aggregate({ _sum: { distanceKm: true } }),
    prisma.userAchievement.count(),
    prisma.userAchievement.findMany({ select: { achievement: { select: { code: true } } } }),
    prisma.flight.findFirst({ where: { hasLiveTracking: true }, select: { id: true } }),
    prisma.userSettings.findMany({
      select: { enabledDomains: true, historicalEnrichmentEnabled: true, data: true },
    }),
  ]);

  const providerColumns: ReadonlyArray<readonly [string, unknown]> = [
    ["airlabs", admin?.globalAirlabsApiKey],
    ["aviationstack", admin?.globalAviationstackApiKey],
    ["aerodatabox", admin?.globalAerodataboxApiKey],
    ["opensky", admin?.globalOpenskyClientId],
  ];

  const languages = allUserSettings
    .map((s) => readLanguage(s.data))
    .filter((lang): lang is string => lang !== null);

  return {
    install_id: installId,
    version: appVersion,
    arch: detectArch(),
    enabled_domains: [...new Set(allUserSettings.flatMap((s) => s.enabledDomains))],
    users_bucket: bucketUsers(userCount),
    flights_bucket: bucketFlights(flightCount),
    cruises_bucket: bucketCruises(cruiseCount),
    distance_km: {
      flight: roundKm(flightDistance._sum.routeDistance ?? 0),
      cruise: roundKm(cruiseDistance._sum.distanceKm ?? 0),
    },
    achievements: {
      unlocked_total: achievementTotal,
      keys: [...new Set(achievementRows.map((row) => row.achievement.code))],
    },
    features: {
      llm_parser: Boolean(admin?.ollamaUrl ?? admin?.globalOpenaiApiKey ?? admin?.globalClaudeApiKey),
      backups: Boolean(admin?.backupEnabled),
      webdav_sync: Boolean(admin?.webdavSyncEnabled),
      historical_enrichment: allUserSettings.some((s) => s.historicalEnrichmentEnabled === true),
      live_tracking: trackedFlight !== null,
    },
    flight_api_providers: providerColumns.filter(([, value]) => Boolean(value)).map(([name]) => name),
    locale: majorityLocale(languages),
    reported_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- --forceExit usageStats/__tests__/payload
```
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/usageStats/payload.ts backend/src/services/usageStats/__tests__/payload.test.ts
git commit -m "feat(usage-stats): add pure buildUsagePayload with a no-PII guarantee test"
```

---

### Task 5: Transport + scheduler

**Files:**
- Create: `backend/src/services/usageStats/transport.ts`
- Create: `backend/src/services/usageStats/index.ts`
- Create: `backend/src/jobs/usageStatsScheduler.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/services/usageStats/__tests__/transport.test.ts`

**Interfaces:**
- Consumes: `consent.ts` (Task 3), `payload.ts` (Task 4).
- Produces: `sendPing(payload, baseUrl): Promise<boolean>`, `sendErasure(installId, baseUrl): Promise<boolean>`, `usageStatsTick(): Promise<void>`, `startUsageStatsScheduler(): void`, `stopUsageStatsScheduler(): void`. Task 6's admin route calls `usageStatsTick` and `sendErasure`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/usageStats/__tests__/transport.test.ts`:

```typescript
jest.mock("../consent", () => ({
  getConsent: jest.fn(),
  getStatsBaseUrl: jest.fn(),
  getInstallId: jest.fn(),
}));
jest.mock("../payload", () => ({ buildUsagePayload: jest.fn() }));

import { sendPing, sendErasure, usageStatsTick } from "../transport";
import { getConsent, getStatsBaseUrl } from "../consent";
import { buildUsagePayload } from "../payload";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const PAYLOAD = { install_id: "abc", version: "2.4.0" } as never;

beforeEach(() => {
  jest.clearAllMocks();
  (buildUsagePayload as jest.Mock).mockResolvedValue(PAYLOAD);
  (getStatsBaseUrl as jest.Mock).mockReturnValue("https://stats.test");
  (getConsent as jest.Mock).mockResolvedValue("granted");
});

describe("sendPing", () => {
  it("POSTs to <base>/v1/ping and reports success", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    await expect(sendPing(PAYLOAD, "https://stats.test")).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://stats.test/v1/ping",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns false on a non-2xx response, and does not throw", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(sendPing(PAYLOAD, "https://stats.test")).resolves.toBe(false);
  });

  it("returns false when the network rejects, and does not throw", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(sendPing(PAYLOAD, "https://stats.test")).resolves.toBe(false);
  });
});

describe("sendErasure", () => {
  it("DELETEs <base>/v1/install/<id>", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    await expect(sendErasure("abc123", "https://stats.test")).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://stats.test/v1/install/abc123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("never throws on failure", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));
    await expect(sendErasure("abc123", "https://stats.test")).resolves.toBe(false);
  });
});

describe("usageStatsTick", () => {
  it("sends when consent is granted", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    await usageStatsTick();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each(["unset", "denied"])("sends nothing when consent is %s", async (state) => {
    (getConsent as jest.Mock).mockResolvedValue(state);
    await usageStatsTick();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(buildUsagePayload).not.toHaveBeenCalled();
  });

  it("sends nothing when the endpoint is empty, even when granted", async () => {
    (getStatsBaseUrl as jest.Mock).mockReturnValue("");
    await usageStatsTick();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never throws when payload construction blows up", async () => {
    (buildUsagePayload as jest.Mock).mockRejectedValue(new Error("db down"));
    await expect(usageStatsTick()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- --forceExit usageStats/__tests__/transport
```
Expected: FAIL — "Cannot find module '../transport'".

- [ ] **Step 3: Implement the transport**

`backend/src/services/usageStats/transport.ts`. Node 22+ has global `fetch`; no
`axios` dependency needed here.

```typescript
import { logger } from "../../utils/logger";
import { getConsent, getStatsBaseUrl } from "./consent";
import { buildUsagePayload, type UsagePayload } from "./payload";

const TIMEOUT_MS = 5_000;

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** POST the payload. Never throws — telemetry must never affect the running app. */
export async function sendPing(payload: UsagePayload, baseUrl: string): Promise<boolean> {
  try {
    const response = await withTimeout((signal) =>
      fetch(`${baseUrl}/v1/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      }),
    );
    return response.ok;
  } catch (error) {
    logger.debug({ error }, "usage-stats ping failed");
    return false;
  }
}

/** Consent withdrawal: ask the server to erase this install's row. Never throws. */
export async function sendErasure(installId: string, baseUrl: string): Promise<boolean> {
  try {
    const response = await withTimeout((signal) =>
      fetch(`${baseUrl}/v1/install/${encodeURIComponent(installId)}`, {
        method: "DELETE",
        signal,
      }),
    );
    return response.ok;
  } catch (error) {
    logger.debug({ error }, "usage-stats erasure failed");
    return false;
  }
}

/**
 * Scheduled entry point. No-op unless consent is granted AND an endpoint is
 * configured. Swallows every error.
 */
export async function usageStatsTick(): Promise<void> {
  try {
    if ((await getConsent()) !== "granted") return;
    const baseUrl = getStatsBaseUrl();
    if (!baseUrl) return;
    await sendPing(await buildUsagePayload(), baseUrl);
  } catch (error) {
    logger.debug({ error }, "usage-stats tick error");
  }
}
```

Note `logger.debug({ error }, "...")` — the project's Pino serializer maps the
`error` key. Passing a bare `Error` as the message argument logs `{}`.

- [ ] **Step 4: Create the barrel**

`backend/src/services/usageStats/index.ts`:

```typescript
export * from "./buckets";
export * from "./consent";
export * from "./payload";
export * from "./transport";
```

- [ ] **Step 5: Implement the scheduler**

`backend/src/jobs/usageStatsScheduler.ts`, matching the module-level-state idiom of
`backend/src/jobs/flightUpdateScheduler.ts`:

```typescript
import cron from "node-cron";
import { logger } from "../utils/logger";
import { usageStatsTick } from "../services/usageStats";

let scheduledJob: cron.ScheduledTask | null = null;

/** Random 0-59 minute offset so a thousand installs do not all ping at 03:00 UTC. */
function jitteredDailyPattern(): string {
  const minute = Math.floor(Math.random() * 60);
  return `${minute} 3 * * *`;
}

export function startUsageStatsScheduler(): void {
  if (scheduledJob) {
    logger.warn("usage-stats scheduler already running");
    return;
  }
  const pattern = jitteredDailyPattern();
  scheduledJob = cron.schedule(pattern, async () => {
    await usageStatsTick();
  });
  scheduledJob.start();
  logger.info({ pattern }, "usage-stats scheduler started");
}

export function stopUsageStatsScheduler(): void {
  if (!scheduledJob) return;
  scheduledJob.stop();
  scheduledJob = null;
  logger.info("usage-stats scheduler stopped");
}

export function isUsageStatsSchedulerRunning(): boolean {
  return scheduledJob !== null;
}
```

- [ ] **Step 6: Wire into `backend/src/index.ts`**

Follow the existing dynamic-import + try/catch pattern used for the other four
schedulers (around lines 431-483). In the server-start block:

```typescript
    try {
      const { startUsageStatsScheduler } = await import("./jobs/usageStatsScheduler");
      startUsageStatsScheduler();
    } catch (error) {
      logger.error({ error }, "server_start_usage_stats_scheduler_error");
    }
```

And in **both** the SIGTERM and SIGINT handlers (around lines 286-303), alongside the
other `stop*` calls:

```typescript
    const { stopUsageStatsScheduler } = await import("./jobs/usageStatsScheduler");
    stopUsageStatsScheduler();
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd backend && npm test -- --forceExit usageStats && npx tsc --noEmit && npm run lint
```
Expected: PASS, 10 transport tests (34 across the usageStats suite). Typecheck and lint clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/usageStats/transport.ts backend/src/services/usageStats/index.ts \
        backend/src/services/usageStats/__tests__/transport.test.ts \
        backend/src/jobs/usageStatsScheduler.ts backend/src/index.ts
git commit -m "feat(usage-stats): add best-effort transport, erasure call and jittered daily cron"
```

---

### Task 6: Admin + setup routes

**Files:**
- Create: `backend/src/routes/admin/usageStats.ts`
- Modify: `backend/src/routes/admin/index.ts`
- Modify: `backend/src/routes/setup.ts`
- Test: `backend/src/__tests__/routes/adminUsageStats.test.ts`

**Interfaces:**
- Consumes: `consent.ts`, `transport.ts`.
- Produces: `GET /api/v1/admin/usage-stats` → `{ consent: ConsentState; installId: string | null; endpointConfigured: boolean }`; `PUT /api/v1/admin/usage-stats` with body `{ consent: "granted" | "denied" }`. Task 7's `usageStatsApi` calls exactly these.

`backend/src/routes/admin/index.ts` already applies `authenticate`, `requireAdmin`
and `requireWriteScope` to every mounted sub-router. Do **not** re-apply them.

Behaviour that matters: **granting fires an immediate ping** (so the dashboard sees
the install without waiting a day); **denying fires an erasure** (Art. 17 without
e-mail). Both are fire-and-forget — the HTTP response must not wait on, or fail
because of, the stats service.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/routes/adminUsageStats.test.ts`:

```typescript
jest.mock("../../services/usageStats", () => ({
  getConsent: jest.fn(),
  setConsent: jest.fn(),
  getInstallId: jest.fn(),
  getOrCreateInstallId: jest.fn(),
  getStatsBaseUrl: jest.fn(),
  usageStatsTick: jest.fn(),
  sendErasure: jest.fn(),
}));

import { usageStatsConsentSchema, applyConsentChange } from "../../routes/admin/usageStats";
import {
  setConsent, getInstallId, getStatsBaseUrl, usageStatsTick, sendErasure,
} from "../../services/usageStats";

beforeEach(() => {
  jest.clearAllMocks();
  (getStatsBaseUrl as jest.Mock).mockReturnValue("https://stats.test");
  (getInstallId as jest.Mock).mockResolvedValue("abc123");
  (usageStatsTick as jest.Mock).mockResolvedValue(undefined);
  (sendErasure as jest.Mock).mockResolvedValue(true);
});

describe("usageStatsConsentSchema", () => {
  it("accepts granted and denied", () => {
    expect(usageStatsConsentSchema.parse({ consent: "granted" }).consent).toBe("granted");
    expect(usageStatsConsentSchema.parse({ consent: "denied" }).consent).toBe("denied");
  });

  it("rejects unset — the API never sets it back to unset", () => {
    expect(() => usageStatsConsentSchema.parse({ consent: "unset" })).toThrow();
  });

  it("rejects an arbitrary string", () => {
    expect(() => usageStatsConsentSchema.parse({ consent: "yes" })).toThrow();
  });
});

describe("applyConsentChange", () => {
  it("persists then fires an immediate ping on grant", async () => {
    await applyConsentChange("granted");
    expect(setConsent).toHaveBeenCalledWith("granted");
    expect(usageStatsTick).toHaveBeenCalledTimes(1);
    expect(sendErasure).not.toHaveBeenCalled();
  });

  it("erases the server row BEFORE persisting the denial", async () => {
    const order: string[] = [];
    (sendErasure as jest.Mock).mockImplementation(async () => { order.push("erase"); return true; });
    (setConsent as jest.Mock).mockImplementation(async () => { order.push("persist"); });
    await applyConsentChange("denied");
    expect(order).toEqual(["erase", "persist"]);
    expect(sendErasure).toHaveBeenCalledWith("abc123", "https://stats.test");
  });

  it("still persists the denial when erasure fails", async () => {
    (sendErasure as jest.Mock).mockRejectedValue(new Error("offline"));
    await expect(applyConsentChange("denied")).resolves.toBeUndefined();
    expect(setConsent).toHaveBeenCalledWith("denied");
  });

  it("skips erasure when there is no install id yet", async () => {
    (getInstallId as jest.Mock).mockResolvedValue(null);
    await applyConsentChange("denied");
    expect(sendErasure).not.toHaveBeenCalled();
    expect(setConsent).toHaveBeenCalledWith("denied");
  });

  it("skips network work entirely when the endpoint is disabled", async () => {
    (getStatsBaseUrl as jest.Mock).mockReturnValue("");
    await applyConsentChange("denied");
    expect(sendErasure).not.toHaveBeenCalled();
    await applyConsentChange("granted");
    expect(usageStatsTick).not.toHaveBeenCalled();
  });
});
```

Erasure runs **before** persisting the denial on purpose: once consent is `denied`,
`getInstallId()` is still readable, but a crash between the two steps must leave the
user *protected* rather than *recorded as protected*. Erase first, then record.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- --forceExit adminUsageStats
```
Expected: FAIL — "Cannot find module '../../routes/admin/usageStats'".

- [ ] **Step 3: Implement the route**

`backend/src/routes/admin/usageStats.ts`:

```typescript
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { logger } from "../../utils/logger";
import {
  getConsent, setConsent, getInstallId, getStatsBaseUrl, usageStatsTick, sendErasure,
  type ConsentState,
} from "../../services/usageStats";

const router = Router();

/** The API never sets consent back to `unset` — that state only exists pre-decision. */
export const usageStatsConsentSchema = z.object({
  consent: z.enum(["granted", "denied"]),
});

/**
 * Apply a consent decision.
 *
 * On denial we erase the server-side row BEFORE persisting the local denial: a
 * crash between the two must leave the user erased, not merely marked as erased.
 * Both network calls are best-effort and never fail the request.
 */
export async function applyConsentChange(consent: "granted" | "denied"): Promise<void> {
  const baseUrl = getStatsBaseUrl();

  if (consent === "denied") {
    const installId = await getInstallId();
    if (baseUrl && installId) {
      try {
        await sendErasure(installId, baseUrl);
      } catch (error) {
        logger.debug({ error }, "usage-stats erasure on withdrawal failed");
      }
    }
    await setConsent("denied");
    return;
  }

  await setConsent("granted");
  if (!baseUrl) return;
  try {
    await usageStatsTick();
  } catch (error) {
    logger.debug({ error }, "usage-stats immediate ping after grant failed");
  }
}

// GET /api/v1/admin/usage-stats
router.get("/usage-stats", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [consent, installId] = await Promise.all([getConsent(), getInstallId()]);
    res.json({
      consent,
      installId,
      endpointConfigured: getStatsBaseUrl() !== "",
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/admin/usage-stats
router.put("/usage-stats", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { consent } = usageStatsConsentSchema.parse(req.body);
    await applyConsentChange(consent);
    const installId = await getInstallId();
    res.json({ consent, installId, endpointConfigured: getStatsBaseUrl() !== "" });
  } catch (error) {
    next(error);
  }
});

export default router;
```

Add `type ConsentState` to the `consent.ts` re-export if the barrel does not already
surface it. Remove the unused import if `ConsentState` is not referenced.

- [ ] **Step 4: Mount it**

In `backend/src/routes/admin/index.ts`, alongside the existing sub-router mounts:

```typescript
import usageStatsRouter from "./usageStats";
// ...
router.use(usageStatsRouter);
```

- [ ] **Step 5: Accept consent at first boot**

In `backend/src/routes/setup.ts`, extend the Zod body schema:

```typescript
  usageStatsConsent: z.enum(["granted", "denied"]).optional(),
```

and after the admin user + settings are created, before responding:

```typescript
    if (usageStatsConsent) {
      const { applyConsentChange } = await import("./admin/usageStats");
      await applyConsentChange(usageStatsConsent);
    }
```

Setup must not fail because the stats service is unreachable — `applyConsentChange`
already swallows network errors, but wrap the call in its own `try/catch` logging at
`debug` so a `setConsent` DB error cannot abort a successful install either.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd backend && npm test -- --forceExit adminUsageStats && npx tsc --noEmit && npm run lint
```
Expected: PASS, 9 tests. Typecheck and lint clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/admin/usageStats.ts backend/src/routes/admin/index.ts \
        backend/src/routes/setup.ts backend/src/__tests__/routes/adminUsageStats.test.ts
git commit -m "feat(usage-stats): add admin consent endpoints with erase-on-withdrawal"
```

---

### Task 7: Frontend API client + consent card

**Files:**
- Create: `frontend/src/lib/api/usageStats.ts`
- Modify: `frontend/src/lib/api/index.ts`
- Create: `frontend/src/components/UsageStatsConsentCard.tsx`
- Create: `frontend/src/i18n/resources/de/usageStats.json`
- Create: `frontend/src/i18n/resources/en/usageStats.json`
- Modify: `frontend/src/i18n/config.ts`
- Test: `frontend/src/components/__tests__/UsageStatsConsentCard.test.tsx`

**Interfaces:**
- Consumes: the admin endpoints from Task 6.
- Produces: `usageStatsApi.get()`, `usageStatsApi.setConsent(consent)`; `UsageStatsConsentCard` (default export) with props `{ onDecided?: (consent: "granted" | "denied") => void; variant?: "modal" | "setup" }`. Task 8 mounts it in both places.

**Copy rules (GDPR, spec §3):** "Ja" and "Nein" carry equal visual weight — same
size, same prominence, neither pre-selected, neither styled as the primary action.
Both link to the docs page. No dark patterns; this is a legal requirement, not a
style preference.

**Persistence rule (from Plan 1's review):** the card persists the decision **the
moment a button is clicked**, never on modal close. A user who closes the modal
without clicking has given no consent, and `usageStatsConsent` stays `unset` — which
sends nothing, forever, until they flip the Admin toggle. Do not add a "remember to
decide" prompt.

**The equal-weight test compares `className`.** That is necessary but not sufficient:
if the two buttons carry different inline `style` objects they are still visually
unequal and the spec is violated while the test passes. Give both buttons the *same*
`className` **and** the *same* `style`. Do not add a `bg-blue-600` primary treatment
to the accept button — that is exactly the dark pattern this rule forbids.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/__tests__/UsageStatsConsentCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ setConsent: vi.fn() }));

vi.mock("../../lib/api", () => ({
  usageStatsApi: { setConsent: mocks.setConsent, get: vi.fn() },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import UsageStatsConsentCard from "../UsageStatsConsentCard";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setConsent.mockResolvedValue({ consent: "granted", installId: "x", endpointConfigured: true });
});

describe("UsageStatsConsentCard", () => {
  it("offers both choices", () => {
    render(<UsageStatsConsentCard />);
    expect(screen.getByRole("button", { name: "usageStats:consent.accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "usageStats:consent.decline" })).toBeInTheDocument();
  });

  it("gives accept and decline identical styling — no dark pattern", () => {
    render(<UsageStatsConsentCard />);
    const accept = screen.getByRole("button", { name: "usageStats:consent.accept" });
    const decline = screen.getByRole("button", { name: "usageStats:consent.decline" });
    // Both must match: className alone would let an inline style re-introduce a
    // visual hierarchy, which is precisely the dark pattern GDPR Art. 7 forbids.
    expect(accept.className).toBe(decline.className);
    expect(accept.getAttribute("style")).toBe(decline.getAttribute("style"));
  });

  it("persists nothing when the card is merely unmounted without a choice", () => {
    const { unmount } = render(<UsageStatsConsentCard />);
    unmount();
    expect(mocks.setConsent).not.toHaveBeenCalled();
  });

  it("sends granted and reports the decision upward", async () => {
    const onDecided = vi.fn();
    render(<UsageStatsConsentCard onDecided={onDecided} />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.accept" }));
    expect(mocks.setConsent).toHaveBeenCalledWith("granted");
    expect(onDecided).toHaveBeenCalledWith("granted");
  });

  it("sends denied", async () => {
    render(<UsageStatsConsentCard />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.decline" }));
    expect(mocks.setConsent).toHaveBeenCalledWith("denied");
  });

  it("links to the transparency docs page", () => {
    render(<UsageStatsConsentCard />);
    const link = screen.getByRole("link", { name: "usageStats:consent.whatIsSent" });
    expect(link).toHaveAttribute("href", "https://travstats.de/docs/usage-statistics");
  });

  it("still reports the decision when the request fails", async () => {
    mocks.setConsent.mockRejectedValue(new Error("offline"));
    const onDecided = vi.fn();
    render(<UsageStatsConsentCard onDecided={onDecided} />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.decline" }));
    expect(onDecided).toHaveBeenCalledWith("denied");
  });

  it("in setup variant it defers the API call to the parent", async () => {
    const onDecided = vi.fn();
    render(<UsageStatsConsentCard variant="setup" onDecided={onDecided} />);
    await userEvent.click(screen.getByRole("button", { name: "usageStats:consent.accept" }));
    expect(mocks.setConsent).not.toHaveBeenCalled();
    expect(onDecided).toHaveBeenCalledWith("granted");
  });
});
```

The `variant="setup"` case exists because during setup no admin session exists yet —
the consent rides along in the `setupApi.initialize` body instead of hitting the
admin endpoint. That is why Task 6 extended `setup.ts`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/components/__tests__/UsageStatsConsentCard.test.tsx
```
Expected: FAIL — "Failed to resolve import ../UsageStatsConsentCard".

- [ ] **Step 3: Implement the API client**

`frontend/src/lib/api/usageStats.ts`:

```typescript
import { api } from "./client";

export type UsageStatsConsent = "unset" | "granted" | "denied";

export interface UsageStatsStatus {
  consent: UsageStatsConsent;
  installId: string | null;
  endpointConfigured: boolean;
}

export const usageStatsApi = {
  get: async (): Promise<UsageStatsStatus> => {
    const { data } = await api.get<UsageStatsStatus>("/admin/usage-stats");
    return data;
  },
  setConsent: async (consent: "granted" | "denied"): Promise<UsageStatsStatus> => {
    const { data } = await api.put<UsageStatsStatus>("/admin/usage-stats", { consent });
    return data;
  },
};
```

Re-export it from `frontend/src/lib/api/index.ts`: `export * from "./usageStats";`

- [ ] **Step 4: Create both i18n bundles and register the namespace**

`frontend/src/i18n/resources/de/usageStats.json` (primary):

```json
{
  "consent": {
    "title": "Anonyme Nutzungsstatistik",
    "body": "Hilf uns zu verstehen, wie TravStats genutzt wird. Wir senden ausschließlich anonyme Kennzahlen — Version, aktivierte Domains, grobe Größenordnungen. Niemals deine Flüge, Häfen, Namen, IP-Adresse oder API-Schlüssel.",
    "accept": "Ja, anonyme Daten senden",
    "decline": "Nein, danke",
    "whatIsSent": "Was genau wird gesendet?",
    "revokeHint": "Du kannst das jederzeit im Admin-Bereich wieder abschalten. Beim Abschalten werden die gespeicherten Daten dieser Installation gelöscht."
  },
  "admin": {
    "title": "Anonyme Nutzungsstatistik",
    "description": "Sendet einmal täglich eine anonyme Kennzahlen-Meldung an stats.travstats.de. Standardmäßig aus.",
    "enabled": "Aktiviert",
    "disabled": "Deaktiviert",
    "installId": "Installations-ID",
    "installIdHint": "Zufällige Kennung dieser Installation. Nenne sie bei einer Auskunfts- oder Löschanfrage.",
    "endpointDisabled": "Der Endpunkt ist per Umgebungsvariable deaktiviert. Es wird nichts gesendet."
  }
}
```

`frontend/src/i18n/resources/en/usageStats.json` (mirror — identical structure):

```json
{
  "consent": {
    "title": "Anonymous usage statistics",
    "body": "Help us understand how TravStats is used. We send anonymous metrics only — version, enabled domains, coarse size ranges. Never your flights, ports, names, IP address, or API keys.",
    "accept": "Yes, send anonymous data",
    "decline": "No, thanks",
    "whatIsSent": "What exactly is sent?",
    "revokeHint": "You can turn this off again at any time in the admin area. Turning it off deletes this installation's stored data."
  },
  "admin": {
    "title": "Anonymous usage statistics",
    "description": "Sends one anonymous metrics report per day to stats.travstats.de. Off by default.",
    "enabled": "Enabled",
    "disabled": "Disabled",
    "installId": "Installation ID",
    "installIdHint": "Random identifier for this installation. Quote it in an access or erasure request.",
    "endpointDisabled": "The endpoint is disabled via environment variable. Nothing is sent."
  }
}
```

Register `usageStats` in `frontend/src/i18n/config.ts` — three edits per language
(import, `resources` entry, `ns` array), exactly as in Plan 1 Task 2 Step 5.

- [ ] **Step 5: Implement the card**

`frontend/src/components/UsageStatsConsentCard.tsx`:

```tsx
import { useState } from "react";
import { usageStatsApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";

const DOCS_URL = "https://travstats.de/docs/usage-statistics";

interface UsageStatsConsentCardProps {
  onDecided?: (consent: "granted" | "denied") => void;
  /**
   * "modal": call the admin API directly (an admin session exists).
   * "setup": no session yet — the parent sends the choice with setupApi.initialize.
   */
  variant?: "modal" | "setup";
}

/**
 * Opt-in consent card. GDPR Art. 7: accept and decline must carry equal weight —
 * identical styling, neither pre-selected. Do not "improve" this by highlighting
 * the accept button.
 */
export default function UsageStatsConsentCard({
  onDecided,
  variant = "modal",
}: UsageStatsConsentCardProps): JSX.Element {
  const { t } = useTranslation(["usageStats"]);
  const [busy, setBusy] = useState(false);

  const buttonClass = "flex-1 px-4 py-2 rounded-md text-sm font-medium border";

  const decide = async (consent: "granted" | "denied"): Promise<void> => {
    setBusy(true);
    if (variant === "modal") {
      try {
        await usageStatsApi.setConsent(consent);
      } catch (error) {
        // The user's choice is recorded upward regardless: never trap someone
        // in a consent dialog because the network is down.
        logger.debug("usage-stats consent request failed", error);
      }
    }
    setBusy(false);
    onDecided?.(consent);
  };

  return (
    <section
      className="rounded-md p-4 flex flex-col gap-3"
      style={{ border: "1px solid var(--color-border)", background: "var(--bg-elevated)" }}
    >
      <h3 className="font-medium" style={{ color: "var(--text-primary)" }}>
        {t("usageStats:consent.title")}
      </h3>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {t("usageStats:consent.body")}
      </p>
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm underline w-fit"
        style={{ color: "var(--text-muted)" }}
      >
        {t("usageStats:consent.whatIsSent")}
      </a>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("granted")}
          className={buttonClass}
          style={{ borderColor: "var(--color-border)", color: "var(--text-primary)" }}
        >
          {t("usageStats:consent.accept")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("denied")}
          className={buttonClass}
          style={{ borderColor: "var(--color-border)", color: "var(--text-primary)" }}
        >
          {t("usageStats:consent.decline")}
        </button>
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {t("usageStats:consent.revokeHint")}
      </p>
    </section>
  );
}
```

Both buttons share `buttonClass` **and** identical inline styles. The equal-weight
test in Step 1 compares `className`; keeping the `style` objects identical too is
what actually satisfies the spec.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/components/__tests__/UsageStatsConsentCard.test.tsx
```
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api/usageStats.ts frontend/src/lib/api/index.ts \
        frontend/src/components/UsageStatsConsentCard.tsx \
        frontend/src/components/__tests__/UsageStatsConsentCard.test.tsx \
        frontend/src/i18n/resources/de/usageStats.json frontend/src/i18n/resources/en/usageStats.json \
        frontend/src/i18n/config.ts
git commit -m "feat(usage-stats): add consent card with equal-weight choices and api client"
```

---

### Task 8: Wire the three consent surfaces

**Files:**
- Modify: `frontend/src/App.tsx` (pass `extraSlot`)
- Modify: `frontend/src/pages/SetupPage.tsx`
- Create: `frontend/src/components/Admin/UsageStatsSettings.tsx`
- Modify: `frontend/src/pages/AdminPage.tsx`

**Interfaces:**
- Consumes: `UsageStatsConsentCard` (Task 7), `WhatsNewModal` + `useWhatsNew` (Plan 1), `usageStatsApi` (Task 7).
- Produces: the feature is user-reachable.

- [ ] **Step 1: What's-New surface — admin only**

In `frontend/src/App.tsx`, extend the `WhatsNewModal` mount from Plan 1 Task 5. The
card is shown only to admins (consent is instance-wide) and only while consent is
still `unset`.

> **Read before writing this.** `onClose` on that modal already persists
> `whatsNewSeenVersion` and fires from both the `×` and the dismiss button. Do **not**
> touch `onClose` and do **not** infer a consent decision from it. `onDecided` — fired
> by the card itself when a button is clicked — is the only signal that a decision was
> made. If the admin closes the modal without clicking either consent button, consent
> correctly remains `unset`, nothing is ever sent, and the Admin toggle (Step 3)
> remains the way to decide later. That is the intended behaviour, not a gap to patch.

`App.tsx` will need `useState`/`useEffect` imported if they are not already, plus
`usageStatsApi` from `"./lib/api"` and the card component. Reuse the existing
`isAuthenticated` (declared near the top after the Plan 1 restructuring) and read the
admin flag from the `user` object already destructured from `useAuthStore()` — do not
add a second auth source.

```tsx
  const [consentPending, setConsentPending] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user?.isAdmin) return;
    let cancelled = false;
    void usageStatsApi
      .get()
      .then((status) => { if (!cancelled) setConsentPending(status.consent === "unset"); })
      .catch(() => { if (!cancelled) setConsentPending(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated, user?.isAdmin]);
```

```tsx
      <WhatsNewModal
        isOpen={shouldShow}
        entry={entry}
        onClose={() => void dismiss()}
        extraSlot={
          consentPending ? (
            <UsageStatsConsentCard onDecided={() => setConsentPending(false)} />
          ) : undefined
        }
      />
```

Read the admin flag from the existing auth store rather than adding a new source.

- [ ] **Step 2: Setup surface**

In `frontend/src/pages/SetupPage.tsx`, add state and render the card below
`DomainPickerStep`:

```tsx
  const [usageStatsConsent, setUsageStatsConsent] = useState<"granted" | "denied" | undefined>(undefined);
```

```tsx
        <UsageStatsConsentCard variant="setup" onDecided={setUsageStatsConsent} />
```

and pass it into the existing `setupApi.initialize(...)` call:

```tsx
      const response = await setupApi.initialize({
        username: formData.username,
        password: formData.password,
        frontendUrl,
        enabledDomains: selectedDomains,
        usageStatsConsent,
      });
```

Add `usageStatsConsent?: "granted" | "denied";` to the `setupApi.initialize` payload
type in `frontend/src/lib/api/setup.ts`. Leaving the choice unmade is valid — the
field is optional and consent stays `unset`, which sends nothing.

- [ ] **Step 3: Admin toggle**

Create `frontend/src/components/Admin/UsageStatsSettings.tsx`. Match the checkbox
markup from `frontend/src/components/Admin/InstanceSettings.tsx`.

```tsx
import { useEffect, useState } from "react";
import { usageStatsApi, type UsageStatsStatus } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

export default function UsageStatsSettings(): JSX.Element {
  const { t } = useTranslation(["usageStats", "common"]);
  const [status, setStatus] = useState<UsageStatsStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void usageStatsApi
      .get()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch((error) => logger.debug("failed to load usage-stats status", error));
    return () => { cancelled = true; };
  }, []);

  const toggle = async (checked: boolean): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await usageStatsApi.setConsent(checked ? "granted" : "denied"));
    } catch (error) {
      logger.debug("failed to change usage-stats consent", error);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <p style={{ color: "var(--text-muted)" }}>{t("common:loading")}</p>;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="font-medium" style={{ color: "var(--text-primary)" }}>
          {t("usageStats:admin.title")}
        </h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("usageStats:admin.description")}
        </p>
      </div>

      {!status.endpointConfigured && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("usageStats:admin.endpointDisabled")}
        </p>
      )}

      <label className="flex items-start gap-3 text-sm" style={{ color: "var(--text-primary)" }}>
        <input
          type="checkbox"
          checked={status.consent === "granted"}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-[var(--border)]"
        />
        <span className="font-medium">
          {status.consent === "granted" ? t("usageStats:admin.enabled") : t("usageStats:admin.disabled")}
        </span>
      </label>

      {status.installId && (
        <div>
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {t("usageStats:admin.installId")}
          </span>
          <code className="block text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {status.installId}
          </code>
          <span className="block text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("usageStats:admin.installIdHint")}
          </span>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Mount the admin panel**

In `frontend/src/pages/AdminPage.tsx`, render `<UsageStatsSettings />` inside the
existing `instance` section (below `<InstanceSettings />`). It belongs to the
`"general"` tab, which `TAB_FOR_SECTION` already maps `instance` to — so no new
section id and no `TAB_FOR_SECTION` change are needed.

- [ ] **Step 5: Full verification**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd ../backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
```
Expected: all green.

- [ ] **Step 6: Manual smoke test with a fake endpoint**

Never point a dev instance at the real `stats.travstats.de`. Start the backend with
a local sink:

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  TRAVSTATS_STATS_ENDPOINT="http://localhost:8088" \
  PORT=8000 FRONTEND_URL=http://localhost:3000 NODE_ENV=development COOKIE_SECURE=false \
  npx tsx src/index.ts
```

Verify, in order:

1. Admin → General → Instance shows the toggle, **off**, with no install id.
2. Turn it **on** → an install id appears; the backend logs one ping attempt to `localhost:8088` (connection refused is fine and must not error the UI).
3. Turn it **off** → the backend logs one `DELETE /v1/install/<id>` attempt.
4. Restart the backend with `TRAVSTATS_STATS_ENDPOINT=""` → the panel shows the "endpoint disabled" notice and no ping is attempted even with consent granted.
5. `SELECT usage_stats_consent, usage_stats_install_id FROM admin_settings;` reflects each change.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/SetupPage.tsx frontend/src/pages/AdminPage.tsx \
        frontend/src/components/Admin/UsageStatsSettings.tsx frontend/src/lib/api/setup.ts
git commit -m "feat(usage-stats): wire consent into setup, What's-New and the admin panel"
```

---

## Done criteria

- Both build gates green.
- Consent defaults to `unset`; nothing is ever sent in `unset` or `denied`.
- An empty `TRAVSTATS_STATS_ENDPOINT` disables sending even when granted.
- Withdrawal issues a `DELETE` before persisting the denial.
- `buildUsagePayload()` performs no network I/O, and the no-PII test passes.
- Accept and decline are visually identical.
- The migration touches only `admin_settings`.
- `backend/VERSION` and `CHANGELOG.md` untouched.
