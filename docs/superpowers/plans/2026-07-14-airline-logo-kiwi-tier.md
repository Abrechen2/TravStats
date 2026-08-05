# Airline Logo — Keyless kiwi Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken vendored-wordmark logo tier with kiwi.com's finished brand tiles, stored on the data volume and refreshed automatically, and delete the manifest + plate heuristic that the old tier needed.

**Architecture:** `resolveAirlineLogo` gains a **kiwi** tier between logostream (premium) and Daisycon (tail net). kiwi returns a square PNG that already carries its own background, so the frontend renders it bare — no manifest, no brand colour, no luminance heuristic. The existing disk cache (already on `/app/data`) gains `fetchedAt` / `lastAttemptAt` / `source` and a stale-while-revalidate read path, plus a nightly cron sweep and an admin re-sync. The vendored `soaring-symbols` snapshot stops serving wordmarks and becomes the **icon tier**.

**Tech Stack:** Express/TypeScript, Jest (backend), React/Vitest (frontend), node-cron, Prisma (untouched here).

**Spec:** `docs/superpowers/specs/2026-07-14-airline-logo-kiwi-tier-design.md`

## Global Constraints

- **`any` is FORBIDDEN** — `unknown` + type guards. `.d.ts` files are the only exception.
- **Logger** — `import logger from '../utils/logger'` (default export). No `console.log`.
- **Async** — always `async/await`, never `.then()`.
- **Immutability** — spread `{...obj, field}`; no in-place mutation.
- **File size** — 200–400 lines ideal, **800 hard max**.
- **Prettier** — printWidth 100, `singleQuote: false` in the `airlineLogo/` tree (match the surrounding files, which use double quotes).
- **i18n** — every user-facing string lands in **DE and EN together**. DE is primary.
- **Branch** — `feat/airline-logo-kiwi-tier` (already exists, spec committed). Never commit to `main`.
- **Never leak the logostream key** — it travels as a `key=` query param; `maskKey()` already scrubs it before logging. Any new log line carrying a URL must go through it.
- **The fall-through invariant** — every tier returns `null` on a miss and falls through. A tier must **never** return a placeholder image. This is the invariant the whole chain rests on.

### Verified constants (measured 2026-07-14, do not re-derive)

| Constant | Value |
|---|---|
| kiwi base | `https://images.kiwi.com/airlines` |
| Size used | `128` (kiwi offers 32/64/128 only; 256+ → 404) |
| kiwi placeholder md5 @128 | `946bca53c7e1c56d66a7f13e69520aee` (2477 B, a grey aeroplane glyph) |
| Coverage | 133/133 measured, incl. regional + low-cost carriers |

---

## File Structure

**Backend**
- Modify `backend/src/services/airlineLogo/logoCache.ts` — meta gains `fetchedAt` / `lastAttemptAt` / `source`; new `getCachedLogoEntry`, `touchFailedRefresh`, `listCachedLogoKeys`, `isStale`.
- Modify `backend/src/services/airlineLogo/airlineLogoService.ts` — add the kiwi tier; stale-while-revalidate; export `refreshLogo`.
- Modify `backend/src/services/airlineLogo/vendoredLogos.ts` — demote to the icon tier; delete `vendoredBrands`.
- Create `backend/src/jobs/airlineLogoRefreshScheduler.ts` — nightly sweep.
- Modify `backend/src/index.ts` — start/stop the scheduler.
- Modify `backend/src/routes/airlineLogos.ts` — delete `GET /manifest`.
- Modify `backend/src/routes/admin/system.ts` — add `POST /admin/airline-logos/refresh` + `GET /admin/airline-logos/refresh-status`.

**Frontend**
- Modify `frontend/src/components/flightsTable/AirlineWordmarkCell.tsx` — render the tile bare; delete `isDark` + the plate.
- Delete `frontend/src/hooks/useAirlineLogoManifest.ts`.
- Modify `frontend/src/components/Admin/…` — the re-sync button (see Task 7).

---

## Task 1: The kiwi tier

**Files:**
- Modify: `backend/src/services/airlineLogo/airlineLogoService.ts`
- Test: `backend/src/services/airlineLogo/__tests__/airlineLogoService.test.ts`

**Interfaces:**
- Consumes: `fetchImage(url)`, `md5(buf)`, `CachedLogo` — all already in the file.
- Produces: `fromKiwi(code: string): Promise<CachedLogo | null>`, inserted into the chain in `resolveAirlineLogo`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/services/airlineLogo/__tests__/airlineLogoService.test.ts`. Check the existing file first — it already mocks `global.fetch` and `getApiKey`; reuse that harness rather than inventing a second one.

```ts
describe("kiwi tier", () => {
  const REAL_PNG = Buffer.from("89504e470d0a1a0a-real-logo-bytes", "utf-8");
  // The byte-stable grey-aeroplane placeholder kiwi returns for unknown codes.
  const PLACEHOLDER = Buffer.from("kiwi-grey-aeroplane-placeholder", "utf-8");

  beforeEach(() => {
    __resetNegativeCacheForTests();
    jest.restoreAllMocks();
  });

  it("returns the bytes for an airline kiwi knows", async () => {
    mockFetchOnce({ url: /images\.kiwi\.com/, body: REAL_PNG, contentType: "image/png" });
    const logo = await resolveAirlineLogo("LH", "logo");
    expect(logo?.body).toEqual(REAL_PNG);
  });

  it("treats the placeholder as a miss and falls through to Daisycon", async () => {
    // Force the kiwi placeholder md5 into the guard set for this test by
    // serving the exact bytes the constant hashes; see KIWI_PLACEHOLDER_MD5S.
    mockFetchOnce({ url: /images\.kiwi\.com/, body: placeholderBytes(), contentType: "image/png" });
    mockFetchOnce({ url: /daisycon/, body: REAL_PNG, contentType: "image/png" });
    const logo = await resolveAirlineLogo("ZZ", "logo");
    expect(logo?.body).toEqual(REAL_PNG); // Daisycon answered, not kiwi
  });

  it("never returns a placeholder as if it were a logo", async () => {
    mockFetchOnce({ url: /images\.kiwi\.com/, body: placeholderBytes(), contentType: "image/png" });
    mockFetchOnce({ url: /daisycon/, status: 404 });
    const logo = await resolveAirlineLogo("ZZ", "logo");
    expect(logo).toBeNull();
  });

  it("runs after logostream — a premium key wins", async () => {
    mockApiKey("logostream", "secret");
    mockFetchOnce({ url: /logostream/, body: REAL_PNG, contentType: "image/png" });
    const kiwiSpy = mockFetchOnce({ url: /images\.kiwi\.com/, body: REAL_PNG, contentType: "image/png" });
    await resolveAirlineLogo("LH", "logo");
    expect(kiwiSpy).not.toHaveBeenCalled();
  });
});
```

`placeholderBytes()` reads the **real** placeholder, committed as a fixture:

```ts
import fs from "fs";
import path from "path";

// The actual bytes kiwi returns for an unknown code (fetched from
// images.kiwi.com/airlines/128/ZZ.png on 2026-07-14). Using the real image —
// rather than a stub whose hash we inject into the guard set — means this test
// also proves the KIWI_PLACEHOLDER_MD5S constant itself is correct. If kiwi
// ever changes the placeholder, this test fails and tells us to re-vendor it,
// which is exactly the signal we want.
function placeholderBytes(): Buffer {
  return fs.readFileSync(
    path.join(__dirname, "fixtures", "kiwi-placeholder-128.png")
  );
}
```

The fixture is already committed at
`backend/src/services/airlineLogo/__tests__/fixtures/kiwi-placeholder-128.png`
(2477 B, md5 `946bca53c7e1c56d66a7f13e69520aee`).

**Do not mutate `KIWI_PLACEHOLDER_MD5S` from a test.** A test that injects its
own stub's hash into the production guard set proves only that the guard works
on a value the test invented — it would stay green if the real constant were
wrong.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && npx jest airlineLogoService -t "kiwi tier"
```

Expected: FAIL — kiwi is never called; the premium/vendored/daisycon chain answers.

- [ ] **Step 3: Implement the tier**

In `backend/src/services/airlineLogo/airlineLogoService.ts`, next to the existing constants:

```ts
const KIWI_BASE = "https://images.kiwi.com/airlines";
// kiwi offers 32/64/128 only (256+ is a 404). 128 is the largest, and the
// flights-table tile renders at 44–56 px, so 128 also covers a 2× display.
const KIWI_SIZE = 128;

// kiwi answers HTTP 200 with a generic grey-aeroplane glyph for codes it does
// not know. Unlike Daisycon's, this placeholder IS byte-stable: every unknown
// code returns the identical image (verified 2026-07-14 across ZZ/XX/99).
export const KIWI_PLACEHOLDER_MD5S = new Set(["946bca53c7e1c56d66a7f13e69520aee"]);
```

and the tier itself:

```ts
/**
 * The keyless default. kiwi returns a finished square brand tile that already
 * carries the airline's own background — Lufthansa white, Delta navy — so
 * nothing downstream needs a brand colour, a manifest or a contrast heuristic.
 *
 * IATA only: the endpoint takes a 2-letter code. A 3-letter ICAO is a miss here
 * and falls through, which is correct — Daisycon accepts ICAO.
 */
async function fromKiwi(code: string): Promise<CachedLogo | null> {
  if (code.length !== 2) return null;
  const logo = await fetchImage(`${KIWI_BASE}/${KIWI_SIZE}/${code}.png`);
  if (!logo) return null;
  if (KIWI_PLACEHOLDER_MD5S.has(md5(logo.body))) return null;
  return logo;
}
```

Rewrite the chain in `resolveAirlineLogo`, replacing the old three-tier comment
and expression:

```ts
  // Tiers, in order of what they cost the instance. A miss in one tier must
  // fall through, never be papered over: that is why each returns null rather
  // than a placeholder.
  //
  //   logostream — best quality, burns an admin's key budget, so it only runs
  //                where a key is configured. NOT complete (British Airways is
  //                missing), which is why the keyless tier below is not merely
  //                a fallback.
  //   vendored   — the ICON tier. Square marks for compact surfaces. It no
  //                longer serves wordmarks: its `logo.svg` was missing for 10
  //                of 93 airlines and its marks need a plate we no longer draw.
  //   kiwi       — the KEYLESS DEFAULT for wordmark-shaped variants. A finished
  //                brand tile with its own background; 133/133 measured.
  //   Daisycon   — the tail net for whatever even kiwi does not know.
  const logo =
    (await fromLogostream(code, variant)) ??
    getVendoredLogo(code, variant) ??
    (await fromKiwi(code)) ??
    (await fromDaisycon(code));
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npx jest airlineLogoService
```

Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/airlineLogo/airlineLogoService.ts \
        backend/src/services/airlineLogo/__tests__/airlineLogoService.test.ts
git commit -m "feat(logos): a keyless tier that carries its own background

kiwi.com returns a finished square brand tile — Lufthansa white, Delta navy —
so no consumer needs a brand colour, a manifest or a contrast heuristic. 133/133
airlines measured, including regional and low-cost carriers the vendored
snapshot never had. Unknown codes return a byte-stable grey-aeroplane
placeholder, guarded by md5 exactly as Daisycon's is."
```

---

## Task 2: The vendored snapshot becomes the icon tier

**Files:**
- Modify: `backend/src/services/airlineLogo/vendoredLogos.ts`
- Test: `backend/src/services/airlineLogo/__tests__/vendoredLogos.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getVendoredLogo(code, variant)` now resolves **only** `icon` and
  `logo-white`; `vendoredBrands()` and the `VendoredBrand` type are **deleted**.
  `vendoredAirlineCount()` stays (the admin/about surface uses it).

Why `logo-white` maps to the monochrome *icon*: a dark surface needs a
single-colour mark it can tint, and `icon-mono.svg` is exactly that. It needs no
plate at all.

- [ ] **Step 1: Write the failing tests**

```ts
it("serves the icon variant", () => {
  expect(getVendoredLogo("LH", "icon")).not.toBeNull();
});

it("serves the monochrome mark for logo-white", () => {
  expect(getVendoredLogo("LH", "logo-white")).not.toBeNull();
});

it("no longer serves wordmarks — the logo variant falls through", () => {
  // The vendored logo.svg was missing for 10 of 93 airlines and its marks
  // needed a plate. kiwi serves this variant now.
  expect(getVendoredLogo("LH", "logo")).toBeNull();
});

it("no longer serves tails", () => {
  expect(getVendoredLogo("LH", "tail")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx jest vendoredLogos
```

Expected: FAIL — `logo` and `tail` still resolve.

- [ ] **Step 3: Implement**

In `vendoredLogos.ts`, replace `VARIANT_FILES`:

```ts
/**
 * The vendored snapshot is the ICON tier. It deliberately does NOT serve the
 * wordmark variants any more: its `logo.svg` was absent for 10 of the 93
 * airlines, and the marks it does ship are drawn in the brand's own colour, so
 * they needed a contrasting plate — the heuristic that shipped an invisible
 * logo in 2.5.0-beta.1. kiwi serves wordmark-shaped variants now; this tier
 * keeps what it is genuinely good at.
 *
 * `logo-white` maps to the monochrome mark: a dark surface wants a
 * single-colour glyph it can tint, and that needs no plate at all.
 */
const VARIANT_FILES: Partial<Record<LogoVariant, string>> = {
  icon: "icon.svg",
  "logo-white": "icon-mono.svg",
};
```

and make the lookup tolerate an unmapped variant:

```ts
export function getVendoredLogo(code: string, variant: LogoVariant): CachedLogo | null {
  const file = VARIANT_FILES[variant];
  if (!file) return null; // wordmark-shaped variants belong to kiwi now
  ...
}
```

Delete `vendoredBrands()`, the `VendoredBrand` interface, and the
`branding.primary_color` reading in the snapshot loader — nothing consumes them
after Task 5.

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend && npx jest vendoredLogos airlineLogoService
```

Expected: PASS. If `airlineLogoService.test.ts` has a case asserting the
vendored tier answers `logo`, **delete it** — it encodes the bug.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/airlineLogo/vendoredLogos.ts \
        backend/src/services/airlineLogo/__tests__/vendoredLogos.test.ts
git commit -m "refactor(logos): the vendored snapshot is the icon tier now

Its logo.svg was missing for 10 of 93 airlines, and the marks it does ship are
drawn in the brand colour, so they needed the contrast plate that shipped an
invisible logo in beta.1. It keeps what it is good at — square marks for
compact surfaces — and logo-white now maps to the monochrome mark, which needs
no plate at all."
```

---

## Task 3: Cache freshness — fetchedAt, lastAttemptAt, source

**Files:**
- Modify: `backend/src/services/airlineLogo/logoCache.ts`
- Test: `backend/src/services/airlineLogo/__tests__/logoCache.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LogoSource = "logostream" | "vendored" | "kiwi" | "daisycon";
  export interface CachedLogo { body: Buffer; contentType: string }
  export interface CachedLogoEntry extends CachedLogo {
    /** Epoch ms of the last SUCCESSFUL fetch. null = legacy entry → infinitely stale. */
    fetchedAt: number | null;
    /** Epoch ms of the last attempt, successful or not. Drives the retry backoff. */
    lastAttemptAt: number | null;
    source: LogoSource | null;
  }
  export async function getCachedLogoEntry(key: string): Promise<CachedLogoEntry | null>;
  export async function putCachedLogo(key: string, logo: CachedLogo, source: LogoSource): Promise<void>;
  export async function touchFailedRefresh(key: string): Promise<void>;
  export async function listCachedLogoKeys(): Promise<string[]>;
  export function isStale(entry: CachedLogoEntry, maxAgeMs: number): boolean;
  ```
  `getCachedLogo` is **removed** — every caller moves to `getCachedLogoEntry`.

**The load-bearing rule:** a failed refresh writes **only** `lastAttemptAt`. It
must not touch `fetchedAt`. If it did, the stale entry would look fresh, the
nightly sweep would skip it, and a logo that failed to refresh once would freeze
forever.

- [ ] **Step 1: Write the failing tests**

```ts
import fs from "fs/promises";
import path from "path";
import {
  logoCacheDir, getCachedLogoEntry, putCachedLogo, touchFailedRefresh,
  listCachedLogoKeys, isStale,
} from "../logoCache";

const LOGO = { body: Buffer.from("png-bytes"), contentType: "image/png" };
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await fs.rm(logoCacheDir(), { recursive: true, force: true });
});

it("stamps fetchedAt, lastAttemptAt and source on write", async () => {
  const before = Date.now();
  await putCachedLogo("LH-logo", LOGO, "kiwi");
  const entry = await getCachedLogoEntry("LH-logo");
  expect(entry?.body).toEqual(LOGO.body);
  expect(entry?.source).toBe("kiwi");
  expect(entry?.fetchedAt).toBeGreaterThanOrEqual(before);
  expect(entry?.lastAttemptAt).toBeGreaterThanOrEqual(before);
});

it("treats a legacy entry with no fetchedAt as infinitely stale", async () => {
  const dir = logoCacheDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "LH-logo.img"), LOGO.body);
  await fs.writeFile(path.join(dir, "LH-logo.meta.json"),
    JSON.stringify({ contentType: "image/png" })); // the pre-2.5.0 shape
  const entry = await getCachedLogoEntry("LH-logo");
  expect(entry?.fetchedAt).toBeNull();
  expect(isStale(entry!, 30 * DAY)).toBe(true);
});

it("is fresh inside the max age and stale outside it", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi");
  const entry = (await getCachedLogoEntry("LH-logo"))!;
  expect(isStale(entry, 30 * DAY)).toBe(false);
  expect(isStale({ ...entry, fetchedAt: Date.now() - 31 * DAY }, 30 * DAY)).toBe(true);
});

it("a failed refresh moves lastAttemptAt but NEVER fetchedAt", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi");
  const fresh = (await getCachedLogoEntry("LH-logo"))!;
  // Age the entry so it is genuinely stale, then fail a refresh on it.
  const dir = logoCacheDir();
  const stale = { contentType: "image/png", fetchedAt: Date.now() - 40 * DAY,
                  lastAttemptAt: Date.now() - 40 * DAY, source: "kiwi" };
  await fs.writeFile(path.join(dir, "LH-logo.meta.json"), JSON.stringify(stale));

  await touchFailedRefresh("LH-logo");

  const after = (await getCachedLogoEntry("LH-logo"))!;
  expect(after.body).toEqual(fresh.body);                 // bytes survive
  expect(after.fetchedAt).toBe(stale.fetchedAt);          // staleness unchanged
  expect(after.lastAttemptAt).toBeGreaterThan(stale.lastAttemptAt!);
  // The whole point: a failing upstream must not make it look fresh.
  expect(isStale(after, 30 * DAY)).toBe(true);
});

it("lists the cached keys", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi");
  await putCachedLogo("BA-icon", LOGO, "vendored");
  expect((await listCachedLogoKeys()).sort()).toEqual(["BA-icon", "LH-logo"]);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx jest logoCache
```

Expected: FAIL — `getCachedLogoEntry` / `touchFailedRefresh` / `listCachedLogoKeys` / `isStale` do not exist.

- [ ] **Step 3: Implement**

Replace the body of `logoCache.ts` below `assertSafeKey` with:

```ts
export type LogoSource = "logostream" | "vendored" | "kiwi" | "daisycon";

export interface CachedLogoEntry extends CachedLogo {
  /** Epoch ms of the last SUCCESSFUL fetch. null on pre-2.5.0 entries. */
  fetchedAt: number | null;
  /** Epoch ms of the last attempt, success or failure. Drives the retry backoff. */
  lastAttemptAt: number | null;
  source: LogoSource | null;
}

interface LogoMeta {
  contentType: string;
  fetchedAt?: number;
  lastAttemptAt?: number;
  source?: LogoSource;
}

function parseMeta(raw: string): LogoMeta | null {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) return null;
  const meta = value as Record<string, unknown>;
  if (typeof meta.contentType !== "string") return null;
  return {
    contentType: meta.contentType,
    fetchedAt: typeof meta.fetchedAt === "number" ? meta.fetchedAt : undefined,
    lastAttemptAt: typeof meta.lastAttemptAt === "number" ? meta.lastAttemptAt : undefined,
    source: typeof meta.source === "string" ? (meta.source as LogoSource) : undefined,
  };
}

export async function getCachedLogoEntry(key: string): Promise<CachedLogoEntry | null> {
  assertSafeKey(key);
  try {
    const dir = logoCacheDir();
    const meta = parseMeta(await fs.readFile(path.join(dir, `${key}.meta.json`), "utf-8"));
    if (!meta) return null;
    const body = await fs.readFile(path.join(dir, `${key}.img`));
    return {
      body,
      contentType: meta.contentType,
      fetchedAt: meta.fetchedAt ?? null,
      lastAttemptAt: meta.lastAttemptAt ?? null,
      source: meta.source ?? null,
    };
  } catch {
    return null; // cold miss or corrupt entry — treated identically
  }
}

export async function putCachedLogo(
  key: string,
  logo: CachedLogo,
  source: LogoSource
): Promise<void> {
  assertSafeKey(key);
  const dir = logoCacheDir();
  await fs.mkdir(dir, { recursive: true });
  const now = Date.now();
  await fs.writeFile(path.join(dir, `${key}.img`), logo.body);
  const meta: LogoMeta = {
    contentType: logo.contentType,
    fetchedAt: now,
    lastAttemptAt: now,
    source,
  };
  await fs.writeFile(path.join(dir, `${key}.meta.json`), JSON.stringify(meta));
  logger.debug({ operation: "logo_cache_put", key, source }, "cached airline logo");
}

/**
 * Record that a refresh was attempted and failed.
 *
 * Writes `lastAttemptAt` and NOTHING else. Bumping `fetchedAt` here would make
 * the stale entry look fresh, the nightly sweep would skip it, and a logo that
 * failed to refresh once would never be retried again. Staleness is measured
 * from the last success; the retry backoff from the last attempt.
 */
export async function touchFailedRefresh(key: string): Promise<void> {
  assertSafeKey(key);
  const dir = logoCacheDir();
  const file = path.join(dir, `${key}.meta.json`);
  try {
    const meta = parseMeta(await fs.readFile(file, "utf-8"));
    if (!meta) return;
    await fs.writeFile(file, JSON.stringify({ ...meta, lastAttemptAt: Date.now() }));
  } catch {
    // No entry to touch — nothing to record.
  }
}

export async function listCachedLogoKeys(): Promise<string[]> {
  try {
    const files = await fs.readdir(logoCacheDir());
    return files
      .filter((f) => f.endsWith(".meta.json"))
      .map((f) => f.slice(0, -".meta.json".length));
  } catch {
    return []; // no cache dir yet
  }
}

/** A legacy entry (no fetchedAt) is infinitely stale — it refreshes on first touch. */
export function isStale(entry: CachedLogoEntry, maxAgeMs: number): boolean {
  if (entry.fetchedAt === null) return true;
  return Date.now() - entry.fetchedAt > maxAgeMs;
}
```

Keep `logoCacheDir`, `assertSafeKey`, `KEY_PATTERN` and the `CachedLogo` type as
they are. Delete the old `getCachedLogo`.

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend && npx jest logoCache
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/airlineLogo/logoCache.ts \
        backend/src/services/airlineLogo/__tests__/logoCache.test.ts
git commit -m "feat(logos): the disk cache learns when it was filled

Entries carried no timestamp, so a logo fetched once was served forever and an
airline rebrand would never reach an instance. Adds fetchedAt (last success),
lastAttemptAt (last attempt) and source. A failed refresh writes only
lastAttemptAt — bumping fetchedAt would make a stale entry look fresh and
freeze it forever."
```

---

## Task 4: Stale-while-revalidate in the resolver

**Files:**
- Modify: `backend/src/services/airlineLogo/airlineLogoService.ts`
- Test: `backend/src/services/airlineLogo/__tests__/airlineLogoService.test.ts`

**Interfaces:**
- Consumes: `getCachedLogoEntry`, `putCachedLogo`, `touchFailedRefresh`, `isStale`, `LogoSource` (Task 3).
- Produces:
  ```ts
  export const LOGO_MAX_AGE_MS: number;   // env LOGO_MAX_AGE_DAYS, default 30
  export const RETRY_BACKOFF_MS: number;  // 6 h
  /** Re-fetch one cache key through the chain. Returns true when bytes changed. */
  export async function refreshLogo(key: string): Promise<boolean>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe("stale-while-revalidate", () => {
  it("serves a stale entry immediately and does not block on the network", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    await ageEntry("LH-logo", 40 * DAY);          // helper: rewrite fetchedAt
    const slow = mockFetchNeverResolves(/kiwi/);   // upstream hangs

    const logo = await resolveAirlineLogo("LH", "logo");

    expect(logo?.body).toEqual(OLD);              // served from cache, at once
    expect(slow).toHaveBeenCalled();              // refresh WAS kicked off
  });

  it("a fresh entry triggers no refresh at all", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    const spy = mockFetchOnce({ url: /kiwi/, body: NEW, contentType: "image/png" });
    await resolveAirlineLogo("LH", "logo");
    expect(spy).not.toHaveBeenCalled();
  });

  it("the next request gets the refreshed bytes", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    await ageEntry("LH-logo", 40 * DAY);
    mockFetchOnce({ url: /kiwi/, body: NEW, contentType: "image/png" });

    await resolveAirlineLogo("LH", "logo");   // serves OLD, refreshes behind it
    await flushRefreshes();                   // helper: await the in-flight refresh

    const second = await resolveAirlineLogo("LH", "logo");
    expect(second?.body).toEqual(NEW);
  });

  it("a failed refresh keeps the old bytes and leaves the entry stale", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    await ageEntry("LH-logo", 40 * DAY);
    mockFetchAllFail();

    const logo = await resolveAirlineLogo("LH", "logo");
    await flushRefreshes();

    expect(logo?.body).toEqual(OLD);
    const entry = (await getCachedLogoEntry("LH-logo"))!;
    expect(entry.body).toEqual(OLD);
    expect(isStale(entry, LOGO_MAX_AGE_MS)).toBe(true); // still due for retry
  });

  it("coalesces concurrent refreshes of the same key into one", async () => {
    await putCachedLogo("LH-logo", { body: OLD, contentType: "image/png" }, "kiwi");
    await ageEntry("LH-logo", 40 * DAY);
    const spy = mockFetchOnce({ url: /kiwi/, body: NEW, contentType: "image/png" });

    await Promise.all([
      resolveAirlineLogo("LH", "logo"),
      resolveAirlineLogo("LH", "logo"),
      resolveAirlineLogo("LH", "logo"),
    ]);
    await flushRefreshes();

    expect(spy).toHaveBeenCalledTimes(1); // a table of 200 rows must not fan out
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx jest airlineLogoService -t "stale-while-revalidate"
```

Expected: FAIL — a cache hit returns immediately and never revalidates.

- [ ] **Step 3: Implement**

```ts
const DAY_MS = 24 * 60 * 60 * 1000;
const LOGO_MAX_AGE_DAYS = Number(process.env.LOGO_MAX_AGE_DAYS ?? 30);
export const LOGO_MAX_AGE_MS = LOGO_MAX_AGE_DAYS * DAY_MS;
export const RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000;

// One in-flight refresh per key. A flights table renders hundreds of rows at
// once; without this, a single stale logo would fan out into hundreds of
// identical upstream requests.
const inFlight = new Map<string, Promise<boolean>>();

/** Test seam: await every refresh currently in flight. */
export async function __flushRefreshesForTests(): Promise<void> {
  await Promise.allSettled([...inFlight.values()]);
}

async function fetchFromChain(code: string, variant: LogoVariant):
  Promise<{ logo: CachedLogo; source: LogoSource } | null> {
  const premium = await fromLogostream(code, variant);
  if (premium) return { logo: premium, source: "logostream" };
  const vendored = getVendoredLogo(code, variant);
  if (vendored) return { logo: vendored, source: "vendored" };
  const kiwi = await fromKiwi(code);
  if (kiwi) return { logo: kiwi, source: "kiwi" };
  const daisycon = await fromDaisycon(code);
  if (daisycon) return { logo: daisycon, source: "daisycon" };
  return null;
}

/**
 * Re-fetch one cache key through the chain. Returns true when the bytes changed.
 *
 * A failure leaves the cached bytes AND their fetchedAt untouched: a stale logo
 * beats no logo, and the entry must stay visibly stale so the next sweep retries
 * it.
 */
export async function refreshLogo(key: string): Promise<boolean> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<boolean> => {
    const sep = key.lastIndexOf("-");
    const code = key.slice(0, sep);
    const variant = key.slice(sep + 1) as LogoVariant;
    try {
      const found = await fetchFromChain(code, variant);
      if (!found) {
        await touchFailedRefresh(key);
        return false;
      }
      await putCachedLogo(key, found.logo, found.source);
      return true;
    } catch (error) {
      logger.warn(
        { operation: "logo_refresh_failed", key, message: (error as Error).message },
        "airline logo refresh failed"
      );
      await touchFailedRefresh(key);
      return false;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}

function dueForRetry(entry: CachedLogoEntry): boolean {
  if (entry.lastAttemptAt === null) return true;
  return Date.now() - entry.lastAttemptAt > RETRY_BACKOFF_MS;
}

export async function resolveAirlineLogo(
  code: string,
  variant: LogoVariant
): Promise<CachedLogo | null> {
  const cacheKey = `${code}-${variant}`;

  const cached = await getCachedLogoEntry(cacheKey);
  if (cached) {
    // Stale-while-revalidate: the caller ALWAYS gets bytes now. A stale entry
    // refreshes behind the response, so no user ever waits on an upstream and a
    // dead upstream never blocks a page.
    if (isStale(cached, LOGO_MAX_AGE_MS) && dueForRetry(cached)) {
      void refreshLogo(cacheKey);
    }
    return { body: cached.body, contentType: cached.contentType };
  }

  const negativeUntil = negativeCache.get(cacheKey);
  if (negativeUntil !== undefined && negativeUntil > Date.now()) return null;
  negativeCache.delete(cacheKey);

  const found = await fetchFromChain(code, variant);
  if (!found) {
    negativeCache.set(cacheKey, Date.now() + NEGATIVE_TTL_MS);
    return null;
  }

  await putCachedLogo(cacheKey, found.logo, found.source);
  return found.logo;
}
```

The old inline chain expression is now `fetchFromChain` — delete the duplicate.

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend && npx jest airlineLogoService
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/airlineLogo/airlineLogoService.ts \
        backend/src/services/airlineLogo/__tests__/airlineLogoService.test.ts
git commit -m "feat(logos): serve stale bytes instantly, refresh behind the response

A cache read now always answers from disk, even when the entry is past its max
age, and kicks off a background refresh whose result the NEXT request sees. No
user waits on an upstream and a dead upstream never blocks a page. Refreshes
coalesce per key: a 200-row flights table must not fan out into 200 identical
requests."
```

---

## Task 5: The nightly refresh sweep

**Files:**
- Create: `backend/src/jobs/airlineLogoRefreshScheduler.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/jobs/__tests__/airlineLogoRefreshScheduler.test.ts`

**Interfaces:**
- Consumes: `listCachedLogoKeys`, `getCachedLogoEntry`, `isStale` (Task 3); `refreshLogo`, `LOGO_MAX_AGE_MS`, `RETRY_BACKOFF_MS` (Task 4).
- Produces:
  ```ts
  export async function sweepStaleLogos(): Promise<{ checked: number; refreshed: number }>;
  export function startAirlineLogoRefreshScheduler(): void;
  export function stopAirlineLogoRefreshScheduler(): void;
  ```

Model it on `backend/src/jobs/historicalEnrichmentScheduler.ts` — read that file
first for the module-level `schedulerTask` + `cron.schedule` shape. **Cron runs
in UTC** on this deployment (both containers set `TZ: UTC`; see the timezone
note in `CLAUDE.local.md`) — `0 3 * * *` means 3 AM UTC, which is what we want.

- [ ] **Step 1: Write the failing tests**

```ts
it("refreshes only entries past the max age", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi");                 // fresh
  await putCachedLogo("BA-logo", LOGO, "kiwi");
  await ageEntry("BA-logo", 40 * DAY);                          // stale
  const spy = jest.spyOn(service, "refreshLogo").mockResolvedValue(true);

  const result = await sweepStaleLogos();

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith("BA-logo");
  expect(result).toEqual({ checked: 2, refreshed: 1 });
});

it("skips a stale entry still inside the retry backoff", async () => {
  await putCachedLogo("BA-logo", LOGO, "kiwi");
  await ageEntry("BA-logo", 40 * DAY);
  await touchFailedRefresh("BA-logo");        // attempted just now → backoff
  const spy = jest.spyOn(service, "refreshLogo").mockResolvedValue(true);

  const result = await sweepStaleLogos();

  expect(spy).not.toHaveBeenCalled();
  expect(result).toEqual({ checked: 1, refreshed: 0 });
});

it("keeps going when one refresh throws", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi"); await ageEntry("LH-logo", 40 * DAY);
  await putCachedLogo("BA-logo", LOGO, "kiwi"); await ageEntry("BA-logo", 40 * DAY);
  jest.spyOn(service, "refreshLogo")
    .mockRejectedValueOnce(new Error("upstream down"))
    .mockResolvedValueOnce(true);

  const result = await sweepStaleLogos();

  expect(result.refreshed).toBe(1);   // one failed, the sweep completed anyway
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx jest airlineLogoRefreshScheduler
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

```ts
import cron, { type ScheduledTask } from "node-cron";
import logger from "../utils/logger";
import {
  getCachedLogoEntry, isStale, listCachedLogoKeys,
} from "../services/airlineLogo/logoCache";
import {
  refreshLogo, LOGO_MAX_AGE_MS, RETRY_BACKOFF_MS,
} from "../services/airlineLogo/airlineLogoService";

// 3 AM UTC. node-cron reads the container clock, and both containers run TZ=UTC
// (see the timezone note in CLAUDE.local.md) — so this really is 3 AM UTC.
const CRON_EXPRESSION = "0 3 * * *";

// Sequential, with a breath between fetches: a cold instance can hold a few
// hundred keys, and firing them all at once would look like an attack.
const DELAY_BETWEEN_MS = 250;

let schedulerTask: ScheduledTask | null = null;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function sweepStaleLogos(): Promise<{ checked: number; refreshed: number }> {
  const keys = await listCachedLogoKeys();
  let refreshed = 0;

  for (const key of keys) {
    const entry = await getCachedLogoEntry(key);
    if (!entry) continue;
    if (!isStale(entry, LOGO_MAX_AGE_MS)) continue;
    // Staleness is measured from the last success; the backoff from the last
    // attempt. An upstream that failed an hour ago is not retried tonight.
    if (entry.lastAttemptAt !== null && Date.now() - entry.lastAttemptAt < RETRY_BACKOFF_MS) {
      continue;
    }
    try {
      if (await refreshLogo(key)) refreshed++;
    } catch (error) {
      // One bad key must not abort the sweep.
      logger.warn(
        { operation: "logo_sweep_key_failed", key,
          message: error instanceof Error ? error.message : "unknown error" },
        "airline logo refresh failed during sweep"
      );
    }
    await sleep(DELAY_BETWEEN_MS);
  }

  logger.info(
    { operation: "logo_sweep_done", checked: keys.length, refreshed },
    "airline logo refresh sweep complete"
  );
  return { checked: keys.length, refreshed };
}

export function startAirlineLogoRefreshScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(CRON_EXPRESSION, () => {
    void sweepStaleLogos();
  });
  logger.info(
    { operation: "logo_scheduler_started", cron: CRON_EXPRESSION },
    "airline logo refresh scheduler started"
  );
}

export function stopAirlineLogoRefreshScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
```

Wire it into `backend/src/index.ts` beside the other schedulers — start it where
`historicalEnrichmentScheduler` starts, and add the stop call to the shutdown
block around line 296:

```ts
  const { stopAirlineLogoRefreshScheduler } = await import('./jobs/airlineLogoRefreshScheduler');
  stopAirlineLogoRefreshScheduler();
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend && npx jest airlineLogoRefreshScheduler && npx tsc --noEmit
```

Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add backend/src/jobs/airlineLogoRefreshScheduler.ts \
        backend/src/jobs/__tests__/airlineLogoRefreshScheduler.test.ts \
        backend/src/index.ts
git commit -m "feat(logos): a nightly sweep that keeps stored logos current

Stale-while-revalidate only refreshes logos somebody looks at. The sweep covers
the rest, so an airline that rebrands reaches every instance even if nobody
opened its flight that month. Sequential with a 250 ms breath between fetches —
a cold instance holds a few hundred keys and must not fire them in one burst."
```

---

## Task 6: Admin re-sync endpoint

**Files:**
- Modify: `backend/src/routes/admin/system.ts`
- Test: `backend/src/routes/admin/__tests__/airlineLogoRefresh.test.ts`

**Interfaces:**
- Consumes: `sweepStaleLogos` (Task 5).
- Produces: `POST /api/v1/admin/airline-logos/refresh` → `202 { message }`;
  `GET /api/v1/admin/airline-logos/refresh-status` → `{ running, checked, refreshed, finishedAt }`.

Mirrors the existing `POST /admin/airports/reseed` + `GET
/admin/airports/seeding-status` pair in the same file — read those first. Reuse
`adminReseedLimiter`.

- [ ] **Step 1: Write the failing tests**

```ts
it("requires admin", async () => {
  await request(app).post("/api/v1/admin/airline-logos/refresh")
    .set("Cookie", nonAdminCookie).expect(403);
});

it("starts a sweep and returns immediately", async () => {
  const spy = jest.spyOn(scheduler, "sweepStaleLogos")
    .mockResolvedValue({ checked: 5, refreshed: 2 });
  await request(app).post("/api/v1/admin/airline-logos/refresh")
    .set("Cookie", adminCookie).expect(202);
  expect(spy).toHaveBeenCalled();
});

it("refuses a second sweep while one is running", async () => {
  jest.spyOn(scheduler, "sweepStaleLogos").mockImplementation(() => neverResolves());
  await request(app).post("/api/v1/admin/airline-logos/refresh").set("Cookie", adminCookie).expect(202);
  await request(app).post("/api/v1/admin/airline-logos/refresh").set("Cookie", adminCookie).expect(409);
});

it("reports the last result", async () => {
  jest.spyOn(scheduler, "sweepStaleLogos").mockResolvedValue({ checked: 5, refreshed: 2 });
  await request(app).post("/api/v1/admin/airline-logos/refresh").set("Cookie", adminCookie);
  await flushPromises();
  const res = await request(app).get("/api/v1/admin/airline-logos/refresh-status")
    .set("Cookie", adminCookie).expect(200);
  expect(res.body).toMatchObject({ running: false, checked: 5, refreshed: 2 });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx jest airlineLogoRefresh
```

Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Implement**

In `backend/src/routes/admin/system.ts`:

```ts
import { sweepStaleLogos } from '../../jobs/airlineLogoRefreshScheduler';

// In-memory status. Deliberately not a DB row: a sweep is cheap, idempotent and
// safe to lose across a restart — unlike the airport seed, which is not.
interface LogoRefreshStatus {
  running: boolean;
  checked: number | null;
  refreshed: number | null;
  finishedAt: string | null;
}
let logoRefreshStatus: LogoRefreshStatus = {
  running: false, checked: null, refreshed: null, finishedAt: null,
};

// POST /admin/airline-logos/refresh — re-check every stored logo against the
// resolution chain now, instead of waiting for tonight's sweep. Returns at once;
// poll GET /admin/airline-logos/refresh-status.
router.post('/airline-logos/refresh', adminReseedLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (logoRefreshStatus.running) {
      res.status(409).json({ error: 'A logo refresh is already running' });
      return;
    }
    logoRefreshStatus = { running: true, checked: null, refreshed: null, finishedAt: null };
    logger.info({
      operation: 'admin_airline_logo_refresh',
      message: 'Airline logo refresh triggered via admin endpoint',
      context: { triggeredBy: req.userId, viaPAT: !!req.apiToken },
    });

    // Fire and forget — the sweep can take minutes on a warm cache.
    void sweepStaleLogos()
      .then((result) => {
        logoRefreshStatus = {
          running: false,
          checked: result.checked,
          refreshed: result.refreshed,
          finishedAt: new Date().toISOString(),
        };
      })
      .catch((error: unknown) => {
        logger.error({
          operation: 'admin_airline_logo_refresh_failed',
          message: 'Airline logo refresh failed',
          error: { message: error instanceof Error ? error.message : 'unknown error' },
        });
        logoRefreshStatus = {
          running: false, checked: null, refreshed: null,
          finishedAt: new Date().toISOString(),
        };
      });

    res.status(202).json({ message: 'Logo refresh started' });
  } catch (error) {
    next(error);
  }
});

router.get('/airline-logos/refresh-status', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(logoRefreshStatus);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend && npx jest airlineLogoRefresh && npx tsc --noEmit && npm run lint
```

Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin/system.ts \
        backend/src/routes/admin/__tests__/airlineLogoRefresh.test.ts
git commit -m "feat(logos): let an admin re-check the stored logos on demand

Mirrors the airport re-seed: fire and forget, poll for the result. The status
lives in memory on purpose — a sweep is cheap and idempotent, so losing it
across a restart costs nothing."
```

---

## Task 7: The frontend stops guessing

**Files:**
- Modify: `frontend/src/components/flightsTable/AirlineWordmarkCell.tsx`
- Modify: `frontend/src/components/flightsTable/__tests__/AirlineWordmarkCell.test.tsx`
- Delete: `frontend/src/hooks/useAirlineLogoManifest.ts`
- Modify: `backend/src/routes/airlineLogos.ts` (delete `GET /manifest`)
- Modify: `backend/src/routes/__tests__/airlineLogos.test.ts`

**Interfaces:**
- Consumes: nothing — this task *removes* the contract between the manifest and the cell.
- Produces: `AirlineWordmarkCell` renders `<AirlineLogo variant="logo" size={44} />` bare.

**The existing plate assertions must be DELETED, not adapted.** They assert the
tile background follows the brand's luminance — they encode the bug. Every one
of them passed while the logo was invisible on screen, which is exactly why a
green suite proved nothing here.

- [ ] **Step 1: Write the failing tests**

Replace the plate cases in `AirlineWordmarkCell.test.tsx`:

```tsx
it("renders the logo with no plate behind it", () => {
  const { container } = render(<AirlineWordmarkCell flight={flight} />);
  const img = container.querySelector("img");
  expect(img).toBeTruthy();
  // The tile arrives with its own background. Anything we paint behind it is a
  // second background — which is what shipped broken in 2.5.0-beta.1 and .2.
  const wrapper = img!.parentElement!;
  expect(wrapper.style.background).toBe("");
});

it("does not fetch a manifest", async () => {
  const spy = jest.spyOn(api, "get");
  render(<AirlineWordmarkCell flight={flight} />);
  await waitFor(() => expect(spy).not.toHaveBeenCalledWith("/airline-logos/manifest"));
});

it("falls back to the airline name when no logo resolves", () => {
  const { getByText } = render(<AirlineWordmarkCell flight={{ ...flight, airline: "Lufthansa" }} />);
  fireEvent.error(document.querySelector("img")!);
  expect(getByText("Lufthansa")).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && npx vitest --run AirlineWordmarkCell
```

Expected: FAIL — the cell still paints a plate and still calls the manifest.

- [ ] **Step 3: Implement**

Replace `AirlineWordmarkCell.tsx` wholesale:

```tsx
import type { Flight } from "../../types";
import AirlineLogo from "../AirlineLogo";
import { resolveAirlineDisplay, resolveAirlineIata } from "../../lib/airlineUtils";

/**
 * Airline column cell: a departures-board style brand tile (owner reference:
 * airport departure boards). The written airline name is deliberately NOT shown
 * next to it (owner decision 2026-07-12) — it stays as the title tooltip and as
 * the text fallback when no logo resolves.
 *
 * The tile is rendered BARE. Every tier of the logo chain now returns an image
 * that carries its own background: kiwi's keyless brand tile does, and so does
 * a logostream wordmark. Painting anything behind it would be a second
 * background — which is precisely what 2.5.0-beta.1 shipped (a navy crane on a
 * navy plate: invisible) and what beta.2's luminance heuristic only half fixed.
 * There is nothing left for this component to decide.
 */
const TILE_PX = 44;

export default function AirlineWordmarkCell({ flight }: { flight: Flight }): JSX.Element {
  const name = resolveAirlineDisplay(flight);
  const iata = resolveAirlineIata(flight);

  const fallback = (
    <span className="font-medium" style={{ color: "var(--text-primary)" }}>
      {name || flight.flightNumber || "—"}
    </span>
  );

  return (
    <span title={name ?? undefined}>
      <AirlineLogo
        iata={iata}
        icao={flight.airlineIcao}
        flightNumber={flight.flightNumber}
        variant="logo"
        size={TILE_PX}
        // max-w-none: Tailwind's preflight sets img { max-width: 100% }, and
        // Firefox's auto table layout computes this column narrower than
        // Chrome — the cap would shrink the tile to the cell width there.
        className="rounded object-contain max-w-none"
        alt={name ?? "Airline logo"}
        fallback={fallback}
      />
    </span>
  );
}
```

Delete `frontend/src/hooks/useAirlineLogoManifest.ts` and grep for stragglers:

```bash
cd frontend && grep -rn "useAirlineLogoManifest\|airline-logos/manifest" src/
```

Expected after the change: **no hits**.

Delete the `GET /manifest` route from `backend/src/routes/airlineLogos.ts`
(including the `vendoredBrands` and `getApiKey` imports if nothing else in the
file uses them) and its cases from `backend/src/routes/__tests__/airlineLogos.test.ts`.

- [ ] **Step 4: Run to verify it passes**

```bash
cd frontend && npx vitest --run && npx tsc --noEmit
cd ../backend && npx jest airlineLogos && npx tsc --noEmit
```

Expected: PASS both sides, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/flightsTable/AirlineWordmarkCell.tsx \
        frontend/src/components/flightsTable/__tests__/AirlineWordmarkCell.test.tsx \
        frontend/src/hooks/useAirlineLogoManifest.ts \
        backend/src/routes/airlineLogos.ts \
        backend/src/routes/__tests__/airlineLogos.test.ts
git commit -m "refactor(logos): the cell has nothing left to decide

Every tier now returns an image that carries its own background, so the tile
renders bare. Deletes the manifest endpoint, the manifest hook, the brand-colour
map and the isDark() luminance heuristic — the machinery that existed only to
guess a plate colour, and that guessed wrong for Iberia (no plate at all) and
Delta (a plate the backend could not fill).

The old plate assertions are deleted rather than adapted: they were green while
the logo was invisible on screen."
```

---

## Task 8: The admin button

**Files:**
- Modify: the admin System-Info section that already hosts the airport re-seed
  action (find it with `grep -rn "airports/reseed" frontend/src/`)
- Modify: `frontend/src/i18n/locales/de/admin.json` and `…/en/admin.json`
- Test: alongside the existing airport-reseed button test

**Interfaces:**
- Consumes: `POST /admin/airline-logos/refresh`, `GET /admin/airline-logos/refresh-status` (Task 6).

- [ ] **Step 1: Write the failing test**

```tsx
it("triggers a logo refresh and shows the result", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({ status: 202, data: {} });
  vi.spyOn(api, "get").mockResolvedValue({
    data: { running: false, checked: 12, refreshed: 3, finishedAt: "2026-07-14T03:00:00Z" },
  });

  render(<AdminSystemSection />);
  fireEvent.click(screen.getByRole("button", { name: /logos aktualisieren/i }));

  await waitFor(() => expect(post).toHaveBeenCalledWith("/admin/airline-logos/refresh"));
  await waitFor(() => expect(screen.getByText(/3 von 12/i)).toBeTruthy());
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && npx vitest --run AdminSystem
```

Expected: FAIL — no such button.

- [ ] **Step 3: Implement**

Add the button next to the airport re-seed, styled with **`btn-primary`** (the
button system: amber primary, `btn-secondary`, `btn-danger` — never a raw
Tailwind colour, see `frontend/src/index.css`).

i18n — **DE and EN together**, DE primary:

`de/admin.json`:
```json
{
  "airlineLogos": {
    "title": "Airline-Logos",
    "description": "Gespeicherte Logos gegen die Quellen prüfen und veraltete erneuern. Läuft ohnehin jede Nacht.",
    "action": "Logos aktualisieren",
    "running": "Wird geprüft …",
    "result": "{{refreshed}} von {{checked}} Logos erneuert",
    "failed": "Aktualisierung fehlgeschlagen"
  }
}
```

`en/admin.json`:
```json
{
  "airlineLogos": {
    "title": "Airline logos",
    "description": "Check the stored logos against their sources and refresh the stale ones. This also runs nightly.",
    "action": "Refresh logos",
    "running": "Checking …",
    "result": "Refreshed {{refreshed}} of {{checked}} logos",
    "failed": "Refresh failed"
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd frontend && npx vitest --run && npx tsc --noEmit && npm run lint
```

Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Admin frontend/src/i18n/locales/de/admin.json \
        frontend/src/i18n/locales/en/admin.json
git commit -m "feat(logos): an admin can refresh the stored logos on demand

Sits beside the airport re-seed and behaves the same way. Nightly is usually
enough; this is for the moment an airline rebrands and you do not want to wait."
```

---

## Task 9: Verify it in a browser, then land it

**Files:** none — this is the gate.

A green suite certifies nothing here. Every unit test passed while beta.1's logo
was invisible on screen, because no assertion could see the colour of a mark
against the colour behind it. **Look at it.**

- [ ] **Step 1: Full build checks**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
cd ../frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: all green. Two backend suites are known-flaky (cruise teardown
deadlock, parser live-LLM timeout) — they are pre-existing and not caused by this
change.

- [ ] **Step 2: Run the app and look at the flights table**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  PORT=8000 FRONTEND_URL=http://localhost:3000 NODE_ENV=development COOKIE_SECURE=false npx tsx src/index.ts
cd frontend && VITE_API_URL=http://localhost:8000 npx vite --port 3000 --host 0.0.0.0
```

**VITE_API_URL must be set in the SHELL**, not only in `.env.local` — the Vite
proxy reads `process.env`, axios reads `import.meta.env`, and a mismatch sends
them to different backends (see `CLAUDE.local.md`).

Confirm by eye, at `/flights`:
- [ ] Lufthansa, Delta, Iberia and Qantas all render a **legible** tile.
      Iberia and Delta are the two that were broken — check them explicitly.
- [ ] No white plate behind a tile that already has its own background.
- [ ] An airline outside the vendored 93 (e.g. easyJet `U2`) renders too.
- [ ] Console and network tabs are clean; no request to `/airline-logos/manifest`.

- [ ] **Step 3: Confirm the cache filled and is stamped**

```bash
ls backend/.travstats-data/cache/airline-logos/ | head
cat backend/.travstats-data/cache/airline-logos/LH-logo.meta.json
```

Expected: `{"contentType":"image/png","fetchedAt":<ms>,"lastAttemptAt":<ms>,"source":"kiwi"}`

- [ ] **Step 4: Update the docs**

- `CLAUDE.md` → the airline-logo bullet under **Critical Gotchas**: the chain is
  logostream → vendored (icons only) → kiwi → Daisycon; the manifest and the
  plate heuristic are gone; the cache self-refreshes.
- `docs/superpowers/specs/2026-07-14-airline-logo-kiwi-tier-design.md` → mark
  **Status: implemented**.

- [ ] **Step 5: Commit and report**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-07-14-airline-logo-kiwi-tier-design.md
git commit -m "docs(logos): record the new resolution chain"
```

Then **report to the owner and ask, as a single isolated question, whether to
merge to `main`.** A branch being green and complete says nothing about whether
it should ship — merging is the owner's release decision, never a step in a
checklist.

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| kiwi tier between logostream and Daisycon | 1 |
| Placeholder md5 guard | 1 |
| Vendored snapshot → icon tier | 2 |
| `fetchedAt` / `lastAttemptAt` / `source` in the cache meta | 3 |
| Legacy entries infinitely stale | 3 |
| Failed refresh never touches `fetchedAt` | 3 (unit), 4 (integration) |
| Stale-while-revalidate | 4 |
| Refresh coalescing | 4 |
| Nightly cron sweep, UTC, spaced fetches | 5 |
| Retry backoff honoured by the sweep | 5 |
| Admin re-sync + status | 6 |
| Delete manifest / `isDark` / brand-colour map | 2 (backend map), 7 (route + hook + cell) |
| Text fallback survives | 7 |
| Browser UAT before claiming success | 9 |

No gaps.

**Type consistency**

`LogoSource`, `CachedLogoEntry`, `getCachedLogoEntry`, `putCachedLogo(key, logo,
source)`, `touchFailedRefresh`, `listCachedLogoKeys`, `isStale(entry, maxAgeMs)`,
`refreshLogo(key)`, `sweepStaleLogos()`, `LOGO_MAX_AGE_MS`, `RETRY_BACKOFF_MS` —
defined in Tasks 3–5 and used with the same names and signatures in Tasks 4–6.
`getCachedLogo` is removed in Task 3 and never referenced afterwards.

**Out of scope (as specced):** the airline/aircraft master-data tables (#189),
the flights admin page (#191), and pruning the now-unused `logo*.svg` files from
the vendored snapshot.
