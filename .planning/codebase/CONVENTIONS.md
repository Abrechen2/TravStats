# Coding Conventions

**Analysis Date:** 2026-04-03

## Naming Patterns

**Files:**
- React components: PascalCase `.tsx` (e.g., `FlightEditModal.tsx`, `DarkModeToggle.tsx`)
- Zustand stores: camelCase with `Store` suffix (e.g., `authStore.ts`, `settingsStore.ts`)
- Custom hooks: camelCase with `use` prefix in `hooks/` dir (e.g., `useTranslation.ts`, `useClickOutside.ts`)
- API client groupings: camelCase with `Api` suffix (e.g., `authApi`, `parseApi`, `settingsApi`)
- Backend route files: domain-named, one file per domain (e.g., `flights.ts`, `auth.ts`, `stats.ts`)
- Backend service files: camelCase, one service per concern (e.g., `co2Calculator.ts`, `flightLookup.ts`)
- Backend schema files: domain-named in `schemas/` (e.g., `flight.ts`, `auth.ts`, `admin.ts`)
- Test files co-located with routes/services or in `__tests__/` subdirectory: `*.test.ts` / `*.test.tsx`
- Mock files: in `src/__mocks__/` with matching module name

**Functions:**
- camelCase for all functions (e.g., `calculateCo2Kg`, `enrichFlightAirports`, `generateRequestId`)
- React components: PascalCase named exports (e.g., `export function FlightEditModal(...)`)
- Boolean-returning functions: `is`/`has`/`can` prefix (e.g., `isDebugEnabled`, `hasTrainingAccess`)

**Variables:**
- camelCase for locals and exported values
- `UPPER_SNAKE_CASE` for true constants/enums (e.g., `CABIN_FACTORS`, `ALLOWED_RECEIPT_DOMAINS`, `API_TIMEOUTS`)
- Underscore prefix `_` for intentionally unused parameters/variables (ESLint `argsIgnorePattern: '^_'`)

**Types/Interfaces:**
- PascalCase for all (e.g., `AuthState`, `ToastType`, `FlightUpdateData`)
- `type` for unions and primitives (e.g., `type ThemePreference = "light" | "dark"`)
- `interface` for object shapes (e.g., `interface AuthState`, `interface ApiError extends Error`)
- Zod-inferred types via `z.infer<typeof schema>` — always exported alongside schema (e.g., `export type LoginInput = z.infer<typeof loginSchema>`)

## Code Style

**Formatting (Prettier — `frontend/.prettierrc`):**
- `semi: true` — always semicolons
- `singleQuote: false` — double quotes for strings
- `printWidth: 100` — 100-character line limit
- `tabWidth: 2` — 2-space indentation
- `trailingComma: "es5"` — trailing commas where valid in ES5
- `arrowParens: "always"` — always parenthesize arrow function args
- Backend follows the same style (no separate `.prettierrc`, enforced via ESLint + Prettier integration)

**Linting:**
- Backend: `@typescript-eslint/eslint-plugin` with `@typescript-eslint/no-explicit-any: warn` — `any` is forbidden in production code; use `unknown` + type guards
- Frontend: `typescript-eslint` recommended + `react-hooks` plugin; `@typescript-eslint/no-unused-vars: error` with underscore-prefix ignore patterns
- Exception: `.d.ts` files may use `any` and `{}` types (`@typescript-eslint/no-explicit-any: off` for `**/*.d.ts`)
- `react/react-in-jsx-scope: off` — no need to import React in scope

## TypeScript Strictness

Both `backend/tsconfig.json` and `frontend/tsconfig.json` use `"strict": true`.

Frontend adds:
- `"noUnusedLocals": true`
- `"noUnusedParameters": true`
- `"noFallthroughCasesInSwitch": true`

Backend adds:
- `"forceConsistentCasingInFileNames": true`
- `"types": ["node", "jest"]`

**Critical rule:** `any` is BANNED in production source code. Always use `unknown` with type narrowing:
```typescript
// WRONG
function handle(data: any) { ... }

// CORRECT
function handle(data: unknown) {
  if (typeof data === "string") { ... }
}

// For Prisma JSON fields:
someField: data as unknown as Prisma.InputJsonValue
```

## Import Organization

**Order (frontend):**
1. External libraries (`react`, `axios`, `zustand`, etc.)
2. Internal types (`../types`)
3. Store imports (`../store/authStore`)
4. Lib imports (`../lib/api`, `../lib/logger`)
5. Component imports (`../components/...`)
6. Hook imports (`../hooks/useTranslation`)

**Path Aliases:**
- Frontend: `@/*` maps to `./src/*` (configured in `frontend/tsconfig.json` and `frontend/vitest.config.ts`)
- Backend: No path aliases; uses relative imports

## Error Handling

**Backend pattern — `AppError` for intentional HTTP errors:**
```typescript
import { AppError } from '../middleware/errorHandler';

// Throw typed errors in route handlers; the global errorHandler catches them
if (!user) {
  throw new AppError('User not found', 404);
}
```

**Backend global error handler** (`backend/src/middleware/errorHandler.ts`):
- Handles both `AppError` (custom HTTP errors) and `ZodError` (validation failures)
- Zod errors → 400 with field-level detail
- Stack trace only exposed in development mode
- All errors logged via Pino with request context

**Frontend pattern — try/catch with logger:**
```typescript
try {
  const result = await authApi.logout();
} catch (error) {
  logger.error("Logout error:", error);
} finally {
  set({ user: null });
}
```

**API 401 handling:** Response interceptor in `frontend/src/lib/api.ts` dispatches `auth:unauthorized` custom event; `authStore.ts` listens for it to trigger logout. Avoids circular dependency between `api.ts` and store.

**Rules:**
- Never silently swallow errors
- Always `async/await` — no `.then()` chains
- Log errors at the level where context is known (server-side detail, user-friendly message client-side)
- `finally` blocks for mandatory cleanup (e.g., clearing auth state)

## Logging

**Backend — Pino structured logger** (`backend/src/utils/logger.ts`):
- Default logger: `import logger from '../utils/logger'`
- Category loggers for domain-specific output: `httpLogger`, `dbLogger`, `parserLogger`, `securityLogger`, `systemLogger`
- `PerformanceTracker` class for timing operations
- Log format: structured JSON with `timestamp`, `level`, `category`, `message`, `context`, `performance`
- Sensitive fields auto-redacted: `password`, `token`, `apiKey`, `authorization`, `cookie`
- Log level controlled by `LOG_LEVEL` env var; defaults to `debug` in dev, `info` in prod

```typescript
import logger from '../utils/logger';
import { securityLogger } from '../utils/logger';

logger.info({ category: 'flights', operation: 'create_flight', context: { userId } });
securityLogger.warn({ operation: 'security_event', context: { eventType: 'auth_failure', ip } });
```

**Frontend — simple environment-aware logger** (`frontend/src/lib/logger.ts`):
- `import { logger } from '../lib/logger'`
- `logger.debug/info` only log in development mode
- `logger.warn/error` always log
- Never use `console.log` directly in component/store code

## Validation (Zod)

All user inputs and API boundaries are validated with Zod schemas located in `backend/src/schemas/`.

**Pattern:**
```typescript
// Schema definition in backend/src/schemas/auth.ts
export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Usage in route
const input = loginSchema.parse(req.body);  // throws ZodError on failure → 400
```

**Schema patterns observed:**
- `.partial().refine(...)` for PATCH endpoints (at least one field required)
- `.refine(...)` for cross-field business rules (e.g., flight time range validation)
- `.coerce.number()` for query params that arrive as strings
- `.optional().nullable()` for fields that can be absent or null
- Custom validators using `.refine()` with detailed error messages

## State Management (Zustand)

All global state lives in `frontend/src/store/`.

**Pattern:**
```typescript
// Define state interface + actions in one interface
interface AuthState {
  user: User | null;
  setAuth: (user: User) => void;
  logout: () => Promise<void>;
}

// Create store with create<T>()
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      setAuth: (user) => set({ user }),     // always use set() — immutable
      logout: async () => {
        try { await authApi.logout(); }
        catch (error) { logger.error("Logout error:", error); }
        finally { set({ user: null }); }
      },
    }),
    { name: "auth-storage" }
  )
);
```

**Rules:**
- Always use `set(...)` — never mutate state directly
- Use `set((state) => ({ ... }))` for state derived from previous state (e.g., array updates)
- Use `get()` when you need current state inside an action
- `persist` middleware used for: `authStore` (user only, no token), `settingsStore`, `themeStore`
- `partialize` to exclude sensitive/transient fields from persistence

**Stores:**
- `authStore.ts` — user session, logout
- `settingsStore.ts` — display/units/defaults/map preferences, remote sync
- `themeStore.ts` — dark mode toggle
- `toastStore.ts` — toast notification queue

## API Client Pattern

All HTTP calls go through `frontend/src/lib/api.ts`. Three Axios instances with different timeouts:

| Instance | Timeout | Use |
|---|---|---|
| `api` (internal) | `API_TIMEOUTS.DEFAULT` (10s) | All standard requests |
| `parserApi` | `API_TIMEOUTS.PARSER` (180s) | AI/OCR parser calls |
| `hardwareApi` | `API_TIMEOUTS.HARDWARE` (35s) | Hardware info endpoints |

All instances use `withCredentials: true` for HttpOnly JWT cookies.

**API is organized into domain objects:**
```typescript
export const authApi = { register, login, logout, changePassword };
export const flightsApi = { getFlights, createFlight, updateFlight, deleteFlight, ... };
export const parseApi = { parseEmail, parseEmailFile, parseBoardingpass, parsePdf, ... };
export const settingsApi = { getSettings, updateSettings, ... };
// etc.
```

**Shared interfaces** are defined at the top of `api.ts` and exported for component use.

## i18n

**Framework:** `react-i18next` with synchronous initialization (no Suspense).

**Key rules:**
- Import `useTranslation` from `'../hooks/useTranslation'` — NOT directly from `react-i18next`
- The custom hook (`frontend/src/hooks/useTranslation.ts`) syncs language from `settingsStore` to i18n
- Namespaces: `common`, `dashboard`, `settings`, `flights`, `auth`, `admin`, `training`, `errors`, `achievements`, `stats`, `setup`, `onboarding`, `map`, `pendingUpdates`, `parser`
- Translation files: `frontend/src/i18n/resources/{de,en}/{namespace}.json`
- Default namespace: `common` (no prefix needed for common keys)
- Cross-namespace: `t('flights:label.airline')` with colon separator
- Nested keys use dot separator: `t('section.subsection.key')`
- Language options: `"en"` | `"de"` only

## Immutability

**Mandatory:** Never mutate objects in place. Always create new objects:

```typescript
// WRONG
state.user = null;

// CORRECT (Zustand)
set({ user: null });
set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
```

## Module Design

**Exports:**
- Named exports preferred throughout — default exports only for React components (implicit by React convention) and the Pino logger instance
- No barrel (`index.ts`) files — import directly from the file

**Function size:** Functions are kept small (< 50 lines); extraction to utility files when logic is reusable.

---

*Convention analysis: 2026-04-03*
