# Complete, Protected Demo Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The standard demo seed fills every domain with coherent trips (flights, stays, places, tours, journal, cruises) plus bulk data, the demo account cannot change its credentials or outbound connections, a public instance can show the demo login, and the public preview CT134 runs it with a nightly reset.

**Architecture:** `seedDemoAccount.ts` stays the entry point and delegates to new modules under `backend/src/seedDemo/`. Account protection is one middleware (`rejectDemo` / `rejectDemoWrites`) mounted on the named routes, with `isDemo` carried in the auth payload so the UI can explain instead of offering a button that fails. The login hint rides on the unauthenticated `GET /api/v1/setup/status`.

**Tech Stack:** Express + Prisma + Zod (backend, Jest + supertest against Postgres), React + Vite + Zustand + react-i18next (frontend, Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-09-17-demo-account-complete-design.md`

## Global Constraints

- Work in the worktree `D:\TravStats_Projekt\TravStats\.worktrees\design-system`, branch `dev/design-system`. Never commit to `main`; never merge.
- Code, comments and commit messages in English. User-facing copy: German first, English mirrored in the same change (`frontend/src/i18n/resources/{de,en}/*.json`; `localeKeyParity.test.ts` enforces it).
- Demo credentials: username `demo`, password `demo123` (constants `DEMO_USERNAME`, `DEMO_PASSWORD` in `seedDemoAccount.ts`).
- Error code for a refused demo action: `403 { error: "DEMO_ACCOUNT_FORBIDDEN" }`.
- Env flag: `PUBLIC_DEMO_LOGIN` (default `false`); API field: `publicDemoLogin`.
- No source file may exceed 800 lines (`node scripts/check-file-size.mjs`); seed scripts are exempt but new modules stay small anyway.
- Backend tests need `DATABASE_URL=postgresql://flights_dev:dev_password_change_me_123@localhost:5437/flights_merge_test` (container `travstats-db-mergetest`, own DB of this session — never 5433/5434 for suites).
- Frontend gate: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`. Backend gate: `cd backend && npx tsc --noEmit && npm run lint && npx jest --forceExit`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Never run `taskkill`; never `git stash`.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/middleware/demoGuard.ts` (create) | `rejectDemo`, `rejectDemoWrites` — refuse demo users |
| `backend/src/routes/auth.ts`, `auth/twoFactor.ts`, `auth/passkeys.ts`, `pairing.ts`, `settings/index.ts`, `flights.ts` (modify) | mount the guard; `isDemo` in auth payloads |
| `backend/src/routes/__tests__/demoGuard.routes.test.ts` (create) | 403 per locked route family |
| `backend/src/config/env.ts`, `routes/setup.ts`, `services/openapi/paths/*` (modify) | `PUBLIC_DEMO_LOGIN` → `publicDemoLogin` |
| `frontend/src/types/index.ts`, `hooks/useSessionValidation.ts` (modify) | `isDemo` on `User`, refreshed from `/auth/me` |
| `frontend/src/components/Settings/DemoLockedNotice.tsx` (create) | the one sentence shown instead of a locked control |
| `frontend/src/components/Settings/{SecuritySection,PasskeySection,ApiTokensSection,ApiKeysSection,DevicesSection,ImmichConnectionCard,DawarichConnectionCard,ProfileSection}.tsx` (modify) | show the notice for the demo account |
| `frontend/src/pages/LoginPage.tsx`, `lib/api/setup.ts` (modify) | demo login hint |
| `backend/src/seedDemo/stories.ts` (create) | narrated trips as typed data |
| `backend/src/seedDemo/bulk.ts` (create) | bulk lodging + places as typed data |
| `backend/src/seedDemo/lookup.ts` (create) | airport/port/ship/curated lookups that fail loudly |
| `backend/src/seedDemo/seedTours.ts` (create) | tour route + stops + legs |
| `backend/src/seedDemo/seedStories.ts` (create) | writes a narrated trip and all its parts |
| `backend/src/seedDemo/seedBulk.ts` (create) | writes bulk lodging, places, place lists |
| `backend/src/seedDemoAccount.ts` (modify) | credential reset, extended wipe, airport list, wiring |
| `backend/src/__tests__/seedDemo.*.test.ts` (create) | seed completeness, idempotency, tours |

---

### Task 1: Demo guard on account-level routes, `isDemo` in the auth payload

**Files:**
- Create: `backend/src/middleware/demoGuard.ts`
- Modify: `backend/src/routes/auth.ts` (`/change-password` at ~371; user payloads at ~176, ~315, `/me` select at ~342)
- Modify: `backend/src/routes/auth/twoFactor.ts` (`/setup` ~54, `/activate` ~87, `/disable` ~230, `/recovery-codes` ~269; user payload ~218)
- Modify: `backend/src/routes/auth/passkeys.ts` (`/register/options` ~67, `/register/verify` ~109, `PATCH /:id` ~284, `DELETE /:id` ~299)
- Modify: `backend/src/routes/pairing.ts` (`/start` ~79)
- Modify: `backend/src/routes/settings/index.ts` (~22–40)
- Modify: `backend/src/routes/flights.ts` (~871–915, the two inline guards)
- Test: `backend/src/routes/__tests__/demoGuard.routes.test.ts`

**Interfaces:**
- Produces: `rejectDemo: RequestHandler` (refuses every method), `rejectDemoWrites: RequestHandler` (lets GET/HEAD/OPTIONS through). Both read `req.userId` (set by `authenticate`) and answer `403 { error: "DEMO_ACCOUNT_FORBIDDEN", message }`.
- Produces: auth responses (`/auth/me`, `/auth/login`, `/auth/register`, 2FA verify) carry `user.isDemo: boolean`.

- [ ] **Step 1: Write the failing route test**

```ts
// backend/src/routes/__tests__/demoGuard.routes.test.ts
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The public preview shows the demo login to anyone. Every visitor shares the
 * account, so nothing one of them does may lock out or endanger the next:
 * credentials, second factors, device pairing, tokens, provider keys, outbound
 * connections and the profile picture are refused for `isDemo` users.
 */
describe("demo account guard", () => {
  let demoCookie: string;
  let userCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["guardDemo", "guardUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "guardDemo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "guardUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  const locked: Array<[string, "post" | "put" | "patch" | "delete", object]> = [
    ["/api/v1/auth/change-password", "post", { oldPassword: "demo123", newPassword: "whatever123!" }],
    ["/api/v1/auth/2fa/setup", "post", {}],
    ["/api/v1/auth/2fa/activate", "post", { code: "123456" }],
    ["/api/v1/auth/2fa/disable", "post", { password: "demo123" }],
    ["/api/v1/auth/2fa/recovery-codes", "post", { password: "demo123" }],
    ["/api/v1/auth/passkeys/register/options", "post", {}],
    ["/api/v1/auth/passkeys/register/verify", "post", {}],
    ["/api/v1/auth/passkeys/00000000-0000-0000-0000-000000000000", "patch", { name: "x" }],
    ["/api/v1/auth/passkeys/00000000-0000-0000-0000-000000000000", "delete", {}],
    ["/api/v1/pairing/start", "post", {}],
    ["/api/v1/settings/tokens", "post", { name: "x", scope: "read" }],
    ["/api/v1/settings/tokens/00000000-0000-0000-0000-000000000000", "delete", {}],
    ["/api/v1/settings/api-keys", "put", {}],
    ["/api/v1/settings/api-keys/test/aerodatabox", "post", {}],
    ["/api/v1/settings/immich", "put", { baseUrl: "http://10.0.0.1" }],
    ["/api/v1/settings/immich/test", "post", {}],
    ["/api/v1/settings/dawarich", "put", { baseUrl: "http://10.0.0.1" }],
    ["/api/v1/settings/dawarich/test", "post", {}],
    ["/api/v1/settings/profile-picture", "post", {}],
    ["/api/v1/settings/profile-picture", "delete", {}],
  ];

  it.each(locked)("refuses %s (%s) for the demo account", async (path, method, body) => {
    const res = await request(app)[method](path).set("Cookie", demoCookie).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
  });

  it.each(locked)("does not refuse %s (%s) for a normal account", async (path, method, body) => {
    const res = await request(app)[method](path).set("Cookie", userCookie).send(body);
    expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
  });

  it("still lets the demo account read its settings", async () => {
    const res = await request(app).get("/api/v1/settings/api-keys").set("Cookie", demoCookie);
    expect(res.status).toBe(200);
  });

  it("tells the client that the account is the demo account", async () => {
    const demo = await request(app).get("/api/v1/auth/me").set("Cookie", demoCookie);
    expect(demo.body.user.isDemo).toBe(true);
    const user = await request(app).get("/api/v1/auth/me").set("Cookie", userCookie);
    expect(user.body.user.isDemo).toBe(false);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "guardDemo", password: "demo123" });
    expect(login.status).toBe(200);
    expect(login.body.user.isDemo).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && DATABASE_URL=postgresql://flights_dev:dev_password_change_me_123@localhost:5437/flights_merge_test npx jest src/routes/__tests__/demoGuard.routes.test.ts --forceExit`
Expected: FAIL — locked routes answer 400/200/401 instead of 403; `isDemo` undefined.

- [ ] **Step 3: Create the middleware**

```ts
// backend/src/middleware/demoGuard.ts
import type { NextFunction, Response } from "express";
import { prisma } from "../db";
import type { AuthRequest } from "./auth";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The demo account is shared by every visitor of a public instance. What one
 * of them does to its credentials, second factors, tokens or outbound
 * connections would lock out or endanger all the others, so those routes
 * refuse it. Travel data stays editable; a nightly reseed restores it.
 *
 * Mount AFTER `authenticate`: it reads `req.userId`.
 */
export async function rejectDemo(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) {
      next();
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isDemo: true },
    });
    if (user?.isDemo) {
      res.status(403).json({
        error: "DEMO_ACCOUNT_FORBIDDEN",
        message: "The demo account cannot change this. Use your own account on your own instance.",
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** `rejectDemo` for writes only: the demo account may still read the page. */
export function rejectDemoWrites(req: AuthRequest, res: Response, next: NextFunction): void {
  if (READ_METHODS.has(req.method)) {
    next();
    return;
  }
  void rejectDemo(req, res, next);
}
```

- [ ] **Step 4: Mount it**

In `backend/src/routes/auth.ts`, add the import and put `rejectDemo` right after `authenticate` on change-password:

```ts
import { rejectDemo } from "../middleware/demoGuard";
// …
router.post('/change-password', authenticate, rejectDemo, authLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
```

In the same file add `isDemo` to the three user payloads — `/register` response (~176), `/login` response (~315) and the `/me` select (~342):

```ts
        isAdmin: user.isAdmin,
        isDemo: user.isDemo,
```

```ts
      select: {
        id: true,
        username: true,
        isAdmin: true,
        isDemo: true,
        firstName: true,
        lastName: true,
      },
```

(If the `user` object at ~315 comes from a `select` that omits `isDemo`, add `isDemo: true` to that select.)

In `backend/src/routes/auth/twoFactor.ts`: `import { rejectDemo } from "../../middleware/demoGuard";`, then in each of `/setup`, `/activate`, `/disable`, `/recovery-codes` insert `rejectDemo,` directly after `authenticate,`. In the verify response user payload (~218) add `isDemo: user.isDemo,` next to `isAdmin` (and `isDemo: true` to its select if it has one).

In `backend/src/routes/auth/passkeys.ts`: import likewise and insert `rejectDemo,` after `authenticate,` on `/register/options`, `/register/verify`, `PATCH /:id`, `DELETE /:id`.

In `backend/src/routes/pairing.ts`: import `{ rejectDemo } from "../middleware/demoGuard"` and change `/start` to `authenticate, rejectDemo, cookieOnly,`.

In `backend/src/routes/settings/index.ts`, after `router.use(requireWriteScope);` and before the sub-router mounts:

```ts
import { rejectDemoWrites } from "../../middleware/demoGuard";
// …
// Shared demo account: no keys, tokens, outbound URLs or pictures (spec §3).
router.use(["/api-keys", "/tokens", "/immich", "/dawarich", "/profile-picture"], rejectDemoWrites);
```

In `backend/src/routes/flights.ts`, replace the two inline `isDemo` lookups in `/refresh-historical-bulk/preview` and `/refresh-historical-bulk` with the middleware, keeping their specific message: change the handlers to `router.get('/refresh-historical-bulk/preview', flightCreationLimiter, rejectDemo, async …` / `router.post('/refresh-historical-bulk', flightCreationLimiter, rejectDemo, async …` and delete the `const user = await prisma.user.findUnique(...)` + `if (user?.isDemo) {...}` blocks. Import `rejectDemo` from `../middleware/demoGuard`.

- [ ] **Step 5: Run the test and the flights refresh tests**

Run: `cd backend && DATABASE_URL=… npx jest src/routes/__tests__/demoGuard.routes.test.ts src/routes/__tests__/auth src/__tests__/openapi --forceExit`
Expected: PASS. If `openapi.responseSchema` fails because `/auth/me` schema lacks `isDemo`, add `isDemo: z.boolean()` to that response schema in `backend/src/services/openapi/paths/` (grep for `"/auth/me"`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/demoGuard.ts backend/src/routes backend/src/services/openapi
git commit -m "feat(auth): the shared demo account cannot change credentials, tokens or connections

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `PUBLIC_DEMO_LOGIN` and the login hint

**Files:**
- Modify: `backend/src/config/env.ts:57`
- Modify: `backend/src/routes/setup.ts:33-55`
- Modify: OpenAPI registration of `GET /setup/status` (grep `backend/src/services/openapi` for `setup/status`; if unregistered, it is listed in the coverage baseline — add the field wherever its response schema lives)
- Modify: `frontend/src/lib/api/setup.ts:6`
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/i18n/resources/de/auth.json`, `frontend/src/i18n/resources/en/auth.json` (`login` block)
- Test: `backend/src/routes/__tests__/setup.publicDemoLogin.test.ts`, `frontend/src/pages/__tests__/LoginPage.demoHint.test.tsx`

**Interfaces:**
- Produces: `GET /api/v1/setup/status` → `{ setupComplete, requiresSetup, message, publicDemoLogin: boolean }`.
- Produces: `setupApi.getStatus(): Promise<{ setupComplete: boolean; requiresSetup: boolean; message: string; publicDemoLogin?: boolean }>`.

- [ ] **Step 1: Failing backend test**

```ts
// backend/src/routes/__tests__/setup.publicDemoLogin.test.ts
import request from "supertest";
import app from "../../index";

// A first install seeds demo/demo123 too, so the flag — not the existence of
// the account — decides whether the login page may print the credentials.
describe("GET /setup/status carries the public demo login flag", () => {
  const original = process.env.PUBLIC_DEMO_LOGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.PUBLIC_DEMO_LOGIN;
    else process.env.PUBLIC_DEMO_LOGIN = original;
  });

  it("is false unless the instance opts in", async () => {
    delete process.env.PUBLIC_DEMO_LOGIN;
    const res = await request(app).get("/api/v1/setup/status");
    expect(res.status).toBe(200);
    expect(res.body.publicDemoLogin).toBe(false);
  });

  it("is true with PUBLIC_DEMO_LOGIN=true", async () => {
    process.env.PUBLIC_DEMO_LOGIN = "true";
    const res = await request(app).get("/api/v1/setup/status");
    expect(res.body.publicDemoLogin).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`publicDemoLogin` undefined)

Run: `cd backend && DATABASE_URL=… npx jest src/routes/__tests__/setup.publicDemoLogin.test.ts --forceExit`

- [ ] **Step 3: Implement backend**

`backend/src/config/env.ts`, below `CREATE_DEMO_USER`:

```ts
  // Prints demo / demo123 on the login page. Only for a public demo instance:
  // every install seeds the demo user, and a real one must never advertise it.
  PUBLIC_DEMO_LOGIN: z.string().transform((val) => val === 'true').prefault('false'),
```

`backend/src/routes/setup.ts`, in the `/status` handler — read the variable at request time (the test flips it per case):

```ts
    res.json({
      setupComplete,
      requiresSetup: !setupComplete,
      publicDemoLogin: process.env.PUBLIC_DEMO_LOGIN === 'true',
      message: setupComplete
```

Add `publicDemoLogin: z.boolean()` to the OpenAPI response schema of `/setup/status`.

- [ ] **Step 4: Run backend test — expect PASS**

- [ ] **Step 5: Failing frontend test**

```tsx
// frontend/src/pages/__tests__/LoginPage.demoHint.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getStatus = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    setupApi: { getStatus: () => getStatus() },
    passkeyApi: { availability: () => Promise.resolve({ available: false }) },
  };
});

import LoginPage from "../LoginPage";

describe("LoginPage — public demo login hint", () => {
  beforeEach(() => getStatus.mockReset());

  it("says nothing about a demo account unless the instance opts in", async () => {
    getStatus.mockResolvedValue({ setupComplete: true, requiresSetup: false, message: "", publicDemoLogin: false });
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    expect(screen.queryByText("auth:login.demoHint")).toBeNull();
  });

  it("shows the hint and fills both fields on a public demo instance", async () => {
    getStatus.mockResolvedValue({ setupComplete: true, requiresSetup: false, message: "", publicDemoLogin: true });
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "auth:login.demoFill" }));
    expect(screen.getByLabelText("auth:login.username")).toHaveValue("demo");
    expect(screen.getByLabelText("auth:login.password")).toHaveValue("demo123");
  });
});
```

(`LoginPage.tsx` imports `authApi, passkeyApi` from `../lib/api`; add `setupApi` to that import. The global test `t` mock returns keys; if it returns `login.username` without the namespace, use the keys the existing LoginPage tests query.)

- [ ] **Step 6: Run it — expect FAIL** (no hint, no button)

Run: `cd frontend && npx vitest --run src/pages/__tests__/LoginPage.demoHint.test.tsx`

- [ ] **Step 7: Implement frontend**

`frontend/src/lib/api/setup.ts` — add `publicDemoLogin?: boolean;` to the `getStatus` return type.

`frontend/src/pages/LoginPage.tsx` — state + effect next to the passkey availability effect:

```tsx
  // A public demo instance prints its shared login (PUBLIC_DEMO_LOGIN). Any
  // other install never does, although it seeds the same demo account.
  const [publicDemoLogin, setPublicDemoLogin] = useState(false);
  useEffect(() => {
    setupApi
      .getStatus()
      .then((s) => setPublicDemoLogin(s.publicDemoLogin === true))
      .catch(() => setPublicDemoLogin(false));
  }, []);
```

and directly above `<form onSubmit={handleSubmit} …>`:

```tsx
            {publicDemoLogin && (
              <div
                className="mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
                style={{ background: "var(--ts-surface2)", border: "1px solid var(--ts-border)" }}
              >
                <span>{t("login.demoHint", { username: "demo", password: "demo123" })}</span>
                <button
                  type="button"
                  className="btn-secondary whitespace-nowrap"
                  onClick={() => {
                    setUsername("demo");
                    setPassword("demo123");
                  }}
                >
                  {t("login.demoFill")}
                </button>
              </div>
            )}
```

Change line 5 to `import { authApi, passkeyApi, setupApi } from "../lib/api";`.

`de/auth.json` `login` block:

```json
    "demoHint": "Demo-Zugang: {{username}} / {{password}} — wird jede Nacht zurückgesetzt",
    "demoFill": "Demo-Daten eintragen",
```

`en/auth.json` `login` block:

```json
    "demoHint": "Demo login: {{username}} / {{password}} — reset every night",
    "demoFill": "Fill in demo login",
```

- [ ] **Step 8: Run frontend test + parity test — expect PASS**

Run: `cd frontend && npx vitest --run src/pages/__tests__/LoginPage.demoHint.test.tsx src/i18n`

- [ ] **Step 9: Commit**

```bash
git add backend/src/config/env.ts backend/src/routes/setup.ts backend/src/routes/__tests__/setup.publicDemoLogin.test.ts backend/src/services/openapi frontend/src/lib/api/setup.ts frontend/src/pages frontend/src/i18n
git commit -m "feat(login): a public demo instance shows and fills its demo login

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The settings explain what the demo account cannot change

**Files:**
- Modify: `frontend/src/types/index.ts:5-9`
- Modify: `frontend/src/hooks/useSessionValidation.ts:~50`
- Create: `frontend/src/hooks/useIsDemoAccount.ts`
- Create: `frontend/src/components/Settings/DemoLockedNotice.tsx`
- Modify: `frontend/src/components/Settings/SecuritySection.tsx`, `PasskeySection.tsx`, `ApiTokensSection.tsx`, `ApiKeysSection.tsx`, `DevicesSection.tsx`, `ImmichConnectionCard.tsx`, `DawarichConnectionCard.tsx`, `ProfileSection.tsx`
- Modify: `frontend/src/i18n/resources/{de,en}/settings.json`
- Test: `frontend/src/components/Settings/__tests__/DemoLockedNotice.sections.test.tsx`

**Interfaces:**
- Consumes: `user.isDemo` from Task 1.
- Produces: `useIsDemoAccount(): boolean`; `<DemoLockedNotice />` (no props).

- [ ] **Step 1: Failing test**

```tsx
// frontend/src/components/Settings/__tests__/DemoLockedNotice.sections.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => true }));

import ApiTokensSection from "../ApiTokensSection";
import PasskeySection from "../PasskeySection";

// The server refuses these for the shared demo account (403
// DEMO_ACCOUNT_FORBIDDEN). Offering the button anyway would be a button that
// always fails; the section says why instead.
describe("settings sections on the demo account", () => {
  it.each([
    ["ApiTokensSection", ApiTokensSection],
    ["PasskeySection", PasskeySection],
  ])("%s explains instead of offering the action", (_name, Section) => {
    render(
      <MemoryRouter>
        <Section />
      </MemoryRouter>
    );
    expect(screen.getByText("settings:demoLocked")).toBeInTheDocument();
  });
});
```

(If either section takes required props, pass the minimal ones its existing tests pass; import style — default vs named — must match the file.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd frontend && npx vitest --run src/components/Settings/__tests__/DemoLockedNotice.sections.test.tsx`

- [ ] **Step 3: Implement the type, hook, notice**

`frontend/src/types/index.ts`:

```ts
export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  /** The shared demo account of a public instance — settings that the server refuses are explained, not offered. */
  isDemo?: boolean;
}
```

`frontend/src/hooks/useIsDemoAccount.ts`:

```ts
import { useAuthStore } from "../store/authStore";

/** True for the shared demo account (see backend middleware/demoGuard.ts). */
export function useIsDemoAccount(): boolean {
  return useAuthStore((s) => s.user?.isDemo === true);
}
```

`frontend/src/hooks/useSessionValidation.ts` — the persisted user predates the flag, so take the fresh one from `/auth/me`:

```ts
        const { user } = await authApi.me();
        useAuthStore.getState().setAuth(user);
```

(replacing `await authApi.me();`; confirm `setAuth` only sets the user — it does in `store/authStore.ts:33`.)

`frontend/src/components/Settings/DemoLockedNotice.tsx`:

```tsx
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/** Stands in for a control the demo account may not use (403 DEMO_ACCOUNT_FORBIDDEN). */
export default function DemoLockedNotice(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <p className="t-caption" role="note">
      {t("settings:demoLocked")}
    </p>
  );
}
```

`de/settings.json` (top level): `"demoLocked": "Im Demo-Zugang gesperrt — alle Besucher teilen sich dieses Konto."`
`en/settings.json` (top level): `"demoLocked": "Locked in the demo account — every visitor shares it."`

- [ ] **Step 4: Apply in the eight components**

In each listed component add

```tsx
import DemoLockedNotice from "./DemoLockedNotice";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
// inside the component, first line after its other hooks:
const isDemo = useIsDemoAccount();
```

and wrap the part that performs the locked action — keep the section card and its title, replace only the interactive body:

```tsx
{isDemo ? <DemoLockedNotice /> : (
  /* the existing buttons / form / list with actions, unchanged */
)}
```

What to wrap per file: `SecuritySection` — the change-password form and the two-factor controls; `PasskeySection` — the add button and each row's rename/delete; `ApiTokensSection` — create form and revoke buttons; `ApiKeysSection` — the key cards' save/test controls; `DevicesSection` — the pairing start button/QR; `ImmichConnectionCard` and `DawarichConnectionCard` — URL/key form and test button; `ProfileSection` — only the profile-picture upload/remove controls (names and birthdate stay editable). Existing hooks must still run unconditionally (wrap JSX, never return before a hook).

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd frontend && npx vitest --run src/components/Settings src/i18n src/hooks && npx tsc --noEmit && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(settings): the demo account sees why a setting is locked

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Seed foundation — credential reset, full wipe, airports, lookups

**Files:**
- Modify: `backend/src/seedDemoAccount.ts` (`AIRPORT_IATAS` ~108, `wipeDemoUser` ~435, `ensureUser` ~450)
- Create: `backend/src/seedDemo/lookup.ts`
- Test: extend `backend/src/__tests__/seedDemoAccount.isDemo.test.ts`

**Interfaces:**
- Produces: `airportByIata(airports: Map<string, AirportRow>, iata: string): AirportRow` (throws), `portIdByLocode(locode: string): Promise<number>` (throws), `shipByName(name: string): Promise<{ id: number; name: string; cruiseLine: string }>` (throws), `curatedIdIfPresent(id: string): Promise<string | null>`.
- Produces: `AirportRow` exported from `seedDemoAccount.ts` (change `type AirportRow` to `export type AirportRow`).

- [ ] **Step 1: Failing test — append to `seedDemoAccount.isDemo.test.ts`**

```ts
  it("restores the demo credentials on every run", async () => {
    const id = await ensureUser();
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword("changed-by-a-visitor"),
        mustChangePassword: true,
        twoFactorSecret: "PENDINGSECRET",
        twoFactorEnabledAt: new Date(),
      },
    });

    await ensureUser();

    const after = await prisma.user.findUnique({ where: { id } });
    expect(after?.mustChangePassword).toBe(false);
    expect(after?.twoFactorEnabledAt).toBeNull();
    expect(after?.twoFactorSecret).toBeNull();
    const { comparePassword } = await import("../utils/password");
    expect(await comparePassword("demo123", after!.passwordHash)).toBe(true);
  });
```

(User columns: `twoFactorSecret`, `twoFactorPendingSecret`, `twoFactorEnabledAt`, `twoFactorToken`, `twoFactorTokenExpiry`; relations `twoFactorRecoveryCodes` (model `TwoFactorRecoveryCode`), `webauthnCredentials` (model `WebAuthnCredential`), `apiTokens` (model `ApiToken`). Check `comparePassword`'s argument order in `utils/password.ts:9`.)

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && DATABASE_URL=… npx jest src/__tests__/seedDemoAccount.isDemo.test.ts --forceExit`

- [ ] **Step 3: Implement**

In `ensureUser`, replace the `if (existing) { … }` block:

```ts
  if (existing) {
    await wipeDemoUser(existing.id);
    // Restore the account itself, not only its data. The route guards should
    // make this a no-op; it is the second line if one is ever missed.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        isDemo: true,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        mustChangePassword: false,
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: null,
        twoFactorToken: null,
        twoFactorTokenExpiry: null,
      },
    });
    await prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: existing.id } });
    await prisma.webAuthnCredential.deleteMany({ where: { userId: existing.id } });
    await prisma.apiToken.deleteMany({ where: { userId: existing.id } });
    return existing.id;
  }
```

(If `TwoFactorRecoveryCode` / `WebAuthnCredential` key the owner by a different column than `userId`, use that column — `sed -n '/^model WebAuthnCredential/,/^}/p' backend/prisma/schema.prisma`.)

Extend `wipeDemoUser` so it deletes everything the new seed writes, before the existing deletes:

```ts
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.placeList.deleteMany({ where: { userId } }); // entries cascade
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.lodgingStay.deleteMany({ where: { userId } });
  await prisma.lodging.deleteMany({ where: { userId } });
  await prisma.tripJournalEntry.deleteMany({ where: { trip: { userId } } });
  await prisma.tripRoute.deleteMany({ where: { trip: { userId } } }); // legs/tracks cascade
  await prisma.tripStop.deleteMany({ where: { trip: { userId } } });
  await prisma.companion.deleteMany({ where: { userId } }); // join rows cascade
```

Add `"KEF", "FLR", "BGO", "TOS",` to `AIRPORT_IATAS`; change `type AirportRow` to `export type AirportRow`.

Create `backend/src/seedDemo/lookup.ts`:

```ts
import { prisma } from "../db";
import type { AirportRow } from "../seedDemoAccount";

/**
 * Lookups for the narrated demo data. A missing airport, port or ship is a
 * broken seed, not an optional row: fail loudly instead of dropping a flight.
 * Ports go by UN/LOCODE — the name pool has "Naples" twice.
 */
export function airportByIata(airports: Map<string, AirportRow>, iata: string): AirportRow {
  const airport = airports.get(iata);
  if (!airport) throw new Error(`Demo seed: airport ${iata} is not in the pool (AIRPORT_IATAS)`);
  return airport;
}

export async function portIdByLocode(locode: string): Promise<number> {
  const port = await prisma.port.findFirst({ where: { unlocode: locode }, select: { id: true } });
  if (!port) throw new Error(`Demo seed: port ${locode} is not in the catalogue`);
  return port.id;
}

export async function shipByName(name: string): Promise<{ id: number; name: string; cruiseLine: string }> {
  const ship = await prisma.ship.findFirst({
    where: { name },
    select: { id: true, name: true, cruiseLine: true },
  });
  if (!ship) throw new Error(`Demo seed: ship ${name} is not in the catalogue`);
  return ship;
}

/**
 * The one soft lookup: init.ts seeds the demo before the server seeds the
 * curated catalogue, so a place stays unlinked rather than failing the seed.
 */
export async function curatedIdIfPresent(id: string): Promise<string | null> {
  const item = await prisma.curatedPlace.findUnique({ where: { id }, select: { id: true } });
  return item?.id ?? null;
}
```

- [ ] **Step 4: Run — expect PASS**; also `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/seedDemoAccount.ts backend/src/seedDemo/lookup.ts backend/src/__tests__/seedDemoAccount.isDemo.test.ts
git commit -m "feat(seed): the demo seed resets the account and wipes every domain

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Narrated trip data and tours

**Files:**
- Create: `backend/src/seedDemo/stories.ts`
- Create: `backend/src/seedDemo/seedTours.ts`
- Test: `backend/src/__tests__/seedDemo.tours.test.ts`

**Interfaces:**
- Produces types in `stories.ts`:

```ts
export interface StoryPoint { name: string; lat: number; lon: number }
export interface StoryFlight { airline: string; flightNumber: string; from: string; to: string; departure: string; arrival: string }
export interface StoryStay {
  name: string; type: "hotel" | "campsite" | "guesthouse" | "apartment" | "hostel";
  city: string; country: string; iso: string; lat: number; lon: number;
  checkIn: string; checkOut: string; board: "none" | "breakfast" | "half" | "full" | "all_inclusive";
  price: number | null; currency: string; rating: number | null; stars: number | null;
}
export interface StoryPlace {
  name: string; category: "restaurant" | "landmark" | "nature" | "museum" | "entertainment" | "shopping" | "viewpoint" | "other";
  city: string; country: string; iso: string; lat: number; lon: number;
  visitedAt: string | null; rating: number | null; curatedId?: string;
}
export interface StoryCruise {
  ship: string; start: string; end: string; cabinType: "inside" | "oceanview" | "balcony" | "suite";
  price: number; stops: Array<{ locode: string } | { atSea: true }>;
}
export interface StoryTour { name: string; mode: "road" | "ferry" | "rail" | "foot" | "bike"; color: string; stops: StoryPoint[] }
export interface StoryJournal { date: string; title: string; body: string; mood: string; weather: string }
export interface Story {
  name: string; description: string; color: string; icon: string;
  status: "planned" | "in_progress" | "completed"; category: "vacation" | "business" | "weekend" | "family" | "other";
  start: string; end: string; origin: string; destination: string; countries: string[];
  tags: string[]; companions: string[];
  flights: StoryFlight[]; stays: StoryStay[]; places: StoryPlace[];
  cruise?: StoryCruise; tour?: StoryTour; journal: StoryJournal[];
}
export const STORIES: Story[];
```

- Produces in `seedTours.ts`: `seedTour(tripId: string, tour: StoryTour, orderIdx: number): Promise<string>` (returns route id).

- [ ] **Step 1: Failing test**

```ts
// backend/src/__tests__/seedDemo.tours.test.ts
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { STORIES } from "../seedDemo/stories";
import { seedTour } from "../seedDemo/seedTours";

describe("seedTour writes a tour the app can draw", () => {
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedTourUser" } });
    const user = await prisma.user.create({
      data: { username: "seedTourUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Tour test" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("stores ordered stops and one straight leg between each pair", async () => {
    const tour = STORIES.find((s) => s.tour)!.tour!;
    const routeId = await seedTour(tripId, tour, 0);

    const stops = await prisma.tripStop.findMany({ where: { routeId }, orderBy: { routeOrderIdx: "asc" } });
    expect(stops.map((s) => s.title)).toEqual(tour.stops.map((s) => s.name));
    const legs = await prisma.tripRouteLeg.findMany({ where: { routeId } });
    expect(legs).toHaveLength(stops.length - 1);
    for (const leg of legs) {
      expect(leg.distanceKm).toBeGreaterThan(0);
      expect(leg.source).toBe("straight");
    }
  });

  it("gives every story a consistent date range", () => {
    for (const story of STORIES) {
      expect(Date.parse(story.start), story.name).toBeLessThanOrEqual(Date.parse(story.end));
      for (const stay of story.stays) {
        expect(Date.parse(stay.checkIn), stay.name).toBeGreaterThanOrEqual(Date.parse(story.start));
        expect(Date.parse(stay.checkOut), stay.name).toBeLessThanOrEqual(Date.parse(story.end));
      }
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (modules missing)

- [ ] **Step 3: Write `stories.ts`** — the types above plus this data (dates in UTC ISO):

```ts
export const STORIES: Story[] = [
  {
    name: "Island – Ringstraße", icon: "🌋", color: "#38bdf8", status: "completed", category: "vacation",
    description: "Zehn Tage einmal um die Insel: Wasserfälle, Gletscher und Mitternachtssonne.",
    start: "2024-06-08T00:00:00Z", end: "2024-06-17T23:59:00Z", origin: "München", destination: "Reykjavík",
    countries: ["IS"], tags: ["Roadtrip", "Natur"], companions: ["Anna"],
    flights: [
      { airline: "Icelandair", flightNumber: "FI533", from: "MUC", to: "KEF", departure: "2024-06-08T13:05:00Z", arrival: "2024-06-08T16:20:00Z" },
      { airline: "Icelandair", flightNumber: "FI532", from: "KEF", to: "MUC", departure: "2024-06-17T07:40:00Z", arrival: "2024-06-17T12:50:00Z" },
    ],
    stays: [
      { name: "Hotel Borg", type: "hotel", city: "Reykjavík", country: "Iceland", iso: "IS", lat: 64.1474, lon: -21.9396, checkIn: "2024-06-08T00:00:00Z", checkOut: "2024-06-10T00:00:00Z", board: "breakfast", price: 520, currency: "EUR", rating: 4.5, stars: 4 },
      { name: "Guesthouse Vík", type: "guesthouse", city: "Vík", country: "Iceland", iso: "IS", lat: 63.4186, lon: -19.006, checkIn: "2024-06-10T00:00:00Z", checkOut: "2024-06-12T00:00:00Z", board: "breakfast", price: 290, currency: "EUR", rating: 4, stars: null },
      { name: "Hótel Höfn", type: "hotel", city: "Höfn", country: "Iceland", iso: "IS", lat: 64.2539, lon: -15.2082, checkIn: "2024-06-12T00:00:00Z", checkOut: "2024-06-13T00:00:00Z", board: "none", price: 185, currency: "EUR", rating: 3.5, stars: 3 },
      { name: "Camping Hlíð", type: "campsite", city: "Mývatn", country: "Iceland", iso: "IS", lat: 65.645, lon: -16.912, checkIn: "2024-06-13T00:00:00Z", checkOut: "2024-06-15T00:00:00Z", board: "none", price: null, currency: "EUR", rating: 4, stars: null },
      { name: "Hotel Kea", type: "hotel", city: "Akureyri", country: "Iceland", iso: "IS", lat: 65.6816, lon: -18.0878, checkIn: "2024-06-15T00:00:00Z", checkOut: "2024-06-17T00:00:00Z", board: "breakfast", price: 410, currency: "EUR", rating: 4.5, stars: 4 },
    ],
    places: [
      { name: "Þingvellir", category: "nature", city: "Þingvellir", country: "Iceland", iso: "IS", lat: 64.2559, lon: -21.1299, visitedAt: "2024-06-09T10:00:00Z", rating: 5, curatedId: "world-heritage:1152" },
      { name: "Geysir", category: "nature", city: "Haukadalur", country: "Iceland", iso: "IS", lat: 64.3104, lon: -20.3024, visitedAt: "2024-06-09T13:00:00Z", rating: 4 },
      { name: "Gullfoss", category: "nature", city: "Bláskógabyggð", country: "Iceland", iso: "IS", lat: 64.3271, lon: -20.1199, visitedAt: "2024-06-09T15:00:00Z", rating: 5 },
      { name: "Seljalandsfoss", category: "nature", city: "Rangárþing eystra", country: "Iceland", iso: "IS", lat: 63.6156, lon: -19.9886, visitedAt: "2024-06-10T11:00:00Z", rating: 5 },
      { name: "Reynisfjara", category: "nature", city: "Vík", country: "Iceland", iso: "IS", lat: 63.4044, lon: -19.045, visitedAt: "2024-06-11T09:00:00Z", rating: 4 },
      { name: "Jökulsárlón", category: "viewpoint", city: "Vatnajökull", country: "Iceland", iso: "IS", lat: 64.0484, lon: -16.1794, visitedAt: "2024-06-12T14:00:00Z", rating: 5, curatedId: "world-heritage:1604" },
      { name: "Dettifoss", category: "nature", city: "Norðurþing", country: "Iceland", iso: "IS", lat: 65.8147, lon: -16.3846, visitedAt: "2024-06-14T12:00:00Z", rating: 4 },
      { name: "Goðafoss", category: "nature", city: "Þingeyjarsveit", country: "Iceland", iso: "IS", lat: 65.6828, lon: -17.5502, visitedAt: "2024-06-15T10:00:00Z", rating: 4 },
    ],
    tour: {
      name: "Ringstraße", mode: "road", color: "#38bdf8",
      stops: [
        { name: "Reykjavík", lat: 64.1466, lon: -21.9426 }, { name: "Þingvellir", lat: 64.2559, lon: -21.1299 },
        { name: "Geysir", lat: 64.3104, lon: -20.3024 }, { name: "Gullfoss", lat: 64.3271, lon: -20.1199 },
        { name: "Seljalandsfoss", lat: 63.6156, lon: -19.9886 }, { name: "Vík", lat: 63.4186, lon: -19.006 },
        { name: "Jökulsárlón", lat: 64.0484, lon: -16.1794 }, { name: "Höfn", lat: 64.2539, lon: -15.2082 },
        { name: "Mývatn", lat: 65.6039, lon: -16.9961 }, { name: "Akureyri", lat: 65.6885, lon: -18.1262 },
      ],
    },
    journal: [
      { date: "2024-06-09T20:00:00Z", title: "Goldener Kreis", body: "Þingvellir am Morgen fast menschenleer, der Geysir brav alle paar Minuten.", mood: "begeistert", weather: "bewölkt, 11 °C" },
      { date: "2024-06-11T21:00:00Z", title: "Schwarzer Strand", body: "Reynisfjara bei Wind — die Wellen kommen weiter, als man denkt.", mood: "ehrfürchtig", weather: "Sturm, 9 °C" },
      { date: "2024-06-12T22:00:00Z", title: "Eisberge", body: "Jökulsárlón bei Mitternachtssonne. Robben zwischen den Schollen.", mood: "glücklich", weather: "sonnig, 12 °C" },
      { date: "2024-06-14T20:00:00Z", title: "Mývatn", body: "Mücken, Lava und das Naturbad am Abend.", mood: "entspannt", weather: "sonnig, 15 °C" },
    ],
  },
  {
    name: "Japan – Tokio bis Kyoto", icon: "🗾", color: "#f472b6", status: "completed", category: "vacation",
    description: "Kirschblüte in Tokio, Tempel in Kyoto und Nara, Burg Himeji.",
    start: "2025-04-01T00:00:00Z", end: "2025-04-12T23:59:00Z", origin: "Frankfurt", destination: "Osaka",
    countries: ["JP"], tags: ["Kirschblüte", "Bahn"], companions: ["Anna", "Jonas"],
    flights: [
      { airline: "Lufthansa", flightNumber: "LH716", from: "FRA", to: "HND", departure: "2025-04-01T11:50:00Z", arrival: "2025-04-02T00:05:00Z" },
      { airline: "Lufthansa", flightNumber: "LH741", from: "KIX", to: "FRA", departure: "2025-04-12T01:25:00Z", arrival: "2025-04-12T15:10:00Z" },
    ],
    stays: [
      { name: "Hotel Gracery Shinjuku", type: "hotel", city: "Tokio", country: "Japan", iso: "JP", lat: 35.6948, lon: 139.702, checkIn: "2025-04-02T00:00:00Z", checkOut: "2025-04-06T00:00:00Z", board: "none", price: 118000, currency: "JPY", rating: 4, stars: 3 },
      { name: "Hotel Granvia Kyoto", type: "hotel", city: "Kyoto", country: "Japan", iso: "JP", lat: 34.9855, lon: 135.7588, checkIn: "2025-04-06T00:00:00Z", checkOut: "2025-04-10T00:00:00Z", board: "breakfast", price: 164000, currency: "JPY", rating: 4.5, stars: 4 },
      { name: "Cross Hotel Osaka", type: "hotel", city: "Osaka", country: "Japan", iso: "JP", lat: 34.6693, lon: 135.5013, checkIn: "2025-04-10T00:00:00Z", checkOut: "2025-04-12T00:00:00Z", board: "none", price: 52000, currency: "JPY", rating: 4, stars: 4 },
    ],
    places: [
      { name: "Sensō-ji", category: "landmark", city: "Tokio", country: "Japan", iso: "JP", lat: 35.7148, lon: 139.7967, visitedAt: "2025-04-03T09:00:00Z", rating: 5 },
      { name: "Shibuya Crossing", category: "landmark", city: "Tokio", country: "Japan", iso: "JP", lat: 35.6595, lon: 139.7005, visitedAt: "2025-04-03T19:00:00Z", rating: 4 },
      { name: "Tokyo Skytree", category: "viewpoint", city: "Tokio", country: "Japan", iso: "JP", lat: 35.7101, lon: 139.8107, visitedAt: "2025-04-04T17:00:00Z", rating: 4 },
      { name: "Kinkaku-ji", category: "landmark", city: "Kyoto", country: "Japan", iso: "JP", lat: 35.0394, lon: 135.7292, visitedAt: "2025-04-07T10:00:00Z", rating: 5, curatedId: "world-heritage:688" },
      { name: "Fushimi Inari-taisha", category: "landmark", city: "Kyoto", country: "Japan", iso: "JP", lat: 34.9671, lon: 135.7727, visitedAt: "2025-04-08T07:00:00Z", rating: 5 },
      { name: "Bambuswald Arashiyama", category: "nature", city: "Kyoto", country: "Japan", iso: "JP", lat: 35.017, lon: 135.6713, visitedAt: "2025-04-08T15:00:00Z", rating: 4 },
      { name: "Tōdai-ji", category: "landmark", city: "Nara", country: "Japan", iso: "JP", lat: 34.689, lon: 135.8398, visitedAt: "2025-04-09T11:00:00Z", rating: 5, curatedId: "world-heritage:870" },
      { name: "Burg Himeji", category: "landmark", city: "Himeji", country: "Japan", iso: "JP", lat: 34.8394, lon: 134.6939, visitedAt: "2025-04-10T10:00:00Z", rating: 5, curatedId: "world-heritage:661" },
      { name: "Dōtonbori", category: "restaurant", city: "Osaka", country: "Japan", iso: "JP", lat: 34.6687, lon: 135.5019, visitedAt: "2025-04-11T19:00:00Z", rating: 4 },
    ],
    tour: {
      name: "Mit dem Shinkansen", mode: "rail", color: "#f472b6",
      stops: [
        { name: "Tokio", lat: 35.6812, lon: 139.7671 }, { name: "Kyoto", lat: 34.9858, lon: 135.7588 },
        { name: "Nara", lat: 34.6851, lon: 135.8048 }, { name: "Himeji", lat: 34.8269, lon: 134.6906 },
        { name: "Osaka", lat: 34.7025, lon: 135.4959 },
      ],
    },
    journal: [
      { date: "2025-04-03T22:00:00Z", title: "Hanami", body: "Picknick unter Kirschblüten im Ueno-Park, halb Tokio war da.", mood: "glücklich", weather: "sonnig, 18 °C" },
      { date: "2025-04-08T21:00:00Z", title: "Tausend Tore", body: "Um sieben Uhr früh am Fushimi Inari — ab neun ist es voll.", mood: "ruhig", weather: "diesig, 15 °C" },
      { date: "2025-04-10T21:00:00Z", title: "Die weiße Burg", body: "Himeji von innen: steile Treppen, großartige Aussicht.", mood: "begeistert", weather: "sonnig, 19 °C" },
    ],
  },
  {
    name: "Toskana", icon: "🍷", color: "#fb923c", status: "completed", category: "vacation",
    description: "Florenz, Weinberge rund um San Gimignano und die Hügel des Val d'Orcia.",
    start: "2023-09-09T00:00:00Z", end: "2023-09-17T23:59:00Z", origin: "München", destination: "Pisa",
    countries: ["IT"], tags: ["Genuss", "Roadtrip"], companions: ["Anna"],
    flights: [
      { airline: "Air Dolomiti", flightNumber: "EN8190", from: "MUC", to: "FLR", departure: "2023-09-09T07:30:00Z", arrival: "2023-09-09T08:45:00Z" },
      { airline: "Lufthansa", flightNumber: "LH1937", from: "PSA", to: "MUC", departure: "2023-09-17T15:10:00Z", arrival: "2023-09-17T16:35:00Z" },
    ],
    stays: [
      { name: "Agriturismo Il Poggio", type: "guesthouse", city: "San Gimignano", country: "Italy", iso: "IT", lat: 43.4677, lon: 11.0435, checkIn: "2023-09-09T00:00:00Z", checkOut: "2023-09-13T00:00:00Z", board: "half", price: 780, currency: "EUR", rating: 5, stars: null },
      { name: "Appartamento Il Campo", type: "apartment", city: "Siena", country: "Italy", iso: "IT", lat: 43.3186, lon: 11.3316, checkIn: "2023-09-13T00:00:00Z", checkOut: "2023-09-17T00:00:00Z", board: "none", price: 560, currency: "EUR", rating: 4, stars: null },
    ],
    places: [
      { name: "Dom von Florenz", category: "landmark", city: "Florenz", country: "Italy", iso: "IT", lat: 43.7731, lon: 11.256, visitedAt: "2023-09-09T11:00:00Z", rating: 5, curatedId: "world-heritage:174" },
      { name: "Ponte Vecchio", category: "landmark", city: "Florenz", country: "Italy", iso: "IT", lat: 43.768, lon: 11.2531, visitedAt: "2023-09-09T15:00:00Z", rating: 4 },
      { name: "San Gimignano", category: "landmark", city: "San Gimignano", country: "Italy", iso: "IT", lat: 43.4677, lon: 11.0434, visitedAt: "2023-09-10T10:00:00Z", rating: 5, curatedId: "world-heritage:550" },
      { name: "Piazza del Campo", category: "landmark", city: "Siena", country: "Italy", iso: "IT", lat: 43.3183, lon: 11.3317, visitedAt: "2023-09-14T18:00:00Z", rating: 5, curatedId: "world-heritage:717" },
      { name: "Pienza", category: "viewpoint", city: "Pienza", country: "Italy", iso: "IT", lat: 43.0766, lon: 11.679, visitedAt: "2023-09-15T11:00:00Z", rating: 5, curatedId: "world-heritage:789" },
      { name: "Schiefer Turm von Pisa", category: "landmark", city: "Pisa", country: "Italy", iso: "IT", lat: 43.723, lon: 10.3966, visitedAt: "2023-09-17T10:00:00Z", rating: 4, curatedId: "world-heritage:395" },
    ],
    tour: {
      name: "Durch die Hügel", mode: "road", color: "#fb923c",
      stops: [
        { name: "Florenz", lat: 43.7696, lon: 11.2558 }, { name: "San Gimignano", lat: 43.4677, lon: 11.0434 },
        { name: "Siena", lat: 43.3188, lon: 11.3308 }, { name: "Pienza", lat: 43.0766, lon: 11.679 },
        { name: "Pisa", lat: 43.7228, lon: 10.4017 },
      ],
    },
    journal: [
      { date: "2023-09-10T21:00:00Z", title: "Türme im Abendlicht", body: "San Gimignano nach den Tagesbussen — plötzlich still.", mood: "entspannt", weather: "sonnig, 27 °C" },
      { date: "2023-09-15T21:00:00Z", title: "Val d'Orcia", body: "Zypressenallee, Pecorino in Pienza, zu viel Wein.", mood: "glücklich", weather: "sonnig, 29 °C" },
    ],
  },
  {
    name: "Mittelmeer-Kreuzfahrt", icon: "🚢", color: "#fbbf24", status: "completed", category: "vacation",
    description: "Von Barcelona über Marseille, Genua und Neapel nach Rom.",
    start: "2024-05-10T00:00:00Z", end: "2024-05-17T23:59:00Z", origin: "Barcelona", destination: "Civitavecchia",
    countries: ["ES", "FR", "IT"], tags: ["Kreuzfahrt"], companions: ["Anna"],
    flights: [
      { airline: "Lufthansa", flightNumber: "LH1812", from: "MUC", to: "BCN", departure: "2024-05-10T06:45:00Z", arrival: "2024-05-10T08:55:00Z" },
      { airline: "Lufthansa", flightNumber: "LH1869", from: "FCO", to: "MUC", departure: "2024-05-17T16:05:00Z", arrival: "2024-05-17T17:40:00Z" },
    ],
    stays: [
      { name: "Hotel Colón", type: "hotel", city: "Barcelona", country: "Spain", iso: "ES", lat: 41.3845, lon: 2.1762, checkIn: "2024-05-10T00:00:00Z", checkOut: "2024-05-11T00:00:00Z", board: "breakfast", price: 240, currency: "EUR", rating: 4, stars: 4 },
    ],
    places: [
      { name: "Sagrada Família", category: "landmark", city: "Barcelona", country: "Spain", iso: "ES", lat: 41.4036, lon: 2.1744, visitedAt: "2024-05-10T15:00:00Z", rating: 5 },
      { name: "Vieux-Port", category: "landmark", city: "Marseille", country: "France", iso: "FR", lat: 43.2951, lon: 5.374, visitedAt: "2024-05-12T11:00:00Z", rating: 4 },
      { name: "Pompeji", category: "museum", city: "Pompei", country: "Italy", iso: "IT", lat: 40.7489, lon: 14.4848, visitedAt: "2024-05-15T10:00:00Z", rating: 5, curatedId: "world-heritage:829" },
      { name: "Kolosseum", category: "landmark", city: "Rom", country: "Italy", iso: "IT", lat: 41.8902, lon: 12.4922, visitedAt: "2024-05-17T09:00:00Z", rating: 5, curatedId: "world-wonders-new7:colosseum" },
    ],
    cruise: {
      ship: "MSC Grandiosa", start: "2024-05-11T16:00:00Z", end: "2024-05-17T08:00:00Z", cabinType: "balcony", price: 1890,
      stops: [{ locode: "ESBCN" }, { locode: "FRMRS" }, { locode: "ITGOA" }, { atSea: true }, { locode: "ITNAP" }, { atSea: true }, { locode: "ITCVV" }],
    },
    journal: [
      { date: "2024-05-15T21:00:00Z", title: "Pompeji", body: "Landausflug in der Mittagshitze, trotzdem der beste Tag der Reise.", mood: "beeindruckt", weather: "sonnig, 26 °C" },
    ],
  },
  {
    name: "Norwegens Fjorde", icon: "🏔️", color: "#818cf8", status: "completed", category: "vacation",
    description: "Mit AIDAsol die Küste hinauf bis über den Polarkreis.",
    start: "2025-07-05T00:00:00Z", end: "2025-07-13T23:59:00Z", origin: "Bergen", destination: "Tromsø",
    countries: ["NO"], tags: ["Kreuzfahrt", "Polarkreis"], companions: ["Jonas"],
    flights: [
      { airline: "Lufthansa", flightNumber: "LH2458", from: "MUC", to: "BGO", departure: "2025-07-05T09:10:00Z", arrival: "2025-07-05T11:35:00Z" },
      { airline: "Norwegian", flightNumber: "DY391", from: "TOS", to: "OSL", departure: "2025-07-13T10:00:00Z", arrival: "2025-07-13T11:50:00Z" },
      { airline: "Lufthansa", flightNumber: "LH2455", from: "OSL", to: "MUC", departure: "2025-07-13T13:30:00Z", arrival: "2025-07-13T15:45:00Z" },
    ],
    stays: [],
    places: [
      { name: "Bryggen", category: "landmark", city: "Bergen", country: "Norway", iso: "NO", lat: 60.3975, lon: 5.3233, visitedAt: "2025-07-05T15:00:00Z", rating: 4, curatedId: "world-heritage:59" },
      { name: "Aussichtspunkt Aksla", category: "viewpoint", city: "Ålesund", country: "Norway", iso: "NO", lat: 62.4722, lon: 6.16, visitedAt: "2025-07-07T10:00:00Z", rating: 5 },
      { name: "Nidarosdom", category: "landmark", city: "Trondheim", country: "Norway", iso: "NO", lat: 63.4269, lon: 10.3969, visitedAt: "2025-07-09T11:00:00Z", rating: 4 },
      { name: "Eismeerkathedrale", category: "landmark", city: "Tromsø", country: "Norway", iso: "NO", lat: 69.6481, lon: 18.9876, visitedAt: "2025-07-12T16:00:00Z", rating: 4 },
    ],
    cruise: {
      ship: "AIDAsol", start: "2025-07-05T18:00:00Z", end: "2025-07-13T07:00:00Z", cabinType: "oceanview", price: 2150,
      stops: [{ locode: "NOBGO" }, { atSea: true }, { locode: "NOAES" }, { atSea: true }, { locode: "NOTRD" }, { locode: "NOBOO" }, { atSea: true }, { locode: "NOTOS" }],
    },
    journal: [
      { date: "2025-07-10T23:00:00Z", title: "Polarkreis", body: "Taufe an Deck um Mitternacht, die Sonne ging einfach nicht unter.", mood: "ausgelassen", weather: "klar, 13 °C" },
    ],
  },
  {
    name: "Portugal", icon: "🇵🇹", color: "#34d399", status: "planned", category: "vacation",
    description: "Lissabon, Sintra und die Küste hinauf nach Porto.",
    start: "2027-06-05T00:00:00Z", end: "2027-06-12T23:59:00Z", origin: "Lissabon", destination: "Porto",
    countries: ["PT"], tags: ["Roadtrip"], companions: ["Anna"],
    flights: [
      { airline: "TAP Air Portugal", flightNumber: "TP557", from: "MUC", to: "LIS", departure: "2027-06-05T06:25:00Z", arrival: "2027-06-05T09:20:00Z" },
      { airline: "Lufthansa", flightNumber: "LH1781", from: "OPO", to: "MUC", departure: "2027-06-12T12:15:00Z", arrival: "2027-06-12T15:55:00Z" },
    ],
    stays: [
      { name: "Memmo Alfama", type: "hotel", city: "Lissabon", country: "Portugal", iso: "PT", lat: 38.711, lon: -9.13, checkIn: "2027-06-05T00:00:00Z", checkOut: "2027-06-09T00:00:00Z", board: "breakfast", price: 960, currency: "EUR", rating: null, stars: 4 },
      { name: "Pestana Vintage Porto", type: "hotel", city: "Porto", country: "Portugal", iso: "PT", lat: 41.1405, lon: -8.6132, checkIn: "2027-06-09T00:00:00Z", checkOut: "2027-06-12T00:00:00Z", board: "breakfast", price: 690, currency: "EUR", rating: null, stars: 5 },
    ],
    places: [
      { name: "Torre de Belém", category: "landmark", city: "Lissabon", country: "Portugal", iso: "PT", lat: 38.6916, lon: -9.216, visitedAt: null, rating: null, curatedId: "world-heritage:263" },
      { name: "Palácio da Pena", category: "landmark", city: "Sintra", country: "Portugal", iso: "PT", lat: 38.7876, lon: -9.3906, visitedAt: null, rating: null, curatedId: "world-heritage:723" },
      { name: "Ribeira", category: "landmark", city: "Porto", country: "Portugal", iso: "PT", lat: 41.1407, lon: -8.613, visitedAt: null, rating: null, curatedId: "world-heritage:755" },
      { name: "Livraria Lello", category: "shopping", city: "Porto", country: "Portugal", iso: "PT", lat: 41.1469, lon: -8.6149, visitedAt: null, rating: null },
    ],
    tour: {
      name: "Küste nach Norden", mode: "road", color: "#34d399",
      stops: [
        { name: "Lissabon", lat: 38.7223, lon: -9.1393 }, { name: "Sintra", lat: 38.8029, lon: -9.3817 },
        { name: "Óbidos", lat: 39.3606, lon: -9.1571 }, { name: "Coimbra", lat: 40.2033, lon: -8.4103 },
        { name: "Porto", lat: 41.1579, lon: -8.6291 },
      ],
    },
    journal: [],
  },
];
```

(Before trusting the ships: `grep -E "^(MSC Grandiosa|AIDAsol)," backend/src/seedData/ships.csv` must print both.)

- [ ] **Step 4: Write `seedTours.ts`**

```ts
// backend/src/seedDemo/seedTours.ts
import { prisma } from "../db";
import { recomputeLegs } from "../services/tour/legRecompute";
import type { StoryTour } from "./stories";

/**
 * One tour section with its stops in order. Legs come from the same
 * `recomputeLegs` the tour routes use, so they are `straight` legs with a
 * great-circle distance until someone asks the app for a road route.
 */
export async function seedTour(tripId: string, tour: StoryTour, orderIdx: number): Promise<string> {
  const route = await prisma.tripRoute.create({
    data: { tripId, name: tour.name, mode: tour.mode, color: tour.color, orderIdx },
  });
  const stops = [];
  for (const [index, point] of tour.stops.entries()) {
    stops.push(
      await prisma.tripStop.create({
        data: {
          tripId,
          title: point.name,
          lat: point.lat,
          lon: point.lon,
          orderIdx: index,
          routeId: route.id,
          routeOrderIdx: index,
        },
        select: { id: true, lat: true, lon: true },
      })
    );
  }
  await prisma.$transaction((tx) => recomputeLegs(tx, route.id, tour.mode, stops), { timeout: 30_000 });
  return route.id;
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `cd backend && DATABASE_URL=… npx jest src/__tests__/seedDemo.tours.test.ts --forceExit && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add backend/src/seedDemo/stories.ts backend/src/seedDemo/seedTours.ts backend/src/__tests__/seedDemo.tours.test.ts
git commit -m "feat(seed): narrated demo trips as data, and their tours

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Write the narrated trips

**Files:**
- Create: `backend/src/seedDemo/seedStories.ts`
- Test: `backend/src/__tests__/seedDemo.stories.test.ts`

**Interfaces:**
- Consumes: `STORIES`, `seedTour`, `airportByIata`, `portIdByLocode`, `shipByName`, `curatedIdIfPresent`, `AirportRow`, `loadPools` (from `seedDemoAccount.ts`), `resolveCompanions`, `linkRowsFor` (from `services/companionService`).
- Produces: `seedStories(userId: string, airports: Map<string, AirportRow>): Promise<number>` (number of trips).

- [ ] **Step 1: Failing test**

```ts
// backend/src/__tests__/seedDemo.stories.test.ts
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { loadPools } from "../seedDemoAccount";
import { STORIES } from "../seedDemo/stories";
import { seedStories } from "../seedDemo/seedStories";

describe("seedStories", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedStoriesUser" } });
    userId = (
      await prisma.user.create({
        data: { username: "seedStoriesUser", passwordHash: await hashPassword("password123") },
      })
    ).id;
    const { airports } = await loadPools();
    await seedStories(userId, airports);
  }, 60_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("writes every narrated trip with all of its parts linked", async () => {
    for (const story of STORIES) {
      const trip = await prisma.trip.findFirst({
        where: { userId, name: story.name },
        include: { flights: true, lodgingStays: true, placeVisits: true, routes: true, journalEntries: true, cruises: true },
      });
      expect(trip, story.name).not.toBeNull();
      expect(trip!.flights, story.name).toHaveLength(story.flights.length);
      expect(trip!.lodgingStays, story.name).toHaveLength(story.stays.length);
      expect(trip!.placeVisits.length, story.name).toBe(story.places.filter((p) => p.visitedAt).length);
      expect(trip!.routes, story.name).toHaveLength(story.tour ? 1 : 0);
      expect(trip!.journalEntries, story.name).toHaveLength(story.journal.length);
      expect(trip!.cruises, story.name).toHaveLength(story.cruise ? 1 : 0);
    }
  });

  it("keeps a cruise's stops in the 3-state invariant, numbered from 1", async () => {
    const cruises = await prisma.cruise.findMany({ where: { userId }, include: { stops: { orderBy: { dayNumber: "asc" } } } });
    for (const cruise of cruises) {
      cruise.stops.forEach((stop, i) => {
        expect(stop.dayNumber).toBe(i + 1);
        expect(stop.isAtSea ? stop.portId === null : stop.portId !== null).toBe(true);
      });
    }
  });

  it("marks planned stories' flights and stays as not yet taken", async () => {
    const planned = STORIES.filter((s) => s.status === "planned").map((s) => s.name);
    const trips = await prisma.trip.findMany({ where: { userId, name: { in: planned } }, include: { flights: true, lodgingStays: true } });
    for (const trip of trips) {
      for (const f of trip.flights) expect(f.status).toBe("scheduled");
      for (const s of trip.lodgingStays) expect(s.status).toBe("scheduled");
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// backend/src/seedDemo/seedStories.ts
import { prisma } from "../db";
import type { AirportRow } from "../seedDemoAccount";
import { calculateCo2Kg } from "../services/co2Calculator";
import { linkRowsFor, resolveCompanions } from "../services/companionService";
import { airportByIata, curatedIdIfPresent, portIdByLocode, shipByName } from "./lookup";
import { seedTour } from "./seedTours";
import { STORIES, type Story } from "./stories";

const nightsBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

async function seedStory(userId: string, story: Story, airports: Map<string, AirportRow>): Promise<void> {
  const planned = story.status === "planned";
  const trip = await prisma.trip.create({
    data: {
      userId, name: story.name, description: story.description, color: story.color, icon: story.icon,
      status: story.status, category: story.category, startDate: new Date(story.start), endDate: new Date(story.end),
      originLabel: story.origin, destinationLabel: story.destination, countries: story.countries,
      tags: story.tags, companions: story.companions,
    },
  });
  const companions = await resolveCompanions(userId, story.companions);
  if (companions.length > 0) {
    await prisma.tripCompanion.createMany({
      data: linkRowsFor(companions.map((c) => c.id)).map((l) => ({ tripId: trip.id, companionId: l.companionId, position: l.position })),
      skipDuplicates: true,
    });
  }

  for (const f of story.flights) {
    const dep = airportByIata(airports, f.from);
    const arr = airportByIata(airports, f.to);
    await prisma.flight.create({
      data: {
        userId, tripId: trip.id, airline: f.airline, flightNumber: f.flightNumber,
        depIcao: dep.icao, depIata: dep.iata, depName: dep.name, depLat: dep.lat, depLon: dep.lon,
        arrIcao: arr.icao, arrIata: arr.iata, arrName: arr.name, arrLat: arr.lat, arrLon: arr.lon,
        departureTime: new Date(f.departure), arrivalTime: new Date(f.arrival),
        status: planned ? "scheduled" : "flown", seatClass: "economy", category: "vacation",
        companions: story.companions, tags: story.tags, dataSource: "manual", lastModifiedBy: "user",
        co2Kg: calculateCo2Kg({ depLat: dep.lat, depLon: dep.lon, arrLat: arr.lat, arrLon: arr.lon, seatClass: "economy" }),
      },
    });
  }

  for (const s of story.stays) {
    const lodging = await prisma.lodging.create({
      data: {
        userId, type: s.type, name: s.name, city: s.city, country: s.country, isoCountryCode: s.iso,
        lat: s.lat, lon: s.lon, stars: s.stars, visited: !planned, dataSource: "manual",
      },
    });
    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id, userId, tripId: trip.id, checkIn: new Date(s.checkIn), checkOut: new Date(s.checkOut),
        nights: nightsBetween(s.checkIn, s.checkOut), status: planned ? "scheduled" : "completed", board: s.board,
        guests: 1 + story.companions.length, currency: s.currency, totalPrice: s.price,
        ratingOverall: s.rating, companions: story.companions, dataSource: "manual",
      },
    });
  }

  for (const [orderIdx, p] of story.places.entries()) {
    const curatedItemId = p.curatedId ? await curatedIdIfPresent(p.curatedId) : null;
    const place = await prisma.place.create({
      data: {
        userId, name: p.name, category: p.category, lat: p.lat, lon: p.lon, city: p.city, country: p.country,
        isoCountryCode: p.iso, visited: p.visitedAt !== null, curatedItemId, dataSource: curatedItemId ? "curated" : "manual",
      },
    });
    if (p.visitedAt) {
      await prisma.placeVisit.create({
        data: { placeId: place.id, userId, tripId: trip.id, visitedAt: new Date(p.visitedAt), orderIdx, rating: p.rating },
      });
    }
  }

  if (story.cruise) {
    const c = story.cruise;
    const ship = await shipByName(c.ship);
    const portIds: Array<number | null> = [];
    for (const stop of c.stops) portIds.push("locode" in stop ? await portIdByLocode(stop.locode) : null);
    const firstPort = portIds.find((id) => id !== null) ?? null;
    const lastPort = [...portIds].reverse().find((id) => id !== null) ?? null;
    const cruise = await prisma.cruise.create({
      data: {
        userId, tripId: trip.id, shipId: ship.id, cruiseLine: ship.cruiseLine, departurePortId: firstPort, arrivalPortId: lastPort,
        startDate: new Date(c.start), endDate: new Date(c.end), status: planned ? "scheduled" : "flown",
        cabinType: c.cabinType, price: c.price, currency: "EUR", companions: story.companions, tags: story.tags, dataSource: "manual",
      },
    });
    for (const [i, portId] of portIds.entries()) {
      const day = new Date(Date.parse(c.start) + i * 86_400_000);
      await prisma.cruiseStop.create({
        data: {
          cruiseId: cruise.id, dayNumber: i + 1, portId, isAtSea: portId === null,
          arrivalTime: portId === null ? null : day,
          departureTime: portId === null ? null : new Date(day.getTime() + 9 * 3_600_000),
        },
      });
    }
  }

  if (story.tour) await seedTour(trip.id, story.tour, 0);

  for (const j of story.journal) {
    await prisma.tripJournalEntry.create({
      data: { tripId: trip.id, date: new Date(j.date), title: j.title, body: j.body, mood: j.mood, weather: j.weather },
    });
  }
}

/** The narrated trips — each one coherent across flights, stays, places, tour and journal. */
export async function seedStories(userId: string, airports: Map<string, AirportRow>): Promise<number> {
  for (const story of STORIES) await seedStory(userId, story, airports);
  return STORIES.length;
}
```

(`seatClass: "economy"` and `category: "vacation"` are values `SEAT_CLASSES` / `CATEGORIES` in `seedDemoAccount.ts` already use; cruise statuses `flown` / `scheduled` match `seedCruises`.)

- [ ] **Step 4: Run — expect PASS**; `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/seedDemo/seedStories.ts backend/src/__tests__/seedDemo.stories.test.ts
git commit -m "feat(seed): write the narrated demo trips with every part linked

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Bulk lodging, places and place lists

**Files:**
- Create: `backend/src/seedDemo/bulk.ts`
- Create: `backend/src/seedDemo/seedBulk.ts`
- Test: `backend/src/__tests__/seedDemo.bulk.test.ts`

**Interfaces:**
- Produces: `BULK_CITIES: BulkCity[]` where `interface BulkCity { city: string; country: string; iso: string; hotel: { name: string; type: "hotel" | "hostel" | "apartment" | "guesthouse"; stars: number | null; lat: number; lon: number; year: number; nights: number; price: number; currency: string; rating: number }; places: Array<{ name: string; category: StoryPlace["category"]; lat: number; lon: number; visited: boolean }> }`.
- Produces: `seedBulk(userId: string): Promise<{ stays: number; places: number; lists: number }>`.

- [ ] **Step 1: Failing test**

```ts
// backend/src/__tests__/seedDemo.bulk.test.ts
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { BULK_CITIES } from "../seedDemo/bulk";
import { seedBulk } from "../seedDemo/seedBulk";

describe("seedBulk", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedBulkUser" } });
    userId = (await prisma.user.create({ data: { username: "seedBulkUser", passwordHash: await hashPassword("password123") } })).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("writes one stay per city, every place, and two lists with members", async () => {
    const result = await seedBulk(userId);
    expect(result.stays).toBe(BULK_CITIES.length);
    expect(result.places).toBe(BULK_CITIES.reduce((n, c) => n + c.places.length, 0));
    expect(result.lists).toBe(2);
    const lists = await prisma.placeList.findMany({ where: { userId }, include: { entries: true } });
    for (const list of lists) expect(list.entries.length, list.name).toBeGreaterThan(0);
    // Unattached: bulk rows belong to no trip.
    expect(await prisma.lodgingStay.count({ where: { userId, tripId: { not: null } } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `bulk.ts`** (20 cities, 20 stays, 60 places):

```ts
// backend/src/seedDemo/bulk.ts
import type { StoryPlace } from "./stories";

export interface BulkCity {
  city: string; country: string; iso: string;
  hotel: { name: string; type: "hotel" | "hostel" | "apartment" | "guesthouse"; stars: number | null; lat: number; lon: number; year: number; nights: number; price: number; currency: string; rating: number };
  places: Array<{ name: string; category: StoryPlace["category"]; lat: number; lon: number; visited: boolean }>;
}

/** Volume for statistics, maps and heatmaps: stays and places outside the narrated trips. */
export const BULK_CITIES: BulkCity[] = [
  { city: "Wien", country: "Austria", iso: "AT", hotel: { name: "Hotel Sacher", type: "hotel", stars: 5, lat: 48.2038, lon: 16.3694, year: 2019, nights: 2, price: 690, currency: "EUR", rating: 5 }, places: [
    { name: "Schloss Schönbrunn", category: "landmark", lat: 48.1845, lon: 16.3122, visited: true },
    { name: "Naschmarkt", category: "restaurant", lat: 48.1985, lon: 16.3638, visited: true },
    { name: "Albertina", category: "museum", lat: 48.2046, lon: 16.3681, visited: false } ] },
  { city: "Prag", country: "Czechia", iso: "CZ", hotel: { name: "Hotel Josef", type: "hotel", stars: 4, lat: 50.0901, lon: 14.4236, year: 2018, nights: 3, price: 420, currency: "EUR", rating: 4 }, places: [
    { name: "Karlsbrücke", category: "landmark", lat: 50.0865, lon: 14.4114, visited: true },
    { name: "Prager Burg", category: "landmark", lat: 50.0911, lon: 14.4016, visited: true },
    { name: "Letná-Park", category: "viewpoint", lat: 50.0963, lon: 14.4202, visited: true } ] },
  { city: "Paris", country: "France", iso: "FR", hotel: { name: "Hôtel des Grands Boulevards", type: "hotel", stars: 4, lat: 48.8713, lon: 2.3467, year: 2022, nights: 3, price: 810, currency: "EUR", rating: 4.5 }, places: [
    { name: "Louvre", category: "museum", lat: 48.8606, lon: 2.3376, visited: true },
    { name: "Montmartre", category: "viewpoint", lat: 48.8867, lon: 2.3431, visited: true },
    { name: "Musée d'Orsay", category: "museum", lat: 48.86, lon: 2.3266, visited: false } ] },
  { city: "London", country: "United Kingdom", iso: "GB", hotel: { name: "The Hoxton Southwark", type: "hotel", stars: 4, lat: 51.5049, lon: -0.1052, year: 2023, nights: 4, price: 980, currency: "GBP", rating: 4 }, places: [
    { name: "British Museum", category: "museum", lat: 51.5194, lon: -0.127, visited: true },
    { name: "Borough Market", category: "restaurant", lat: 51.5055, lon: -0.091, visited: true },
    { name: "Sky Garden", category: "viewpoint", lat: 51.5112, lon: -0.0836, visited: true } ] },
  { city: "Amsterdam", country: "Netherlands", iso: "NL", hotel: { name: "Pulitzer Amsterdam", type: "hotel", stars: 5, lat: 52.3729, lon: 4.8836, year: 2021, nights: 2, price: 740, currency: "EUR", rating: 4.5 }, places: [
    { name: "Rijksmuseum", category: "museum", lat: 52.36, lon: 4.8852, visited: true },
    { name: "Vondelpark", category: "nature", lat: 52.358, lon: 4.8686, visited: true },
    { name: "A'DAM Lookout", category: "viewpoint", lat: 52.3843, lon: 4.9018, visited: false } ] },
  { city: "Kopenhagen", country: "Denmark", iso: "DK", hotel: { name: "Generator Copenhagen", type: "hostel", stars: null, lat: 55.6842, lon: 12.5877, year: 2017, nights: 3, price: 210, currency: "DKK", rating: 3.5 }, places: [
    { name: "Nyhavn", category: "landmark", lat: 55.6798, lon: 12.5908, visited: true },
    { name: "Tivoli", category: "entertainment", lat: 55.6737, lon: 12.5681, visited: true },
    { name: "Torvehallerne", category: "restaurant", lat: 55.6838, lon: 12.5702, visited: true } ] },
  { city: "Stockholm", country: "Sweden", iso: "SE", hotel: { name: "Hotel Skeppsholmen", type: "hotel", stars: 4, lat: 59.3257, lon: 18.0842, year: 2022, nights: 3, price: 5400, currency: "SEK", rating: 4 }, places: [
    { name: "Vasa-Museum", category: "museum", lat: 59.328, lon: 18.0914, visited: true },
    { name: "Gamla stan", category: "landmark", lat: 59.3251, lon: 18.0711, visited: true },
    { name: "Fotografiska", category: "museum", lat: 59.3178, lon: 18.0856, visited: false } ] },
  { city: "Edinburgh", country: "United Kingdom", iso: "GB", hotel: { name: "Old Town Apartment", type: "apartment", stars: null, lat: 55.9496, lon: -3.1904, year: 2019, nights: 4, price: 640, currency: "GBP", rating: 4 }, places: [
    { name: "Edinburgh Castle", category: "landmark", lat: 55.9486, lon: -3.1999, visited: true },
    { name: "Arthur's Seat", category: "viewpoint", lat: 55.9441, lon: -3.1618, visited: true },
    { name: "The Royal Mile", category: "shopping", lat: 55.9503, lon: -3.1874, visited: true } ] },
  { city: "Lissabon", country: "Portugal", iso: "PT", hotel: { name: "Casa do Bairro", type: "guesthouse", stars: null, lat: 38.7136, lon: -9.1445, year: 2018, nights: 3, price: 330, currency: "EUR", rating: 4.5 }, places: [
    { name: "Miradouro da Senhora do Monte", category: "viewpoint", lat: 38.7193, lon: -9.1331, visited: true },
    { name: "Time Out Market", category: "restaurant", lat: 38.7071, lon: -9.1459, visited: true },
    { name: "Oceanário", category: "entertainment", lat: 38.7635, lon: -9.0937, visited: false } ] },
  { city: "Madrid", country: "Spain", iso: "ES", hotel: { name: "Hotel Urban", type: "hotel", stars: 5, lat: 40.4152, lon: -3.6989, year: 2020, nights: 2, price: 460, currency: "EUR", rating: 4 }, places: [
    { name: "Museo del Prado", category: "museum", lat: 40.4138, lon: -3.6921, visited: true },
    { name: "Retiro-Park", category: "nature", lat: 40.4153, lon: -3.6845, visited: true },
    { name: "Mercado de San Miguel", category: "restaurant", lat: 40.4154, lon: -3.7089, visited: true } ] },
  { city: "New York", country: "United States", iso: "US", hotel: { name: "The Standard High Line", type: "hotel", stars: 4, lat: 40.7408, lon: -74.0079, year: 2019, nights: 5, price: 2100, currency: "USD", rating: 4 }, places: [
    { name: "Central Park", category: "nature", lat: 40.7829, lon: -73.9654, visited: true },
    { name: "High Line", category: "nature", lat: 40.748, lon: -74.0048, visited: true },
    { name: "Metropolitan Museum of Art", category: "museum", lat: 40.7794, lon: -73.9632, visited: true } ] },
  { city: "San Francisco", country: "United States", iso: "US", hotel: { name: "Hotel Zephyr", type: "hotel", stars: 3, lat: 37.8078, lon: -122.4149, year: 2019, nights: 3, price: 890, currency: "USD", rating: 3.5 }, places: [
    { name: "Golden Gate Bridge", category: "landmark", lat: 37.8199, lon: -122.4783, visited: true },
    { name: "Alcatraz", category: "museum", lat: 37.827, lon: -122.423, visited: true },
    { name: "Ferry Building", category: "restaurant", lat: 37.7955, lon: -122.3937, visited: true } ] },
  { city: "Singapur", country: "Singapore", iso: "SG", hotel: { name: "Hotel Indigo Katong", type: "hotel", stars: 4, lat: 1.3052, lon: 103.9048, year: 2023, nights: 3, price: 980, currency: "SGD", rating: 4.5 }, places: [
    { name: "Gardens by the Bay", category: "nature", lat: 1.2816, lon: 103.8636, visited: true },
    { name: "Maxwell Food Centre", category: "restaurant", lat: 1.2803, lon: 103.8447, visited: true },
    { name: "Marina Bay Sands SkyPark", category: "viewpoint", lat: 1.2834, lon: 103.8607, visited: false } ] },
  { city: "Bangkok", country: "Thailand", iso: "TH", hotel: { name: "Riva Arun", type: "hotel", stars: 4, lat: 13.7437, lon: 100.4899, year: 2018, nights: 3, price: 14500, currency: "THB", rating: 4 }, places: [
    { name: "Wat Arun", category: "landmark", lat: 13.7437, lon: 100.4889, visited: true },
    { name: "Wat Pho", category: "landmark", lat: 13.7465, lon: 100.4927, visited: true },
    { name: "Chatuchak-Wochenendmarkt", category: "shopping", lat: 13.7999, lon: 100.5502, visited: true } ] },
  { city: "Sydney", country: "Australia", iso: "AU", hotel: { name: "QT Sydney", type: "hotel", stars: 5, lat: -33.8712, lon: 151.2073, year: 2020, nights: 4, price: 1650, currency: "AUD", rating: 4.5 }, places: [
    { name: "Sydney Opera House", category: "landmark", lat: -33.8568, lon: 151.2153, visited: true },
    { name: "Bondi Beach", category: "nature", lat: -33.8915, lon: 151.2767, visited: true },
    { name: "Blue Mountains", category: "nature", lat: -33.7153, lon: 150.3115, visited: false } ] },
  { city: "Kapstadt", country: "South Africa", iso: "ZA", hotel: { name: "Cape Heritage Hotel", type: "hotel", stars: 4, lat: -33.9176, lon: 18.4199, year: 2022, nights: 4, price: 12800, currency: "ZAR", rating: 4.5 }, places: [
    { name: "Tafelberg", category: "viewpoint", lat: -33.9628, lon: 18.4098, visited: true },
    { name: "Kap der Guten Hoffnung", category: "nature", lat: -34.3568, lon: 18.474, visited: true },
    { name: "Boulders Beach", category: "nature", lat: -34.1975, lon: 18.4518, visited: true } ] },
  { city: "Marrakesch", country: "Morocco", iso: "MA", hotel: { name: "Riad Kniza", type: "guesthouse", stars: null, lat: 31.6343, lon: -7.9941, year: 2017, nights: 3, price: 480, currency: "EUR", rating: 5 }, places: [
    { name: "Djemaa el Fna", category: "landmark", lat: 31.6258, lon: -7.9891, visited: true },
    { name: "Jardin Majorelle", category: "nature", lat: 31.6417, lon: -8.0033, visited: true },
    { name: "Bahia-Palast", category: "museum", lat: 31.6216, lon: -7.9832, visited: true } ] },
  { city: "Dubai", country: "United Arab Emirates", iso: "AE", hotel: { name: "Rove Downtown", type: "hotel", stars: 3, lat: 25.1932, lon: 55.2796, year: 2021, nights: 2, price: 1100, currency: "AED", rating: 3.5 }, places: [
    { name: "Burj Khalifa", category: "viewpoint", lat: 25.1972, lon: 55.2744, visited: true },
    { name: "Dubai Creek", category: "landmark", lat: 25.2644, lon: 55.3036, visited: true },
    { name: "Museum of the Future", category: "museum", lat: 25.2195, lon: 55.2818, visited: false } ] },
  { city: "Berlin", country: "Germany", iso: "DE", hotel: { name: "Michelberger Hotel", type: "hotel", stars: 3, lat: 52.5069, lon: 13.4466, year: 2024, nights: 2, price: 260, currency: "EUR", rating: 4 }, places: [
    { name: "Brandenburger Tor", category: "landmark", lat: 52.5163, lon: 13.3777, visited: true },
    { name: "East Side Gallery", category: "landmark", lat: 52.505, lon: 13.4397, visited: true },
    { name: "Pergamonmuseum", category: "museum", lat: 52.5212, lon: 13.3969, visited: false } ] },
  { city: "Hamburg", country: "Germany", iso: "DE", hotel: { name: "25hours Hotel HafenCity", type: "hotel", stars: 4, lat: 53.5429, lon: 9.9967, year: 2025, nights: 2, price: 310, currency: "EUR", rating: 4.5 }, places: [
    { name: "Elbphilharmonie", category: "entertainment", lat: 53.5413, lon: 9.9841, visited: true },
    { name: "Speicherstadt", category: "landmark", lat: 53.5436, lon: 9.9937, visited: true },
    { name: "Miniatur Wunderland", category: "entertainment", lat: 53.5437, lon: 9.9885, visited: true } ] },
];
```

- [ ] **Step 4: Write `seedBulk.ts`**

```ts
// backend/src/seedDemo/seedBulk.ts
import { prisma } from "../db";
import { BULK_CITIES } from "./bulk";

/** Stays and places outside the narrated trips, plus two user lists across them. */
export async function seedBulk(userId: string): Promise<{ stays: number; places: number; lists: number }> {
  let stays = 0;
  const placeIds: Array<{ id: string; category: string; visited: boolean }> = [];

  for (const [i, c] of BULK_CITIES.entries()) {
    const h = c.hotel;
    const lodging = await prisma.lodging.create({
      data: { userId, type: h.type, name: h.name, city: c.city, country: c.country, isoCountryCode: c.iso, lat: h.lat, lon: h.lon, stars: h.stars, dataSource: "manual" },
    });
    const checkIn = new Date(Date.UTC(h.year, (i * 5) % 12, 3 + (i % 20)));
    const checkOut = new Date(checkIn.getTime() + h.nights * 86_400_000);
    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id, userId, checkIn, checkOut, nights: h.nights, status: "completed",
        board: i % 3 === 0 ? "breakfast" : "none", guests: 2, currency: h.currency, totalPrice: h.price,
        ratingOverall: h.rating, dataSource: "manual",
      },
    });
    stays++;

    for (const p of c.places) {
      const place = await prisma.place.create({
        data: { userId, name: p.name, category: p.category, lat: p.lat, lon: p.lon, city: c.city, country: c.country, isoCountryCode: c.iso, visited: p.visited, dataSource: "manual" },
      });
      if (p.visited) {
        await prisma.placeVisit.create({ data: { placeId: place.id, userId, visitedAt: new Date(checkIn.getTime() + 86_400_000) } });
      }
      placeIds.push({ id: place.id, category: p.category, visited: p.visited });
    }
  }

  const lists = [
    { name: "Aussichtspunkte", color: "#60a5fa", icon: "🔭", members: placeIds.filter((p) => p.category === "viewpoint") },
    { name: "Nächstes Mal", color: "#f472b6", icon: "📌", members: placeIds.filter((p) => !p.visited) },
  ];
  for (const [sortIdx, l] of lists.entries()) {
    const list = await prisma.placeList.create({ data: { userId, name: l.name, color: l.color, icon: l.icon, sortIdx } });
    await prisma.placeListEntry.createMany({
      data: l.members.map((m, i) => ({ listId: list.id, placeId: m.id, sortIdx: i })),
    });
  }

  return { stays, places: placeIds.length, lists: lists.length };
}
```

- [ ] **Step 5: Run — expect PASS**; `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/seedDemo/bulk.ts backend/src/seedDemo/seedBulk.ts backend/src/__tests__/seedDemo.bulk.test.ts
git commit -m "feat(seed): bulk stays, places and place lists for the demo account

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire the seed together, prove it is idempotent

**Files:**
- Modify: `backend/src/seedDemoAccount.ts` (`main()` ~963, `seedTripsAndBookings` ~896, final counts)
- Test: `backend/src/__tests__/seedDemo.full.test.ts`

**Interfaces:**
- Consumes: `seedStories`, `seedBulk`, `ensureUser`, `loadPools`.
- Produces: `export async function runDemoSeed(): Promise<{ userId: string; counts: Record<string, number> }>` — `main()` calls it and prints.

- [ ] **Step 1: Failing test**

```ts
// backend/src/__tests__/seedDemo.full.test.ts
import { prisma } from "../db";
import { runDemoSeed } from "../seedDemoAccount";

/**
 * The whole standard demo seed, run twice. Every domain must have rows, and a
 * second run (the nightly reset) must land on exactly the same counts.
 * Removes the "demo" user afterwards — it is disposable by definition.
 */
describe("the standard demo seed", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "demo" } });
  });

  it("fills every domain and is idempotent", async () => {
    const first = await runDemoSeed();
    for (const [domain, count] of Object.entries(first.counts)) {
      expect(count, domain).toBeGreaterThan(0);
    }
    const second = await runDemoSeed();
    expect(second.userId).toBe(first.userId);
    expect(second.counts).toEqual(first.counts);
  }, 240_000);
});
```

- [ ] **Step 2: Run — expect FAIL** (`runDemoSeed` not exported)

- [ ] **Step 3: Implement**

In `seedDemoAccount.ts` import the modules and replace `main()`'s body up to the achievements step with `runDemoSeed`:

```ts
import { seedStories } from "./seedDemo/seedStories";
import { seedBulk } from "./seedDemo/seedBulk";

export async function runDemoSeed(): Promise<{ userId: string; counts: Record<string, number> }> {
  const userId = await ensureUser();
  await ensureUserSettings(userId);
  const { airports, ships, ports } = await loadPools();
  if (airports.size < 60) {
    throw new Error(`Expected 60+ airports in pool, got ${airports.size}. Run seedAirportsFromCSV first.`);
  }
  await seedFlights(userId, airports);
  await seedCruises(userId, ships, ports);
  await seedTripsAndBookings(userId);
  await seedStories(userId, airports);
  await seedBulk(userId);
  try {
    await checkAndUpdateAchievements(userId);
  } catch (err) {
    console.warn("   ! achievement recompute failed:", err);
  }
  const [flights, cruises, trips, stays, places, placeLists, tours, journal] = await Promise.all([
    prisma.flight.count({ where: { userId } }),
    prisma.cruise.count({ where: { userId } }),
    prisma.trip.count({ where: { userId } }),
    prisma.lodgingStay.count({ where: { userId } }),
    prisma.place.count({ where: { userId } }),
    prisma.placeList.count({ where: { userId } }),
    prisma.tripRoute.count({ where: { trip: { userId } } }),
    prisma.tripJournalEntry.count({ where: { trip: { userId } } }),
  ]);
  return { userId, counts: { flights, cruises, trips, stays, places, placeLists, tours, journal } };
}

async function main(): Promise<void> {
  console.log("🌱 Seeding demo account (demo / demo123) ...");
  const { counts } = await runDemoSeed();
  console.log("✅ Demo seed complete");
  for (const [k, v] of Object.entries(counts)) console.log(`   ${k}: ${v}`);
}
```

`ensureUserSettings` writes `enabledDomains: ["flight", "cruise"]` twice (create and update, ~485 and ~495): change both to `["flight", "cruise", "lodging", "poi"]`, and the log line in the old `main()` goes away with it. `seedTripsAndBookings` names trips "Japan 2022" and "Mittelmeer-Kreuzfahrt"; rename those two defs to "Tokio Kurztrip" and "Adria-Kreuzfahrt" so they do not look like duplicates of the narrated trips. Update the header comment's "Covers:" list.

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && DATABASE_URL=… npx jest src/__tests__/seedDemo src/__tests__/seedDemoAccount --forceExit`

- [ ] **Step 5: Full gates**

Run backend gate and frontend gate from Global Constraints, plus `node scripts/check-file-size.mjs`. Expected: all green. A single suite red only in the full backend run: rerun it alone before treating it as a regression.

- [ ] **Step 6: Commit and push**

```bash
git add backend/src
git commit -m "feat(seed): the standard demo seed fills every domain

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin dev/design-system && git push forgejo dev/design-system
```

---

### Task 9: Build `2.7.0-design.7`, roll out to CT134, nightly reset

**Files:** none in the repo except `roadmap.local.yaml` (main checkout, gitignored). Host facts: `CLAUDE.local.md` (pve-node1 `192.168.178.171`, CT134, slot dir `/opt/preview/beta`, containers `preview-beta`, `preview-beta-db`).

- [ ] **Step 1: Build and push the image** — follow the `travstats-deploy` skill's beta build for tag `2.7.0-design.7` from `dev/design-system` (multi-arch as for design.6). Verify: `docker buildx imagetools inspect ghcr.io/abrechen2/travstats:2.7.0-design.7` lists amd64.

- [ ] **Step 2: Back up and deploy**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -c 'cd /opt/preview/beta && docker exec preview-beta-db pg_dump -U flights -d flights -Fc -f /tmp/pre-design7.dump && cp .env .env.bak-pre-design7 && cp docker-compose.yml docker-compose.yml.bak-pre-design7'"
NODE1=192.168.178.171 bash scripts/preview/deploy-preview.sh beta 2.7.0-design.7
```

Expected: `health: {… "version":"2.7.0-design.7"}`, `public: 200`.

- [ ] **Step 3: Enable the flag and the beta switch**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -c 'cd /opt/preview/beta && grep -q PUBLIC_DEMO_LOGIN docker-compose.yml || sed -i \"s|      APP_VERSION: \\\${IMAGE_TAG}|      APP_VERSION: \\\${IMAGE_TAG}\n      PUBLIC_DEMO_LOGIN: \\\"true\\\"|\" docker-compose.yml && grep -n PUBLIC_DEMO_LOGIN docker-compose.yml && docker compose up -d && docker exec preview-beta-db psql -U flights -d flights -c \"UPDATE admin_settings SET beta_features_enabled = true\"'"
curl -s https://beta.travstats.de/api/v1/setup/status
```

Expected: the grep prints the new line; `setup/status` contains `"publicDemoLogin":true`. (Check the exact column name with `\d admin_settings` if the UPDATE fails.)

- [ ] **Step 4: Seed once**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- docker exec preview-beta sh -c 'cd /app/backend && node dist/seedDemoAccount.js'"
```

Expected: `✅ Demo seed complete` with every count > 0.

- [ ] **Step 5: Nightly reset**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -c 'echo \"0 4 * * * root docker exec preview-beta sh -c \\\"cd /app/backend && node dist/seedDemoAccount.js\\\" >> /opt/preview/beta/demo-reset.log 2>&1\" > /etc/cron.d/travstats-demo-reset && chmod 644 /etc/cron.d/travstats-demo-reset && cat /etc/cron.d/travstats-demo-reset'"
```

Expected: the file prints. The CT runs UTC (`date` inside CT134 to confirm).

- [ ] **Step 6: Browser check at 1440×900** — on `https://beta.travstats.de/login`: hint visible, "Demo-Daten eintragen" fills both fields, login works; `/flights`, `/cruises`, `/lodging`, `/places` non-empty; `/trips` shows the six narrated trips; "Island – Ringstraße" shows its tour on the map; `/places/checklists/world-heritage` shows progress; Settings → Sicherheit shows the locked notice; changing the password is impossible. Screenshot each into `.playwright-mcp/`.

- [ ] **Step 7: Leitstand** — in `D:\TravStats_Projekt\TravStats\roadmap.local.yaml` set the `preview-beta` instance `expect: "2.7.0-design.7"` with a comment naming the rollback files (`.env.bak-pre-design7`, `/tmp/pre-design7.dump`).
