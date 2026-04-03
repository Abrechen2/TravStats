# Codebase Cleanup & Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate dead code, split oversized files (10.300 Zeilen in 6 Dateien), fix silent bugs, and add missing rate-limit protection — without changing any visible behavior.

**Architecture:** Each phase is fully independent and produces a green build on its own. Execute phases in order; skip or defer any phase without breaking others. All splits use barrel exports so existing imports continue to work unchanged.

**Tech Stack:** TypeScript strict, Express/Prisma backend, React/Vite frontend, Jest (backend), Vitest (frontend), Zod validation

---

## Scope Note

This plan covers 6 independent subsystems. Each **Phase** can be its own PR:
- **Phase 1** — Dead code elimination (training pipeline)
- **Phase 2** — Backend route split (`admin.ts` → 6 sub-files)
- **Phase 3** — Backend parser split (`parsers/factory.ts` → 4 files)
- **Phase 4** — Frontend API split (`api.ts` → domain files)
- **Phase 5** — Frontend page splits (3 giant page components)
- **Phase 6** — Bug fixes & quick wins

---

## File Structure Overview

### Phase 1 — Deletions

```
DELETE  backend/src/services/trainingService.ts        (1726 lines)
DELETE  backend/src/services/annotationService.ts      (referenced only by trainingService)
DELETE  backend/src/routes/training.ts                 (321 lines)
DELETE  backend/cancel-job.js
DELETE  backend/check_running_jobs.js
DELETE  backend/extract_emails.js
DELETE  backend/mini-test.ts
MODIFY  backend/src/services/modelManager.ts           (remove archivePreviousModel, validateModel)
MODIFY  backend/src/routes/admin.ts                    (inline getTrainingConfig, remove training-access route)
MODIFY  backend/src/middleware/rateLimit.ts            (remove trainingTriggerLimiter export)
MODIFY  backend/src/index.ts                           (remove trainingRoutes import/use)
```

### Phase 2 — Backend Route Split

```
CREATE  backend/src/routes/admin/index.ts              (~60 lines, router assembly)
CREATE  backend/src/routes/admin/system.ts             (~120 lines, system-info, hardware, export)
CREATE  backend/src/routes/admin/users.ts              (~160 lines, users + invitations)
CREATE  backend/src/routes/admin/parseLogs.ts          (~200 lines, parse-logs + parser-feedback)
CREATE  backend/src/routes/admin/apiKeys.ts            (~220 lines, api-keys + test endpoints)
CREATE  backend/src/routes/admin/logging.ts            (~160 lines, logging endpoints)
CREATE  backend/src/routes/admin/parserSettings.ts     (~180 lines, parser-settings + training-config)
DELETE  backend/src/routes/admin.ts                    (replaced by admin/index.ts)
```

### Phase 3 — Parser Factory Split

```
CREATE  backend/src/services/parsers/config.ts         (~130 lines, getParserConfig, availability)
CREATE  backend/src/services/parsers/boardingPass.ts   (~280 lines, parseBoardingPass + helpers)
CREATE  backend/src/services/parsers/email.ts          (~420 lines, parseEmail + helpers)
MODIFY  backend/src/services/parsers/factory.ts        (thin orchestrator: getVisionParser, getTextParser, getAvailableProviders, re-exports)
```

### Phase 4 — Frontend API Split

```
CREATE  frontend/src/lib/api/types.ts                  (all shared interfaces)
CREATE  frontend/src/lib/api/client.ts                 (axios instances + interceptors)
CREATE  frontend/src/lib/api/auth.ts                   (authApi)
CREATE  frontend/src/lib/api/parse.ts                  (parseApi)
CREATE  frontend/src/lib/api/flights.ts                (flightsApi)
CREATE  frontend/src/lib/api/stats.ts                  (statsApi + stats types)
CREATE  frontend/src/lib/api/airports.ts               (airportsApi + Airport interface)
CREATE  frontend/src/lib/api/achievements.ts           (achievementsApi)
CREATE  frontend/src/lib/api/settings.ts               (settingsApi + SmtpConfig/NotificationPreferences types)
CREATE  frontend/src/lib/api/admin.ts                  (adminApi)
CREATE  frontend/src/lib/api/notifications.ts          (notificationsApi)
CREATE  frontend/src/lib/api/pendingUpdates.ts         (pendingUpdatesApi + PendingUpdate types)
CREATE  frontend/src/lib/api/uploads.ts                (uploadsApi)
CREATE  frontend/src/lib/api/setup.ts                  (setupApi)
CREATE  frontend/src/lib/api/analytics.ts              (analyticsApi)
CREATE  frontend/src/lib/api/index.ts                  (barrel — re-exports everything, backward-compatible)
DELETE  frontend/src/lib/api.ts                        (replaced by api/index.ts barrel)
```

### Phase 5 — Frontend Page Splits

```
CREATE  frontend/src/components/Stats/StatsYearFilter.tsx
CREATE  frontend/src/components/Stats/StatsOverviewCards.tsx
CREATE  frontend/src/components/Stats/StatsChartsSection.tsx
CREATE  frontend/src/components/Stats/StatsCalendarSection.tsx
MODIFY  frontend/src/pages/AdvancedStatsPage.tsx       (orchestrator, ~300 lines)

CREATE  frontend/src/components/Settings/ProfileSection.tsx
CREATE  frontend/src/components/Settings/DisplaySection.tsx
CREATE  frontend/src/components/Settings/UnitsSection.tsx
CREATE  frontend/src/components/Settings/DefaultsSection.tsx
CREATE  frontend/src/components/Settings/MapSection.tsx
CREATE  frontend/src/components/Settings/NotificationsSection.tsx
CREATE  frontend/src/components/Settings/BackupSection.tsx
MODIFY  frontend/src/pages/SettingsPage.tsx            (orchestrator, ~300 lines)

CREATE  frontend/src/components/FlightForm/FlightLookupStep.tsx
CREATE  frontend/src/components/FlightForm/FlightSelectStep.tsx
CREATE  frontend/src/components/FlightForm/FlightCompleteStep.tsx
MODIFY  frontend/src/components/SimplifiedFlightFormV2.tsx  (orchestrator, ~200 lines)
```

### Phase 6 — Bug Fixes

```
MODIFY  frontend/src/components/Filters.tsx            (while-true guard)
MODIFY  frontend/src/components/Stats.tsx              (while-true guard)
MODIFY  frontend/src/pages/AdvancedStatsPage.tsx       (while-true guard)
MODIFY  frontend/src/pages/FlightsTablePage.tsx        (while-true guard)
MODIFY  backend/src/routes/emailParse.ts               (add emailParseLimiter)
MODIFY  backend/src/middleware/rateLimit.ts            (add emailParseLimiter export)
MODIFY  backend/src/services/backupService.ts          (console.warn → logger.warn)
MODIFY  frontend/src/components/ErrorBoundary.tsx      (add import.meta.env.DEV guard)
MODIFY  backend/.gitignore                             (add data/training/)
```

---

## Phase 1: Dead Code Elimination

**Goal:** Delete the training pipeline (1726 + 321 + ~300 lines), orphaned scripts, and dead middleware.

### Task 1.1: Verify current build is green

**Files:** (no changes)

- [ ] **Step 1: Run backend build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```
  Expected: 0 errors

- [ ] **Step 2: Run frontend build check**
  ```bash
  cd ../frontend && npx tsc --noEmit
  ```
  Expected: 0 errors

- [ ] **Step 3: Run frontend tests**
  ```bash
  npx vitest --run
  ```
  Expected: all pass

---

### Task 1.2: Remove training routes from Express app

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/src/routes/training.ts` (delete after index.ts is clean)

- [ ] **Step 1: Remove trainingRoutes from index.ts**

  In `backend/src/index.ts`, remove line 24:
  ```typescript
  import trainingRoutes from './routes/training';
  ```
  And remove the `app.use(...)` line that registers it. Find it with:
  ```bash
  grep -n "trainingRoutes" backend/src/index.ts
  ```
  Delete both lines.

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```
  Expected: 0 errors (training.ts may still emit type errors — that's fine, it's about to be deleted)

- [ ] **Step 3: Delete training.ts route file**
  ```bash
  rm backend/src/routes/training.ts
  ```

- [ ] **Step 4: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```
  Expected: 0 errors

---

### Task 1.3: Inline getTrainingConfig and remove training-access route from admin.ts

**Files:**
- Modify: `backend/src/routes/admin.ts`

- [ ] **Step 1: Remove training-access route (lines ~243–288)**

  Remove the entire block:
  ```typescript
  router.put('/users/:id/training-access', ...)
  ```
  Also remove `trainingAccessSchema` (around line 98) and any related interfaces.

- [ ] **Step 2: Replace dynamic import of getTrainingConfig with inline implementation**

  The training-config routes (GET + PUT, lines ~578–679) use `await import('../services/trainingService')`.
  Replace each dynamic import:
  ```typescript
  // BEFORE
  const { getTrainingConfig } = await import('../services/trainingService');
  const trainingConfig = await getTrainingConfig();
  ```
  With inline logic:
  ```typescript
  // AFTER — inline, no import needed
  const trainingModelOutputDir = adminSettings?.trainingModelOutputDir
    || process.env.TRAINING_MODEL_OUTPUT_DIR || './data/training/models';
  const trainingEmailModelName = adminSettings?.trainingEmailModelName
    || process.env.TRAINING_EMAIL_MODEL_NAME || 'travstats-email-custom';
  const trainingVisionModelName = adminSettings?.trainingVisionModelName
    || process.env.TRAINING_VISION_MODEL_NAME || 'travstats-vision-custom';
  ```
  Update the response objects in GET and PUT to use these local variables instead of `trainingConfig.modelOutputDir` etc.

  Note: The directory-existence logic from `getTrainingConfig` can be dropped — it was a side-effect of fetching config, not something the route actually needed.

- [ ] **Step 3: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```
  Expected: 0 errors

---

### Task 1.4: Delete trainingService.ts and annotationService.ts

**Files:**
- Delete: `backend/src/services/trainingService.ts`
- Delete: `backend/src/services/annotationService.ts`

- [ ] **Step 1: Verify nothing imports trainingService except admin.ts (already fixed)**
  ```bash
  grep -r "trainingService" backend/src --include="*.ts" -l
  ```
  Expected: no output (admin.ts dynamic import was removed in Task 1.3)

- [ ] **Step 2: Verify nothing imports annotationService**
  ```bash
  grep -r "annotationService" backend/src --include="*.ts" -l
  ```
  Expected: only `trainingService.ts` itself (already being deleted)

- [ ] **Step 3: Delete files**
  ```bash
  rm backend/src/services/trainingService.ts
  rm backend/src/services/annotationService.ts
  ```

- [ ] **Step 4: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```
  Expected: 0 errors

---

### Task 1.5: Trim modelManager.ts

**Files:**
- Modify: `backend/src/services/modelManager.ts`

- [ ] **Step 1: Check what's still used**
  ```bash
  grep -r "modelManager\|archivePreviousModel\|validateModel" backend/src --include="*.ts" | grep -v "modelManager.ts"
  ```
  Expected: no hits (since trainingService is deleted)

- [ ] **Step 2: Remove dead exports**

  Open `backend/src/services/modelManager.ts` and delete:
  - `archivePreviousModel` function and its helpers
  - `validateModel` function and its helpers

  Keep any functions that appear in the grep above.

- [ ] **Step 3: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 1.6: Remove trainingTriggerLimiter from rateLimit.ts

**Files:**
- Modify: `backend/src/middleware/rateLimit.ts`

- [ ] **Step 1: Verify it's unused**
  ```bash
  grep -r "trainingTriggerLimiter" backend/src --include="*.ts" | grep -v "rateLimit.ts"
  ```
  Expected: no output

- [ ] **Step 2: Delete the export**

  Remove the `export const trainingTriggerLimiter = ...` block from `backend/src/middleware/rateLimit.ts`.

- [ ] **Step 3: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 1.7: Delete debug scripts

**Files:**
- Delete: `backend/cancel-job.js`, `backend/check_running_jobs.js`, `backend/extract_emails.js`, `backend/mini-test.ts`

- [ ] **Step 1: Delete**
  ```bash
  rm backend/cancel-job.js backend/check_running_jobs.js backend/extract_emails.js backend/mini-test.ts
  ```

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 1.8: Final check and commit

- [ ] **Step 1: Full backend build check**
  ```bash
  cd backend && npx tsc --noEmit && npm run lint
  ```

- [ ] **Step 2: Frontend tests**
  ```bash
  cd frontend && npx vitest --run
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add -A
  git commit -m "refactor: delete training pipeline dead code (trainingService, annotationService, training routes, debug scripts)"
  ```

---

## Phase 2: Backend Route Split — admin.ts

**Goal:** Split `backend/src/routes/admin.ts` (1186 lines) into 6 domain-focused files under `backend/src/routes/admin/`.

### Task 2.1: Create admin/ directory structure

**Files:**
- Create: `backend/src/routes/admin/` (directory)

- [ ] **Step 1: Create directory**
  ```bash
  mkdir backend/src/routes/admin
  ```

---

### Task 2.2: Extract system routes

**Files:**
- Create: `backend/src/routes/admin/system.ts`

Contains:
- `GET /system/info` (lines ~137–168)
- `GET /system/hardware` (lines ~169–179)
- `GET /export/all-data` (lines ~348–377)

- [ ] **Step 1: Create `backend/src/routes/admin/system.ts`**

  ```typescript
  import { Router, Response, NextFunction } from 'express';
  import { adminExportLimiter } from '../../middleware/rateLimit';
  import { prisma } from '../../db';
  import { AppError } from '../../middleware/errorHandler';
  import { AuthRequest } from '../../middleware/auth';
  import logger from '../../utils/logger';
  // ... other imports as needed by the moved routes

  const router = Router();

  // Paste GET /system/info handler here
  // Paste GET /system/hardware handler here
  // Paste GET /export/all-data handler here

  export default router;
  ```

  Then copy the exact handler bodies from `admin.ts` into this file (no logic changes, only moved).

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 2.3: Extract users routes

**Files:**
- Create: `backend/src/routes/admin/users.ts`

Contains:
- `GET /users` (lines ~179–207)
- `PATCH /users/:id/toggle-active` (lines ~207–243)
- `POST /invitations` (lines ~289–322)
- `GET /invitations` (lines ~322–348)

- [ ] **Step 1: Create `backend/src/routes/admin/users.ts`**

  ```typescript
  import { Router, Response, NextFunction } from 'express';
  import { z } from 'zod';
  import { prisma } from '../../db';
  import { AppError } from '../../middleware/errorHandler';
  import { AuthRequest } from '../../middleware/auth';
  import logger from '../../utils/logger';
  // ... other imports as needed

  const router = Router();

  // Paste GET /users handler
  // Paste PATCH /users/:id/toggle-active handler
  // Paste POST /invitations handler
  // Paste GET /invitations handler

  export default router;
  ```

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 2.4: Extract parse-logs routes

**Files:**
- Create: `backend/src/routes/admin/parseLogs.ts`

Contains:
- `GET /parse-logs/stats` (lines ~377–425)
- `GET /parse-logs/export` (lines ~426–461)
- `POST /parse-logs/promote` (lines ~461–522)
- `GET /parser-feedback/stats` (lines ~1010–1024)
- `GET /parser-feedback/patterns` (lines ~1024–1053)
- `POST /parser-feedback/patterns/:id/apply` (lines ~1053–1065)
- `POST /parser-feedback/patterns/auto-apply` (lines ~1065–1080)
- `GET /parser-feedback/details` (lines ~1080–1133)

- [ ] **Step 1: Create `backend/src/routes/admin/parseLogs.ts`**

  Follow the same pattern: Router, imports, paste exact handlers, `export default router`.

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 2.5: Extract API keys routes

**Files:**
- Create: `backend/src/routes/admin/apiKeys.ts`

Contains:
- `GET /api-keys` (lines ~680–719)
- `PUT /api-keys` (lines ~719–791)
- `POST /api-keys/test/openai` (lines ~1133–1143)
- `POST /api-keys/test/claude` (lines ~1143–1153)
- `POST /api-keys/test/airlabs` (lines ~1153–1163)
- `POST /api-keys/test/aviationstack` (lines ~1163–1173)
- `POST /api-keys/test/opensky` (lines ~1173–1183)

- [ ] **Step 1: Create `backend/src/routes/admin/apiKeys.ts`**

  Follow the same pattern.

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 2.6: Extract logging routes

**Files:**
- Create: `backend/src/routes/admin/logging.ts`

Contains all `GET/PUT/POST/DELETE /logging/...` routes (lines ~866–1010).

- [ ] **Step 1: Create `backend/src/routes/admin/logging.ts`**

  Follow the same pattern.

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 2.7: Extract parser-settings routes

**Files:**
- Create: `backend/src/routes/admin/parserSettings.ts`

Contains:
- `GET /parser-settings` (lines ~522–578)
- `PUT /parser-settings` (lines ~791–866)
- `GET /training-config` (lines ~578–603, already inlined in Phase 1)
- `PUT /training-config` (lines ~603–680, already inlined in Phase 1)

- [ ] **Step 1: Create `backend/src/routes/admin/parserSettings.ts`**

  Follow the same pattern. Use the inlined config logic from Phase 1 (no `getTrainingConfig` import needed).

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 2.8: Create admin/index.ts and update imports

**Files:**
- Create: `backend/src/routes/admin/index.ts`
- Modify: `backend/src/index.ts`
- Delete: `backend/src/routes/admin.ts`

- [ ] **Step 1: Create `backend/src/routes/admin/index.ts`**

  ```typescript
  import { Router } from 'express';
  import { authenticate } from '../../middleware/auth';
  import { requireAdmin } from '../../middleware/trainingAuth';
  import systemRouter from './system';
  import usersRouter from './users';
  import parseLogsRouter from './parseLogs';
  import apiKeysRouter from './apiKeys';
  import loggingRouter from './logging';
  import parserSettingsRouter from './parserSettings';
  import smtpRouter from '../smtp'; // existing SMTP sub-router

  const router = Router();

  router.use(authenticate);
  router.use(requireAdmin);

  router.use('/', systemRouter);
  router.use('/', usersRouter);
  router.use('/', parseLogsRouter);
  router.use('/', apiKeysRouter);
  router.use('/logging', loggingRouter);
  router.use('/', parserSettingsRouter);
  router.use('/smtp', smtpRouter);

  export default router;
  ```

  Note: Check `backend/src/routes/admin.ts` line 1183–1184 for the SMTP router import path to use.

- [ ] **Step 2: Update import in backend/src/index.ts**

  Line 23 currently reads:
  ```typescript
  import adminRoutes from './routes/admin';
  ```
  This path (`./routes/admin`) will now resolve to `./routes/admin/index.ts` automatically — **no change needed** if the directory is `routes/admin/`.

- [ ] **Step 3: Delete old admin.ts**
  ```bash
  rm backend/src/routes/admin.ts
  ```

- [ ] **Step 4: Full build check**
  ```bash
  cd backend && npx tsc --noEmit && npm run lint
  ```
  Expected: 0 errors

- [ ] **Step 5: Commit**
  ```bash
  git add -A
  git commit -m "refactor: split admin.ts into admin/ directory (system, users, parseLogs, apiKeys, logging, parserSettings)"
  ```

---

## Phase 3: Backend Parser Split — parsers/factory.ts

**Goal:** Split `backend/src/services/parsers/factory.ts` (1193 lines) into 4 focused files.

### Task 3.1: Extract config.ts

**Files:**
- Create: `backend/src/services/parsers/config.ts`

Contains:
- `getParserConfig` (lines ~137–186)
- `checkProviderAvailability` (lines ~89–109)
- `clearAvailabilityCache` (lines ~1190–1193)
- availability cache variable
- Provider type definitions/constants

- [ ] **Step 1: Create `backend/src/services/parsers/config.ts`**

  Move the listed functions with their imports. Export all three functions.

  ```typescript
  import { prisma } from '../../db';
  import logger from '../../utils/logger';
  // ... other imports needed by these functions

  // availability cache (module-level)
  let availabilityCache: Map<string, { available: boolean; checkedAt: number }> | null = null;

  export async function getParserConfig(...): Promise<ParserConfig> { ... }
  export async function checkProviderAvailability(...): Promise<boolean> { ... }
  export function clearAvailabilityCache(): void { ... }
  ```

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 3.2: Extract boardingPass.ts

**Files:**
- Create: `backend/src/services/parsers/boardingPass.ts`

Contains:
- `parseBoardingPass` (lines ~548–789) — main exported function
- `isSuspiciousBoardingPassResult` (lines ~505–512) — helper, used only by parseBoardingPass
- `calculateParserQuality` (lines ~446–488) — helper, used only within this file

- [ ] **Step 1: Create `backend/src/services/parsers/boardingPass.ts`**

  ```typescript
  import type { ParsedBooking } from './types';
  import { getParserConfig, checkProviderAvailability } from './config';
  import { getVisionParserInstance } from './providers';
  // ... other imports

  function calculateParserQuality(flights: ParsedBooking[]): number { ... }
  function isSuspiciousBoardingPassResult(flight: ParsedBooking): boolean { ... }

  export async function parseBoardingPass(...): Promise<...> { ... }
  ```

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 3.3: Extract email.ts

**Files:**
- Create: `backend/src/services/parsers/email.ts`

Contains:
- `parseEmail` (lines ~790–1147) — main exported function
- `applyEmailRegexPostProcessing` (lines ~512–548) — helper used only by parseEmail
- `shouldUseLLMFallback` (lines ~488–505) — helper used only by parseEmail

- [ ] **Step 1: Create `backend/src/services/parsers/email.ts`**

  ```typescript
  import type { ParsedBooking } from './types';
  import { getParserConfig, checkProviderAvailability } from './config';
  import { getTextParserInstance } from './providers';
  // ... other imports

  function shouldUseLLMFallback(...): boolean { ... }
  function applyEmailRegexPostProcessing(...): ... { ... }

  export async function parseEmail(...): Promise<...> { ... }
  ```

- [ ] **Step 2: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 3.4: Create providers.ts and slim down factory.ts

**Files:**
- Create: `backend/src/services/parsers/providers.ts`
- Modify: `backend/src/services/parsers/factory.ts` (slim orchestrator)

`providers.ts` contains:
- `getVisionParserInstance` (lines ~49–71)
- `getTextParserInstance` (lines ~71–89)
- `getDefaultVisionFallbackChain` (lines ~109–117)
- `getDefaultTextFallbackChain` (lines ~117–125)
- `parseFallbackChain` (lines ~125–137)

`factory.ts` becomes thin orchestrator (~200 lines):
- `getVisionParser` (lines ~187–315) — uses providers.ts + config.ts
- `getTextParser` (lines ~316–445) — uses providers.ts + config.ts
- `getAvailableProviders` (lines ~1148–1190)
- Re-exports from sub-modules for backward compatibility:
  ```typescript
  export { getParserConfig, clearAvailabilityCache } from './config';
  export { parseBoardingPass } from './boardingPass';
  export { parseEmail } from './email';
  ```

- [ ] **Step 1: Create `backend/src/services/parsers/providers.ts`**

  Move the 5 listed functions, export them all.

- [ ] **Step 2: Update factory.ts**

  Replace moved functions with imports from sub-modules. Add re-exports at bottom.

- [ ] **Step 3: Full build check**
  ```bash
  cd backend && npx tsc --noEmit && npm run lint
  ```

- [ ] **Step 4: Verify factory line count has dropped significantly**
  ```bash
  wc -l backend/src/services/parsers/factory.ts
  ```
  Expected: < 250 lines

- [ ] **Step 5: Commit**
  ```bash
  git add -A
  git commit -m "refactor: split parsers/factory.ts into config, providers, boardingPass, email modules"
  ```

---

## Phase 4: Frontend API Split — api.ts

**Goal:** Split `frontend/src/lib/api.ts` (2079 lines) into a `frontend/src/lib/api/` directory with one file per domain.

### Task 4.1: Create directory and extract types.ts

**Files:**
- Create: `frontend/src/lib/api/types.ts`

Contains all interfaces from `api.ts` lines 19–328:
- `ProviderAvailabilityMetadata`, `ProviderAvailability`, `ParserCorrectionEntry`, `ParserCorrectionPayload`
- `BoardingPassParseResult`, `EmailParseResult`, `OllamaVisionCheckResult`
- `MessageResponse`, `SuccessResponse`, `ApiKeyTestResponse`
- `AutoUpdateSettings`, `HistoricalEnrichmentSettings`, `UserSettings`
- `TrainingDataEntry`, `TrainingUploadResult`, `TrainingAnnotationResult` *(keep for now, used in adminApi)*
- `PendingUpdate`, `FlightUpdateChange`, `PendingUpdateFlightRef`, `StatisticsImpact`, `FlightUpdateData`
- `LogEntry`, `LogSearchResult`, `ParserFeedbackEntry`
- `BackupMetadata`, `BackupEntry`
- `ExportAllDataResponse`

- [ ] **Step 1: Create directory**
  ```bash
  mkdir frontend/src/lib/api
  ```

- [ ] **Step 2: Create `frontend/src/lib/api/types.ts`**

  Copy all interface/type definitions from `api.ts` lines 19–328 into this file. No imports from axios needed here. Add `export` to each interface.

- [ ] **Step 3: Build check (types.ts alone)**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

---

### Task 4.2: Create client.ts

**Files:**
- Create: `frontend/src/lib/api/client.ts`

Contains:
- `API_URL` export (line 331)
- `api` (standard axios instance, lines 333–342)
- `parserApi` (180s timeout, lines 344–352)
- `hardwareApi` (35s timeout, lines 354–362)
- 401 response interceptor (lines 363–416)

- [ ] **Step 1: Create `frontend/src/lib/api/client.ts`**

  ```typescript
  import axios from 'axios';

  export const API_URL = import.meta.env?.VITE_API_URL || "";

  export const api = axios.create({
    baseURL: `${API_URL}/api/v1`,
    timeout: 10000,
    withCredentials: true,
  });

  export const parserApi = axios.create({
    baseURL: `${API_URL}/api/v1`,
    timeout: 180000,
    withCredentials: true,
  });

  export const hardwareApi = axios.create({
    baseURL: `${API_URL}/api/v1`,
    timeout: 35000,
    withCredentials: true,
  });

  // Copy the full 401 interceptor block from api.ts lines 363–416 here
  ```

- [ ] **Step 2: Build check**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

---

### Task 4.3: Create domain API files

For each domain file, the pattern is identical:
1. Import `api` (or `parserApi`/`hardwareApi`) from `./client`
2. Import needed types from `./types`
3. Copy the exact API object from `api.ts`
4. Export it

- [ ] **Step 1: Create `frontend/src/lib/api/auth.ts`**

  Import `api` from `./client`. Copy `authApi` from lines 418–451. Export `authApi`.

- [ ] **Step 2: Create `frontend/src/lib/api/parse.ts`**

  Import `parserApi` from `./client`. Copy `parseApi` from lines 452–564. Export `parseApi`.

- [ ] **Step 3: Create `frontend/src/lib/api/flights.ts`**

  Import `api` from `./client`. Copy `flightsApi` from lines 564–615. Export `flightsApi`.

- [ ] **Step 4: Create `frontend/src/lib/api/stats.ts`**

  Import `api` from `./client`. Copy stats-specific types (`SummaryStats`, `SummaryCompareResponse`, `SummaryResponse`, `SummaryParams`) and `statsApi` from lines 615–707. Export all.

- [ ] **Step 5: Create `frontend/src/lib/api/airports.ts`**

  Import `api` from `./client`. Copy `Airport` interface and `airportsApi` from lines 707–735. Export both.

- [ ] **Step 6: Create `frontend/src/lib/api/achievements.ts`**

  Import `api` from `./client`. Copy `achievementsApi` from lines 735–771. Export it.

- [ ] **Step 7: Create `frontend/src/lib/api/settings.ts`**

  Import `api` from `./client`, types from `./types`. Copy `SmtpConfigInput`, `SmtpConfigResponse`, `NotificationPreferences` interfaces + `settingsApi` from lines 771–949. Export all.

- [ ] **Step 8: Create `frontend/src/lib/api/analytics.ts`**

  Import `api` from `./client`. Copy `analyticsApi` from lines 949–957. Export it.

- [ ] **Step 9: Create `frontend/src/lib/api/uploads.ts`**

  Import `api` from `./client`. Copy `uploadsApi` from lines 1009–1040. Export it.

- [ ] **Step 10: Create `frontend/src/lib/api/setup.ts`**

  Import `api` from `./client`. Copy `setupApi` from lines 1040–1096. Export it.

- [ ] **Step 11: Create `frontend/src/lib/api/admin.ts`**

  Import `api` from `./client`, types from `./types`. Copy `adminApi` from lines 1096–1762. Export it. (This will still be the largest domain file at ~660 lines, but it's one focused domain.)

- [ ] **Step 12: Create `frontend/src/lib/api/notifications.ts`**

  Import `api` from `./client`. Copy `notificationsApi` from lines 1762–1777. Export it.

- [ ] **Step 13: Create `frontend/src/lib/api/pendingUpdates.ts`**

  Import `api` from `./client`, types from `./types`. Copy `pendingUpdatesApi` from lines 1777–end. Export it.

- [ ] **Step 14: Build check**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -40
  ```

---

### Task 4.4: Create barrel index.ts and delete old api.ts

**Files:**
- Create: `frontend/src/lib/api/index.ts`
- Delete: `frontend/src/lib/api.ts`

- [ ] **Step 1: Create `frontend/src/lib/api/index.ts`**

  This file re-exports everything so all existing `import { ... } from '../lib/api'` imports continue to work unchanged:

  ```typescript
  // Barrel export — all existing consumers import from '../lib/api' which resolves here
  export * from './types';
  export * from './client';
  export * from './auth';
  export * from './parse';
  export * from './flights';
  export * from './stats';
  export * from './airports';
  export * from './achievements';
  export * from './settings';
  export * from './analytics';
  export * from './uploads';
  export * from './setup';
  export * from './admin';
  export * from './notifications';
  export * from './pendingUpdates';
  ```

- [ ] **Step 2: Delete old api.ts**
  ```bash
  rm frontend/src/lib/api.ts
  ```

- [ ] **Step 3: Full frontend build check**
  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: 0 errors. If there are name conflicts (two files export same name), resolve by removing the duplicate from `types.ts` (prefer the more specific file's definition).

- [ ] **Step 4: Run tests**
  ```bash
  cd frontend && npx vitest --run
  ```
  Expected: all pass

- [ ] **Step 5: Commit**
  ```bash
  git add -A
  git commit -m "refactor: split frontend api.ts into api/ domain modules (auth, parse, flights, stats, airports, achievements, settings, admin, notifications, pendingUpdates)"
  ```

---

## Phase 5: Frontend Page Splits

**Goal:** Reduce three giant page components (2374 + 2095 + 1374 lines) to focused orchestrators with extracted sub-components.

### Task 5.1: Split AdvancedStatsPage.tsx

**Files:**
- Create: `frontend/src/components/Stats/StatsYearFilter.tsx`
- Create: `frontend/src/components/Stats/StatsOverviewCards.tsx`
- Create: `frontend/src/components/Stats/StatsChartsSection.tsx`
- Create: `frontend/src/components/Stats/StatsCalendarSection.tsx`
- Create: `frontend/src/components/Stats/DeltaBadge.tsx`
- Modify: `frontend/src/pages/AdvancedStatsPage.tsx`

**Strategy:** AdvancedStatsPage is a single monolith component. Extract visually distinct sections as pure presentational components that receive data as props. State stays in AdvancedStatsPage.

- [ ] **Step 1: Extract DeltaBadge**

  Create `frontend/src/components/Stats/DeltaBadge.tsx`:
  ```typescript
  interface DeltaBadgeProps {
    current: number;
    compare: number;
  }

  export default function DeltaBadge({ current, compare }: DeltaBadgeProps): JSX.Element {
    // Copy exact implementation from AdvancedStatsPage.tsx lines 40–55
  }
  ```

  Remove `DeltaBadge` function and `DeltaBadgeProps` interface from `AdvancedStatsPage.tsx`. Add import.

- [ ] **Step 2: Build check**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 3: Identify the calendar/heatmap section boundaries**
  ```bash
  grep -n "FlightCalendar\|YearHeatmap" frontend/src/pages/AdvancedStatsPage.tsx
  ```
  Note the JSX block line numbers.

- [ ] **Step 4: Extract StatsCalendarSection**

  Create `frontend/src/components/Stats/StatsCalendarSection.tsx`. Define props for all data the section needs (`flights`, `selectedYear`, etc.). Copy the `<FlightCalendar>` + `<YearHeatmap>` JSX block into this component. Replace the block in `AdvancedStatsPage.tsx` with `<StatsCalendarSection ... />`.

- [ ] **Step 5: Build check**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 6: Identify chart sections**
  ```bash
  grep -n "BarChart\|LineChart\|ResponsiveContainer\|recharts" frontend/src/pages/AdvancedStatsPage.tsx
  ```
  Note the JSX block(s) line numbers.

- [ ] **Step 7: Extract StatsChartsSection**

  Create `frontend/src/components/Stats/StatsChartsSection.tsx`. Define props for chart data arrays. Copy the recharts JSX blocks. Replace in `AdvancedStatsPage.tsx`.

- [ ] **Step 8: Build check**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 9: Identify year filter UI block**
  ```bash
  grep -n "selectedYear\|compareYear\|yearFilter\|compareEnabled" frontend/src/pages/AdvancedStatsPage.tsx | head -20
  ```

- [ ] **Step 10: Extract StatsYearFilter**

  Create `frontend/src/components/Stats/StatsYearFilter.tsx`. Props: `selectedYear`, `compareYear`, `compareEnabled`, `onYearChange`, `onCompareYearChange`, `onCompareToggle`, `availableYears`. Copy the year filter JSX. Replace in `AdvancedStatsPage.tsx`.

- [ ] **Step 11: Build check**
  ```bash
  cd frontend && npx tsc --noEmit
  ```

- [ ] **Step 12: Verify line count dropped significantly**
  ```bash
  wc -l frontend/src/pages/AdvancedStatsPage.tsx
  ```
  Expected: < 700 lines

- [ ] **Step 13: Run tests**
  ```bash
  cd frontend && npx vitest --run
  ```

- [ ] **Step 14: Commit**
  ```bash
  git add -A
  git commit -m "refactor: split AdvancedStatsPage.tsx into Stats/ sub-components (DeltaBadge, CalendarSection, ChartsSection, YearFilter)"
  ```

---

### Task 5.2: Split SettingsPage.tsx

**Files:**
- Create: `frontend/src/components/Settings/ProfileSection.tsx`
- Create: `frontend/src/components/Settings/DisplaySection.tsx`
- Create: `frontend/src/components/Settings/UnitsSection.tsx`
- Create: `frontend/src/components/Settings/DefaultsSection.tsx`
- Create: `frontend/src/components/Settings/MapSection.tsx`
- Create: `frontend/src/components/Settings/NotificationsSection.tsx`
- Create: `frontend/src/components/Settings/BackupSection.tsx`
- Create: `frontend/src/components/Settings/SettingsSectionCard.tsx` (shared layout)
- Modify: `frontend/src/pages/SettingsPage.tsx`

**Strategy:** SettingsPage has `activeSection` state and a sidebar. Each section is rendered conditionally. Extract each section as a component receiving only the state/handlers it needs.

- [ ] **Step 1: Extract SettingsSectionCard**

  Create `frontend/src/components/Settings/SettingsSectionCard.tsx`:
  ```typescript
  interface SectionCardProps {
    children: React.ReactNode;
  }
  export function SectionCard({ children }: SectionCardProps): JSX.Element {
    // Copy from SettingsPage.tsx lines ~455–463
  }

  interface SectionTitleProps {
    title: string;
    description?: string;
  }
  export function SectionTitle({ title, description }: SectionTitleProps): JSX.Element {
    // Copy from SettingsPage.tsx lines ~464–490
  }
  ```

  Remove `SectionCard` and `SectionTitle` from `SettingsPage.tsx`. Add import.

- [ ] **Step 2: Build check**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 3: Extract ProfileSection**

  Find the profile section JSX block in `SettingsPage.tsx` (look for `activeSection === "profile"` or similar conditional). Identify which state/handlers it uses.

  Create `frontend/src/components/Settings/ProfileSection.tsx`:
  ```typescript
  interface ProfileSectionProps {
    // Only the state slices and handlers this section actually uses
  }
  export default function ProfileSection(props: ProfileSectionProps): JSX.Element {
    // Copy exact JSX block
  }
  ```

  Replace the block in `SettingsPage.tsx` with `<ProfileSection ... />`.

- [ ] **Step 4: Build check**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 5: Repeat for DisplaySection, UnitsSection, DefaultsSection, MapSection, NotificationsSection, BackupSection**

  For each section: find its JSX block, identify props needed, create component, replace in SettingsPage, build check.

  ```bash
  # After each section extraction:
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 6: Verify line count dropped**
  ```bash
  wc -l frontend/src/pages/SettingsPage.tsx
  ```
  Expected: < 400 lines

- [ ] **Step 7: Run tests**
  ```bash
  cd frontend && npx vitest --run
  ```

- [ ] **Step 8: Commit**
  ```bash
  git add -A
  git commit -m "refactor: split SettingsPage.tsx into Settings/ sub-components (Profile, Display, Units, Defaults, Map, Notifications, Backup sections)"
  ```

---

### Task 5.3: Split SimplifiedFlightFormV2.tsx

**Files:**
- Create: `frontend/src/components/FlightForm/FlightLookupStep.tsx`
- Create: `frontend/src/components/FlightForm/FlightSelectStep.tsx`
- Create: `frontend/src/components/FlightForm/FlightCompleteStep.tsx`
- Modify: `frontend/src/components/SimplifiedFlightFormV2.tsx`

**Strategy:** The form has `step` state cycling through "input" | "select" | "complete". Each step is a large conditional block. Extract each step as a component.

- [ ] **Step 1: Extract FlightLookupStep (step === "input", lines ~582–721)**

  Identify all state and handlers the "input" step uses from `SimplifiedFlightFormV2.tsx`.

  Create `frontend/src/components/FlightForm/FlightLookupStep.tsx`:
  ```typescript
  interface FlightLookupStepProps {
    // flightNumber, onLookup, onManualEntry, loading, error, etc.
  }
  export default function FlightLookupStep(props: FlightLookupStepProps): JSX.Element {
    // Copy exact JSX from the step === "input" block
  }
  ```

- [ ] **Step 2: Build check**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 3: Extract FlightSelectStep (step === "select", lines ~732–789)**

  Create `frontend/src/components/FlightForm/FlightSelectStep.tsx`. Props: `lookupResults`, `onSelect`, `onBack`. Copy exact JSX.

- [ ] **Step 4: Build check**
  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -20
  ```

- [ ] **Step 5: Extract FlightCompleteStep (step === "complete", lines ~791–1374)**

  This is the largest step (~583 lines). Create `frontend/src/components/FlightForm/FlightCompleteStep.tsx`. Define all needed props (flight form state, handlers). Copy exact JSX.

- [ ] **Step 6: Build check + line count**
  ```bash
  cd frontend && npx tsc --noEmit && wc -l frontend/src/components/SimplifiedFlightFormV2.tsx
  ```
  Expected: < 300 lines in the orchestrator

- [ ] **Step 7: Run tests**
  ```bash
  cd frontend && npx vitest --run
  ```

- [ ] **Step 8: Commit**
  ```bash
  git add -A
  git commit -m "refactor: split SimplifiedFlightFormV2.tsx into FlightForm/ step components (Lookup, Select, Complete)"
  ```

---

## Phase 6: Bug Fixes & Quick Wins

**Goal:** Fix the `while (true)` pagination risk, add missing rate limit, fix production console output, and add missing gitignore entry.

### Task 6.1: Add pagination guard to 4 while-true loops

**Files:**
- Modify: `frontend/src/components/Filters.tsx` (~line 68)
- Modify: `frontend/src/components/Stats.tsx` (~line 39)
- Modify: `frontend/src/pages/AdvancedStatsPage.tsx` (~line 133)
- Modify: `frontend/src/pages/FlightsTablePage.tsx` (~line 52)

The pattern in each file is:
```typescript
// BEFORE
while (true) {
  const res = await flightsApi.list({ limit: PAGE_SIZE, offset });
  // ...
  if (flights.length >= res.data.total) break;
}
```

Replace with:
```typescript
// AFTER — add safety limit
const MAX_PAGES = 200; // 200 × 50 = 10,000 flights max
let pages = 0;
while (pages < MAX_PAGES) {
  pages++;
  const res = await flightsApi.list({ limit: PAGE_SIZE, offset });
  // ...
  if (flights.length >= res.data.total) break;
}
```

- [ ] **Step 1: Fix Filters.tsx**

  Grep for `while (true)` in `frontend/src/components/Filters.tsx` and apply the guard. Remove the `// eslint-disable-next-line no-constant-condition` comment above it.

- [ ] **Step 2: Fix Stats.tsx**

  Same pattern.

- [ ] **Step 3: Fix AdvancedStatsPage.tsx**

  Same pattern.

- [ ] **Step 4: Fix FlightsTablePage.tsx**

  Same pattern.

- [ ] **Step 5: Build check + tests**
  ```bash
  cd frontend && npx tsc --noEmit && npx vitest --run
  ```

---

### Task 6.2: Add rate limit to email parse endpoint

**Files:**
- Modify: `backend/src/middleware/rateLimit.ts`
- Modify: `backend/src/routes/emailParse.ts`

- [ ] **Step 1: Add emailParseLimiter to rateLimit.ts**

  Open `backend/src/middleware/rateLimit.ts`. Add after the `boardingPassParseLimiter` export (use it as a model):
  ```typescript
  // Email parse endpoint (can trigger expensive LLM operations)
  export const emailParseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { error: 'Too many parse requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  ```

- [ ] **Step 2: Apply emailParseLimiter in emailParse.ts**
  ```bash
  grep -n "router.post\|router.use\|authenticate" backend/src/routes/emailParse.ts | head -10
  ```
  Find the main POST route handler. Add the limiter:
  ```typescript
  import { emailParseLimiter } from '../middleware/rateLimit';
  // ...
  router.post('/', authenticate, emailParseLimiter, async (req, res, next) => {
  ```

- [ ] **Step 3: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 6.3: Fix console.warn in backupService.ts

**Files:**
- Modify: `backend/src/services/backupService.ts`

- [ ] **Step 1: Find and replace**
  ```bash
  grep -n "console.warn" backend/src/services/backupService.ts
  ```

- [ ] **Step 2: Replace each occurrence**

  Replace:
  ```typescript
  console.warn('...');
  ```
  With:
  ```typescript
  logger.warn({ operation: 'backup_service', message: '...' });
  ```
  Import `logger` from `'../utils/logger'` if not already imported.

- [ ] **Step 3: Build check**
  ```bash
  cd backend && npx tsc --noEmit
  ```

---

### Task 6.4: Fix debugLog in ErrorBoundary.tsx

**Files:**
- Modify: `frontend/src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Add DEV guard**
  ```bash
  sed -n '1,20p' frontend/src/components/ErrorBoundary.tsx
  ```

  Change lines ~5–17:
  ```typescript
  // BEFORE
  function debugLog(component: string, message: string, data?: unknown): void {
    console.log(`[DEBUG ${component}]`, message, data);
  }
  ```
  To:
  ```typescript
  // AFTER
  function debugLog(component: string, message: string, data?: unknown): void {
    if (import.meta.env.DEV) {
      console.log(`[DEBUG ${component}]`, message, data);
    }
  }
  ```

- [ ] **Step 2: Build check**
  ```bash
  cd frontend && npx tsc --noEmit
  ```

---

### Task 6.5: Add data/training/ to backend gitignore

**Files:**
- Modify: `backend/.gitignore` (or root `.gitignore`)

- [ ] **Step 1: Check which gitignore applies**
  ```bash
  cat backend/.gitignore 2>/dev/null | grep "training\|data/" || echo "not found in backend/.gitignore"
  grep "training\|backend/data" .gitignore || echo "not found in root .gitignore"
  ```

- [ ] **Step 2: Add explicit entry**

  If using `backend/.gitignore`, add:
  ```
  data/training/
  ```
  If using root `.gitignore`, add:
  ```
  backend/data/training/
  ```

---

### Task 6.6: Final phase 6 commit

- [ ] **Step 1: Full build check**
  ```bash
  cd backend && npx tsc --noEmit && npm run lint
  cd ../frontend && npx tsc --noEmit && npx vitest --run
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add -A
  git commit -m "fix: add pagination guards, email parse rate limit, console.warn → logger, ErrorBoundary DEV guard, training data gitignore"
  ```

---

## Self-Review

### Spec Coverage

| Concern | Addressed in |
|---------|-------------|
| trainingService.ts dead code (1726 lines) | Phase 1 |
| training.ts route dead code | Phase 1 |
| Debug scripts (4 files) | Phase 1 |
| trainingTriggerLimiter dead export | Phase 1 |
| admin.ts 1186 lines | Phase 2 |
| parsers/factory.ts 1193 lines | Phase 3 |
| api.ts 2079 lines | Phase 4 |
| AdvancedStatsPage.tsx 2374 lines | Phase 5 |
| SettingsPage.tsx 2095 lines | Phase 5 |
| SimplifiedFlightFormV2.tsx 1374 lines | Phase 5 |
| while(true) pagination risk (4 places) | Phase 6 |
| No rate limit on email parse | Phase 6 |
| console.warn in backupService | Phase 6 |
| debugLog runs in production | Phase 6 |
| data/training/ not in gitignore | Phase 6 |

### Not Addressed (deferred)

- **Prisma migration**: Remove `TrainingJob`, `TrainingJobLog` models and `canTrainLLM` user field. Deferred because Prisma migrations require coordinated deploy. Do in a separate PR after Phase 1 is confirmed stable.
- **routeEstimationService TODOs** (empty overflownCountries): Requires feature work (reverse geocoding), not a cleanup.
- **flightEnrichmentService TODOs**: Requires feature work.
- **minRouteCount filter silent no-op**: Requires either backend API change (feature) or UX decision to remove control.
- **Test coverage for backup/email/page components**: Separate testing initiative.
- **Parser factory integration test**: Separate testing initiative.
- **ESLint 9 / eslint-plugin-react-refresh upgrade**: Tracked separately.
- **adminApi in admin.ts is still ~660 lines**: Acceptable for one domain; further split is optional.

*Plan written: 2026-04-03*
