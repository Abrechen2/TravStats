# Boot Race Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the Nginx ↔ Express boot race that leaves the frontend Zustand stores stuck in an error state after every container restart, even though the database holds all the user's data.

**Architecture:** Two defensive layers. (1) **Server-side gate** — supervisord calls a wrapper script as the nginx command; the wrapper polls `http://localhost:8000/health` and only `exec`s nginx after the backend reports ready. (2) **Client-side retry** — an Axios response interceptor retries idempotent requests on `502/503/504/ECONNREFUSED/ERR_NETWORK` with exponential backoff (3 attempts, 0.5 / 1 / 2 s). Layer 1 fixes the root cause; Layer 2 is defense-in-depth for any future short backend outage.

**Tech Stack:** POSIX sh + supervisord + Docker `HEALTHCHECK`, Axios 1.15.2, Vitest 4.0.

**Repro reference:** Norbert's instance on Unraid-2 (<nas-host>:3080) showed empty data after the rc-latest pull on 2026-05-07. nginx access log showed 0 user-fetches of `/api/v1/flights` for 27 minutes after boot, while nginx error.log recorded `no live upstreams while connecting to upstream` at 15:58:18 — the smoking gun. DB had 226 flights and 71 trips intact. Hard reload (Ctrl+Shift+R) restored the UI without any data being lost.

**Out of scope:**
- Splitting `/health` into liveness vs readiness probes — overkill; the simple Express-up gate is enough.
- Replacing supervisord with s6-overlay or runit — too invasive.
- Maintenance-mode HTML page during boot — adds complexity for a 60-90 s window.

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `scripts/wait-then-nginx.sh` | POSIX sh wrapper. Polls backend `/health` until 200, then `exec`s `nginx -g "daemon off;"`. Falls through to nginx after `BACKEND_WAIT_MAX_SECONDS` (default 300) so the container never hangs forever. | **Create** |
| `scripts/wait-then-nginx.test.sh` | Bash test. Asserts the script polls then execs cleanly when a fake `/health` becomes ready, and falls through with a warning on timeout. | **Create** |
| `supervisord.conf` | Change the `[program:nginx]` command to `/app/scripts/wait-then-nginx.sh`. | **Modify** (line 20) |
| `Dockerfile` | Copy the wrapper into `/app/scripts/`, `chmod +x`, bump `HEALTHCHECK --start-period` from 40 s → 180 s to absorb migration + closed-airport backfill. | **Modify** (lines 100-105 + 122-124) |
| `frontend/src/lib/api/gatewayRetry.ts` | Pure function `attachGatewayRetry(instance: AxiosInstance): void`. Mounts a response interceptor that retries idempotent verbs (`GET/HEAD/OPTIONS`) on `502/503/504`, `ECONNABORTED`, `ERR_NETWORK`, with exponential backoff (`baseDelayMs * 2^(attempt-1)`). Bails after `MAX_RETRIES`. Tags requests with `__retryCount` to avoid infinite loops. | **Create** |
| `frontend/src/lib/api/gatewayRetry.test.ts` | Vitest. Uses a custom Axios adapter (no new deps) to verify: GET retries on 502, succeeds on 3rd attempt, gives up after MAX_RETRIES, never retries POST, network errors retry, 4xx never retry. | **Create** |
| `frontend/src/lib/api/client.ts` | Call `attachGatewayRetry(api)` and `attachGatewayRetry(parserApi)` BEFORE the existing `handle401Error` interceptor (interceptors run last-attached → first-on-error, but for response.use the attach order matters; Axios runs them in attach order on success, reverse on rejection — confirm in implementation). | **Modify** (lines 76-78) |
| `CHANGELOG.md` | One bullet under `## [Unreleased]` → `### Fixed`. | **Modify** |

---

## Task 1: Create the nginx-wait wrapper script (TDD with bash)

**Files:**
- Create: `scripts/wait-then-nginx.sh`
- Test: `scripts/wait-then-nginx.test.sh`

- [ ] **Step 1: Write the failing bash test**

Create `scripts/wait-then-nginx.test.sh`:

```bash
#!/usr/bin/env bash
# Test for wait-then-nginx.sh — runs a fake backend on a free port,
# verifies the wrapper polls until /health is up, then "execs" a stub.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WRAPPER="$SCRIPT_DIR/wait-then-nginx.sh"

# Test 1: backend already up → wrapper exits ~immediately and runs the exec target
test_backend_already_ready() {
  echo "TEST 1: backend already ready..."
  local port=18001
  python3 -m http.server "$port" --directory /tmp >/dev/null 2>&1 &
  local server_pid=$!
  trap "kill $server_pid 2>/dev/null || true" EXIT

  # Stub nginx: write a sentinel file then exit
  local sentinel
  sentinel="$(mktemp)"
  rm -f "$sentinel"
  cat > /tmp/fake-nginx.sh <<EOF
#!/bin/sh
echo "fake nginx ran" > "$sentinel"
EOF
  chmod +x /tmp/fake-nginx.sh

  BACKEND_HEALTH_URL="http://localhost:$port/" \
  BACKEND_WAIT_MAX_SECONDS=10 \
  NGINX_BIN=/tmp/fake-nginx.sh \
    "$WRAPPER" >/tmp/wrapper.log 2>&1

  [ -f "$sentinel" ] || { echo "FAIL: stub nginx never ran"; cat /tmp/wrapper.log; return 1; }
  echo "  OK"

  kill "$server_pid" 2>/dev/null || true
  trap - EXIT
}

# Test 2: backend never ready → wrapper times out, still runs exec target with a warning
test_backend_never_ready() {
  echo "TEST 2: backend never ready, falls through after timeout..."
  local sentinel
  sentinel="$(mktemp)"
  rm -f "$sentinel"
  cat > /tmp/fake-nginx.sh <<EOF
#!/bin/sh
echo "fake nginx ran" > "$sentinel"
EOF
  chmod +x /tmp/fake-nginx.sh

  BACKEND_HEALTH_URL="http://localhost:18002/" \
  BACKEND_WAIT_MAX_SECONDS=2 \
  NGINX_BIN=/tmp/fake-nginx.sh \
    "$WRAPPER" >/tmp/wrapper.log 2>&1

  [ -f "$sentinel" ] || { echo "FAIL: stub nginx not run after timeout"; cat /tmp/wrapper.log; return 1; }
  grep -q "WARNING" /tmp/wrapper.log || { echo "FAIL: missing WARNING after timeout"; cat /tmp/wrapper.log; return 1; }
  echo "  OK"
}

test_backend_already_ready
test_backend_never_ready
echo "ALL TESTS PASSED"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd D:/TravStats_Projekt/TravStats
chmod +x scripts/wait-then-nginx.test.sh
bash scripts/wait-then-nginx.test.sh
```

Expected: FAIL with `wait-then-nginx.sh: No such file or directory`.

- [ ] **Step 3: Write the wrapper script**

Create `scripts/wait-then-nginx.sh`:

```bash
#!/bin/sh
# wait-then-nginx.sh — start nginx ONLY after the backend /health responds.
#
# Why: supervisord starts both nginx and the Express backend in parallel.
# Express needs ~30-90s on first boot (Prisma migrate, airport-closed backfill)
# during which nginx already proxies /api/* to localhost:8000 and gets
# "connection refused" → 502. Browsers cache the empty error state and never
# refetch, leaving the user staring at empty lists despite the DB being intact.
#
# We poll /health here and exec nginx only when the backend is ready. If the
# backend never comes up within BACKEND_WAIT_MAX_SECONDS, we exec nginx anyway
# so that error pages can still be served (better than a blank port).
#
# Configurable via env:
#   BACKEND_HEALTH_URL          (default: http://localhost:8000/health)
#   BACKEND_WAIT_MAX_SECONDS    (default: 300)
#   NGINX_BIN                   (default: /usr/sbin/nginx) — for tests
set -eu

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:8000/health}"
MAX_WAIT_SECONDS="${BACKEND_WAIT_MAX_SECONDS:-300}"
NGINX_BIN="${NGINX_BIN:-/usr/sbin/nginx}"
POLL_INTERVAL=2

elapsed=0
echo "[wait-then-nginx] Polling ${BACKEND_HEALTH_URL} (max ${MAX_WAIT_SECONDS}s)..."

while [ "$elapsed" -lt "$MAX_WAIT_SECONDS" ]; do
  if wget --no-verbose --tries=1 --spider --timeout=3 "$BACKEND_HEALTH_URL" 2>/dev/null; then
    echo "[wait-then-nginx] Backend ready after ${elapsed}s — starting nginx"
    exec "$NGINX_BIN" -g "daemon off;"
  fi
  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))
done

echo "[wait-then-nginx] WARNING: backend not ready after ${MAX_WAIT_SECONDS}s — starting nginx anyway"
exec "$NGINX_BIN" -g "daemon off;"
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bash scripts/wait-then-nginx.test.sh
```

Expected: `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add scripts/wait-then-nginx.sh scripts/wait-then-nginx.test.sh
git commit -m "feat(boot): add wait-then-nginx wrapper to gate nginx on backend /health

Closes the boot race where Browsers fetched /api/* during the ~30-90s
window between nginx ready and Express ready, got 502, and stayed in
an error state until a hard reload. Wrapper polls backend /health,
exec's nginx only when ready, falls through after 5min as a safety net."
```

---

## Task 2: Wire the wrapper into supervisord

**Files:**
- Modify: `supervisord.conf:20`

- [ ] **Step 1: Update the nginx command**

Change line 20 of `supervisord.conf`:

```ini
[program:nginx]
command=/app/scripts/wait-then-nginx.sh
```

(was `command=/usr/sbin/nginx -g "daemon off;"`)

- [ ] **Step 2: Commit**

```bash
git add supervisord.conf
git commit -m "feat(boot): supervisord launches nginx via wait-then-nginx wrapper

Wires Task 1's wrapper. Nginx now gates its own start on backend /health
instead of racing Express during migration phase."
```

---

## Task 3: Copy the script in the Dockerfile + bump healthcheck

**Files:**
- Modify: `Dockerfile:100-105` and `:122-124`

- [ ] **Step 1: Add the COPY for the wrapper**

After the existing `COPY docker-entrypoint.sh /docker-entrypoint.sh` block (around line 101), insert:

```dockerfile
# Boot-race wrapper: nginx waits for backend /health before serving.
# See scripts/wait-then-nginx.sh for the why and the env knobs.
COPY scripts/wait-then-nginx.sh /app/scripts/wait-then-nginx.sh
RUN sed -i 's/\r$//' /app/scripts/wait-then-nginx.sh && \
    chmod +x /app/scripts/wait-then-nginx.sh
```

- [ ] **Step 2: Bump HEALTHCHECK start-period**

Change `Dockerfile:122-124`:

```dockerfile
# 180s start-period covers the longest observed boot path:
# Prisma generate (~5s) + migrate deploy (~10s) + closed-airport
# backfill (~30s) + airport-seed first install (~90s) + Express
# listen (~3s) + the wait-then-nginx poll loop (~2s).
HEALTHCHECK --interval=30s --timeout=3s --start-period=180s \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1
```

(was `--start-period=40s`)

- [ ] **Step 3: Verify the build still works**

```bash
docker build --build-arg VERSION=test -t travstats:wait-test .
```

Expected: build succeeds, no errors.

- [ ] **Step 4: Smoke-test inside an ad-hoc container**

```bash
docker run --rm --name travstats-wait-test \
  -e DATABASE_URL=postgresql://x:y@nonexistent:5432/x \
  -e BACKEND_WAIT_MAX_SECONDS=10 \
  travstats:wait-test &
sleep 30
# wrapper should NOT have started nginx yet (backend can't even start without DB)
# expect "Polling http://localhost:8000/health" in logs and no "Backend ready" line
docker logs travstats-wait-test 2>&1 | grep -E "wait-then-nginx|nginx" | head -10
docker stop travstats-wait-test
```

Expected output contains the polling message; nginx never reports "ready" (backend can't start). After 10s, "WARNING: backend not ready" + nginx exec.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "feat(docker): copy wait-then-nginx wrapper + bump healthcheck start-period

180s start-period absorbs migration + airport backfill on first boot
so docker doesn't mark the container unhealthy during the wrapper's
own health-poll loop."
```

---

## Task 4: Add the gateway-retry interceptor (TDD)

**Files:**
- Create: `frontend/src/lib/api/gatewayRetry.ts`
- Test: `frontend/src/lib/api/gatewayRetry.test.ts`

- [ ] **Step 1: Write the failing Vitest test**

Create `frontend/src/lib/api/gatewayRetry.test.ts`:

```ts
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachGatewayRetry } from "./gatewayRetry";

/**
 * Custom Axios adapter that returns a sequence of canned responses per URL+method.
 * Avoids axios-mock-adapter / msw / nock — keeps the test stack thin.
 */
function makeSequenceAdapter(sequence: Array<{ status: number } | { networkError: true }>) {
  let i = 0;
  return async (config: InternalAxiosRequestConfig) => {
    const next = sequence[i++] ?? sequence[sequence.length - 1];
    if ("networkError" in next) {
      const err = new Error("Network Error") as Error & { code?: string; config?: unknown };
      err.code = "ERR_NETWORK";
      err.config = config;
      throw err;
    }
    if (next.status >= 400) {
      const err = new Error(`HTTP ${next.status}`) as Error & {
        response?: { status: number };
        config?: unknown;
      };
      err.response = { status: next.status };
      err.config = config;
      throw err;
    }
    return {
      data: { ok: true },
      status: next.status,
      statusText: "OK",
      headers: {},
      config,
    };
  };
}

function makeInstance(adapter: ReturnType<typeof makeSequenceAdapter>): AxiosInstance {
  const instance = axios.create({ baseURL: "/api/v1", adapter });
  attachGatewayRetry(instance, { baseDelayMs: 1, maxRetries: 3 });
  return instance;
}

describe("attachGatewayRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries GET on 502 and succeeds on the 3rd attempt", async () => {
    const adapter = makeSequenceAdapter([{ status: 502 }, { status: 502 }, { status: 200 }]);
    const api = makeInstance(adapter);
    const result = await api.get("/flights");
    expect(result.status).toBe(200);
  });

  it("gives up after MAX_RETRIES on persistent 502", async () => {
    const adapter = makeSequenceAdapter([{ status: 502 }]);
    const api = makeInstance(adapter);
    await expect(api.get("/flights")).rejects.toMatchObject({
      response: { status: 502 },
    });
  });

  it("retries on ERR_NETWORK (connection refused during boot)", async () => {
    const adapter = makeSequenceAdapter([{ networkError: true }, { status: 200 }]);
    const api = makeInstance(adapter);
    const result = await api.get("/flights");
    expect(result.status).toBe(200);
  });

  it("does NOT retry POST (non-idempotent)", async () => {
    let calls = 0;
    const adapter = async (config: InternalAxiosRequestConfig) => {
      calls++;
      const err = new Error("HTTP 502") as Error & { response?: { status: number }; config?: unknown };
      err.response = { status: 502 };
      err.config = config;
      throw err;
    };
    const api = makeInstance(adapter);
    await expect(api.post("/flights", { foo: 1 })).rejects.toMatchObject({
      response: { status: 502 },
    });
    expect(calls).toBe(1);
  });

  it("does NOT retry on 4xx", async () => {
    let calls = 0;
    const adapter = async (config: InternalAxiosRequestConfig) => {
      calls++;
      const err = new Error("HTTP 401") as Error & { response?: { status: number }; config?: unknown };
      err.response = { status: 401 };
      err.config = config;
      throw err;
    };
    const api = makeInstance(adapter);
    await expect(api.get("/flights")).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd D:/TravStats_Projekt/TravStats/frontend
npx vitest run src/lib/api/gatewayRetry.test.ts
```

Expected: FAIL with `Cannot find module './gatewayRetry'`.

- [ ] **Step 3: Write the interceptor**

Create `frontend/src/lib/api/gatewayRetry.ts`:

```ts
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
const RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ERR_NETWORK",
]);
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(["get", "head", "options"]);

interface RetryConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

interface RetryOptions {
  /** Initial delay in ms; doubles each retry. */
  baseDelayMs?: number;
  /** Maximum retry attempts after the initial request. */
  maxRetries?: number;
}

/**
 * Mounts a response interceptor on `instance` that retries idempotent verbs
 * (GET/HEAD/OPTIONS) when the server returns 502/503/504 or the request fails
 * with a transient network error. Backs off exponentially.
 *
 * Defends the frontend against the boot window where nginx is up but Express
 * is still applying migrations — without this, the Zustand stores latch onto
 * the first 502 and never refetch until the user hard-reloads.
 *
 * Idempotency check is method-based; we never auto-retry POST/PUT/PATCH/DELETE
 * so a partially-applied write isn't accidentally repeated.
 */
export function attachGatewayRetry(
  instance: AxiosInstance,
  options: RetryOptions = {},
): void {
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxRetries = options.maxRetries ?? 3;

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetryConfig | undefined;
      if (!config) return Promise.reject(error);

      const status = error.response?.status;
      const isStatusRetryable = status !== undefined && RETRYABLE_STATUSES.has(status);
      const isNetworkRetryable =
        error.code !== undefined && RETRYABLE_NETWORK_CODES.has(error.code);
      const method = (config.method ?? "get").toLowerCase();
      const isIdempotent = IDEMPOTENT_METHODS.has(method);

      if (!(isStatusRetryable || isNetworkRetryable) || !isIdempotent) {
        return Promise.reject(error);
      }

      const attempt = (config.__retryCount ?? 0) + 1;
      if (attempt > maxRetries) {
        return Promise.reject(error);
      }
      config.__retryCount = attempt;

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return instance.request(config);
    },
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd D:/TravStats_Projekt/TravStats/frontend
npx vitest run src/lib/api/gatewayRetry.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/gatewayRetry.ts frontend/src/lib/api/gatewayRetry.test.ts
git commit -m "feat(frontend): add gateway-retry interceptor for transient 502/503/504

Defends idempotent reads against the boot window where nginx proxies
to a not-yet-listening Express. Exponential backoff (0.5/1/2s, max 3
attempts) on GET/HEAD/OPTIONS; never retries writes."
```

---

## Task 5: Mount the retry interceptor on `api` and `parserApi`

**Files:**
- Modify: `frontend/src/lib/api/client.ts:76-78`

- [ ] **Step 1: Wire the interceptor BEFORE the 401 handler**

Replace lines 76-78 of `frontend/src/lib/api/client.ts`:

```ts
import { attachGatewayRetry } from "./gatewayRetry";

// Attach gateway-retry FIRST so transient 5xx are retried before the
// 401-handler observes a fall-through error. Axios runs response interceptors
// in attach order on success and in reverse-attach order on rejection — the
// retry interceptor still gets the first crack at retrying.
attachGatewayRetry(api);
attachGatewayRetry(parserApi);

api.interceptors.response.use((response) => response, handle401Error);
parserApi.interceptors.response.use((response) => response, handle401Error);
```

(replaces the existing two `interceptors.response.use(... handle401Error)` lines; add the import at the top of the file next to the existing `import axios, ...` line).

- [ ] **Step 2: Run all frontend tests to ensure nothing else broke**

```bash
cd D:/TravStats_Projekt/TravStats/frontend
npx tsc --noEmit
npx vitest run
```

Expected: tsc clean, all tests pass (including the existing client.ts consumers).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api/client.ts
git commit -m "feat(frontend): mount gateway-retry on api + parserApi axios instances

Active on every existing consumer (flights, trips, stats, settings, …)
without touching their call sites. 401 handling unchanged."
```

---

## Task 6: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (under `## [Unreleased]` → `### Fixed`)

- [ ] **Step 1: Add a fixed-bullet under [Unreleased]**

Insert under the existing `## [Unreleased]` → `### Fixed` block (create the section if it doesn't exist yet):

```markdown
- **Empty UI after every container restart on Unraid + similar setups (boot race)** — supervisord launched nginx and the Express backend in parallel. nginx accepted `/api/*` immediately and proxied to a port where Express wasn't listening yet, so every browser open during the 30-90 s migration window cached `502 / no live upstreams` and never refetched until the user hard-reloaded. Two-layer fix: (1) supervisord now starts nginx via `scripts/wait-then-nginx.sh`, which polls backend `/health` and only `exec`s nginx when ready (5-minute fallthrough so the container never hangs forever); (2) the frontend Axios clients gained a gateway-retry interceptor that retries idempotent verbs on 502/503/504 / `ERR_NETWORK` with exponential backoff (3 attempts, 0.5/1/2 s) so any future short backend outage heals on its own. Docker `HEALTHCHECK --start-period` bumped 40 s → 180 s to absorb the longest observed first-boot path (closed-airport backfill).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): record boot-race fix under [Unreleased]"
```

---

## Task 7: End-to-end smoke test on Cardinal (CT 100)

**Goal:** Verify the fix on the production-shape stack BEFORE cutting an RC for Norbert's instance.

- [ ] **Step 1: Build a local image with the fix**

```bash
cd D:/TravStats_Projekt/TravStats
VERSION=$(cat backend/VERSION | tr -d '\r\n')-bootracetest
docker build --build-arg VERSION=$VERSION --platform linux/amd64 \
  -t ghcr.io/abrechen2/travstats:$VERSION .
docker push ghcr.io/abrechen2/travstats:$VERSION
```

- [ ] **Step 2: Deploy to Cardinal (CT 100) with the temporary tag**

```bash
ssh -i ~/.ssh/id_ed25519 root@<pve-node3> "pct exec 100 -- bash -c \
  'cd /opt/travstats && \
   sed -i \"s|image: ghcr.io/abrechen2/travstats:.*|image: ghcr.io/abrechen2/travstats:$VERSION|\" docker-compose.yml && \
   docker compose pull && docker compose up -d'"
```

- [ ] **Step 3: Watch the boot in real time**

```bash
ssh -i ~/.ssh/id_ed25519 root@<pve-node3> "pct exec 100 -- bash -c \
  'docker logs -f TravStats 2>&1 | grep -E \"wait-then-nginx|migrat|airport|listening|Backend ready\" | head -30'"
```

Expected:
- `[wait-then-nginx] Polling http://localhost:8000/health (max 300s)...`
- migrations + backfills run
- Express logs `listening on :8000`
- `[wait-then-nginx] Backend ready after Ns — starting nginx`
- nginx access.log starts.

- [ ] **Step 4: Confirm zero `no live upstreams` events**

Wait 60 s, then:

```bash
ssh -i ~/.ssh/id_ed25519 root@<pve-node3> "pct exec 100 -- bash -c \
  'docker exec TravStats grep -c \"no live upstreams\" /var/log/nginx/error.log || echo 0'"
```

Expected: `0`.

- [ ] **Step 5: Open the UI in a browser, confirm flights load on first paint**

Visit `http://<prod-host>:3010/` (Cardinal). Login. Dashboard should show flights immediately, no hard reload required.

- [ ] **Step 6: Restore Cardinal to its previous RC**

```bash
ssh -i ~/.ssh/id_ed25519 root@<pve-node3> "pct exec 100 -- bash -c \
  'cd /opt/travstats && git checkout docker-compose.yml && docker compose pull && docker compose up -d'"
```

(or revert via the `/deploy` skill on the next RC roll).

---

## Task 8: Cut an RC and roll out via /deploy

- [ ] **Step 1: Trigger the deploy skill**

```
/deploy
```

The skill auto-determines the bump (a `feat:` and a `fix:` were committed → minor or stay on the current 1.4.0 line as rc.5).

- [ ] **Step 2: Verify Norbert's instance after the rc-latest pull**

Once Unraid CA pulls `:rc-latest`:

```bash
ssh -i ~/.ssh/id_ed25519 root@<nas-host> \
  'docker logs --tail 20 TravStats 2>&1 | grep wait-then-nginx; \
   docker exec TravStats grep -c "no live upstreams" /var/log/nginx/error.log'
```

Expected: wrapper log lines present, count of `no live upstreams` == 0.

Tell Norbert he can refresh — flights should be there on first load now, no Ctrl+Shift+R needed.

---

## Self-Review

**Spec coverage:**
- Server-side gate ✅ Tasks 1-3
- Client-side retry ✅ Tasks 4-5
- Healthcheck timing ✅ Task 3 step 2
- Changelog entry ✅ Task 6
- Smoke verification ✅ Task 7
- Production rollout ✅ Task 8

**Placeholder scan:** none — every step has the full code/command.

**Type consistency:**
- `attachGatewayRetry(instance, options?)` — same signature in interceptor file (Task 4 step 3), test file (Task 4 step 1), and consumer (Task 5 step 1). ✅
- `BACKEND_HEALTH_URL`, `BACKEND_WAIT_MAX_SECONDS`, `NGINX_BIN` env-var names match across script (Task 1 step 3), bash test (Task 1 step 1), and Dockerfile copy step (Task 3 step 1). ✅
- Wrapper path `/app/scripts/wait-then-nginx.sh` matches in supervisord.conf (Task 2) and Dockerfile (Task 3). ✅
