# `travstats-stats` Micro-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone ingest + aggregate service that accepts anonymous pings, honours erasure requests, purges stale rows, and serves a cached public rollup.

**Architecture:** Node + Express + Zod over `node:sqlite` (the Node built-in — no native dependency, no build toolchain, no Postgres). Runs as a systemd unit on CT133 bound to `127.0.0.1:8088`, exposed via the existing `travstats-web` Cloudflare tunnel as `stats.travstats.de`. Two tables: `installs` (one row per install, upserted) and `daily_active` (a growth-chart rollup that survives installs ageing out).

**Tech Stack:** Node 24, Express 5, Zod, `node:sqlite`, `node-cron`, Vitest, systemd.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-10-anonymous-usage-stats-design.md`. **Read §3 (GDPR) and §7 before writing code.**
- **New repository/directory: `D:\TravStats_Projekt\travstats-stats`** — a sibling of `TravStats` and `TravStatsWeb`, matching the `sublarr-stats` layout. It is *not* inside the TravStats repo.
- **CT133 has 3.9 GB disk and 256 MB RAM and no Docker.** That budget is why `node:sqlite` (built-in) beats `better-sqlite3` (native build) and why Postgres is off the table. Do not add a native dependency.
- The payload contract is defined by `UsagePayload` in `backend/src/services/usageStats/payload.ts` (Plan 2, Task 4). The Zod schema here must accept exactly that shape.
- **No IP is ever persisted.** Rate-limit keys are hashed and in-memory only.
- `any` is FORBIDDEN. TypeScript `strict: true`.
- All code, comments, and commits in English.
- Build gate: `npm run typecheck && npm run lint && npx vitest --run`.

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `eslint.config.js` | **Create.** Project scaffold. |
| `src/schema.ts` | **Create.** The Zod ping contract + hardening limits. Nothing else. |
| `src/db.ts` | **Create.** `node:sqlite` connection, DDL, prepared statements. |
| `src/repo.ts` | **Create.** `upsertInstall`, `deleteInstall`, `purgeStale`, `countActive`. |
| `src/aggregate.ts` | **Create.** Pure rollup over rows → the public JSON. |
| `src/rateLimit.ts` | **Create.** Hashed, in-memory, TTL-bounded limiter. |
| `src/routes.ts` | **Create.** The four endpoints. |
| `src/cron.ts` | **Create.** Daily rollup + retention purge. |
| `src/app.ts` / `src/index.ts` | **Create.** Express wiring / process entry. |
| `deploy/stats-setup.sh` | **Create.** Provision CT133 (systemd unit, no-IP-logging nginx). |
| `deploy/DEPLOY.md` | **Create.** Runbook. |
| `PRIVACY.md` | **Create.** Record of processing activities (GDPR Art. 30). |
| `README.md` | **Create.** Payload contract, endpoints, run instructions. |

Splitting `schema` / `repo` / `aggregate` from `routes` is what lets the aggregate
and bucket logic be tested without an HTTP server or a live socket.

---

### Task 1: Scaffold + the Zod contract

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `src/schema.ts`
- Test: `src/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `pingSchema` (Zod object), `type Ping = z.infer<typeof pingSchema>`, and the constants `MAX_ACHIEVEMENT_KEYS = 200`, `MAX_PROVIDERS = 10`, `MAX_DISTANCE_KM = 100_000_000`. Tasks 2-5 import these.

`MAX_DISTANCE_KM` is 100 million km — roughly 250× the Earth-Moon distance, and about
2,500× the largest plausible real total. A ceiling exists so one actor cannot ping
`10^12` and destroy the dashboard headline; it is not a claim about real travel.

- [ ] **Step 1: Scaffold the project**

```bash
mkdir -p D:/TravStats_Projekt/travstats-stats/src/__tests__ D:/TravStats_Projekt/travstats-stats/deploy
cd D:/TravStats_Projekt/travstats-stats
git init
npm init -y
npm install express zod node-cron
npm install -D typescript @types/node @types/express vitest eslint typescript-eslint @eslint/js
```

`package.json` scripts (replace the generated `scripts` block):

```json
  "type": "module",
  "scripts": {
    "dev": "node --experimental-strip-types --watch src/index.ts",
    "start": "node --experimental-strip-types src/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest --run"
  },
  "engines": { "node": ">=24" }
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node"],
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`.gitignore`:

```
node_modules/
stats.db
stats.db-journal
*.log
```

Verify `node:sqlite` is available before going further — the whole storage choice
rests on it:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); db.exec('CREATE TABLE t(a)'); console.log('node:sqlite OK');"
```
Expected: `node:sqlite OK`. If this errors, the Node version is < 22 — stop and
report rather than swapping in `better-sqlite3` (it needs a build toolchain CT133
does not have).

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { pingSchema } from "../schema.ts";

function validPing() {
  return {
    install_id: "a".repeat(32),
    version: "2.4.0",
    arch: "amd64",
    enabled_domains: ["flight", "cruise"],
    users_bucket: "2-5",
    flights_bucket: "50-250",
    cruises_bucket: "0",
    distance_km: { flight: 128_400, cruise: 9_200 },
    achievements: { unlocked_total: 87, keys: ["globetrotter"] },
    features: {
      llm_parser: true, backups: true, webdav_sync: false,
      historical_enrichment: false, live_tracking: true,
    },
    flight_api_providers: ["airlabs"],
    locale: "de",
    reported_at: "2026-07-10T12:00:00.000Z",
  };
}

describe("pingSchema", () => {
  it("accepts a valid payload", () => {
    expect(() => pingSchema.parse(validPing())).not.toThrow();
  });

  it("rejects an install_id that is not 32 hex chars", () => {
    expect(() => pingSchema.parse({ ...validPing(), install_id: "short" })).toThrow();
    expect(() => pingSchema.parse({ ...validPing(), install_id: "z".repeat(32) })).toThrow();
  });

  it("whitelists arch", () => {
    expect(() => pingSchema.parse({ ...validPing(), arch: "sparc" })).toThrow();
  });

  it("whitelists every bucket value", () => {
    expect(() => pingSchema.parse({ ...validPing(), users_bucket: "many" })).toThrow();
    expect(() => pingSchema.parse({ ...validPing(), flights_bucket: "0" })).toThrow();
    expect(() => pingSchema.parse({ ...validPing(), cruises_bucket: "<50" })).toThrow();
  });

  it("whitelists locale", () => {
    expect(() => pingSchema.parse({ ...validPing(), locale: "klingon" })).toThrow();
  });

  it("rejects an implausible distance", () => {
    const p = validPing();
    p.distance_km.flight = 1e12;
    expect(() => pingSchema.parse(p)).toThrow();
  });

  it("rejects a negative distance", () => {
    const p = validPing();
    p.distance_km.cruise = -1;
    expect(() => pingSchema.parse(p)).toThrow();
  });

  it("caps the achievement key list", () => {
    const p = validPing();
    p.achievements.keys = Array.from({ length: 201 }, (_, i) => `k${i}`);
    expect(() => pingSchema.parse(p)).toThrow();
  });

  it("caps the provider list", () => {
    const p = validPing();
    p.flight_api_providers = Array.from({ length: 11 }, (_, i) => `p${i}`);
    expect(() => pingSchema.parse(p)).toThrow();
  });

  it("strips unknown keys instead of storing them", () => {
    const parsed = pingSchema.parse({ ...validPing(), hostname: "nas.local", ip: "1.2.3.4" });
    expect(parsed).not.toHaveProperty("hostname");
    expect(parsed).not.toHaveProperty("ip");
  });

  it("rejects a non-ISO reported_at", () => {
    expect(() => pingSchema.parse({ ...validPing(), reported_at: "yesterday" })).toThrow();
  });
});
```

The unknown-key test is the belt to the client's braces: even if a future client
accidentally adds `hostname`, the server refuses to learn it.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd D:/TravStats_Projekt/travstats-stats && npx vitest --run
```
Expected: FAIL — cannot resolve `../schema.ts`.

- [ ] **Step 4: Implement the schema**

`src/schema.ts`:

```typescript
import { z } from "zod";

export const MAX_ACHIEVEMENT_KEYS = 200;
export const MAX_PROVIDERS = 10;
/** ~250x the Earth-Moon distance. A ceiling against spoofed headline numbers. */
export const MAX_DISTANCE_KM = 100_000_000;

const distance = z.number().finite().nonnegative().max(MAX_DISTANCE_KM);
const slug = z.string().min(1).max(64);

export const pingSchema = z
  .object({
    install_id: z.string().regex(/^[0-9a-f]{32}$/),
    version: z.string().min(1).max(32),
    arch: z.enum(["amd64", "arm64"]),
    enabled_domains: z.array(z.enum(["flight", "cruise", "hotel", "poi"])).max(8),
    users_bucket: z.enum(["1", "2-5", "6-20", "20+"]),
    flights_bucket: z.enum(["<50", "50-250", "250-1k", "1k+"]),
    cruises_bucket: z.enum(["0", "1-5", "6-20", "20+"]),
    distance_km: z.object({ flight: distance, cruise: distance }),
    achievements: z.object({
      unlocked_total: z.number().int().nonnegative().max(1_000_000),
      keys: z.array(slug).max(MAX_ACHIEVEMENT_KEYS),
    }),
    features: z.object({
      llm_parser: z.boolean(),
      backups: z.boolean(),
      webdav_sync: z.boolean(),
      historical_enrichment: z.boolean(),
      live_tracking: z.boolean(),
    }),
    flight_api_providers: z.array(slug).max(MAX_PROVIDERS),
    locale: z.enum(["de", "en"]),
    reported_at: z.string().datetime(),
  })
  .strip(); // unknown keys are discarded, never stored

export type Ping = z.infer<typeof pingSchema>;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest --run && npm run typecheck
```
Expected: PASS, 11 tests. Typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold travstats-stats with the hardened Zod ping contract"
```

---

### Task 2: Storage + repository

**Files:**
- Create: `src/db.ts`, `src/repo.ts`
- Test: `src/__tests__/repo.test.ts`

**Interfaces:**
- Consumes: `Ping` (Task 1).
- Produces: `openDb(path: string): DatabaseSync`, `upsertInstall(db, ping)`, `deleteInstall(db, installId): boolean`, `purgeStale(db, olderThanDays): number`, `countActive(db, withinDays): number`, `listActiveInstalls(db, withinDays): InstallRow[]`, `recordDailyActive(db, day, count)`, `listDailyActive(db): DailyActiveRow[]`. Tasks 3-5 import all.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/repo.test.ts`. Every test gets its own in-memory DB, so they
never share state.

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../db.ts";
import {
  upsertInstall, deleteInstall, purgeStale, countActive, listActiveInstalls,
  recordDailyActive, listDailyActive,
} from "../repo.ts";
import type { Ping } from "../schema.ts";

function ping(overrides: Partial<Ping> = {}): Ping {
  return {
    install_id: "a".repeat(32),
    version: "2.4.0",
    arch: "amd64",
    enabled_domains: ["flight"],
    users_bucket: "1",
    flights_bucket: "<50",
    cruises_bucket: "0",
    distance_km: { flight: 1000, cruise: 0 },
    achievements: { unlocked_total: 3, keys: ["globetrotter"] },
    features: {
      llm_parser: false, backups: false, webdav_sync: false,
      historical_enrichment: false, live_tracking: false,
    },
    flight_api_providers: [],
    locale: "de",
    reported_at: new Date().toISOString(),
    ...overrides,
  } as Ping;
}

let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(":memory:"); });

describe("upsertInstall", () => {
  it("inserts a new install", () => {
    upsertInstall(db, ping());
    expect(countActive(db, 30)).toBe(1);
  });

  it("dedups by install_id — a second ping updates, never inserts", () => {
    upsertInstall(db, ping());
    upsertInstall(db, ping({ version: "2.4.1" }));
    expect(countActive(db, 30)).toBe(1);
    expect(listActiveInstalls(db, 30)[0].version).toBe("2.4.1");
  });

  it("preserves first_seen across updates", () => {
    upsertInstall(db, ping());
    const firstSeen = listActiveInstalls(db, 30)[0].first_seen;
    upsertInstall(db, ping({ version: "2.5.0" }));
    expect(listActiveInstalls(db, 30)[0].first_seen).toBe(firstSeen);
  });

  it("round-trips the JSON-shaped columns", () => {
    upsertInstall(db, ping({ enabled_domains: ["flight", "cruise"], flight_api_providers: ["airlabs"] }));
    const row = listActiveInstalls(db, 30)[0];
    expect(JSON.parse(row.enabled_domains)).toEqual(["flight", "cruise"]);
    expect(JSON.parse(row.flight_api_providers)).toEqual(["airlabs"]);
  });

  it("stores no column that could hold an IP or hostname", () => {
    upsertInstall(db, ping());
    const columns = db.prepare("PRAGMA table_info(installs)").all() as { name: string }[];
    const names = columns.map((c) => c.name.toLowerCase());
    for (const forbidden of ["ip", "ip_address", "hostname", "remote_addr", "user_agent"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe("deleteInstall", () => {
  it("removes the row and reports true", () => {
    upsertInstall(db, ping());
    expect(deleteInstall(db, "a".repeat(32))).toBe(true);
    expect(countActive(db, 30)).toBe(0);
  });

  it("reports false for an unknown id, and is idempotent", () => {
    expect(deleteInstall(db, "b".repeat(32))).toBe(false);
    expect(deleteInstall(db, "b".repeat(32))).toBe(false);
  });
});

describe("countActive", () => {
  it("excludes installs last seen outside the window", () => {
    upsertInstall(db, ping());
    db.prepare("UPDATE installs SET last_seen = ?").run("2020-01-01T00:00:00.000Z");
    expect(countActive(db, 30)).toBe(0);
  });
});

describe("purgeStale", () => {
  it("hard-deletes rows older than the retention window", () => {
    upsertInstall(db, ping());
    db.prepare("UPDATE installs SET last_seen = ?").run("2020-01-01T00:00:00.000Z");
    expect(purgeStale(db, 180)).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM installs").get()).toEqual({ n: 0 });
  });

  it("keeps rows inside the window", () => {
    upsertInstall(db, ping());
    expect(purgeStale(db, 180)).toBe(0);
  });
});

describe("daily_active", () => {
  it("upserts one row per day", () => {
    recordDailyActive(db, "2026-07-10", 5);
    recordDailyActive(db, "2026-07-10", 7);
    expect(listDailyActive(db)).toEqual([{ day: "2026-07-10", active_count: 7 }]);
  });

  it("returns days in ascending order", () => {
    recordDailyActive(db, "2026-07-11", 2);
    recordDailyActive(db, "2026-07-10", 1);
    expect(listDailyActive(db).map((r) => r.day)).toEqual(["2026-07-10", "2026-07-11"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest --run src/__tests__/repo.test.ts
```
Expected: FAIL — cannot resolve `../db.ts`.

- [ ] **Step 3: Implement `src/db.ts`**

```typescript
import { DatabaseSync } from "node:sqlite";

/**
 * Storage for anonymous usage pings.
 *
 * There is deliberately NO column for IP, hostname, user-agent, or any other
 * network identifier. The rate limiter sees the IP transiently, in memory only.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS installs (
  install_id           TEXT PRIMARY KEY,
  first_seen           TEXT NOT NULL,
  last_seen            TEXT NOT NULL,
  version              TEXT NOT NULL,
  arch                 TEXT NOT NULL,
  enabled_domains      TEXT NOT NULL,
  users_bucket         TEXT NOT NULL,
  flights_bucket       TEXT NOT NULL,
  cruises_bucket       TEXT NOT NULL,
  distance_flight_km   INTEGER NOT NULL,
  distance_cruise_km   INTEGER NOT NULL,
  achievements_total   INTEGER NOT NULL,
  achievement_keys     TEXT NOT NULL,
  features             TEXT NOT NULL,
  flight_api_providers TEXT NOT NULL,
  locale               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_installs_last_seen ON installs(last_seen);

CREATE TABLE IF NOT EXISTS daily_active (
  day          TEXT PRIMARY KEY,
  active_count INTEGER NOT NULL
);
`;

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(DDL);
  return db;
}
```

- [ ] **Step 4: Implement `src/repo.ts`**

```typescript
import type { DatabaseSync } from "node:sqlite";
import type { Ping } from "./schema.ts";

export interface InstallRow {
  install_id: string;
  first_seen: string;
  last_seen: string;
  version: string;
  arch: string;
  enabled_domains: string;
  users_bucket: string;
  flights_bucket: string;
  cruises_bucket: string;
  distance_flight_km: number;
  distance_cruise_km: number;
  achievements_total: number;
  achievement_keys: string;
  features: string;
  flight_api_providers: string;
  locale: string;
}

export interface DailyActiveRow {
  day: string;
  active_count: number;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Insert or update one row per install_id. `first_seen` is never overwritten. */
export function upsertInstall(db: DatabaseSync, ping: Ping): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO installs (
       install_id, first_seen, last_seen, version, arch, enabled_domains,
       users_bucket, flights_bucket, cruises_bucket,
       distance_flight_km, distance_cruise_km,
       achievements_total, achievement_keys, features, flight_api_providers, locale
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(install_id) DO UPDATE SET
       last_seen            = excluded.last_seen,
       version              = excluded.version,
       arch                 = excluded.arch,
       enabled_domains      = excluded.enabled_domains,
       users_bucket         = excluded.users_bucket,
       flights_bucket       = excluded.flights_bucket,
       cruises_bucket       = excluded.cruises_bucket,
       distance_flight_km   = excluded.distance_flight_km,
       distance_cruise_km   = excluded.distance_cruise_km,
       achievements_total   = excluded.achievements_total,
       achievement_keys     = excluded.achievement_keys,
       features             = excluded.features,
       flight_api_providers = excluded.flight_api_providers,
       locale               = excluded.locale`,
  ).run(
    ping.install_id, now, now, ping.version, ping.arch,
    JSON.stringify(ping.enabled_domains),
    ping.users_bucket, ping.flights_bucket, ping.cruises_bucket,
    Math.round(ping.distance_km.flight), Math.round(ping.distance_km.cruise),
    ping.achievements.unlocked_total, JSON.stringify(ping.achievements.keys),
    JSON.stringify(ping.features), JSON.stringify(ping.flight_api_providers),
    ping.locale,
  );
}

/** GDPR Art. 17. Returns whether a row was actually removed. */
export function deleteInstall(db: DatabaseSync, installId: string): boolean {
  const result = db.prepare("DELETE FROM installs WHERE install_id = ?").run(installId);
  return Number(result.changes) > 0;
}

/** Storage limitation: hard-delete installs unseen for `olderThanDays`. */
export function purgeStale(db: DatabaseSync, olderThanDays: number): number {
  const result = db.prepare("DELETE FROM installs WHERE last_seen < ?").run(isoDaysAgo(olderThanDays));
  return Number(result.changes);
}

export function countActive(db: DatabaseSync, withinDays: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM installs WHERE last_seen >= ?")
    .get(isoDaysAgo(withinDays)) as { n: number };
  return row.n;
}

export function listActiveInstalls(db: DatabaseSync, withinDays: number): InstallRow[] {
  return db
    .prepare("SELECT * FROM installs WHERE last_seen >= ?")
    .all(isoDaysAgo(withinDays)) as InstallRow[];
}

export function recordDailyActive(db: DatabaseSync, day: string, count: number): void {
  db.prepare(
    `INSERT INTO daily_active (day, active_count) VALUES (?, ?)
     ON CONFLICT(day) DO UPDATE SET active_count = excluded.active_count`,
  ).run(day, count);
}

export function listDailyActive(db: DatabaseSync): DailyActiveRow[] {
  return db.prepare("SELECT day, active_count FROM daily_active ORDER BY day ASC").all() as DailyActiveRow[];
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest --run src/__tests__/repo.test.ts && npm run typecheck
```
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add node:sqlite storage with upsert, erasure and retention purge"
```

---

### Task 3: Aggregate rollup

**Files:**
- Create: `src/aggregate.ts`
- Test: `src/__tests__/aggregate.test.ts`

**Interfaces:**
- Consumes: `InstallRow`, `DailyActiveRow` (Task 2).
- Produces: `buildAggregate(installs: InstallRow[], daily: DailyActiveRow[]): Aggregate` and `export interface Aggregate`. Task 4 serves it; Plan 4's dashboard consumes exactly this JSON.

`buildAggregate` is pure: rows in, JSON out. No DB handle, no clock. That is what
makes the rollup testable without fixtures on disk.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/aggregate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildAggregate } from "../aggregate.ts";
import type { InstallRow } from "../repo.ts";

function row(overrides: Partial<InstallRow> = {}): InstallRow {
  return {
    install_id: "a".repeat(32),
    first_seen: "2026-01-01T00:00:00.000Z",
    last_seen: "2026-07-10T00:00:00.000Z",
    version: "2.4.0",
    arch: "amd64",
    enabled_domains: JSON.stringify(["flight"]),
    users_bucket: "1",
    flights_bucket: "<50",
    cruises_bucket: "0",
    distance_flight_km: 1000,
    distance_cruise_km: 200,
    achievements_total: 3,
    achievement_keys: JSON.stringify(["globetrotter"]),
    features: JSON.stringify({
      llm_parser: false, backups: true, webdav_sync: false,
      historical_enrichment: false, live_tracking: false,
    }),
    flight_api_providers: JSON.stringify(["airlabs"]),
    locale: "de",
    ...overrides,
  };
}

describe("buildAggregate", () => {
  it("counts active installs", () => {
    const agg = buildAggregate([row(), row({ install_id: "b".repeat(32) })], []);
    expect(agg.active_installs).toBe(2);
  });

  it("sums distances across installs", () => {
    const agg = buildAggregate([row(), row({ install_id: "b".repeat(32), distance_flight_km: 500 })], []);
    expect(agg.total_distance_km.flight).toBe(1500);
    expect(agg.total_distance_km.cruise).toBe(400);
  });

  it("sums the trophy total", () => {
    const agg = buildAggregate([row(), row({ install_id: "b".repeat(32), achievements_total: 4 })], []);
    expect(agg.total_achievements).toBe(7);
  });

  it("ranks trophies by how many installs unlocked them", () => {
    const agg = buildAggregate(
      [
        row({ achievement_keys: JSON.stringify(["a", "b"]) }),
        row({ install_id: "b".repeat(32), achievement_keys: JSON.stringify(["a"]) }),
      ],
      [],
    );
    expect(agg.achievement_rarity).toEqual([
      { key: "a", installs: 2 },
      { key: "b", installs: 1 },
    ]);
  });

  it("splits versions, arch, locale and domains", () => {
    const agg = buildAggregate(
      [row(), row({ install_id: "b".repeat(32), version: "2.3.0", arch: "arm64", locale: "en" })],
      [],
    );
    expect(agg.versions).toEqual({ "2.4.0": 1, "2.3.0": 1 });
    expect(agg.arch).toEqual({ amd64: 1, arm64: 1 });
    expect(agg.locales).toEqual({ de: 1, en: 1 });
    expect(agg.domains).toEqual({ flight: 2 });
  });

  it("counts feature adoption", () => {
    const agg = buildAggregate([row()], []);
    expect(agg.features.backups).toBe(1);
    expect(agg.features.llm_parser).toBe(0);
  });

  it("passes daily_active through in order", () => {
    const agg = buildAggregate([], [{ day: "2026-07-09", active_count: 1 }, { day: "2026-07-10", active_count: 3 }]);
    expect(agg.growth).toEqual([
      { day: "2026-07-09", active_count: 1 },
      { day: "2026-07-10", active_count: 3 },
    ]);
  });

  it("returns a well-formed empty aggregate for zero installs", () => {
    const agg = buildAggregate([], []);
    expect(agg.active_installs).toBe(0);
    expect(agg.total_distance_km).toEqual({ flight: 0, cruise: 0 });
    expect(agg.achievement_rarity).toEqual([]);
  });

  it("survives a corrupt JSON column without throwing", () => {
    const agg = buildAggregate([row({ achievement_keys: "{not json" })], []);
    expect(agg.active_installs).toBe(1);
    expect(agg.achievement_rarity).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest --run src/__tests__/aggregate.test.ts
```
Expected: FAIL — cannot resolve `../aggregate.ts`.

- [ ] **Step 3: Implement**

`src/aggregate.ts`:

```typescript
import type { DailyActiveRow, InstallRow } from "./repo.ts";

export interface Aggregate {
  active_installs: number;
  /** Rounded sums. A LOWER BOUND for flights: routeDistance is nullable client-side. */
  total_distance_km: { flight: number; cruise: number };
  total_achievements: number;
  achievement_rarity: { key: string; installs: number }[];
  versions: Record<string, number>;
  arch: Record<string, number>;
  locales: Record<string, number>;
  domains: Record<string, number>;
  size_buckets: { users: Record<string, number>; flights: Record<string, number>; cruises: Record<string, number> };
  features: Record<string, number>;
  growth: DailyActiveRow[];
  generated_at: string;
}

/** Parse a JSON column defensively — a corrupt row must never take down the rollup. */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function tally(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function buildAggregate(installs: InstallRow[], daily: DailyActiveRow[]): Aggregate {
  const versions: Record<string, number> = {};
  const arch: Record<string, number> = {};
  const locales: Record<string, number> = {};
  const domains: Record<string, number> = {};
  const features: Record<string, number> = {};
  const rarity: Record<string, number> = {};
  const users: Record<string, number> = {};
  const flights: Record<string, number> = {};
  const cruises: Record<string, number> = {};

  let flightKm = 0;
  let cruiseKm = 0;
  let achievements = 0;

  for (const row of installs) {
    tally(versions, row.version);
    tally(arch, row.arch);
    tally(locales, row.locale);
    tally(users, row.users_bucket);
    tally(flights, row.flights_bucket);
    tally(cruises, row.cruises_bucket);

    flightKm += row.distance_flight_km;
    cruiseKm += row.distance_cruise_km;
    achievements += row.achievements_total;

    for (const domain of parseJson<string[]>(row.enabled_domains, [])) tally(domains, domain);
    for (const key of parseJson<string[]>(row.achievement_keys, [])) tally(rarity, key);

    const flags = parseJson<Record<string, boolean>>(row.features, {});
    for (const [name, enabled] of Object.entries(flags)) {
      features[name] = (features[name] ?? 0) + (enabled ? 1 : 0);
    }
  }

  return {
    active_installs: installs.length,
    total_distance_km: { flight: flightKm, cruise: cruiseKm },
    total_achievements: achievements,
    achievement_rarity: Object.entries(rarity)
      .map(([key, count]) => ({ key, installs: count }))
      .sort((a, b) => b.installs - a.installs || a.key.localeCompare(b.key)),
    versions,
    arch,
    locales,
    domains,
    size_buckets: { users, flights, cruises },
    features,
    growth: daily,
    generated_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest --run src/__tests__/aggregate.test.ts && npm run typecheck
```
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add pure aggregate rollup with defensive JSON parsing"
```

---

### Task 4: Rate limiter + routes + app

**Files:**
- Create: `src/rateLimit.ts`, `src/routes.ts`, `src/app.ts`, `src/index.ts`
- Test: `src/__tests__/routes.test.ts`, `src/__tests__/rateLimit.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `createRateLimiter({ max, windowMs })`, `createApp(db): express.Express`. `POST /v1/ping`, `DELETE /v1/install/:id`, `GET /v1/aggregate`, `GET /health`.

**The limiter hashes the IP and keeps it in memory only.** No IP reaches SQLite, a
log line, or a response body. Task 5 also disables IP logging in nginx — the code
guarantee is worthless if the reverse proxy writes the address to disk.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/rateLimit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../rateLimit.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createRateLimiter", () => {
  it("allows up to max requests in the window", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    expect(limiter.allow("1.2.3.4")).toBe(true);
    expect(limiter.allow("1.2.3.4")).toBe(true);
    expect(limiter.allow("1.2.3.4")).toBe(false);
  });

  it("tracks distinct clients separately", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limiter.allow("1.2.3.4")).toBe(true);
    expect(limiter.allow("5.6.7.8")).toBe(true);
  });

  it("forgets a client after the window expires", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limiter.allow("1.2.3.4")).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(limiter.allow("1.2.3.4")).toBe(true);
  });

  it("never stores the raw address", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    limiter.allow("192.168.1.77");
    expect(JSON.stringify([...limiter.keysForTest()])).not.toContain("192.168.1.77");
  });
});
```

`src/__tests__/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { openDb } from "../db.ts";
import { createApp } from "../app.ts";

function validPing() {
  return {
    install_id: "a".repeat(32), version: "2.4.0", arch: "amd64",
    enabled_domains: ["flight"], users_bucket: "1", flights_bucket: "<50", cruises_bucket: "0",
    distance_km: { flight: 1000, cruise: 0 },
    achievements: { unlocked_total: 1, keys: ["x"] },
    features: { llm_parser: false, backups: false, webdav_sync: false, historical_enrichment: false, live_tracking: false },
    flight_api_providers: [], locale: "de", reported_at: new Date().toISOString(),
  };
}

let app: ReturnType<typeof createApp>;
beforeEach(() => { app = createApp(openDb(":memory:")); });

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("POST /v1/ping", () => {
  it("accepts a valid payload", async () => {
    expect((await request(app).post("/v1/ping").send(validPing())).status).toBe(204);
  });

  it("rejects an invalid payload with 400 and no stack trace", async () => {
    const res = await request(app).post("/v1/ping").send({ install_id: "nope" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("at ");
  });

  it("dedups repeated pings from one install", async () => {
    await request(app).post("/v1/ping").send(validPing());
    await request(app).post("/v1/ping").send(validPing());
    const res = await request(app).get("/v1/aggregate");
    expect(res.body.active_installs).toBe(1);
  });
});

describe("DELETE /v1/install/:id", () => {
  it("erases a known install and returns 204", async () => {
    await request(app).post("/v1/ping").send(validPing());
    expect((await request(app).delete(`/v1/install/${"a".repeat(32)}`)).status).toBe(204);
    expect((await request(app).get("/v1/aggregate")).body.active_installs).toBe(0);
  });

  it("returns 204 for an unknown id — never confirms existence", async () => {
    expect((await request(app).delete(`/v1/install/${"b".repeat(32)}`)).status).toBe(204);
  });

  it("rejects a malformed id with 400", async () => {
    expect((await request(app).delete("/v1/install/not-an-id")).status).toBe(400);
  });
});

describe("GET /v1/aggregate", () => {
  it("is CORS-open and cacheable", async () => {
    const res = await request(app).get("/v1/aggregate");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["cache-control"]).toContain("max-age");
  });

  it("returns a well-formed empty rollup", async () => {
    const res = await request(app).get("/v1/aggregate");
    expect(res.status).toBe(200);
    expect(res.body.active_installs).toBe(0);
  });
});
```

Install the test-only dependency: `npm install -D supertest @types/supertest`.

Returning **204 for an unknown id** is deliberate: a 404 would confirm whether a
given `install_id` exists, turning the erasure endpoint into an oracle.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest --run
```
Expected: FAIL — cannot resolve `../rateLimit.ts` and `../app.ts`.

- [ ] **Step 3: Implement `src/rateLimit.ts`**

```typescript
import { createHash } from "node:crypto";

interface Entry {
  count: number;
  expiresAt: number;
}

export interface RateLimiter {
  allow(clientAddress: string): boolean;
  /** Test seam. Exposes the hashed keys only. */
  keysForTest(): Iterable<string>;
}

/**
 * In-memory, TTL-bounded limiter.
 *
 * The client address is hashed immediately and the digest is the only thing kept.
 * No raw IP is ever stored, logged, or persisted. GDPR Art. 6 (1) f — abuse
 * prevention — and nothing more.
 */
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }): RateLimiter {
  const entries = new Map<string, Entry>();

  const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

  return {
    allow(clientAddress: string): boolean {
      const key = hash(clientAddress);
      const now = Date.now();
      const existing = entries.get(key);

      if (!existing || existing.expiresAt <= now) {
        entries.set(key, { count: 1, expiresAt: now + windowMs });
        // Opportunistic sweep so the map cannot grow without bound.
        for (const [k, v] of entries) if (v.expiresAt <= now) entries.delete(k);
        return true;
      }
      if (existing.count >= max) return false;
      existing.count += 1;
      return true;
    },
    keysForTest: () => entries.keys(),
  };
}
```

- [ ] **Step 4: Implement `src/routes.ts` and `src/app.ts`**

`src/routes.ts`:

```typescript
import { Router, type Request, type Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { pingSchema } from "./schema.ts";
import { buildAggregate, type Aggregate } from "./aggregate.ts";
import { deleteInstall, listActiveInstalls, listDailyActive, upsertInstall } from "./repo.ts";
import { createRateLimiter } from "./rateLimit.ts";

const ACTIVE_WINDOW_DAYS = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;
const INSTALL_ID_RE = /^[0-9a-f]{32}$/;

export function createRouter(db: DatabaseSync): Router {
  const router = Router();
  const writeLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

  let cached: { value: Aggregate; expiresAt: number } | null = null;

  const clientAddress = (req: Request): string =>
    // Behind the Cloudflare tunnel + nginx; the value is hashed immediately and discarded.
    req.ip ?? req.socket.remoteAddress ?? "unknown";

  const limited = (req: Request, res: Response): boolean => {
    if (writeLimiter.allow(clientAddress(req))) return false;
    res.status(429).json({ error: "rate_limited" });
    return true;
  };

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.post("/v1/ping", (req, res) => {
    if (limited(req, res)) return;
    const parsed = pingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    upsertInstall(db, parsed.data);
    cached = null;
    res.status(204).end();
  });

  router.delete("/v1/install/:id", (req, res) => {
    if (limited(req, res)) return;
    if (!INSTALL_ID_RE.test(req.params.id)) {
      res.status(400).json({ error: "invalid_install_id" });
      return;
    }
    deleteInstall(db, req.params.id);
    cached = null;
    // Always 204, even for an unknown id: a 404 would confirm whether an id exists.
    res.status(204).end();
  });

  router.get("/v1/aggregate", (_req, res) => {
    const now = Date.now();
    if (!cached || cached.expiresAt <= now) {
      cached = {
        value: buildAggregate(listActiveInstalls(db, ACTIVE_WINDOW_DAYS), listDailyActive(db)),
        expiresAt: now + CACHE_TTL_MS,
      };
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_MS / 1000}`);
    res.json(cached.value);
  });

  return router;
}
```

`src/app.ts`:

```typescript
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { createRouter } from "./routes.ts";

export function createApp(db: DatabaseSync): express.Express {
  const app = express();
  app.set("trust proxy", 1); // nginx sits in front; needed for req.ip
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use(createRouter(db));
  return app;
}
```

`src/index.ts`:

```typescript
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";
import { startCron } from "./cron.ts";

const PORT = Number(process.env.STATS_PORT ?? 8088);
const DB_PATH = process.env.STATS_DB_PATH ?? "./stats.db";

const db = openDb(DB_PATH);
startCron(db);

createApp(db).listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`travstats-stats listening on 127.0.0.1:${PORT}\n`);
});
```

`src/index.ts` imports `startCron`, which Task 5 creates. Implement Task 5 before
running `npm start`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest --run && npm run typecheck
```
Expected: PASS — 4 rate-limit tests, 9 route tests. Typecheck clean (once `cron.ts` exists; comment the import out temporarily if running before Task 5).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add hashed in-memory rate limiter, ingest/erasure/aggregate routes"
```

---

### Task 5: Cron — rollup + retention

**Files:**
- Create: `src/cron.ts`
- Test: `src/__tests__/cron.test.ts`

**Interfaces:**
- Consumes: `repo.ts`.
- Produces: `rollupToday(db, today: string): number`, `runRetention(db): number`, `startCron(db): void`.

`rollupToday` takes the day as a parameter rather than reading the clock, so the
test does not depend on when it runs.

- [ ] **Step 1: Write the failing test**

`src/__tests__/cron.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../db.ts";
import { upsertInstall, listDailyActive } from "../repo.ts";
import { rollupToday, runRetention, RETENTION_DAYS } from "../cron.ts";
import type { Ping } from "../schema.ts";

const ping = (id: string): Ping => ({
  install_id: id, version: "2.4.0", arch: "amd64", enabled_domains: ["flight"],
  users_bucket: "1", flights_bucket: "<50", cruises_bucket: "0",
  distance_km: { flight: 0, cruise: 0 }, achievements: { unlocked_total: 0, keys: [] },
  features: { llm_parser: false, backups: false, webdav_sync: false, historical_enrichment: false, live_tracking: false },
  flight_api_providers: [], locale: "de", reported_at: new Date().toISOString(),
});

let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(":memory:"); });

describe("rollupToday", () => {
  it("records today's active count", () => {
    upsertInstall(db, ping("a".repeat(32)));
    upsertInstall(db, ping("b".repeat(32)));
    expect(rollupToday(db, "2026-07-10")).toBe(2);
    expect(listDailyActive(db)).toEqual([{ day: "2026-07-10", active_count: 2 }]);
  });

  it("is idempotent for the same day", () => {
    upsertInstall(db, ping("a".repeat(32)));
    rollupToday(db, "2026-07-10");
    rollupToday(db, "2026-07-10");
    expect(listDailyActive(db)).toHaveLength(1);
  });

  it("preserves history after an install ages out", () => {
    upsertInstall(db, ping("a".repeat(32)));
    rollupToday(db, "2026-07-10");
    db.prepare("DELETE FROM installs").run();
    expect(listDailyActive(db)).toEqual([{ day: "2026-07-10", active_count: 1 }]);
  });
});

describe("runRetention", () => {
  it("purges installs beyond the retention window", () => {
    upsertInstall(db, ping("a".repeat(32)));
    db.prepare("UPDATE installs SET last_seen = ?").run("2020-01-01T00:00:00.000Z");
    expect(runRetention(db)).toBe(1);
  });

  it("keeps recent installs", () => {
    upsertInstall(db, ping("a".repeat(32)));
    expect(runRetention(db)).toBe(0);
  });

  it("uses a 180-day window per the GDPR storage-limitation decision", () => {
    expect(RETENTION_DAYS).toBe(180);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest --run src/__tests__/cron.test.ts
```
Expected: FAIL — cannot resolve `../cron.ts`.

- [ ] **Step 3: Implement**

`src/cron.ts`:

```typescript
import cron from "node-cron";
import type { DatabaseSync } from "node:sqlite";
import { countActive, purgeStale, recordDailyActive } from "./repo.ts";

const ACTIVE_WINDOW_DAYS = 30;
/** GDPR storage limitation. See the spec, §3. */
export const RETENTION_DAYS = 180;

/**
 * Snapshot today's active count.
 *
 * Without this rollup the growth chart cannot be reconstructed once installs age
 * out of the active window — the history would silently rewrite itself.
 */
export function rollupToday(db: DatabaseSync, today: string): number {
  const count = countActive(db, ACTIVE_WINDOW_DAYS);
  recordDailyActive(db, today, count);
  return count;
}

export function runRetention(db: DatabaseSync): number {
  return purgeStale(db, RETENTION_DAYS);
}

export function startCron(db: DatabaseSync): void {
  // 00:10 UTC daily — after midnight, before any human looks at the dashboard.
  cron.schedule("10 0 * * *", () => {
    const today = new Date().toISOString().slice(0, 10);
    const active = rollupToday(db, today);
    const purged = runRetention(db);
    process.stdout.write(`[cron] day=${today} active=${active} purged=${purged}\n`);
  });
}
```

- [ ] **Step 4: Run the whole suite**

```bash
npx vitest --run && npm run typecheck && npm run lint
```
Expected: PASS — 6 cron tests, 40 total. Typecheck and lint clean.

- [ ] **Step 5: Smoke test the real server**

```bash
STATS_DB_PATH=/tmp/stats-smoke.db npm start &
curl -s localhost:8088/health
curl -s -X POST localhost:8088/v1/ping -H 'Content-Type: application/json' \
  -d '{"install_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","version":"2.4.0","arch":"amd64","enabled_domains":["flight"],"users_bucket":"1","flights_bucket":"<50","cruises_bucket":"0","distance_km":{"flight":1000,"cruise":0},"achievements":{"unlocked_total":1,"keys":["x"]},"features":{"llm_parser":false,"backups":false,"webdav_sync":false,"historical_enrichment":false,"live_tracking":false},"flight_api_providers":[],"locale":"de","reported_at":"2026-07-10T12:00:00.000Z"}' -w '%{http_code}\n'
curl -s localhost:8088/v1/aggregate
curl -s -X DELETE localhost:8088/v1/install/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -w '%{http_code}\n'
curl -s localhost:8088/v1/aggregate
```
Expected: `{"status":"ok"}`, `204`, an aggregate with `active_installs: 1`, `204`,
then an aggregate with `active_installs: 0`. Stop the server yourself; do **not** use
`taskkill`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add daily rollup and 180-day retention purge"
```

---

### Task 6: Deploy to CT133 + the no-IP-logging guarantee

**Files:**
- Create: `deploy/stats-setup.sh`, `deploy/DEPLOY.md`, `README.md`, `PRIVACY.md`

**Interfaces:**
- Produces: `https://stats.travstats.de/health` responding 200 in production.

> **This task contains the single highest-consequence detail in the whole design.**
> nginx and cloudflared must not write client IPs to disk on this vhost. Every
> in-code privacy guarantee is void if the reverse proxy logs the address. It must
> be **verified on the live host**, not assumed from the config file.

CT133 mirrors CT130 (`sublarr-stats`): Debian, nginx + cloudflared, ~3.9 GB disk,
256 MB RAM, no Docker. The service runs as systemd + node, SQLite on disk.

- [ ] **Step 1: Write `deploy/stats-setup.sh`**

Runs **inside CT133**. Idempotent.

```bash
#!/usr/bin/env bash
# Provision travstats-stats on CT133. Run inside the container.
set -euo pipefail

APP_DIR=/opt/travstats-stats
UNIT=/etc/systemd/system/travstats-stats.service

command -v node >/dev/null || { echo "node is required (>= 24)"; exit 1; }
node -e 'require("node:sqlite")' || { echo "node:sqlite unavailable — Node >= 22 required"; exit 1; }

mkdir -p "$APP_DIR"
tar --no-same-owner -C "$APP_DIR" -xzf /tmp/travstats-stats-code.tar.gz
cd "$APP_DIR"
npm ci --omit=dev

install -d -o www-data -g www-data "$APP_DIR"
chown -R www-data:www-data "$APP_DIR"

cat > "$UNIT" <<'EOF'
[Unit]
Description=travstats-stats anonymous usage-statistics service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/travstats-stats
Environment=STATS_PORT=8088
Environment=STATS_DB_PATH=/opt/travstats-stats/stats.db
ExecStart=/usr/bin/node --experimental-strip-types src/index.ts
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/travstats-stats

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now travstats-stats
sleep 2
curl -fsS http://127.0.0.1:8088/health && echo " -- travstats-stats healthy"
```

- [ ] **Step 2: Write the nginx vhost with IP logging OFF**

Also inside `deploy/stats-setup.sh`, or as a sibling `deploy/nginx-stats.sh`. The
`log_format` strips `$remote_addr` entirely — it is not anonymised, it is absent.

```nginx
# /etc/nginx/sites-available/stats.travstats.de
log_format stats_noip '- - [$time_local] "$request" $status $body_bytes_sent';

server {
    listen 80;
    server_name stats.travstats.de;

    # GDPR: no client IP on disk. Neither the access log nor the error log
    # may carry $remote_addr. See PRIVACY.md.
    access_log /var/log/nginx/stats.access.log stats_noip;
    error_log  /var/log/nginx/stats.error.log crit;

    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        # Deliberately NOT setting X-Forwarded-For / X-Real-IP:
        # the app must never see, and therefore never accidentally log, the address.
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
    }
}
```

Because `X-Forwarded-For` is not forwarded, `req.ip` resolves to the nginx loopback
address and the rate limiter would key every client identically. **Set
`app.set("trust proxy", false)` and rate-limit on the loopback address is useless.**
Resolve this explicitly: keep `X-Real-IP` **only** for the limiter, and never log it.
Replace the two commented lines with:

```nginx
        proxy_set_header X-Real-IP $remote_addr;
```

and leave `app.set("trust proxy", 1)` as written in Task 4. The IP then exists in
memory for exactly one hash operation. This is the deliberate trade: a working
limiter, still nothing on disk.

- [ ] **Step 3: Add the Cloudflare hostname**

Add `stats.travstats.de` as a second public hostname on the **existing**
`travstats-web` tunnel (`ddd96c4a-d3d9-40de-9c8e-0f6321917f08`) pointing at
`http://localhost:80`, plus the DNS CNAME. Use the token in
`~/.cloudflare-travstats-token`. Adapt `sublarr-stats/deploy/cf_add_stats.py` — it
preserves existing ingress rules rather than overwriting them, which matters because
`travstats.de` and `www.travstats.de` already live on that tunnel.

Then extend the CSP `connect-src` in
`/etc/nginx/snippets/security-headers.conf` on CT133 to include
`https://stats.travstats.de`. Remember the project's `add_header` inheritance
gotcha: a server-level header is silently dropped once any `location` block adds
its own — so verify the header is actually present on the apex response afterwards.

- [ ] **Step 4: Deploy and verify**

```bash
cd D:/TravStats_Projekt/travstats-stats
tar --exclude=node_modules --exclude=.git --exclude=stats.db -czf /tmp/travstats-stats-code.tar.gz .
scp /tmp/travstats-stats-code.tar.gz root@<pve-node1>:/tmp/
ssh root@<pve-node1> "pct push 133 /tmp/travstats-stats-code.tar.gz /tmp/travstats-stats-code.tar.gz && \
  pct exec 133 -- bash /opt/travstats-stats/deploy/stats-setup.sh"
curl -s https://stats.travstats.de/health
```
Expected: `{"status":"ok"}`.

- [ ] **Step 5: VERIFY the no-IP guarantee on the live host**

This is a verification step, not a configuration step. Run it and read the output.

```bash
# Send a ping from a known address, then grep every log for that address.
curl -s -X POST https://stats.travstats.de/v1/ping -H 'Content-Type: application/json' -d '{"install_id":"ffffffffffffffffffffffffffffffff","version":"0.0.0","arch":"amd64","enabled_domains":["flight"],"users_bucket":"1","flights_bucket":"<50","cruises_bucket":"0","distance_km":{"flight":0,"cruise":0},"achievements":{"unlocked_total":0,"keys":[]},"features":{"llm_parser":false,"backups":false,"webdav_sync":false,"historical_enrichment":false,"live_tracking":false},"flight_api_providers":[],"locale":"de","reported_at":"2026-07-10T12:00:00.000Z"}'

MY_IP=$(curl -s https://api.ipify.org)
ssh root@<pve-node1> "pct exec 133 -- bash -c '
  grep -r \"$MY_IP\" /var/log/nginx/ 2>/dev/null && echo \"FAIL: nginx logged the IP\" || echo \"OK: nginx clean\"
  journalctl -u cloudflared --since \"10 minutes ago\" | grep -q \"$MY_IP\" && echo \"FAIL: cloudflared logged the IP\" || echo \"OK: cloudflared clean\"
  journalctl -u travstats-stats --since \"10 minutes ago\" | grep -q \"$MY_IP\" && echo \"FAIL: app logged the IP\" || echo \"OK: app clean\"
  sqlite3 /opt/travstats-stats/stats.db \".dump\" | grep -q \"$MY_IP\" && echo \"FAIL: IP in the database\" || echo \"OK: database clean\"
'"

# Clean up the probe row.
curl -s -X DELETE https://stats.travstats.de/v1/install/ffffffffffffffffffffffffffffffff
```
Expected: four `OK:` lines. **Any `FAIL:` line blocks the release** — fix the source
and re-run before anything is announced. If `sqlite3` is not installed on CT133,
install it or dump via `node -e`; do not skip the check.

- [ ] **Step 6: Write `PRIVACY.md` (GDPR Art. 30) and `README.md`**

`PRIVACY.md` records: controller, purpose (anonymous adoption metrics), legal bases
(Art. 6 (1) a for the payload, Art. 6 (1) f for the transient rate-limit IP),
categories of data (the payload verbatim), recipients (Cloudflare as tunnel
operator, third-country transfer), retention (180 days for `installs`, indefinite
for `daily_active` counts), the erasure mechanism, and the no-IP-logging measure
with the verification command from Step 5.

`README.md` reproduces the payload contract **verbatim**, the four endpoints, the
`node:sqlite` rationale, local-run instructions, and a pointer to
`docs/superpowers/specs/2026-07-10-anonymous-usage-stats-design.md` in the TravStats
repo.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add CT133 systemd deploy, no-IP-logging vhost and Art.30 record"
```

---

## Done criteria

- `npx vitest --run && npm run typecheck && npm run lint` — all green (≈40 tests).
- `https://stats.travstats.de/health` returns 200.
- The Step 5 verification prints four `OK:` lines. **This is not optional.**
- `installs` has no column capable of holding an IP, hostname, or user-agent.
- `DELETE /v1/install/:id` returns 204 for known and unknown ids alike.
- No native npm dependency was added; `node:sqlite` is the only storage driver.
- `PRIVACY.md` exists and matches the payload the client actually sends.
