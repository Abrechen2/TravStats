# Testing Patterns

**Analysis Date:** 2026-04-03

## Test Frameworks

**Backend — Jest:**
- Runner: Jest with `ts-jest` preset
- Config: `backend/jest.config.js`
- Environment: `node`
- Type-checking in tests is disabled (`ts-jest.diagnostics: false`) — type safety enforced via `tsc --noEmit` separately

**Frontend — Vitest:**
- Runner: Vitest with `@vitejs/plugin-react`
- Config: `frontend/vitest.config.ts`
- Environment: `jsdom`
- Setup file: `frontend/src/__tests__/setup.ts`
- Globals: enabled (`globals: true`) — no need to import `describe`, `it`, `expect`

**E2E — Playwright:**
- Config: `playwright.config.ts` (project root)
- Not regularly run; for critical user flows

**Run Commands:**
```bash
# Frontend (no DB required)
cd frontend && npx vitest --run              # Run all tests once
cd frontend && npx vitest                   # Watch mode
cd frontend && npx vitest --run --coverage  # With coverage report

# Backend (requires PostgreSQL running)
cd backend && npm test -- --forceExit       # Run all tests
cd backend && npm test -- --coverage --forceExit  # With coverage

# All tests
bash scripts/run-tests.sh                   # or scripts/run-tests.ps1
```

## Coverage Thresholds

**Backend (`backend/jest.config.js`):**
- branches: 50%
- functions: 50%
- lines: 50%
- statements: 50%

Coverage excludes: `*.d.ts`, `*.test.ts`, `src/__tests__/**`, `src/__mocks__/**`, `src/index.ts`, `src/init.ts`

**Frontend (`frontend/vitest.config.ts`):**
- lines: 30%
- functions: 20%
- branches: 20%

Coverage excludes: `src/__tests__/**`, `*.test.*`, `src/main.tsx`, `src/vite-env.d.ts`, `*.d.ts`, `*.config.*`, `src/i18n/resources/**`

Coverage reporters: `text`, `lcov`, `html`, `json-summary` (both)

## Test File Organization

**Backend:**
- Broad integration tests: `backend/src/__tests__/*.test.ts`
- Route-level tests: co-located with route files (e.g., `backend/src/routes/stats.airlines.test.ts`)
- Service-level tests: `backend/src/services/__tests__/*.test.ts`
- Deep unit tests: `backend/src/__tests__/templates/` for template engine sub-components

**Frontend:**
- Main test directory: `frontend/src/__tests__/`
- Component tests: `frontend/src/__tests__/components/`
- Layer tests (deck.gl): `frontend/src/__tests__/layers/`
- Co-located tests for lib utilities: `frontend/src/lib/*.test.ts`
- Component-co-located tests: `frontend/src/components/Stats/*.test.tsx`

**Naming:**
- Backend: `*.test.ts`
- Frontend: `*.test.ts` / `*.test.tsx`
- No `.spec.*` files in active use

## Setup File

`frontend/src/__tests__/setup.ts` provides global mocks for all frontend tests:

```typescript
import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend Vitest with jest-dom matchers
expect.extend(matchers);

// Global react-i18next mock — t(key) returns the key unchanged
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn().mockResolvedValue(undefined), isInitialized: true },
  }),
  Trans: ({ children }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// Global settingsStore mock (required by useTranslation hook)
vi.mock("../store/settingsStore", async () => {
  const actual = await vi.importActual("../store/settingsStore");
  return {
    ...actual,
    useSettingsStore: vi.fn((selector?) => {
      const defaultState = { display: { language: "en" }, units: { currency: "EUR", distance: "km" }, ... };
      return typeof selector === "function" ? selector(defaultState) : defaultState;
    }),
  };
});

afterEach(() => { cleanup(); });
```

All frontend tests inherit these mocks automatically.

## Test Structure

**Suite organization:**
```typescript
describe("Domain / Component", () => {
  describe("sub-feature or method", () => {
    beforeEach(() => { /* reset state */ });
    afterEach(() => { /* cleanup */ });

    it("should <expected behavior>", () => {
      // arrange → act → assert
    });
  });
});
```

**Backend integration tests** use `supertest` against the real Express app:
```typescript
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('Flights API', () => {
  let authCookie: string;

  beforeAll(async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'flighttest', password: 'password123' });
    authCookie = response.headers['set-cookie'][0];
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  });

  it('should create a flight', async () => {
    const response = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', authCookie)
      .send({ ... })
      .expect(201);
    expect(response.body).toHaveProperty('flight');
  });
});
```

**Frontend component tests** use `@testing-library/react`:
```typescript
import { render } from "@testing-library/react";
import FlightEditModal from "../../components/FlightEditModal";

describe("FlightEditModal", () => {
  it("renders actual departure input when open", () => {
    render(<FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(document.querySelector("#actualDeparture")).toBeTruthy();
  });
});
```

**Frontend store tests** use `renderHook` + `act`:
```typescript
import { renderHook, act } from "@testing-library/react";
import { useAuthStore } from "../store/authStore";

it("should set user on login", () => {
  const { result } = renderHook(() => useAuthStore());
  act(() => { result.current.setAuth(mockUser); });
  expect(result.current.user).toEqual(mockUser);
});
```

## Mocking

**Backend — Jest mocks:**
```typescript
// Inline factory function (avoids jest hoisting TDZ issues)
jest.mock('../utils/logger', () => {
  return {
    __esModule: true,
    default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    securityLogger: { warn: jest.fn(), error: jest.fn() },
    // ... all named exports
  };
});
```

**Frontend — Vitest mocks:**
```typescript
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../lib/api", () => ({
  authApi: { logout: vi.fn().mockResolvedValue({}) },
}));
```

**Module mock reset:**
```typescript
beforeEach(() => {
  useAuthStore.setState({ user: null });  // Reset Zustand store state directly
  localStorage.clear();
});
```

**Static module mocks (backend):**
- `backend/src/__mocks__/uuid.ts` — deterministic UUID counter for test repeatability
- `backend/src/__mocks__/webdav.ts` — mock WebDAV client
- Registered via `moduleNameMapper` in `jest.config.js`

**What to mock:**
- Logger (always — avoids file system writes in tests)
- External API clients (`authApi`, `flightsApi`, etc.)
- `react-i18next` (globally via setup file)
- `settingsStore` (globally via setup file — required by `useTranslation` hook)
- Third-party integrations (WebDAV, uuid)

**What NOT to mock:**
- Business logic under test (services, utils)
- Zod schemas
- Zustand store logic (test actual store behavior via `renderHook`)
- TypeScript types

## Test Data / Fixtures

No separate fixture files. Test data is defined inline as `const` objects:

```typescript
const mockFlight: Flight = {
  id: "1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH123",
  depLat: 50.033,
  depLon: 8.571,
  arrLat: 48.354,
  arrLon: 11.786,
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T11:00:00.000Z",
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
};
```

Backend integration tests create real DB records in `beforeAll` and delete them in `afterAll`.

## Test Types

**Unit Tests (backend):**
- Service logic: `backend/src/services/__tests__/co2Calculator.test.ts`
- Utilities: `backend/src/__tests__/utils.geo.test.ts`
- Middleware: `backend/src/__tests__/middleware.test.ts`
- Template engine: `backend/src/__tests__/templates/`
- Parser subsystems: `backend/src/services/parsers/userTemplates/__tests__/`

**Integration Tests (backend):**
- Full HTTP routes tested via `supertest` against the real app + real PostgreSQL
- Files: `backend/src/__tests__/flights.test.ts`, `auth.test.ts`, `achievements.test.ts`, etc.
- Require running DB — skipped/fail in CI without Postgres

**Unit Tests (frontend):**
- Zustand stores: `frontend/src/__tests__/stores.test.ts`
- Custom hooks: `frontend/src/__tests__/hooks.test.tsx`
- Components (render + DOM assertions): `frontend/src/__tests__/components/`
- deck.gl layer factories: `frontend/src/__tests__/layers/`
- API client functions: `frontend/src/lib/api.stats.test.ts`, `api.parseLog.test.ts`
- Utility libraries: `frontend/src/lib/yearReportPdf.test.ts`

**E2E Tests:**
- Playwright, config at `playwright.config.ts`
- Not part of the standard test run — run separately for critical flows

## Async Testing Patterns

**Async actions in stores:**
```typescript
await act(async () => {
  await result.current.logout();
});
expect(result.current.user).toBeNull();
```

**Timer-based testing:**
```typescript
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); });

act(() => { vi.advanceTimersByTime(5000); });
expect(result.current.toasts).toHaveLength(0);
```

**Error scenario testing:**
```typescript
const mockLogout = authApi.logout as unknown as { mockRejectedValueOnce: (err: Error) => void };
mockLogout.mockRejectedValueOnce(new Error("API error"));

await act(async () => { await result.current.logout(); });
expect(result.current.user).toBeNull();  // should clear user even if API fails
```

## Key Test File Paths

| What | Path |
|---|---|
| Frontend setup | `frontend/src/__tests__/setup.ts` |
| Vitest config | `frontend/vitest.config.ts` |
| Jest config | `backend/jest.config.js` |
| Backend mocks | `backend/src/__mocks__/` |
| Store tests | `frontend/src/__tests__/stores.test.ts` |
| Hook tests | `frontend/src/__tests__/hooks.test.tsx` |
| Auth integration | `backend/src/__tests__/auth.test.ts` |
| Flights integration | `backend/src/__tests__/flights.test.ts` |
| CO2 unit test | `backend/src/services/__tests__/co2Calculator.test.ts` |
| Security tests | `backend/src/__tests__/security.test.ts` |
| API client tests | `frontend/src/lib/api.stats.test.ts` |

---

*Testing analysis: 2026-04-03*
