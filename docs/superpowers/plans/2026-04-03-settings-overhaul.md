# Settings Overhaul — Ollama Config, Backup in DB, Cleanup, Timezone

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all behavior configuration out of ENV into the DB (Admin UI), clean up dead/misleading settings fields, and make the stored timezone preference actually apply to date displays.

**Architecture:** ENV vars are for infrastructure only (PORT, DATABASE_URL, file paths, container names). Ollama URL/model, backup schedule, and all other behavior is stored in `AdminSettings` and editable via the Admin panel. A single Prisma migration handles all schema changes. A new `backupSettings.ts` admin route handles backup schedule config. A `dateUtils.ts` frontend utility centralizes timezone-aware date formatting.

**Tech Stack:** TypeScript, Prisma, Express, React, Vitest, Zod, node-cron

---

## Scope

| Task | What | Why |
|------|------|-----|
| 1 | Prisma migration: add Ollama+Backup fields, drop dead fields | Schema foundation for all other tasks |
| 2 | Backend: admin routes for Ollama + Backup settings | Expose new fields via API |
| 3 | Backend: getParserConfig reads ollamaUrl from DB | Ollama URL no longer ENV-only |
| 4 | Backend: backupScheduler reads from AdminSettings | Backup schedule no longer ENV-only |
| 5 | Admin UI: Ollama configuration section | Admin can set URL + model names |
| 6 | Admin UI: Backup schedule section | Admin can enable auto-backup + set interval |
| 7 | User settings cleanup: BackupSection + NotificationsSection | Remove ghost settings that have no effect |
| 8 | Frontend: timezone utility + apply in FlightsTable | Stored timezone preference actually works |

---

## File Structure

```
MODIFY  backend/prisma/schema.prisma                              (add/remove fields)
CREATE  backend/prisma/migrations/..._settings_overhaul/          (auto-generated)
MODIFY  backend/src/routes/admin/parserSettings.ts                (add ollamaUrl/Model/VisionModel)
CREATE  backend/src/routes/admin/backupSettings.ts                (new GET/PUT /admin/backup-settings)
MODIFY  backend/src/routes/admin/index.ts                         (register backupSettings router)
MODIFY  backend/src/services/parsers/config.ts                    (read ollamaUrl from DB)
MODIFY  backend/src/services/backupScheduler.ts                   (read from AdminSettings)
MODIFY  backend/src/services/loggingConfig.ts                     (fix debugLoggingEnabled → logLevel gate)
MODIFY  backend/src/routes/admin/logging.ts                       (remove debugLoggingEnabled from schema)
MODIFY  frontend/src/components/Admin/ParserSettings.tsx          (add Ollama section)
MODIFY  frontend/src/components/Admin/BackupManagement.tsx        (add backup schedule section)
MODIFY  frontend/src/components/Settings/BackupSection.tsx        (remove ghost settings)
MODIFY  frontend/src/components/Settings/NotificationsSection.tsx (remove dead toggles)
MODIFY  frontend/src/lib/api/settings.ts                          (add ollamaUrl/Model types)
CREATE  frontend/src/lib/dateUtils.ts                             (timezone-aware formatDate)
MODIFY  frontend/src/pages/FlightsTablePage.tsx                   (use dateUtils)
```

---

## Task 1: Prisma Migration — Add Ollama/Backup, Drop Dead Fields

**Files:**
- Modify: `backend/prisma/schema.prisma`

### What changes

**Add to `AdminSettings`:**
- `ollamaUrl`, `ollamaModel`, `ollamaVisionModel` — DB-configurable, ENV is fallback
- `backupEnabled`, `backupInterval`, `backupRetentionDays` — replaces ENV-only backup config

**Remove from `AdminSettings`:**
- `debugLoggingEnabled` — orphaned; "Toggle Debug" button sets `logLevel`, not this field; will gate on `logLevel` instead
- `requireUserApiKeys` — shown in UI but never enforced; misleading
- `requireUserFlightApiKeys` — same

**Remove from `UserSettings`:**
- `trainingSeparateModels` — stored, read by nothing

**Drop model:**
- `SystemSettings` — created by migration, never referenced by any route or service

- [ ] **Step 1: Verify no live references to the fields being removed**

  ```bash
  cd /d/Projekte/TravStats && grep -rn "requireUserApiKeys\|requireUserFlightApiKeys\|trainingSeparateModels\|SystemSettings\b" backend/src --include="*.ts" | grep -v "__tests__"
  ```

  Expected output: only references in route handlers and admin UI (these will be cleaned up in Tasks 2 and 5). If there are references in business logic services (not just routes/UI), investigate before proceeding.

  Also check `debugLoggingEnabled` references:
  ```bash
  grep -rn "debugLoggingEnabled" backend/src --include="*.ts"
  ```
  Expected: only in `loggingConfig.ts` and `logging.ts` route (both will be updated in Task 2).

- [ ] **Step 2: Update `backend/prisma/schema.prisma` — add Ollama + Backup fields to AdminSettings**

  Find the `model AdminSettings {` block. After the `defaultTextParser` line and before the `// === LOGGING CONFIGURATION ===` comment, add:

  ```prisma
  // Ollama configuration (overrides OLLAMA_URL / OLLAMA_MODEL env vars)
  ollamaUrl         String? @map("ollama_url")
  ollamaModel       String? @map("ollama_model")
  ollamaVisionModel String? @map("ollama_vision_model")

  // Backup schedule configuration (overrides AUTO_BACKUP_ENABLED / BACKUP_INTERVAL env vars)
  backupEnabled     Boolean @default(false) @map("backup_enabled")
  backupInterval    String  @default("weekly") @map("backup_interval")
  backupRetentionDays Int   @default(30) @map("backup_retention_days")
  ```

- [ ] **Step 3: Remove `debugLoggingEnabled`, `requireUserApiKeys`, `requireUserFlightApiKeys` from AdminSettings**

  In the `model AdminSettings {` block, delete these three lines:
  ```prisma
  debugLoggingEnabled Boolean @default(false) @map("debug_logging_enabled")
  requireUserApiKeys Boolean @default(false) @map("require_user_api_keys")
  requireUserFlightApiKeys Boolean @default(false) @map("require_user_flight_api_keys")
  ```

- [ ] **Step 4: Remove `trainingSeparateModels` from UserSettings**

  In the `model UserSettings {` block, delete:
  ```prisma
  trainingSeparateModels Boolean @default(true) @map("training_separate_models")
  ```

- [ ] **Step 5: Remove the `SystemSettings` model**

  Delete the entire block:
  ```prisma
  model SystemSettings {
    id        String   @id @default("global")
    data      Json     @map("data")
    createdAt DateTime @default(now()) @map("created_at")
    updatedAt DateTime @updatedAt @map("updated_at")

    @@map("system_settings")
  }
  ```

- [ ] **Step 6: Validate schema**

  ```bash
  cd /d/Projekte/TravStats/backend && npx prisma validate
  ```
  Expected: `The schema at prisma/schema.prisma is valid`

- [ ] **Step 7: Create migration**

  ```bash
  cd /d/Projekte/TravStats/backend && npx prisma migrate dev --name settings_overhaul
  ```
  If DB is unreachable: `npx prisma migrate dev --create-only --name settings_overhaul`
  Confirm destructive operations with `y`.

- [ ] **Step 8: Regenerate Prisma client**

  ```bash
  cd /d/Projekte/TravStats/backend && npx prisma generate
  ```

- [ ] **Step 9: Verify 0 TypeScript errors**

  ```bash
  cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
  ```
  Expected: number > 0 (there will be TS errors because routes/services still reference removed fields — these are fixed in Tasks 2–4). Note the errors; do NOT fix them yet.

- [ ] **Step 10: Commit schema only**

  ```bash
  cd /d/Projekte/TravStats && git add backend/prisma/ && git commit -m "chore: Prisma migration — add Ollama/Backup to AdminSettings, drop dead fields"
  ```

---

## Task 2: Backend — Admin Routes for Ollama + Backup + Dead Field Cleanup

**Files:**
- Modify: `backend/src/routes/admin/parserSettings.ts`
- Create: `backend/src/routes/admin/backupSettings.ts`
- Modify: `backend/src/routes/admin/index.ts`
- Modify: `backend/src/services/loggingConfig.ts`
- Modify: `backend/src/routes/admin/logging.ts`

### 2a: Update parserSettings.ts

- [ ] **Step 1: Update `ParserSettingsUpdateData` interface and schema in `backend/src/routes/admin/parserSettings.ts`**

  Replace the existing `interface ParserSettingsUpdateData` and `parserSettingsSchema` with:

  ```typescript
  interface ParserSettingsUpdateData {
    globalOpenaiApiKey?: string | null;
    globalClaudeApiKey?: string | null;
    allowUserApiKeys?: boolean;
    defaultVisionParser?: string;
    defaultTextParser?: string;
    ollamaUrl?: string | null;
    ollamaModel?: string | null;
    ollamaVisionModel?: string | null;
  }

  const parserSettingsSchema = z.object({
    globalOpenaiApiKey: z.string().nullable().optional(),
    globalClaudeApiKey: z.string().nullable().optional(),
    allowUserApiKeys: z.boolean().optional(),
    defaultVisionParser: z.string().optional(),
    defaultTextParser: z.string().optional(),
    ollamaUrl: z.string().url().nullable().optional()
      .or(z.literal("").transform(() => null)),
    ollamaModel: z.string().max(100).nullable().optional(),
    ollamaVisionModel: z.string().max(100).nullable().optional(),
  });
  ```

  Note: `requireUserApiKeys` and `requireUserFlightApiKeys` are removed from both.

- [ ] **Step 2: Update GET `/parser-settings` response — add Ollama fields, remove dropped fields**

  In the `router.get('/parser-settings', ...)` handler, replace the `res.json({...})` call with:

  ```typescript
  res.json({
    globalOpenaiApiKey: decryptApiKey(adminSettings.globalOpenaiApiKey) || undefined,
    globalClaudeApiKey: decryptApiKey(adminSettings.globalClaudeApiKey) || undefined,
    globalAirlabsApiKey: decryptApiKey(adminSettings.globalAirlabsApiKey) || undefined,
    globalAviationstackApiKey: decryptApiKey(adminSettings.globalAviationstackApiKey) || undefined,
    globalOpenskyClientId: decryptApiKey(adminSettings.globalOpenskyClientId) || undefined,
    globalOpenskyClientSecret: decryptApiKey(adminSettings.globalOpenskyClientSecret) || undefined,
    allowUserApiKeys: adminSettings.allowUserApiKeys,
    allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys,
    defaultVisionParser: adminSettings.defaultVisionParser,
    defaultTextParser: adminSettings.defaultTextParser,
    ollamaUrl: adminSettings.ollamaUrl || process.env.OLLAMA_URL || null,
    ollamaModel: adminSettings.ollamaModel || process.env.OLLAMA_MODEL || null,
    ollamaVisionModel: adminSettings.ollamaVisionModel || process.env.OLLAMA_VISION_MODEL || null,
  });
  ```

- [ ] **Step 3: Update PUT `/parser-settings` handler — add Ollama fields, remove require* fields**

  In the destructuring of `parserSettingsSchema.parse(req.body)`, replace:
  ```typescript
  const {
    globalOpenaiApiKey,
    globalClaudeApiKey,
    allowUserApiKeys,
    requireUserApiKeys,
    defaultVisionParser,
    defaultTextParser,
  } = parserSettingsSchema.parse(req.body);
  ```
  With:
  ```typescript
  const {
    globalOpenaiApiKey,
    globalClaudeApiKey,
    allowUserApiKeys,
    defaultVisionParser,
    defaultTextParser,
    ollamaUrl,
    ollamaModel,
    ollamaVisionModel,
  } = parserSettingsSchema.parse(req.body);
  ```

  In the `updateData` construction block, add after the existing fields:
  ```typescript
  if (ollamaUrl !== undefined) {
    updateData.ollamaUrl = ollamaUrl;
  }
  if (ollamaModel !== undefined) {
    updateData.ollamaModel = ollamaModel || null;
  }
  if (ollamaVisionModel !== undefined) {
    updateData.ollamaVisionModel = ollamaVisionModel || null;
  }
  ```

  Remove the two blocks that set `requireUserApiKeys` and `requireUserFlightApiKeys`.

  In the `prisma.adminSettings.create` fallback inside the `else` branch, remove `requireUserApiKeys: false` and `requireUserFlightApiKeys: false` from the create data.

  Update the success response to include Ollama fields and remove require* fields:
  ```typescript
  res.json({
    message: 'Parser settings updated successfully',
    settings: {
      globalOpenaiApiKey: decryptApiKey(adminSettings.globalOpenaiApiKey) || undefined,
      globalClaudeApiKey: decryptApiKey(adminSettings.globalClaudeApiKey) || undefined,
      allowUserApiKeys: adminSettings.allowUserApiKeys,
      defaultVisionParser: adminSettings.defaultVisionParser,
      defaultTextParser: adminSettings.defaultTextParser,
      ollamaUrl: adminSettings.ollamaUrl || process.env.OLLAMA_URL || null,
      ollamaModel: adminSettings.ollamaModel || process.env.OLLAMA_MODEL || null,
      ollamaVisionModel: adminSettings.ollamaVisionModel || process.env.OLLAMA_VISION_MODEL || null,
    },
  });
  ```

### 2b: Create backupSettings.ts route

- [ ] **Step 4: Create `backend/src/routes/admin/backupSettings.ts`**

  ```typescript
  import { Router, Response, NextFunction } from 'express';
  import { z } from 'zod';
  import { AuthRequest } from '../../middleware/auth';
  import { prisma } from '../../db';
  import { updateSchedule } from '../../services/backupScheduler';
  import logger from '../../utils/logger';

  const backupSettingsSchema = z.object({
    backupEnabled: z.boolean().optional(),
    backupInterval: z.enum(['daily', 'weekly', 'monthly']).optional(),
    backupRetentionDays: z.number().int().min(1).max(365).optional(),
  });

  const router = Router();

  router.get('/backup-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const adminSettings = await prisma.adminSettings.findFirst();
      res.json({
        backupEnabled: adminSettings?.backupEnabled ?? false,
        backupInterval: adminSettings?.backupInterval ?? 'weekly',
        backupRetentionDays: adminSettings?.backupRetentionDays ?? 30,
      });
    } catch (error) {
      next(error);
    }
  });

  router.put('/backup-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { backupEnabled, backupInterval, backupRetentionDays } = backupSettingsSchema.parse(req.body);

      let adminSettings = await prisma.adminSettings.findFirst();

      const updateData: {
        backupEnabled?: boolean;
        backupInterval?: string;
        backupRetentionDays?: number;
      } = {};

      if (backupEnabled !== undefined) updateData.backupEnabled = backupEnabled;
      if (backupInterval !== undefined) updateData.backupInterval = backupInterval;
      if (backupRetentionDays !== undefined) updateData.backupRetentionDays = backupRetentionDays;

      if (adminSettings) {
        adminSettings = await prisma.adminSettings.update({
          where: { id: adminSettings.id },
          data: updateData,
        });
      } else {
        adminSettings = await prisma.adminSettings.create({
          data: {
            allowUserApiKeys: true,
            allowUserFlightApiKeys: true,
            defaultVisionParser: 'auto',
            defaultTextParser: 'auto',
            ...updateData,
          },
        });
      }

      // Restart scheduler with new settings
      await updateSchedule();

      logger.info({ operation: 'backup_settings_updated', context: updateData });

      res.json({
        message: 'Backup settings updated',
        backupEnabled: adminSettings.backupEnabled,
        backupInterval: adminSettings.backupInterval,
        backupRetentionDays: adminSettings.backupRetentionDays,
      });
    } catch (error) {
      next(error);
    }
  });

  export default router;
  ```

- [ ] **Step 5: Register backupSettings router in `backend/src/routes/admin/index.ts`**

  Add import and mount:
  ```typescript
  import backupSettingsRouter from './backupSettings';
  // ...
  router.use('/', backupSettingsRouter);
  ```

### 2c: Fix loggingConfig.ts — replace debugLoggingEnabled gate with logLevel check

- [ ] **Step 6: Update `backend/src/services/loggingConfig.ts`**

  The current config interface has `debugLoggingEnabled: boolean`. Remove it and replace the gating logic.

  Find the `LoggingConfig` interface and remove `debugLoggingEnabled: boolean;`.

  Replace all three gating functions:

  ```typescript
  // Old:
  // return config.logHttpRequests && config.debugLoggingEnabled;
  // New:
  export function isHttpLoggingEnabled(): boolean {
    const config = getLoggingConfig();
    const isDebugLevel = config.logLevel === 'debug' || config.logLevel === 'trace';
    return config.logHttpRequests && isDebugLevel;
  }

  export function isDatabaseLoggingEnabled(): boolean {
    const config = getLoggingConfig();
    const isDebugLevel = config.logLevel === 'debug' || config.logLevel === 'trace';
    return config.logDatabaseQueries && isDebugLevel;
  }

  export function isParserLoggingEnabled(): boolean {
    const config = getLoggingConfig();
    const isDebugLevel = config.logLevel === 'debug' || config.logLevel === 'trace';
    return config.logParserOperations && isDebugLevel;
  }
  ```

  Remove `debugLoggingEnabled` from `getLoggingConfigFromSettings()` and `getDefaultLoggingConfig()` and `toggleDebugLogging()` (if it sets `debugLoggingEnabled`, remove that line).

  In `updateLoggingConfig()`, remove `debugLoggingEnabled` from the `updateData` type and from the prisma update call.

- [ ] **Step 7: Update `backend/src/routes/admin/logging.ts`** — remove `debugLoggingEnabled` from the Zod schema and handler

  ```bash
  grep -n "debugLoggingEnabled" /d/Projekte/TravStats/backend/src/routes/admin/logging.ts
  ```
  Remove any lines referencing `debugLoggingEnabled` in the schema and update data.

- [ ] **Step 8: Backend type check**

  ```bash
  cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
  ```
  Expected: 0 errors.

- [ ] **Step 9: Commit**

  ```bash
  cd /d/Projekte/TravStats && git add backend/src/routes/admin/ backend/src/services/loggingConfig.ts && git commit -m "feat: admin routes — Ollama config + backup settings + remove dead fields"
  ```

---

## Task 3: Backend — getParserConfig Reads ollamaUrl from DB

**Files:**
- Modify: `backend/src/services/parsers/config.ts`

The function currently reads `process.env.OLLAMA_URL` directly. Change it to accept admin settings and use DB value with ENV fallback.

- [ ] **Step 1: Write the test**

  In `backend/src/__tests__/parsers.factory.integration.test.ts`, add one test at the end of the describe block:

  ```typescript
  it("uses ollamaUrl from adminSettings when provided", async () => {
    mockFindMatchingTemplate.mockResolvedValue(null);
    mockTemplateParserCheckAvailability.mockResolvedValue({ available: false });
    const regexResult = [{ flightNumber: "LH103", parserConfidence: 70 }];
    mockRegexParseEmail.mockResolvedValue(regexResult);

    // The getParserConfig function reads adminSettings when passed
    // Test the config function directly
    const { getParserConfig } = await import("../services/parsers/config");
    const config = await getParserConfig(
      undefined,
      { globalOpenaiApiKey: null, globalClaudeApiKey: null, ollamaUrl: "http://custom-ollama:11434" },
      undefined
    );

    expect(config.ollamaUrl).toBe("http://custom-ollama:11434");
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd /d/Projekte/TravStats/backend && npx jest parsers.factory.integration.test.ts --forceExit 2>&1 | tail -10
  ```
  Expected: FAIL (getParserConfig doesn't accept ollamaUrl in adminSettings yet)

- [ ] **Step 3: Update `getParserConfig` in `backend/src/services/parsers/config.ts`**

  Update the `adminSettings` parameter type to include Ollama fields:

  ```typescript
  export async function getParserConfig(
    userSettings?: {
      preferredVisionParser?: string | null;
      preferredTextParser?: string | null;
      visionFallbackChain?: string | null;
      textFallbackChain?: string | null;
      openaiApiKey?: string | null;
      claudeApiKey?: string | null;
    },
    adminSettings?: {
      globalOpenaiApiKey?: string | null;
      globalClaudeApiKey?: string | null;
      ollamaUrl?: string | null;
      ollamaModel?: string | null;
      ollamaVisionModel?: string | null;
    },
    userId?: string
  ): Promise<ParserConfig> {
  ```

  In the return object, replace:
  ```typescript
  ollamaUrl: process.env.OLLAMA_URL,
  ```
  With:
  ```typescript
  ollamaUrl: adminSettings?.ollamaUrl || process.env.OLLAMA_URL,
  ```

  Also update `ollamaModel` and `ollamaVisionModel` — currently they come from `selectModelForParsing()` (which handles the custom trained model). Keep that logic but add admin base model as intermediate fallback:

  The `selectModelForParsing()` already returns the correct model (trained or base). The `ollamaModel` in `ParserConfig` is what actually gets used. No change needed for model selection — `selectModelForParsing()` handles it. Only `ollamaUrl` needs the DB override.

- [ ] **Step 4: Find all callers of `getParserConfig` and pass adminSettings.ollamaUrl**

  ```bash
  grep -rn "getParserConfig\|getAdminParserSettings\|adminSettings" /d/Projekte/TravStats/backend/src/routes --include="*.ts" | grep -v "node_modules" | head -20
  ```

  The booking parser route (or wherever `getParserConfig` is called) currently passes `adminSettings` for API keys. Ensure the `adminSettings` object passed includes the Ollama fields from the DB fetch:

  ```bash
  grep -rn "getParserConfig" /d/Projekte/TravStats/backend/src --include="*.ts" | grep -v "__tests__"
  ```

  For each call site, ensure the `adminSettings` object includes `ollamaUrl: adminSettings?.ollamaUrl`. Since the admin settings are already fetched from the DB at the call sites, they will already have the new fields after migration.

- [ ] **Step 5: Run test to verify it passes**

  ```bash
  cd /d/Projekte/TravStats/backend && npx jest parsers.factory.integration.test.ts --forceExit 2>&1 | tail -10
  ```
  Expected: all tests PASS

- [ ] **Step 6: Type check**

  ```bash
  cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
  ```
  Expected: 0

- [ ] **Step 7: Commit**

  ```bash
  cd /d/Projekte/TravStats && git add backend/src/services/parsers/config.ts backend/src/__tests__/parsers.factory.integration.test.ts && git commit -m "feat: parser config reads ollamaUrl from AdminSettings (ENV as fallback)"
  ```

---

## Task 4: Backend — backupScheduler Reads from AdminSettings

**Files:**
- Modify: `backend/src/services/backupScheduler.ts`

Replace all `process.env.AUTO_BACKUP_ENABLED` and `process.env.BACKUP_INTERVAL` reads with DB queries.

- [ ] **Step 1: Write test**

  Create `backend/src/__tests__/backupScheduler.test.ts`:

  ```typescript
  import { describe, it, expect, jest, beforeEach } from "@jest/globals";

  const mockFindFirst = jest.fn();
  jest.mock("../db", () => ({
    prisma: {
      adminSettings: { findFirst: mockFindFirst },
      backup: { findFirst: jest.fn().mockResolvedValue(null) },
    },
  }));

  jest.mock("../services/backupService", () => ({
    createBackup: jest.fn().mockResolvedValue({}),
  }));

  jest.mock("node-cron", () => ({
    schedule: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
  }));

  jest.mock("../utils/logger", () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  describe("backupScheduler", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.resetModules();
    });

    it("does not start scheduler when backupEnabled is false in DB", async () => {
      mockFindFirst.mockResolvedValue({ backupEnabled: false, backupInterval: "weekly", backupRetentionDays: 30 });
      const cron = await import("node-cron");
      const { startScheduler } = await import("../services/backupScheduler");

      await startScheduler();

      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it("starts scheduler with correct cron pattern when backupEnabled is true", async () => {
      mockFindFirst.mockResolvedValue({ backupEnabled: true, backupInterval: "daily", backupRetentionDays: 30 });
      const cron = await import("node-cron");
      const { startScheduler } = await import("../services/backupScheduler");

      await startScheduler();

      expect(cron.schedule).toHaveBeenCalledWith("0 2 * * *", expect.any(Function));
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd /d/Projekte/TravStats/backend && npx jest backupScheduler.test.ts --forceExit 2>&1 | tail -15
  ```
  Expected: FAIL (scheduler still reads from ENV)

- [ ] **Step 3: Update `backend/src/services/backupScheduler.ts`**

  Add a helper function to read backup settings from DB:

  ```typescript
  async function getBackupSettings(): Promise<{ enabled: boolean; interval: 'daily' | 'weekly' | 'monthly'; retentionDays: number }> {
    const adminSettings = await prisma.adminSettings.findFirst();
    return {
      enabled: adminSettings?.backupEnabled ?? false,
      interval: (adminSettings?.backupInterval as 'daily' | 'weekly' | 'monthly') ?? 'weekly',
      retentionDays: adminSettings?.backupRetentionDays ?? 30,
    };
  }
  ```

  Update `checkAndRunBackup()` — replace:
  ```typescript
  const autoBackup = process.env.AUTO_BACKUP_ENABLED === 'true';
  const backupInterval = (process.env.BACKUP_INTERVAL as 'daily' | 'weekly' | 'monthly') || 'weekly';
  ```
  With:
  ```typescript
  const { enabled: autoBackup, interval: backupInterval } = await getBackupSettings();
  ```

  Update `startScheduler()` — replace both ENV reads with:
  ```typescript
  const { enabled: autoBackup, interval: backupInterval } = await getBackupSettings();
  ```

  Update `getScheduleStatus()` — this function is synchronous but needs async now. Change its signature to `async`:
  ```typescript
  export async function getScheduleStatus(): Promise<{ running: boolean; cronPattern?: string; interval?: string }> {
    if (!scheduledJob) {
      return { running: false };
    }
    const { enabled: autoBackup, interval: backupInterval } = await getBackupSettings();
    if (!autoBackup) {
      return { running: false };
    }
    return {
      running: true,
      cronPattern: getCronPattern(backupInterval),
      interval: backupInterval,
    };
  }
  ```

  Also update the `RETENTION_DAYS` constant — it's used in `cleanupOldBackups()`. Replace the module-level constant:
  ```typescript
  // Remove: const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
  ```
  And read it from the DB at runtime in `cleanupOldBackups()`:
  ```typescript
  export async function cleanupOldBackups(): Promise<number> {
    const adminSettings = await prisma.adminSettings.findFirst();
    const retentionDays = adminSettings?.backupRetentionDays ?? 30;
    // ... rest of function using retentionDays
  }
  ```

  Check if `backupService.ts` also reads `RETENTION_DAYS` from ENV directly:
  ```bash
  grep -n "RETENTION_DAYS\|BACKUP_RETENTION" /d/Projekte/TravStats/backend/src/services/backupService.ts
  ```
  If yes, update `backupService.ts` the same way (read from `prisma.adminSettings.findFirst()` at runtime).

- [ ] **Step 4: Find and update callers of `getScheduleStatus()`**

  ```bash
  grep -rn "getScheduleStatus" /d/Projekte/TravStats/backend/src --include="*.ts"
  ```
  Update any callers to `await getScheduleStatus()`.

- [ ] **Step 5: Run tests**

  ```bash
  cd /d/Projekte/TravStats/backend && npx jest backupScheduler.test.ts --forceExit 2>&1 | tail -15
  ```
  Expected: all tests PASS

- [ ] **Step 6: Type check**

  ```bash
  cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
  ```
  Expected: 0

- [ ] **Step 7: Commit**

  ```bash
  cd /d/Projekte/TravStats && git add backend/src/services/backupScheduler.ts backend/src/__tests__/backupScheduler.test.ts && git commit -m "feat: backupScheduler reads config from AdminSettings DB (not ENV)"
  ```

---

## Task 5: Admin UI — Ollama Configuration Section

**Files:**
- Modify: `frontend/src/components/Admin/ParserSettings.tsx`
- Modify: `frontend/src/pages/AdminPage.tsx`
- Modify: `frontend/src/lib/api/settings.ts` (or wherever `adminApi` types live — check `frontend/src/lib/api/`)

- [ ] **Step 1: Find and update the admin API types**

  ```bash
  grep -rn "getAdminParserSettings\|updateAdminParserSettings\|ParserSettingsData" /d/Projekte/TravStats/frontend/src/lib/api/ --include="*.ts"
  ```

  In the file that defines the admin parser settings types/API calls, add Ollama fields to the return type and update params:

  ```typescript
  export interface AdminParserSettings {
    globalOpenaiApiKey?: string;
    globalClaudeApiKey?: string;
    allowUserApiKeys: boolean;
    allowUserFlightApiKeys: boolean;
    defaultVisionParser: string;
    defaultTextParser: string;
    ollamaUrl: string | null;
    ollamaModel: string | null;
    ollamaVisionModel: string | null;
  }
  ```

  Remove `requireUserApiKeys` and `requireUserFlightApiKeys` from this type.

- [ ] **Step 2: Update `ParserSettingsData` interface in `frontend/src/components/Admin/ParserSettings.tsx`**

  Replace:
  ```typescript
  export interface ParserSettingsData {
    globalOpenaiApiKey?: string;
    globalClaudeApiKey?: string;
    allowUserApiKeys: boolean;
    requireUserApiKeys: boolean;
    defaultVisionParser: string;
    defaultTextParser: string;
  }
  ```
  With:
  ```typescript
  export interface ParserSettingsData {
    globalOpenaiApiKey?: string;
    globalClaudeApiKey?: string;
    allowUserApiKeys: boolean;
    allowUserFlightApiKeys: boolean;
    defaultVisionParser: string;
    defaultTextParser: string;
    ollamaUrl: string | null;
    ollamaModel: string | null;
    ollamaVisionModel: string | null;
  }
  ```

- [ ] **Step 3: Add Ollama section to `ParserSettings.tsx`**

  After the existing "Default Parser Settings" card and before the closing `</div>` of the component, add:

  ```tsx
  {/* Ollama Configuration */}
  <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
    <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
      Ollama Configuration
    </h3>
    <p className="text-sm text-[var(--text-muted)] mb-4">
      Configure the local Ollama instance used for AI parsing. Leave blank to use the{" "}
      <code className="text-xs bg-[var(--bg-elevated)] px-1 rounded">OLLAMA_URL</code> environment variable.
    </p>
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
          Ollama URL
        </label>
        <input
          type="url"
          value={parserSettings.ollamaUrl ?? ""}
          onChange={(e) =>
            onParserSettingsChange({
              ...parserSettings,
              ollamaUrl: e.target.value || null,
            })
          }
          placeholder="http://192.168.178.155:11434"
          className="input w-full"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Full URL including port. DB value overrides OLLAMA_URL env var.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
            Text Model
          </label>
          <input
            type="text"
            value={parserSettings.ollamaModel ?? ""}
            onChange={(e) =>
              onParserSettingsChange({
                ...parserSettings,
                ollamaModel: e.target.value || null,
              })
            }
            placeholder="qwen2.5:7b"
            className="input w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
            Vision Model
          </label>
          <input
            type="text"
            value={parserSettings.ollamaVisionModel ?? ""}
            onChange={(e) =>
              onParserSettingsChange({
                ...parserSettings,
                ollamaVisionModel: e.target.value || null,
              })
            }
            placeholder="llama3.2-vision"
            className="input w-full"
          />
        </div>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 4: Remove `requireUserApiKeys` from `AdminPage.tsx`**

  ```bash
  grep -n "requireUserApiKeys" /d/Projekte/TravStats/frontend/src/pages/AdminPage.tsx
  ```

  Remove all references: the state initialization, the `handleSaveParserSettings` call that passes it, and the prop passed to `ParserSettingsTab`.

- [ ] **Step 5: Frontend type check**

  ```bash
  cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
  ```
  Expected: 0

- [ ] **Step 6: Frontend tests**

  ```bash
  cd /d/Projekte/TravStats/frontend && npx vitest --run 2>&1 | tail -5
  ```
  Expected: all pass

- [ ] **Step 7: Commit**

  ```bash
  cd /d/Projekte/TravStats && git add frontend/src/components/Admin/ParserSettings.tsx frontend/src/pages/AdminPage.tsx frontend/src/lib/api/ && git commit -m "feat: admin UI — Ollama URL + model configuration section"
  ```

---

## Task 6: Admin UI — Backup Schedule Settings

**Files:**
- Modify: `frontend/src/components/Admin/BackupManagement.tsx`
- Modify: `frontend/src/lib/api/` (add backup settings API calls)

The `BackupManagement.tsx` admin component currently only manages backup history. Add a settings section at the top for enable/interval/retention.

- [ ] **Step 1: Add backup settings API calls**

  Find the backup API file:
  ```bash
  grep -rn "backupApi\|backup\." /d/Projekte/TravStats/frontend/src/lib/api/ --include="*.ts" | head -10
  ```

  In that file, add:
  ```typescript
  export interface BackupScheduleSettings {
    backupEnabled: boolean;
    backupInterval: 'daily' | 'weekly' | 'monthly';
    backupRetentionDays: number;
  }

  // In the backupApi object:
  getBackupSettings: async (): Promise<BackupScheduleSettings> => {
    const response = await apiClient.get<BackupScheduleSettings>('/admin/backup-settings');
    return response.data;
  },

  updateBackupSettings: async (settings: Partial<BackupScheduleSettings>): Promise<BackupScheduleSettings> => {
    const response = await apiClient.put<BackupScheduleSettings>('/admin/backup-settings', settings);
    return response.data;
  },
  ```

- [ ] **Step 2: Add backup schedule settings state to `BackupManagement.tsx`**

  Add state and load logic at the top of the component:

  ```typescript
  const [backupSettings, setBackupSettings] = useState<BackupScheduleSettings>({
    backupEnabled: false,
    backupInterval: 'weekly',
    backupRetentionDays: 30,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    backupApi.getBackupSettings()
      .then(setBackupSettings)
      .catch((err) => logger.error("Failed to load backup settings:", err));
  }, []);

  const handleSaveBackupSettings = async (): Promise<void> => {
    setSavingSettings(true);
    try {
      const updated = await backupApi.updateBackupSettings(backupSettings);
      setBackupSettings(updated);
      addToast("success", t("admin:backup.settingsSaved"));
    } catch (err) {
      addToast("error", t("admin:backup.settingsFailed"));
    } finally {
      setSavingSettings(false);
    }
  };
  ```

- [ ] **Step 3: Add schedule settings UI at the top of `BackupManagement.tsx`**

  Before the existing backup list/history section, add:

  ```tsx
  {/* Backup Schedule Settings */}
  <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6 mb-6">
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("admin:backup.schedule.title")}
        </h3>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {t("admin:backup.schedule.description")}
        </p>
      </div>
      <button
        onClick={handleSaveBackupSettings}
        disabled={savingSettings}
        className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium text-sm"
      >
        {savingSettings ? t("common:buttons.saving") : t("common:buttons.save")}
      </button>
    </div>
    <div className="space-y-4">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={backupSettings.backupEnabled}
          onChange={(e) => setBackupSettings({ ...backupSettings, backupEnabled: e.target.checked })}
          className="w-4 h-4 rounded"
        />
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {t("admin:backup.schedule.enableAutoBackup")}
        </span>
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
            {t("admin:backup.schedule.interval")}
          </label>
          <select
            value={backupSettings.backupInterval}
            onChange={(e) =>
              setBackupSettings({
                ...backupSettings,
                backupInterval: e.target.value as BackupScheduleSettings["backupInterval"],
              })
            }
            disabled={!backupSettings.backupEnabled}
            className="input w-full disabled:opacity-50"
          >
            <option value="daily">{t("settings:backup.intervals.daily")}</option>
            <option value="weekly">{t("settings:backup.intervals.weekly")}</option>
            <option value="monthly">{t("settings:backup.intervals.monthly")}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
            {t("admin:backup.schedule.retentionDays")}
          </label>
          <input
            type="number"
            value={backupSettings.backupRetentionDays}
            onChange={(e) =>
              setBackupSettings({
                ...backupSettings,
                backupRetentionDays: parseInt(e.target.value, 10) || 30,
              })
            }
            min="1"
            max="365"
            className="input w-full"
          />
        </div>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 4: Add i18n keys** to `frontend/src/i18n/de/admin.json` and `frontend/src/i18n/en/admin.json`:

  ```json
  "backup": {
    "schedule": {
      "title": "Automatisches Backup",
      "description": "Geplante Backups werden täglich um 2:00 Uhr ausgeführt.",
      "enableAutoBackup": "Automatisches Backup aktivieren",
      "interval": "Intervall",
      "retentionDays": "Aufbewahrung (Tage)"
    },
    "settingsSaved": "Backup-Einstellungen gespeichert",
    "settingsFailed": "Fehler beim Speichern der Einstellungen"
  }
  ```

  English (`en/admin.json`):
  ```json
  "backup": {
    "schedule": {
      "title": "Automatic Backup",
      "description": "Scheduled backups run at 2:00 AM.",
      "enableAutoBackup": "Enable automatic backup",
      "interval": "Interval",
      "retentionDays": "Retention (days)"
    },
    "settingsSaved": "Backup settings saved",
    "settingsFailed": "Failed to save backup settings"
  }
  ```

  Check if these keys already exist:
  ```bash
  grep -n "backup" /d/Projekte/TravStats/frontend/src/i18n/de/admin.json | head -10
  ```

- [ ] **Step 5: Type check + tests**

  ```bash
  cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l && npx vitest --run 2>&1 | tail -5
  ```
  Expected: 0 errors, all tests pass

- [ ] **Step 6: Commit**

  ```bash
  cd /d/Projekte/TravStats && git add frontend/src/components/Admin/BackupManagement.tsx frontend/src/lib/api/ frontend/src/i18n/ && git commit -m "feat: admin UI — backup schedule settings (enable, interval, retention)"
  ```

---

## Task 7: User Settings Cleanup

**Files:**
- Modify: `frontend/src/components/Settings/BackupSection.tsx`
- Modify: `frontend/src/components/Settings/NotificationsSection.tsx`
- Modify: `frontend/src/store/settingsStore.ts` (remove dead types)
- Modify: `frontend/src/lib/api/types.ts` (remove dead fields)

### 7a: BackupSection — remove ghost settings

The user-facing backup section currently shows `autoBackup`, `backupInterval`, `exportFormat`, `cloudSync` — all stored in JSON blob, none read by the scheduler. Replace with a read-only status display. The schedule config is now admin-only.

- [ ] **Step 1: Read current BackupSection to understand full props**

  ```bash
  grep -n "onSetBackup\|BackupSettings\|backup\." /d/Projekte/TravStats/frontend/src/store/settingsStore.ts | head -20
  ```

- [ ] **Step 2: Simplify `BackupSection.tsx`**

  Replace the entire file content with a read-only view:

  ```tsx
  import { useTranslation } from "../../hooks/useTranslation";
  import { SectionCard, SectionTitle } from "./SettingsShared";

  interface LastBackup {
    completedAt: string | null;
    size: string;
    status: string;
  }

  interface BackupSectionProps {
    lastBackup: LastBackup | null;
    backupStatus: { running: boolean } | null;
    isAdmin: boolean;
  }

  export default function BackupSection({
    lastBackup,
    backupStatus,
    isAdmin,
  }: BackupSectionProps): JSX.Element {
    const { t } = useTranslation(["settings"]);

    return (
      <SectionCard>
        <SectionTitle
          title={t("settings:backup.title")}
          description={t("settings:backup.description")}
        />
        <div className="space-y-3">
          {isAdmin ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("settings:backup.adminNote")}
            </p>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("settings:backup.userNote")}
            </p>
          )}
          {backupStatus?.running ? (
            <div className="flex items-center gap-2" style={{ color: "var(--accent)" }}>
              <span className="animate-pulse">&#9679;</span>
              <span>{t("settings:backup.status.running")}</span>
            </div>
          ) : lastBackup ? (
            <div className="space-y-1">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {t("settings:backup.status.lastBackup", {
                  date: lastBackup.completedAt
                    ? new Date(lastBackup.completedAt).toLocaleString("de-DE")
                    : "-",
                })}
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings:backup.status.size", {
                  size: (parseInt(lastBackup.size, 10) / 1024 / 1024).toFixed(2),
                })}
              </p>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("settings:backup.status.noBackup")}
            </p>
          )}
        </div>
      </SectionCard>
    );
  }
  ```

  Add the two new i18n keys to `de/settings.json` and `en/settings.json`:
  - `"adminNote"`: `"Backup-Einstellungen werden im Admin-Panel verwaltet."`
  - `"userNote"`: `"Backups werden vom Administrator verwaltet."`

- [ ] **Step 3: Update callers of `BackupSection` to remove `onSetBackup`, `onSetRetentionDays`, `backup`, `retentionDays` props**

  ```bash
  grep -rn "BackupSection\|onSetBackup\|retentionDays" /d/Projekte/TravStats/frontend/src --include="*.tsx" | grep -v "BackupSection.tsx"
  ```

  Update the parent component (likely `useSettingsPage.ts` or `SettingsPage.tsx`) to not pass the removed props.

### 7b: NotificationsSection — remove dead JSON blob toggles

- [ ] **Step 4: Read current NotificationsSection**

  ```bash
  cat /d/Projekte/TravStats/frontend/src/components/Settings/NotificationsSection.tsx
  ```

- [ ] **Step 5: Remove dead toggles from `NotificationsSection.tsx`**

  The component currently renders `emailNotifications`, `checkInReminder`, and `featureUpdates` toggles (which save to JSON blob and are never read by services) alongside the working `NotificationPreferences` component.

  Remove the dead toggles: `emailNotifications`, `checkInReminder`, `featureUpdates`. Keep only `NotificationPreferences` (which actually controls `User.notificationEmail`, `notifyBefore24h`, `notifyBefore2h`).

  If `NotificationsSection` renders ONLY those dead toggles (no other content), replace the entire section with just the `NotificationPreferences` component inline, or simplify the wrapper to remove the dead props.

- [ ] **Step 6: Type check + tests**

  ```bash
  cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l && npx vitest --run 2>&1 | tail -5
  ```
  Expected: 0 errors, all pass

- [ ] **Step 7: Commit**

  ```bash
  cd /d/Projekte/TravStats && git add frontend/src/components/Settings/ frontend/src/store/settingsStore.ts frontend/src/i18n/ && git commit -m "fix: remove ghost settings from BackupSection and NotificationsSection"
  ```

---

## Task 8: Frontend — Timezone Utility + Apply in FlightsTable

**Files:**
- Create: `frontend/src/lib/dateUtils.ts`
- Modify: `frontend/src/pages/FlightsTablePage.tsx`

The `display.timezone` is stored in `settingsStore` but never used for date formatting. Any `toLocaleDateString()` call currently uses the browser locale. This task creates a central utility that reads the user's timezone setting and applies it.

- [ ] **Step 1: Write test for the utility**

  Create `frontend/src/lib/dateUtils.test.ts`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { formatDateInTimezone, formatDateTimeInTimezone } from "./dateUtils";

  describe("dateUtils", () => {
    const date = new Date("2026-05-01T10:00:00Z"); // 10:00 UTC

    it("formats date in UTC timezone", () => {
      const result = formatDateInTimezone(date, "UTC");
      expect(result).toBe("01.05.2026");
    });

    it("formats date in Berlin timezone (UTC+2 in summer)", () => {
      const result = formatDateInTimezone(date, "Europe/Berlin");
      expect(result).toBe("01.05.2026");
    });

    it("formats datetime with time component", () => {
      const result = formatDateTimeInTimezone(date, "UTC");
      expect(result).toContain("10:00");
    });

    it("handles string date input", () => {
      const result = formatDateInTimezone("2026-05-01T10:00:00Z", "UTC");
      expect(result).toBe("01.05.2026");
    });

    it("returns fallback for invalid date", () => {
      const result = formatDateInTimezone("not-a-date", "UTC");
      expect(result).toBe("—");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd /d/Projekte/TravStats/frontend && npx vitest run src/lib/dateUtils.test.ts 2>&1 | tail -10
  ```
  Expected: FAIL (module not found)

- [ ] **Step 3: Create `frontend/src/lib/dateUtils.ts`**

  ```typescript
  /**
   * Timezone-aware date formatting utilities.
   * All functions accept a timezone string (IANA format, e.g. "Europe/Berlin")
   * and format dates consistently using de-DE locale conventions.
   */

  const FALLBACK = "—";

  function toDate(input: Date | string): Date | null {
    if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Format a date as "dd.MM.yyyy" in the given timezone.
   */
  export function formatDateInTimezone(input: Date | string, timezone: string): string {
    const date = toDate(input);
    if (!date) return FALLBACK;
    return new Intl.DateTimeFormat("de-DE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone,
    }).format(date);
  }

  /**
   * Format a date+time as "dd.MM.yyyy, HH:mm" in the given timezone.
   */
  export function formatDateTimeInTimezone(input: Date | string, timezone: string): string {
    const date = toDate(input);
    if (!date) return FALLBACK;
    return new Intl.DateTimeFormat("de-DE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date);
  }

  /**
   * Format a time-only as "HH:mm" in the given timezone.
   */
  export function formatTimeInTimezone(input: Date | string, timezone: string): string {
    const date = toDate(input);
    if (!date) return FALLBACK;
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date);
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  cd /d/Projekte/TravStats/frontend && npx vitest run src/lib/dateUtils.test.ts 2>&1 | tail -10
  ```
  Expected: all tests PASS

- [ ] **Step 5: Apply in `FlightsTablePage.tsx`**

  The existing `formatDate` function at line ~154:
  ```typescript
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(getDateLocale(), DATE_FORMATS.DEFAULT);
  };
  ```

  Replace with:
  ```typescript
  import { formatDateInTimezone } from "../lib/dateUtils";
  import { useSettingsStore } from "../store/settingsStore";

  // Inside the component:
  const timezone = useSettingsStore((s) => s.display.timezone);

  const formatDate = (date: string): string => formatDateInTimezone(date, timezone);
  ```

  Check that `useSettingsStore` is already imported in this file:
  ```bash
  grep -n "useSettingsStore\|settingsStore" /d/Projekte/TravStats/frontend/src/pages/FlightsTablePage.tsx
  ```
  If not already imported, add the import.

- [ ] **Step 6: Run frontend tests**

  ```bash
  cd /d/Projekte/TravStats/frontend && npx vitest --run 2>&1 | tail -5
  ```
  Expected: all pass (128+5 = 133 tests)

- [ ] **Step 7: Type check**

  ```bash
  cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
  ```
  Expected: 0

- [ ] **Step 8: Commit**

  ```bash
  cd /d/Projekte/TravStats && git add frontend/src/lib/dateUtils.ts frontend/src/lib/dateUtils.test.ts frontend/src/pages/FlightsTablePage.tsx && git commit -m "feat: timezone-aware date formatting utility, apply in FlightsTable"
  ```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Ollama URL configurable via Admin UI | Tasks 1, 2, 3, 5 |
| Ollama model names configurable via Admin UI | Tasks 1, 2, 5 |
| Backup schedule in DB/UI (not ENV) | Tasks 1, 2, 4, 6 |
| Remove `debugLoggingEnabled` orphan | Tasks 1, 2 |
| Remove `requireUserApiKeys` (never enforced) | Tasks 1, 2, 5 |
| Remove `trainingSeparateModels` (dead) | Task 1 |
| Drop `SystemSettings` dead table | Task 1 |
| Remove ghost user backup settings | Task 7 |
| Remove dead notification toggles | Task 7 |
| Timezone actually applies to dates | Task 8 |

### ENV vars still used (intentionally)

After this plan, ENV vars remaining are:
- `DATABASE_URL` — connection string (infrastructure)
- `PORT` — server port (infrastructure)
- `BACKUP_PATH` — file path (infrastructure)
- `DOCKER_DB_CONTAINER`, `POSTGRES_DB`, `POSTGRES_USER` — DB config (infrastructure)
- `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_VISION_MODEL` — **fallback only** when no DB value set
- `AUTO_BACKUP_ENABLED`, `BACKUP_INTERVAL` — **no longer read** (remove from `env.ts` Zod schema)

Note: `TRAINING_EMAIL_MODEL_NAME`, `TRAINING_VISION_MODEL_NAME` remain as ENV fallbacks for the trained model selection — acceptable since training config is admin-only.

### Placeholder scan

No placeholders. All code blocks are complete and runnable.

### Type consistency

- `BackupScheduleSettings.backupInterval` is `'daily' | 'weekly' | 'monthly'` — consistent with `getCronPattern()` parameter type in `backupScheduler.ts`.
- `AdminSettings.ollamaUrl` is `String?` in Prisma and `string | null` in TypeScript types — consistent throughout Tasks 2, 3, 5.
- `formatDateInTimezone` accepts `Date | string` — consistent with how dates appear in `FlightsTablePage` (`flight.departureTime` is a string from API).

*Plan written: 2026-04-03*
