# Airline Logo API (logostream.dev) Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve airline logos through an authenticated, disk-cached backend proxy that prefers logostream.dev (icon/wordmark/dark variants, SVG) and falls back to Daisycon, so the frontend never talks to logo CDNs directly and the API key never reaches the browser.

**Architecture:** A new backend service resolves `(airlineCode, variant)` → image bytes via a chain: disk cache → logostream (when a key resolves) → Daisycon → miss. The key follows the standard provider pattern: **admin_settings global key (encrypted, settable in the admin UI like AirLabs & co.) → `LOGOSTREAM_API_KEY` env fallback**, via `apiKeyResolver.getApiKey("logostream")`. A thin Express route exposes it at `GET /api/v1/airline-logos/:code`. The frontend `AirlineLogo` component swaps its Daisycon URL for the proxy URL; its letterbox fallback stays as-is.

**Tech Stack:** Express 4 + TypeScript (strict), native `fetch` (Node ≥ 20, same as `airportLookup.ts`), Zod, Jest + supertest (backend), Vitest + Testing Library (frontend).

## Global Constraints

- `any` is FORBIDDEN — use `unknown` + type guards (CLAUDE.md).
- Pino logger only — `import logger from '../utils/logger'`; no `console.log`.
- Zod validation for all request input; schemas colocated in the route file (pattern: `routes/airports.ts`).
- Files 200–400 lines ideal, 800 hard max. English code/comments/commits.
- **Migration safety:** this feature adds ONE `admin_settings` column. The shared dev DB (`flights_dev`) may carry other branches' migrations — before generating, run `prisma migrate deploy` against it and verify `npm run check:drift` is green; then inspect the generated SQL and confirm it contains **exactly one `ALTER TABLE "admin_settings" ADD COLUMN`** and nothing else (no bundled drift — the trip_photos incident). If anything else appears, stop and hand-write the migration instead.
- **NEVER commit the API key.** It lives only in `backend/.env` (gitignored). Grep your diff for `FREE-` before every commit.
- Work on branch `feat/airline-logo-proxy` off `main`.
- Run GitNexus impact before modifying existing symbols; `detect_changes` before commits (CLAUDE.md).

## Pinned facts (verified 2026-07-12)

- Daisycon (current source in `frontend/src/components/AirlineLogo.tsx`): `https://images.daisycon.io/airline?iata=LH&width=300&height=150`, no auth, PNG only, **always full logo with wordmark**. Unknown IATA returns a **generic placeholder image with HTTP 200** — MD5 `e868e45186e3f2e758f42dcd1029da2d` (300×150 request). This defeats error-based fallbacks; the service must hash-filter it.
- logostream.dev: auth via `x-api-key` header; variants `icon`, `icon-transparent`, `logo`, `logo-transparent`, `logo-white`, `logo-bg-white`, `tail`, `tail-3D`; SVG + PNG. Free tier 20k req/month. **Exact endpoint shape is unconfirmed** — Task 1 pins it empirically.
- Data dir convention (from `backend/src/utils/jwtSecret.ts`): dev → `<cwd>/.travstats-data/...`, prod → `/app/data/...` (single persisted volume; no Dockerfile change needed).
- Auth middleware: `import { authenticate, AuthRequest } from '../middleware/auth'`. Route-test auth-cookie pattern: see `backend/src/routes/__tests__/cruises.test.ts`.
- Route mount point: `backend/src/index.ts` route block (lines ~220–251).

---

### Task 1: Pin the logostream API contract (probe, no app code)

**Files:**
- Create: `docs/superpowers/plans/2026-07-12-airline-logo-api-fixtures.md`

**Interfaces:**
- Produces: the confirmed values for `LOGOSTREAM_BASE`, path/query shape, auth header, per-variant content types, and unknown-airline behaviour (status code or placeholder hash). Task 4 copies these constants verbatim.

- [ ] **Step 1: Read the key from the local env (set it first if missing)**

`backend/.env` must contain `LOGOSTREAM_API_KEY=...` (the owner has the key; it is NOT in the repo). Verify:

```bash
grep -c "^LOGOSTREAM_API_KEY=" backend/.env
```

Expected: `1`. If `0`, stop and ask the owner to add it.

- [ ] **Step 2: Probe the candidate endpoints**

```bash
KEY=$(grep '^LOGOSTREAM_API_KEY=' backend/.env | cut -d= -f2-)
# Candidate A (docs page): aviation-api host, x-api-key header
curl -s -D - -o /tmp/ls-a.bin -H "x-api-key: $KEY" \
  "https://aviation-api.logostream.dev/v1/airline-logo?iata=LH&variant=icon" | head -12
# Candidate B (URLs seen in docs response JSON): direct image host
curl -s -D - -o /tmp/ls-b.bin \
  "https://api.logostream.dev/airlines/iata/LH?variant=icon&key=$KEY" | head -12
```

Expected: exactly one candidate returns `200` with `Content-Type: image/svg+xml` or `image/png`. Open the winning body to confirm it is a real Lufthansa icon (not an error JSON).

- [ ] **Step 3: Probe variants, ICAO addressing, and unknown-airline behaviour**

Against the winning endpoint, repeat for `variant=logo`, `variant=logo-white`, `variant=tail`, an ICAO code (`DLH`), and a garbage code (`iata=Q9`). Record for each: HTTP status, `Content-Type`, and — if a 200 body comes back for the garbage code — its MD5 (`md5sum`/`Get-FileHash -Algorithm MD5`).

- [ ] **Step 4: Write the fixtures doc and commit**

`docs/superpowers/plans/2026-07-12-airline-logo-api-fixtures.md` — a table: request URL template (with `<KEY>` masked), auth mechanism, per-variant status + content type, unknown-code behaviour (+ placeholder MD5 if any). No real key anywhere in the file.

```bash
git add docs/superpowers/plans/2026-07-12-airline-logo-api-fixtures.md
git commit -m "docs: pin logostream API contract for airline logo proxy"
```

---

### Task 2: Env plumbing for `LOGOSTREAM_API_KEY`

**Files:**
- Modify: `backend/src/config/env.ts` (Zod env schema — `DATA_DIR` already lives there at ~line 77)
- Modify: `backend/.env.example`

**Interfaces:**
- Produces: `process.env.LOGOSTREAM_API_KEY` validated as `string | undefined`; consumed by Task 4.

- [ ] **Step 1: Add the optional key to the env schema**

In `backend/src/config/env.ts`, next to the other optional keys:

```ts
LOGOSTREAM_API_KEY: z.string().min(10).optional(),
```

- [ ] **Step 2: Document it in `.env.example`**

```bash
# Airline logo API (logostream.dev) — optional. Without it the logo proxy
# falls back to Daisycon (full-wordmark logos only, PNG).
LOGOSTREAM_API_KEY=
```

- [ ] **Step 3: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit` — expected: clean.

```bash
git add backend/src/config/env.ts backend/.env.example
git commit -m "feat(logos): add optional LOGOSTREAM_API_KEY to env schema"
```

---

### Task 2b: `admin_settings` column + resolver provider

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `AdminSettings` — next to `global_aerodatabox_api_key`)
- Create: `backend/prisma/migrations/<timestamp>_add_logostream_api_key/migration.sql` (generated)
- Modify: `backend/src/services/apiKeyResolver.ts`
- Test: `backend/src/services/__tests__/apiKeyResolver.logostream.test.ts`

**Interfaces:**
- Consumes: `LOGOSTREAM_API_KEY` env (Task 2).
- Produces: `getApiKey("logostream")` → decrypted admin-global key, else `process.env.LOGOSTREAM_API_KEY`, else `null`. `"logostream"` joins the `ApiProvider` union. **No user-level key** — logos are instance-wide assets, so resolution is global → env only.

- [ ] **Step 1: Add the schema field**

In `model AdminSettings`, next to the other global keys:

```prisma
globalLogostreamApiKey String? @map("global_logostream_api_key")
```

- [ ] **Step 2: Generate the migration with the drift guard**

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx prisma migrate deploy
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npm run check:drift
```

`check:drift` must be green (only the new schema field pending) BEFORE generating. Then:

```bash
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx prisma migrate dev --name add_logostream_api_key
```

Open the generated `migration.sql` — it must contain **exactly**:

```sql
ALTER TABLE "admin_settings" ADD COLUMN "global_logostream_api_key" TEXT;
```

Anything else → delete the migration, resolve the bundled drift first (see Global Constraints), do not proceed.

- [ ] **Step 3: Write the failing resolver test**

```ts
// backend/src/services/__tests__/apiKeyResolver.logostream.test.ts
import { getApiKey } from "../apiKeyResolver";
import { prisma } from "../../db";
import { encryptApiKey } from "../../utils/encryption";

describe("getApiKey('logostream')", () => {
  afterEach(async () => {
    await prisma.adminSettings.updateMany({ data: { globalLogostreamApiKey: null } });
    delete process.env.LOGOSTREAM_API_KEY;
  });

  it("prefers the admin-global key over env", async () => {
    process.env.LOGOSTREAM_API_KEY = "env-key";
    await prisma.adminSettings.updateMany({
      data: { globalLogostreamApiKey: encryptApiKey("global-key") },
    });
    expect(await getApiKey("logostream")).toBe("global-key");
  });

  it("falls back to env when no global key is set", async () => {
    process.env.LOGOSTREAM_API_KEY = "env-key";
    expect(await getApiKey("logostream")).toBe("env-key");
  });

  it("returns null when neither exists", async () => {
    expect(await getApiKey("logostream")).toBeNull();
  });
});
```

Run: `npx jest src/services/__tests__/apiKeyResolver.logostream.test.ts --forceExit` — expected: FAIL (`'logostream'` not assignable to `ApiProvider`).

- [ ] **Step 4: Extend the resolver**

In `apiKeyResolver.ts`: add `| 'logostream'` to `ApiProvider`; in the **global-key switch** add `case 'logostream': globalKey = adminSettings.globalLogostreamApiKey; break;`; in the **env fallback switch** (bottom of `getApiKey`) add `case 'logostream': return process.env.LOGOSTREAM_API_KEY || null;`. The user-key switch gets NO case — logostream deliberately skips user-level keys.

- [ ] **Step 5: Run tests — expected PASS**, then commit

```bash
git add backend/prisma backend/src/services/apiKeyResolver.ts backend/src/services/__tests__/apiKeyResolver.logostream.test.ts
git commit -m "feat(logos): logostream provider in apiKeyResolver + admin_settings column"
```

---

### Task 2c: Admin API route + UI card (settable like the other keys)

**Files:**
- Modify: `backend/src/routes/admin/apiKeys.ts`
- Modify: `frontend/src/lib/api/admin.ts` (add `globalLogostreamApiKey?: string` to the global-api-keys type)
- Modify: `frontend/src/components/Admin/GlobalApiKeysManager.tsx`
- Modify: `frontend/src/i18n/resources/de/admin.json` + `frontend/src/i18n/resources/en/admin.json` (DE first, EN mirrored — language policy)
- Test: extend `backend/src/routes/__tests__/` admin api-keys test if one exists; otherwise the route changes are covered by the masked-GET assertion below

**Interfaces:**
- Consumes: `globalLogostreamApiKey` column from Task 2b.
- Produces: `GET /api/v1/admin/api-keys` returns `globalLogostreamApiKey` masked (`abcd****wxyz`); `PUT /api/v1/admin/api-keys` accepts and encrypts it. UI card labelled via `admin:globalApiKeys.logostream.*`.

- [ ] **Step 1: Backend — extend `apiKeys.ts`**

Follow the AirLabs field through the file and mirror every occurrence:
1. `GlobalApiKeysUpdateData` interface: `globalLogostreamApiKey?: string | null;`
2. `globalApiKeysSchema`: `globalLogostreamApiKey: z.string().optional().nullable(),`
3. GET handler: `globalLogostreamApiKey: maskKey(adminSettings.globalLogostreamApiKey),` (+ `undefined` in the no-settings branch)
4. PUT handler: encrypt-on-write exactly like `globalAirlabsApiKey` (skip when the incoming value `looksMasked`)

No `/test` endpoint for logostream in this task (the probe in Task 1 validates the key; a tester needs a known-good request shape and can ride a later polish).

- [ ] **Step 2: Frontend — add the provider card**

In `GlobalApiKeysManager.tsx`, duplicate the AirLabs card block (lines ~103–113) below the last provider:

```tsx
<ProviderCard
  provider="logostream"
  label={t("admin:globalApiKeys.logostream.label")}
  description={t("admin:globalApiKeys.logostream.description")}
  getKeyUrl="https://airline.logostream.dev/"
  hasAccess={!!globalApiKeys.globalLogostreamApiKey}
  value={globalApiKeys.globalLogostreamApiKey || ""}
  onChange={(value) =>
    onGlobalApiKeysChange({ ...globalApiKeys, globalLogostreamApiKey: value })
  }
  onClear={() => onGlobalApiKeysChange({ ...globalApiKeys, globalLogostreamApiKey: "" })}
/>
```

(Match the component's actual prop names — read the AirLabs block first; if the card component exposes a `testEndpoint`/`onTest` prop, omit it for logostream.)

- [ ] **Step 3: i18n — DE and EN together**

`de/admin.json`:

```json
"logostream": {
  "label": "Airline-Logos (logostream.dev)",
  "description": "Liefert Airline-Logos als Icon-, Schriftzug- und Dark-Mode-Varianten. Ohne Key werden nur die einfachen Komplett-Logos (Daisycon) angezeigt."
}
```

`en/admin.json`:

```json
"logostream": {
  "label": "Airline logos (logostream.dev)",
  "description": "Provides airline logos as icon, wordmark and dark-mode variants. Without a key only the basic full logos (Daisycon) are shown."
}
```

- [ ] **Step 4: Verify + commit**

Backend: `npx tsc --noEmit && npm run lint`. Frontend: `npx tsc --noEmit && npm run lint && npx vitest --run` (the i18n commonKeys scan guards the new keys resolve in both locales). Manually: admin page shows the new card; saving a key → GET returns it masked.

```bash
git add backend/src/routes/admin/apiKeys.ts frontend/src/lib/api/admin.ts frontend/src/components/Admin/GlobalApiKeysManager.tsx frontend/src/i18n/resources/de/admin.json frontend/src/i18n/resources/en/admin.json
git commit -m "feat(logos): logostream key manageable in the admin global API keys UI"
```

---

### Task 3: Disk cache module

**Files:**
- Create: `backend/src/services/airlineLogo/logoCache.ts`
- Test: `backend/src/services/airlineLogo/__tests__/logoCache.test.ts`

**Interfaces:**
- Produces:
  - `type CachedLogo = { body: Buffer; contentType: string }`
  - `getCachedLogo(key: string): Promise<CachedLogo | null>`
  - `putCachedLogo(key: string, logo: CachedLogo): Promise<void>`
  - `logoCacheDir(): string` (exported for tests)
  - Cache keys are `${code}-${variant}` (uppercase code), sanitised to `[A-Z0-9-]`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/services/airlineLogo/__tests__/logoCache.test.ts
import { getCachedLogo, putCachedLogo, logoCacheDir } from "../logoCache";
import fs from "fs";
import path from "path";

describe("logoCache", () => {
  const key = "TEST-icon";

  afterEach(() => {
    fs.rmSync(path.join(logoCacheDir(), `${key}.img`), { force: true });
    fs.rmSync(path.join(logoCacheDir(), `${key}.meta.json`), { force: true });
  });

  it("returns null on a cold miss", async () => {
    expect(await getCachedLogo("NOPE-icon")).toBeNull();
  });

  it("round-trips body and content type", async () => {
    const body = Buffer.from("<svg/>");
    await putCachedLogo(key, { body, contentType: "image/svg+xml" });
    const hit = await getCachedLogo(key);
    expect(hit).not.toBeNull();
    expect(hit!.contentType).toBe("image/svg+xml");
    expect(hit!.body.equals(body)).toBe(true);
  });

  it("rejects keys with path characters", async () => {
    await expect(putCachedLogo("../evil", { body: Buffer.from("x"), contentType: "image/png" }))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/services/airlineLogo/__tests__/logoCache.test.ts --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// backend/src/services/airlineLogo/logoCache.ts
import fs from "fs/promises";
import path from "path";
import logger from "../../utils/logger";

export type CachedLogo = { body: Buffer; contentType: string };

const KEY_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,30}$/;

export function logoCacheDir(): string {
  // Same dual-path convention as utils/jwtSecret.ts: the prod image mounts
  // a single volume at /app/data; dev uses a repo-local dot-directory.
  return process.env.NODE_ENV === "production"
    ? "/app/data/cache/airline-logos"
    : path.join(process.cwd(), ".travstats-data", "cache", "airline-logos");
}

function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`invalid logo cache key: ${key}`);
}

export async function getCachedLogo(key: string): Promise<CachedLogo | null> {
  assertSafeKey(key);
  try {
    const dir = logoCacheDir();
    const metaRaw = await fs.readFile(path.join(dir, `${key}.meta.json`), "utf-8");
    const meta: unknown = JSON.parse(metaRaw);
    if (typeof meta !== "object" || meta === null || typeof (meta as { contentType?: unknown }).contentType !== "string") {
      return null;
    }
    const body = await fs.readFile(path.join(dir, `${key}.img`));
    return { body, contentType: (meta as { contentType: string }).contentType };
  } catch {
    return null; // cold miss or corrupt entry — treated identically
  }
}

export async function putCachedLogo(key: string, logo: CachedLogo): Promise<void> {
  assertSafeKey(key);
  const dir = logoCacheDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${key}.img`), logo.body);
  await fs.writeFile(
    path.join(dir, `${key}.meta.json`),
    JSON.stringify({ contentType: logo.contentType })
  );
  logger.debug({ operation: "logo_cache_put", key }, "cached airline logo");
}
```

- [ ] **Step 4: Run tests — expected PASS**, then commit

```bash
git add backend/src/services/airlineLogo/
git commit -m "feat(logos): disk cache for airline logos under the data volume"
```

---

### Task 4: Resolution service (logostream → Daisycon → miss)

**Files:**
- Create: `backend/src/services/airlineLogo/airlineLogoService.ts`
- Test: `backend/src/services/airlineLogo/__tests__/airlineLogoService.test.ts`

**Interfaces:**
- Consumes: `getCachedLogo` / `putCachedLogo` / `CachedLogo` from Task 3; `getApiKey("logostream")` from Task 2b; endpoint constants from the Task 1 fixtures doc.
- Produces:
  - `type LogoVariant = "icon" | "logo" | "logo-white" | "tail"`
  - `resolveAirlineLogo(code: string, variant: LogoVariant): Promise<CachedLogo | null>` — `code` is a 2-char IATA or 3-char ICAO, already uppercased by the route.

- [ ] **Step 1: Write the failing tests (mock `fetch`)**

```ts
// backend/src/services/airlineLogo/__tests__/airlineLogoService.test.ts
import { resolveAirlineLogo, __resetNegativeCacheForTests } from "../airlineLogoService";
import * as cache from "../logoCache";
import * as resolver from "../../apiKeyResolver";
import crypto from "crypto";

// The Daisycon "unknown airline" placeholder defeats status-based detection
// (it is served with HTTP 200) — the service must recognise it by hash.
const DAISYCON_PLACEHOLDER_MD5 = "e868e45186e3f2e758f42dcd1029da2d";

const realFetch = global.fetch;
beforeEach(() => {
  // Default: no key resolves anywhere (admin_settings nor env)
  jest.spyOn(resolver, "getApiKey").mockResolvedValue(null);
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
  __resetNegativeCacheForTests();
});

function mockFetchOnce(status: number, body: Buffer, contentType: string): jest.Mock {
  const fn = jest.fn().mockResolvedValue(
    new Response(new Uint8Array(body), { status, headers: { "content-type": contentType } })
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("resolveAirlineLogo", () => {
  it("returns the disk-cache hit without any network call", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue({
      body: Buffer.from("hit"), contentType: "image/png",
    });
    const fn = jest.fn();
    global.fetch = fn as unknown as typeof fetch;
    const r = await resolveAirlineLogo("LH", "icon");
    expect(r!.body.toString()).toBe("hit");
    expect(fn).not.toHaveBeenCalled();
  });

  it("uses logostream when a key resolves and caches the result", async () => {
    jest.spyOn(resolver, "getApiKey").mockResolvedValue("FREE-TEST-KEY-000000");
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const put = jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    mockFetchOnce(200, Buffer.from("<svg/>"), "image/svg+xml");
    const r = await resolveAirlineLogo("LH", "icon");
    expect(r!.contentType).toBe("image/svg+xml");
    expect(put).toHaveBeenCalledWith("LH-icon", expect.objectContaining({ contentType: "image/svg+xml" }));
  });

  it("falls back to Daisycon without a key", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    const fn = mockFetchOnce(200, Buffer.from("realpng"), "image/png");
    const r = await resolveAirlineLogo("LH", "icon");
    expect(r).not.toBeNull();
    expect(String(fn.mock.calls[0][0])).toContain("daisycon");
  });

  it("treats the Daisycon placeholder body as a miss", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const put = jest.spyOn(cache, "putCachedLogo").mockResolvedValue();
    // Craft a body whose md5 matches the known placeholder hash by mocking crypto:
    const body = Buffer.from("placeholder-bytes");
    jest.spyOn(crypto, "createHash").mockReturnValue({
      update: () => ({ digest: () => DAISYCON_PLACEHOLDER_MD5 }),
    } as unknown as crypto.Hash);
    mockFetchOnce(200, body, "image/png");
    const r = await resolveAirlineLogo("Q9", "icon");
    expect(r).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it("negative-caches misses so a second call makes no network request", async () => {
    jest.spyOn(cache, "getCachedLogo").mockResolvedValue(null);
    const fn = mockFetchOnce(404, Buffer.alloc(0), "text/plain");
    expect(await resolveAirlineLogo("ZZ", "icon")).toBeNull();
    const calls = fn.mock.calls.length;
    expect(await resolveAirlineLogo("ZZ", "icon")).toBeNull();
    expect(fn.mock.calls.length).toBe(calls); // no additional fetches
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/services/airlineLogo/__tests__/airlineLogoService.test.ts --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

> The two `buildLogostreamUrl` constants below encode candidate A from Task 1.
> **Copy the confirmed URL template and auth header from the Task 1 fixtures doc**
> — if candidate B won, adjust the template accordingly (same function shape).

```ts
// backend/src/services/airlineLogo/airlineLogoService.ts
import crypto from "crypto";
import logger from "../../utils/logger";
import { getApiKey } from "../apiKeyResolver";
import { getCachedLogo, putCachedLogo, type CachedLogo } from "./logoCache";

export type LogoVariant = "icon" | "logo" | "logo-white" | "tail";

// Daisycon serves a generic placeholder with HTTP 200 for unknown airlines —
// recognisable only by content hash (verified 2026-07-12, 300x150 request).
const DAISYCON_PLACEHOLDER_MD5S = new Set(["e868e45186e3f2e758f42dcd1029da2d"]);

const LOGOSTREAM_BASE = "https://aviation-api.logostream.dev/v1/airline-logo";
const DAISYCON_BASE = "https://images.daisycon.io/airline";
const FETCH_TIMEOUT_MS = 5_000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

// In-memory negative cache: a miss today may resolve after logostream adds
// the airline, so it expires — unlike positive entries, which are immutable.
const negativeCache = new Map<string, number>();
export function __resetNegativeCacheForTests(): void {
  negativeCache.clear();
}

function md5(buf: Buffer): string {
  return crypto.createHash("md5").update(buf).digest("hex");
}

async function fetchImage(url: string, headers?: Record<string, string>): Promise<CachedLogo | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0) return null;
    return { body, contentType };
  } catch (error) {
    logger.warn({ operation: "logo_fetch_failed", url, error }, "airline logo fetch failed");
    return null;
  }
}

function buildLogostreamUrl(code: string, variant: LogoVariant): string {
  const param = code.length === 3 ? "icao" : "iata";
  return `${LOGOSTREAM_BASE}?${param}=${code}&variant=${variant}&format=svg`;
}

async function fromLogostream(code: string, variant: LogoVariant): Promise<CachedLogo | null> {
  // Admin-global key (encrypted in admin_settings, set via the admin UI)
  // wins over the LOGOSTREAM_API_KEY env fallback — standard provider pattern.
  const key = await getApiKey("logostream");
  if (!key) return null;
  return fetchImage(buildLogostreamUrl(code, variant), { "x-api-key": key });
}

async function fromDaisycon(code: string): Promise<CachedLogo | null> {
  // Daisycon only has the full wordmark logo; every variant maps onto it.
  const param = code.length === 3 ? "icao" : "iata";
  const logo = await fetchImage(`${DAISYCON_BASE}?${param}=${code}&width=300&height=150`);
  if (logo && DAISYCON_PLACEHOLDER_MD5S.has(md5(logo.body))) return null;
  return logo;
}

export async function resolveAirlineLogo(code: string, variant: LogoVariant): Promise<CachedLogo | null> {
  const cacheKey = `${code}-${variant}`;

  const cached = await getCachedLogo(cacheKey);
  if (cached) return cached;

  const negativeUntil = negativeCache.get(cacheKey);
  if (negativeUntil !== undefined && negativeUntil > Date.now()) return null;
  negativeCache.delete(cacheKey);

  const logo = (await fromLogostream(code, variant)) ?? (await fromDaisycon(code));
  if (!logo) {
    negativeCache.set(cacheKey, Date.now() + NEGATIVE_TTL_MS);
    return null;
  }

  await putCachedLogo(cacheKey, logo);
  return logo;
}
```

- [ ] **Step 4: Run tests — expected PASS**, then commit

```bash
git add backend/src/services/airlineLogo/
git commit -m "feat(logos): resolution chain logostream -> daisycon with placeholder filter"
```

---

### Task 5: Route, rate limiter, mount

**Files:**
- Create: `backend/src/routes/airlineLogos.ts`
- Modify: `backend/src/middleware/rateLimit.ts` (append one limiter, same pattern as `airportSearchLimiter`)
- Modify: `backend/src/index.ts` (one `app.use` line in the route block, after `/api/v1/airports` at ~line 228)
- Test: `backend/src/routes/__tests__/airlineLogos.test.ts`

**Interfaces:**
- Consumes: `resolveAirlineLogo`, `LogoVariant` from Task 4; `authenticate` from `middleware/auth`.
- Produces: `GET /api/v1/airline-logos/:code?variant=icon|logo|logo-white|tail` → 200 image bytes with long-lived `Cache-Control`, 404 on miss, 400 on invalid input, 401 unauthenticated.

- [ ] **Step 1: Write the failing route tests**

Copy the auth-cookie setup from `backend/src/routes/__tests__/cruises.test.ts` (register/login helper producing `authCookie`), then:

```ts
// backend/src/routes/__tests__/airlineLogos.test.ts
import request from "supertest";
import app from "../../index";
import * as service from "../../services/airlineLogo/airlineLogoService";
// + the same beforeAll auth-cookie setup as cruises.test.ts → `authCookie`

describe("GET /api/v1/airline-logos/:code", () => {
  it("401 without auth", async () => {
    const res = await request(app).get("/api/v1/airline-logos/LH");
    expect(res.status).toBe(401);
  });

  it("400 for an invalid code", async () => {
    const res = await request(app).get("/api/v1/airline-logos/TOOLONG1").set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("400 for an unknown variant", async () => {
    const res = await request(app)
      .get("/api/v1/airline-logos/LH?variant=hologram").set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("200 with image bytes and immutable caching on a hit", async () => {
    jest.spyOn(service, "resolveAirlineLogo").mockResolvedValue({
      body: Buffer.from("<svg/>"), contentType: "image/svg+xml",
    });
    const res = await request(app).get("/api/v1/airline-logos/lh").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.headers["cache-control"]).toContain("max-age=604800");
    expect(service.resolveAirlineLogo).toHaveBeenCalledWith("LH", "icon"); // uppercased + default variant
  });

  it("404 on a miss", async () => {
    jest.spyOn(service, "resolveAirlineLogo").mockResolvedValue(null);
    const res = await request(app).get("/api/v1/airline-logos/ZZ").set("Cookie", authCookie);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure** (404s from the not-found handler instead of the expected statuses)

- [ ] **Step 3: Implement limiter + route + mount**

`backend/src/middleware/rateLimit.ts` — append, following the file's existing style:

```ts
// Airline-logo proxy: cheap after first fetch (disk cache), but each cold
// miss costs an upstream request against the 20k/month logostream budget.
export const airlineLogoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
```

```ts
// backend/src/routes/airlineLogos.ts
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { airlineLogoLimiter } from "../middleware/rateLimit";
import { resolveAirlineLogo, type LogoVariant } from "../services/airlineLogo/airlineLogoService";

const paramsSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9]{2,3}$/, "IATA (2) or ICAO (3) code expected"),
});
const querySchema = z.object({
  variant: z.enum(["icon", "logo", "logo-white", "tail"]).default("icon"),
});

const router = Router();

router.get(
  "/:code",
  airlineLogoLimiter,
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = paramsSchema.safeParse(req.params);
      const query = querySchema.safeParse(req.query);
      if (!params.success || !query.success) {
        res.status(400).json({ error: "Invalid airline code or variant" });
        return;
      }
      const code = params.data.code.toUpperCase();
      const logo = await resolveAirlineLogo(code, query.data.variant as LogoVariant);
      if (!logo) {
        res.status(404).json({ error: "No logo available" });
        return;
      }
      res
        .setHeader("Content-Type", logo.contentType)
        .setHeader("Cache-Control", "private, max-age=604800")
        .send(logo.body);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
```

`backend/src/index.ts` — import next to the other route imports and mount after the airports line:

```ts
import airlineLogoRoutes from './routes/airlineLogos';
// ...
app.use('/api/v1/airline-logos', airlineLogoRoutes);
```

- [ ] **Step 4: Run the route tests — expected PASS.** Also run `npx tsc --noEmit && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/airlineLogos.ts backend/src/routes/__tests__/airlineLogos.test.ts backend/src/middleware/rateLimit.ts backend/src/index.ts
git commit -m "feat(logos): authenticated cached proxy route GET /api/v1/airline-logos/:code"
```

---

### Task 6: Frontend — switch `AirlineLogo` to the proxy

**Files:**
- Modify: `frontend/src/components/AirlineLogo.tsx` (full current source is 117 lines; only `buildUrl`, the header comment, and props change — letterbox fallback stays identical)
- Test: `frontend/src/components/__tests__/AirlineLogo.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/airline-logos/:code?variant=` from Task 5 (cookie auth is implicit — same-origin `<img>` requests send the JWT cookie, the same mechanism profile avatars use).
- Produces: unchanged component API plus a new optional `variant?: "icon" | "logo" | "logo-white" | "tail"` prop (default `"icon"`). The `bg` prop becomes a no-op kept for source compatibility; remove its uses later with the table redesign.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/__tests__/AirlineLogo.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import AirlineLogo from "../AirlineLogo";

describe("AirlineLogo", () => {
  it("requests the backend proxy with the default icon variant", () => {
    render(<AirlineLogo iata="LH" />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("/api/v1/airline-logos/LH?variant=icon");
  });

  it("passes an explicit variant through", () => {
    render(<AirlineLogo iata="LH" variant="logo-white" />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("variant=logo-white");
  });

  it("falls back to ICAO when no IATA is given", () => {
    render(<AirlineLogo icao="DLH" />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("/api/v1/airline-logos/DLH");
  });

  it("renders the letterbox fallback when the image errors", () => {
    render(<AirlineLogo iata="LH" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("LH")).toBeInTheDocument();
  });

  it("renders the letterbox immediately when no code is derivable", () => {
    render(<AirlineLogo flightNumber="12345" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest --run src/components/__tests__/AirlineLogo.test.tsx`
Expected: FAIL — src still points at daisycon, `variant` prop unknown.

- [ ] **Step 3: Modify the component**

Replace the Daisycon block (header comment lines 3–16, `DAISYCON_BASE` line 16, and `buildUrl` lines 45–60) with:

```ts
/**
 * Airline logo via the backend proxy (GET /api/v1/airline-logos/:code),
 * which resolves logostream.dev (icon/wordmark/dark variants, SVG) and
 * falls back to Daisycon server-side. Auth rides on the JWT cookie —
 * same-origin <img> requests send it automatically. Falls back to a
 * stylised IATA letter box when no logo resolves or the request fails.
 */

export type AirlineLogoVariant = "icon" | "logo" | "logo-white" | "tail";

function buildUrl(params: {
  iata?: string;
  icao?: string;
  variant: AirlineLogoVariant;
}): string | null {
  const code = params.iata ?? params.icao;
  if (!code) return null;
  return `/api/v1/airline-logos/${encodeURIComponent(code)}?variant=${params.variant}`;
}
```

Add `variant: AirlineLogoVariant = "icon"` to the destructured props (and `variant?: AirlineLogoVariant;` to `AirlineLogoProps`, documenting that `bg` is now a no-op). Update the `url` memo to `buildUrl({ iata: resolvedIata, icao: resolvedIcao, variant })` with `variant` in the dependency array. Everything else (letterbox, `deriveIata`, sizing) stays byte-identical.

- [ ] **Step 4: Run the component tests — expected PASS.** Then the full frontend gate: `npx tsc --noEmit && npm run lint && npx vitest --run`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AirlineLogo.tsx frontend/src/components/__tests__/AirlineLogo.test.tsx
git commit -m "feat(logos): AirlineLogo renders via the backend proxy with variant support"
```

---

### Task 7: End-to-end verification (real key, real browser)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev stack** (backend 8000 / frontend 3000 per CLAUDE.local.md). Set the key **via the admin UI card** (Task 2c) — this also verifies the encrypt/mask round-trip; the env var stays unset to prove the admin-settings path.

- [ ] **Step 2: API smoke** — expect `200 image/*` twice, second one served from disk cache (verify via a `logo_cache_put` debug log on the first call only):

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" -b "<auth-cookie>" \
  "http://localhost:8000/api/v1/airline-logos/LH?variant=icon"
```

Also verify: garbage code `Q9` → `404` (Daisycon placeholder filtered), no key in any response header.

- [ ] **Step 3: Browser check (owner rule: visual verification is mandatory)** — log in at `localhost:3000`, open the flight list view (it renders `AirlineLogo`), confirm real icons render, and confirm via DevTools that image requests go to `/api/v1/airline-logos/...` and none to `daisycon.io`. Confirm an airline without a logo shows the letterbox.

- [ ] **Step 4: Full gates + scope check**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
cd ../frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Run `gitnexus detect_changes` — expected scope: `airlineLogoService`, `logoCache`, `airlineLogos` route, `rateLimit`, `index.ts`, `AirlineLogo`. Then report to the owner and ask the **isolated merge question** (CLAUDE.md — merging is a release decision).

---

## Explicitly out of scope (deferred)

- **Infisical**: the Infisical skills (`infisical-api`, `infisical-setup`) are now available in the session; storing the key in the CT 141 instance and injecting it as the env fallback is a separate, later step. It changes nothing in this code — only where the env var comes from. Primary key storage is the admin UI anyway (encrypted in `admin_settings`).
- **`POST /test` endpoint for the logostream card**: the Task 1 probe validates the key manually; an in-UI tester can ride a later polish round.
- **Flights-table redesign** (`icon` variant next to airline names, tail markers on the map): consumes this proxy; separate plan/branch.
- **TravStatsApp**: the app authenticates with Bearer PATs; the proxy works for it unchanged once the app sends its token on image requests.
