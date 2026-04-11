# Ollama LLM Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully wire Ollama LLM email parsing into TravStats — from DB-driven config through backend pipeline to an Admin UI with connection test.

**Architecture:** DB fields `ollamaUrl`/`ollamaModel` (already in `admin_settings`) are read by `getAdminParserSettings()` and fed into `getParserConfig()`, which passes them to the `OllamaTextParser` instance. A new Admin UI panel lets admins set the URL/model and test connectivity. `bookingParser.ts` returns the actual parser name instead of hardcoded `'regex'`.

**Tech Stack:** Express/TypeScript, Prisma, React 18, Zustand, react-i18next, Zod, Tailwind

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/services/parsers/types.ts` | Modify | Add `ollamaUrl`/`ollamaModel` to `ParserConfig` |
| `backend/src/services/parsers/text/ollamaTextParser.ts` | Modify | Accept URL/model via constructor instead of env-only |
| `backend/src/services/parsers/providers.ts` | Modify | Forward URL/model from config to `OllamaTextParser` |
| `backend/src/services/parsers/config.ts` | Modify | Load admin settings, populate Ollama fields in config |
| `backend/src/services/bookingParser.ts` | Modify | Fix hardcoded `parserUsed: 'regex'` and `ollamaAvailable: false` |
| `backend/src/routes/admin/parserSettings.ts` | Modify | Expose `ollamaUrl`/`ollamaModel` in GET/PUT; add POST `/test-ollama` |
| `frontend/src/lib/api/admin.ts` | Modify | Add `ollamaUrl`/`ollamaModel` to type signatures; add `testOllamaConnection` |
| `frontend/src/components/Admin/ParserSettings.tsx` | Modify | Add Ollama config panel with URL/model inputs and connection test |
| `frontend/src/pages/AdminPage.tsx` | Modify | Extend `parserSettings` state; wire test-connection handler |
| `frontend/src/i18n/resources/de/admin.json` | Modify | German strings for Ollama panel |
| `frontend/src/i18n/resources/en/admin.json` | Modify | English strings for Ollama panel |

---

## Task 1: Extend `ParserConfig` type with Ollama connection fields

**Files:**
- Modify: `backend/src/services/parsers/types.ts`

- [ ] **Step 1: Add fields to `ParserConfig` interface**

In `backend/src/services/parsers/types.ts`, add two optional fields to the `ParserConfig` interface after `textFallbacks`:

```typescript
export interface ParserConfig {
  visionProvider: VisionProvider | 'auto';
  textProvider: TextProvider | 'auto';
  visionFallbacks: VisionProvider[];
  textFallbacks: TextProvider[];
  /** Ollama server URL — overrides OLLAMA_URL env var */
  ollamaUrl?: string;
  /** Ollama model name — overrides OLLAMA_MODEL env var */
  ollamaModel?: string;
  userId?: string;
}
```

- [ ] **Step 2: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/services/parsers/types.ts
git commit -m "feat(parser): add ollamaUrl/ollamaModel to ParserConfig"
```

---

## Task 2: Make `OllamaTextParser` accept dynamic URL and model

**Files:**
- Modify: `backend/src/services/parsers/text/ollamaTextParser.ts`

- [ ] **Step 1: Refactor constructor to accept optional overrides**

Replace the top-level constants and class definition:

```typescript
// Remove these two const lines at top level:
// const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
// const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:14b";

export class OllamaTextParser implements ITextParser {
  readonly provider: TextProvider = "ollama";
  private readonly url: string;
  private readonly model: string;

  constructor(url?: string, model?: string) {
    this.url = url ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
    this.model = model ?? process.env.OLLAMA_MODEL ?? "qwen2.5:14b";
  }
```

- [ ] **Step 2: Replace all `OLLAMA_URL` / `OLLAMA_MODEL` references inside the class with `this.url` / `this.model`**

In `checkAvailability()`:
```typescript
async checkAvailability(): Promise<ProviderAvailability> {
  try {
    const res = await fetchJson(`${this.url}/api/tags`, "{}");
    const parsed: unknown = JSON.parse(res);
    if (typeof parsed === "object" && parsed !== null && "models" in parsed) {
      return {
        available: true,
        metadata: { url: this.url, model: this.model },
      };
    }
    return { available: false, reason: "Unexpected Ollama response" };
  } catch (err) {
    return {
      available: false,
      reason: `Ollama not reachable at ${this.url}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

In `parseEmail()`:
```typescript
async parseEmail(subject: string, text: string): Promise<ParsedBooking[]> {
  const emailSnippet = text.slice(0, 5000);
  const userPrompt = `Subject: ${subject}\n\n${emailSnippet}`;

  const body = JSON.stringify({
    model: this.model,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    stream: false,
    options: { temperature: 0.1 },
  });

  logger.info({ model: this.model, url: this.url }, "[Ollama Text Parser] Sending email to Ollama");

  const raw = await fetchJson(`${this.url}/api/generate`, body);
  // ... rest unchanged
```

- [ ] **Step 3: Update the singleton factory to support per-URL/model instances**

Replace the singleton at the bottom:
```typescript
const instanceCache = new Map<string, OllamaTextParser>();

export function getOllamaTextParser(url?: string, model?: string): OllamaTextParser {
  const key = `${url ?? "default"}::${model ?? "default"}`;
  if (!instanceCache.has(key)) {
    instanceCache.set(key, new OllamaTextParser(url, model));
  }
  return instanceCache.get(key)!;
}
```

- [ ] **Step 4: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/services/parsers/text/ollamaTextParser.ts
git commit -m "feat(ollama): accept dynamic URL/model in OllamaTextParser constructor"
```

---

## Task 3: Forward Ollama URL/model from `ParserConfig` to the parser instance

**Files:**
- Modify: `backend/src/services/parsers/providers.ts`

- [ ] **Step 1: Update `getTextParserInstance` to accept config**

Replace the signature and `ollama` case:
```typescript
export function getTextParserInstance(provider: TextProvider, config?: ParserConfig): ITextParser {
  switch (provider) {
    case 'regex':
      return getRegexParser();
    case 'ollama':
      return getOllamaTextParser(config?.ollamaUrl, config?.ollamaModel);
    default:
      throw new Error(`Unknown text provider: ${provider}`);
  }
}
```

- [ ] **Step 2: Pass config into `getTextParser` loop**

In `getTextParser()`, update the call inside the loop:
```typescript
// Before:
const parser = getTextParserInstance(provider);
// After:
const parser = getTextParserInstance(provider, config);
```

- [ ] **Step 3: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/services/parsers/providers.ts
git commit -m "feat(parser): forward ollamaUrl/ollamaModel from config to OllamaTextParser"
```

---

## Task 4: Wire admin DB settings into `getParserConfig()`

**Files:**
- Modify: `backend/src/services/parsers/config.ts`

- [ ] **Step 1: Import `getAdminParserSettings`**

Add import at top of file:
```typescript
import { getAdminParserSettings } from '../parserSettings';
```

- [ ] **Step 2: Replace the stub `getParserConfig` with a DB-aware version**

```typescript
export async function getParserConfig(
  _userSettings?: Record<string, unknown>,
  _adminSettings?: Record<string, unknown>,
  userId?: string
): Promise<ParserConfig> {
  const adminSettings = await getAdminParserSettings();

  const ollamaUrl = adminSettings?.ollamaUrl ?? process.env.OLLAMA_URL ?? undefined;
  const ollamaModel = adminSettings?.ollamaModel ?? process.env.OLLAMA_MODEL ?? undefined;

  return {
    visionProvider: 'tesseract',
    textProvider: 'regex',
    visionFallbacks: getDefaultVisionFallbackChain(),
    textFallbacks: getDefaultTextFallbackChain(),
    ollamaUrl: ollamaUrl ?? undefined,
    ollamaModel: ollamaModel ?? undefined,
    userId,
  };
}
```

- [ ] **Step 3: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/services/parsers/config.ts
git commit -m "feat(parser): load ollamaUrl/ollamaModel from DB admin settings"
```

---

## Task 5: Fix `bookingParser.ts` return metadata

**Files:**
- Modify: `backend/src/services/bookingParser.ts`

The `ParseResult` type has `parserUsed: 'regex'` hardcoded and `ollamaAvailable: false`. These should reflect reality.

- [ ] **Step 1: Broaden `ParseResult.parserUsed` type and fix `ollamaAvailable`**

```typescript
export interface ParseResult {
  flights: ParsedBooking[];
  parserUsed: 'regex' | 'ollama';
  ollamaAvailable: boolean;
  fallbackUsed?: boolean;
}
```

- [ ] **Step 2: Fix `parseBookingEmail` return value**

Replace the final `return` block inside `parseBookingEmail`:
```typescript
// Determine if ollama was available (= it was the preferred provider in config)
const ollamaAvailable = config.textFallbacks.includes('ollama');

return {
  flights: result.flights,
  parserUsed: result.provider as 'regex' | 'ollama',
  ollamaAvailable,
  fallbackUsed: result.fallbackUsed,
};
```

You need `config` in scope — it's already defined as `const config = await getParserConfig(...)` a few lines above. No additional import needed.

- [ ] **Step 3: Fix `parseBookingText` identically** — find the same pattern and apply the same fix.

In `parseBookingText` (around line 109+), apply the same return fix. Read the function body first, then apply:
```typescript
const ollamaAvailable = config.textFallbacks.includes('ollama');

return {
  flights: result.flights,
  parserUsed: result.provider as 'regex' | 'ollama',
  ollamaAvailable,
  fallbackUsed: result.fallbackUsed,
};
```

- [ ] **Step 4: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/services/bookingParser.ts
git commit -m "fix(parser): report actual parserUsed and ollamaAvailable in ParseResult"
```

---

## Task 6: Extend admin API with Ollama config endpoints

**Files:**
- Modify: `backend/src/routes/admin/parserSettings.ts`

- [ ] **Step 1: Extend Zod schema with Ollama fields**

Replace `parserSettingsSchema`:
```typescript
const parserSettingsSchema = z.object({
  allowUserApiKeys: z.boolean().optional(),
  defaultVisionParser: z.string().optional(),
  defaultTextParser: z.string().optional(),
  ollamaUrl: z.string().url("Must be a valid URL").optional().nullable(),
  ollamaModel: z.string().min(1).max(100).optional().nullable(),
});
```

- [ ] **Step 2: Extend `ParserSettingsUpdateData` interface**

```typescript
interface ParserSettingsUpdateData {
  allowUserApiKeys?: boolean;
  defaultVisionParser?: string;
  defaultTextParser?: string;
  ollamaUrl?: string | null;
  ollamaModel?: string | null;
}
```

- [ ] **Step 3: Update GET `/parser-settings` to include Ollama fields**

Replace the `res.json(...)` call in the GET handler:
```typescript
res.json({
  allowUserApiKeys: adminSettings.allowUserApiKeys,
  allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys,
  defaultVisionParser: adminSettings.defaultVisionParser ?? 'tesseract',
  defaultTextParser: adminSettings.defaultTextParser ?? 'regex',
  ollamaUrl: adminSettings.ollamaUrl ?? null,
  ollamaModel: adminSettings.ollamaModel ?? null,
});
```

- [ ] **Step 4: Update PUT `/parser-settings` to save Ollama fields**

In the PUT handler, extend `updateData` population:
```typescript
const { allowUserApiKeys, defaultVisionParser, defaultTextParser, ollamaUrl, ollamaModel } =
  parserSettingsSchema.parse(req.body);

// ... existing updateData assignments, then add:
if (ollamaUrl !== undefined) {
  updateData.ollamaUrl = ollamaUrl;
}
if (ollamaModel !== undefined) {
  updateData.ollamaModel = ollamaModel;
}
```

Also update the PUT response to include the new fields:
```typescript
res.json({
  message: 'Parser settings updated successfully',
  settings: {
    allowUserApiKeys: adminSettings.allowUserApiKeys,
    defaultVisionParser: adminSettings.defaultVisionParser ?? 'tesseract',
    defaultTextParser: adminSettings.defaultTextParser ?? 'regex',
    ollamaUrl: adminSettings.ollamaUrl ?? null,
    ollamaModel: adminSettings.ollamaModel ?? null,
  },
});
```

- [ ] **Step 5: Add POST `/test-ollama` endpoint**

Add this route before `export default router`:
```typescript
router.post('/test-ollama', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ollamaUrl, ollamaModel } = z.object({
      ollamaUrl: z.string().url(),
      ollamaModel: z.string().min(1),
    }).parse(req.body);

    // Try fetching models list
    const tagsUrl = `${ollamaUrl}/api/tags`;
    const parsed = new URL(tagsUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? (await import('https')) : (await import('http'));

    const result = await new Promise<{ ok: boolean; models?: string[]; error?: string }>((resolve) => {
      const req2 = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname,
          method: 'GET',
          timeout: 5000,
        },
        (response) => {
          let data = '';
          response.on('data', (chunk: string) => { data += chunk; });
          response.on('end', () => {
            try {
              const json: unknown = JSON.parse(data);
              if (typeof json === 'object' && json !== null && 'models' in json) {
                const modelsArray = (json as Record<string, unknown>).models;
                const models = Array.isArray(modelsArray)
                  ? modelsArray.map((m: unknown) => {
                      if (typeof m === 'object' && m !== null && 'name' in m) {
                        return String((m as Record<string, unknown>).name);
                      }
                      return String(m);
                    })
                  : [];
                const modelInstalled = models.some((m) => m.startsWith(ollamaModel));
                resolve({ ok: true, models, ...(modelInstalled ? {} : { error: `Model '${ollamaModel}' not found. Installed: ${models.join(', ')}` }) });
              } else {
                resolve({ ok: false, error: 'Unexpected response format' });
              }
            } catch {
              resolve({ ok: false, error: 'Failed to parse Ollama response' });
            }
          });
        }
      );
      req2.on('error', (err: Error) => resolve({ ok: false, error: err.message }));
      req2.on('timeout', () => { req2.destroy(); resolve({ ok: false, error: 'Connection timed out (5s)' }); });
      req2.end();
    });

    if (result.ok) {
      res.json({ success: true, models: result.models, warning: result.error ?? null });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 6: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/routes/admin/parserSettings.ts
git commit -m "feat(admin): expose ollamaUrl/ollamaModel in parser-settings API; add test-ollama endpoint"
```

---

## Task 7: Update frontend API client for Ollama

**Files:**
- Modify: `frontend/src/lib/api/admin.ts`

- [ ] **Step 1: Add `ollamaUrl`/`ollamaModel` to `getAdminParserSettings` return type**

```typescript
getAdminParserSettings: async (): Promise<{
  allowUserApiKeys: boolean;
  defaultVisionParser: string;
  defaultTextParser: string;
  ollamaUrl: string | null;
  ollamaModel: string | null;
}> => {
  const { data } = await api.get<{
    allowUserApiKeys: boolean;
    defaultVisionParser: string;
    defaultTextParser: string;
    ollamaUrl: string | null;
    ollamaModel: string | null;
  }>("/admin/parser-settings");
  return data;
},
```

- [ ] **Step 2: Add `ollamaUrl`/`ollamaModel` to `updateAdminParserSettings` params**

```typescript
updateAdminParserSettings: async (settings: {
  allowUserApiKeys?: boolean;
  ollamaUrl?: string | null;
  ollamaModel?: string | null;
}): Promise<MessageResponse> => {
  const { data } = await api.put<MessageResponse>("/admin/parser-settings", settings);
  return data;
},
```

- [ ] **Step 3: Add `testOllamaConnection` function**

After `updateAdminParserSettings`:
```typescript
testOllamaConnection: async (ollamaUrl: string, ollamaModel: string): Promise<{
  success: boolean;
  models?: string[];
  warning?: string | null;
  error?: string;
}> => {
  const { data } = await api.post<{
    success: boolean;
    models?: string[];
    warning?: string | null;
    error?: string;
  }>("/admin/test-ollama", { ollamaUrl, ollamaModel });
  return data;
},
```

- [ ] **Step 4: Type-check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/lib/api/admin.ts
git commit -m "feat(api): add ollamaUrl/ollamaModel to admin parser settings; add testOllamaConnection"
```

---

## Task 8: Add i18n strings for Ollama admin panel

**Files:**
- Modify: `frontend/src/i18n/resources/de/admin.json`
- Modify: `frontend/src/i18n/resources/en/admin.json`

- [ ] **Step 1: Add German strings**

Find `"parserSettings"` key in `frontend/src/i18n/resources/de/admin.json`. The object currently has `title`, `description`, `defaultSettings`, `defaultSettingsDescription`. Add an `ollama` sub-key after `defaultSettingsDescription`:

```json
"ollama": {
  "title": "Ollama LLM Parser",
  "description": "Ollama läuft lokal oder im Netzwerk und analysiert Buchungsbestätigungen mit einem LLM. Ideal für Multi-Stopp und komplexe E-Mails.",
  "urlLabel": "Ollama URL",
  "urlPlaceholder": "http://192.168.178.155:11434",
  "modelLabel": "Modell",
  "modelPlaceholder": "qwen2.5:14b",
  "testButton": "Verbindung testen",
  "testing": "Wird getestet…",
  "statusConnected": "Verbunden",
  "statusDisconnected": "Nicht erreichbar",
  "modelNotFound": "Modell nicht gefunden",
  "modelsAvailable": "Verfügbare Modelle",
  "connectionSuccess": "Ollama erreichbar",
  "connectionFailed": "Verbindung fehlgeschlagen"
}
```

Also add these toast strings under `"toasts"`:
```json
"ollamaTestSuccess": "Ollama erreichbar – {{count}} Modell(e) gefunden",
"ollamaTestFailed": "Verbindung zu Ollama fehlgeschlagen"
```

- [ ] **Step 2: Add English strings**

Same structure in `frontend/src/i18n/resources/en/admin.json`:

```json
"ollama": {
  "title": "Ollama LLM Parser",
  "description": "Ollama runs locally or on your network and analyzes booking confirmations with an LLM. Ideal for multi-stop and complex emails.",
  "urlLabel": "Ollama URL",
  "urlPlaceholder": "http://192.168.178.155:11434",
  "modelLabel": "Model",
  "modelPlaceholder": "qwen2.5:14b",
  "testButton": "Test Connection",
  "testing": "Testing…",
  "statusConnected": "Connected",
  "statusDisconnected": "Not reachable",
  "modelNotFound": "Model not found",
  "modelsAvailable": "Available models",
  "connectionSuccess": "Ollama reachable",
  "connectionFailed": "Connection failed"
}
```

Toasts:
```json
"ollamaTestSuccess": "Ollama reachable – {{count}} model(s) found",
"ollamaTestFailed": "Ollama connection failed"
```

- [ ] **Step 3: Type-check (frontend)**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/i18n/resources/de/admin.json frontend/src/i18n/resources/en/admin.json
git commit -m "feat(i18n): add Ollama admin panel strings (de + en)"
```

---

## Task 9: Build Ollama config panel in `ParserSettings.tsx`

**Files:**
- Modify: `frontend/src/components/Admin/ParserSettings.tsx`

- [ ] **Step 1: Extend `ParserSettingsData` interface and props**

```typescript
export interface ParserSettingsData {
  allowUserApiKeys: boolean;
  defaultVisionParser: string;
  defaultTextParser: string;
  ollamaUrl: string | null;
  ollamaModel: string | null;
}

interface ParserSettingsProps {
  parserSettings: ParserSettingsData;
  savingParsers: boolean;
  onSave: () => void;
  onParserSettingsChange: (settings: ParserSettingsData) => void;
  onTestOllama: () => void;
  ollamaTestState: { status: 'idle' | 'loading' | 'ok' | 'error' | 'warn'; message?: string };
}
```

- [ ] **Step 2: Add Ollama panel to the JSX**

Add a new section between the "Parser Info" box and "User API Key Permissions" box:

```tsx
import { useTranslation } from "../../hooks/useTranslation";

// Inside the component, after the existing "Parser Info" section:

{/* Ollama LLM Parser */}
<div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
  <div className="flex items-center justify-between mb-2">
    <h3 className="text-lg font-semibold text-[var(--text-primary)]">
      {t("admin:parserSettings.ollama.title")}
    </h3>
    {ollamaTestState.status !== 'idle' && (
      <span
        className={`text-xs font-medium px-2 py-1 rounded-full ${
          ollamaTestState.status === 'ok'
            ? 'bg-green-100 text-green-700'
            : ollamaTestState.status === 'warn'
            ? 'bg-yellow-100 text-yellow-700'
            : ollamaTestState.status === 'error'
            ? 'bg-red-100 text-red-700'
            : 'bg-gray-100 text-gray-500'
        }`}
      >
        {ollamaTestState.status === 'ok' && t("admin:parserSettings.ollama.statusConnected")}
        {ollamaTestState.status === 'warn' && t("admin:parserSettings.ollama.modelNotFound")}
        {ollamaTestState.status === 'error' && t("admin:parserSettings.ollama.statusDisconnected")}
        {ollamaTestState.status === 'loading' && t("admin:parserSettings.ollama.testing")}
      </span>
    )}
  </div>
  <p className="text-sm text-[var(--text-muted)] mb-4">
    {t("admin:parserSettings.ollama.description")}
  </p>
  <div className="space-y-3">
    <div>
      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
        {t("admin:parserSettings.ollama.urlLabel")}
      </label>
      <input
        type="url"
        value={parserSettings.ollamaUrl ?? ""}
        onChange={(e) =>
          onParserSettingsChange({ ...parserSettings, ollamaUrl: e.target.value || null })
        }
        placeholder={t("admin:parserSettings.ollama.urlPlaceholder")}
        className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
    <div>
      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
        {t("admin:parserSettings.ollama.modelLabel")}
      </label>
      <input
        type="text"
        value={parserSettings.ollamaModel ?? ""}
        onChange={(e) =>
          onParserSettingsChange({ ...parserSettings, ollamaModel: e.target.value || null })
        }
        placeholder={t("admin:parserSettings.ollama.modelPlaceholder")}
        className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
    {ollamaTestState.message && (
      <p className="text-xs text-[var(--text-muted)] mt-1">{ollamaTestState.message}</p>
    )}
    <button
      onClick={onTestOllama}
      disabled={ollamaTestState.status === 'loading' || !parserSettings.ollamaUrl || !parserSettings.ollamaModel}
      className="mt-1 px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg hover:bg-[var(--bg-base)] disabled:opacity-50 transition"
    >
      {ollamaTestState.status === 'loading'
        ? t("admin:parserSettings.ollama.testing")
        : t("admin:parserSettings.ollama.testButton")}
    </button>
  </div>
</div>
```

- [ ] **Step 3: Type-check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/components/Admin/ParserSettings.tsx
git commit -m "feat(admin-ui): add Ollama config panel with URL/model inputs and connection test"
```

---

## Task 10: Wire Ollama panel into `AdminPage.tsx`

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: Add `ollamaTestState` local state**

Inside the `AdminPage` component, add:
```typescript
const [ollamaTestState, setOllamaTestState] = useState<{
  status: 'idle' | 'loading' | 'ok' | 'error' | 'warn';
  message?: string;
}>({ status: 'idle' });
```

- [ ] **Step 2: Ensure `parserSettings` state type includes Ollama fields**

Find the `useState` for `parserSettings`:
```typescript
// Before:
const [parserSettings, setParserSettings] = useState<ParserSettingsData | null>(null);
// ParserSettingsData is imported from Admin/ParserSettings — no change needed here
// because we already extended it in Task 9. Just verify the import is correct.
```

Verify the import at the top of `AdminPage.tsx`:
```typescript
import ParserSettingsTab, { ParserSettingsData } from "../components/Admin/ParserSettings";
```

- [ ] **Step 3: Add `handleTestOllama` handler**

```typescript
const handleTestOllama = async (): Promise<void> => {
  if (!parserSettings?.ollamaUrl || !parserSettings?.ollamaModel) return;
  setOllamaTestState({ status: 'loading' });
  try {
    const result = await adminApi.testOllamaConnection(
      parserSettings.ollamaUrl,
      parserSettings.ollamaModel
    );
    if (result.success) {
      const modelCount = result.models?.length ?? 0;
      if (result.warning) {
        setOllamaTestState({
          status: 'warn',
          message: `${result.warning} — ${t("admin:parserSettings.ollama.modelsAvailable")}: ${result.models?.join(', ')}`,
        });
      } else {
        setOllamaTestState({
          status: 'ok',
          message: t("admin:toasts.ollamaTestSuccess", { count: modelCount }),
        });
      }
    } else {
      setOllamaTestState({ status: 'error', message: result.error });
    }
  } catch (error: unknown) {
    setOllamaTestState({
      status: 'error',
      message: getErrorMessage(error, t("admin:toasts.ollamaTestFailed")),
    });
  }
};
```

- [ ] **Step 4: Pass new props to `ParserSettingsTab`**

Find the `<ParserSettingsTab` JSX and add the two new props:
```tsx
<ParserSettingsTab
  parserSettings={parserSettings}
  savingParsers={savingParsers}
  onSave={handleSaveParserSettings}
  onParserSettingsChange={setParserSettings}
  onTestOllama={handleTestOllama}
  ollamaTestState={ollamaTestState}
/>
```

- [ ] **Step 5: Ensure `loadData` maps Ollama fields from API response**

Find the `loadData` function that calls `adminApi.getAdminParserSettings()`. Verify that it maps `ollamaUrl` and `ollamaModel` into `parserSettings` state. It should look like:
```typescript
const parserData = await adminApi.getAdminParserSettings();
setParserSettings({
  allowUserApiKeys: parserData.allowUserApiKeys,
  defaultVisionParser: parserData.defaultVisionParser,
  defaultTextParser: parserData.defaultTextParser,
  ollamaUrl: parserData.ollamaUrl,
  ollamaModel: parserData.ollamaModel,
});
```

If the existing code uses spread like `setParserSettings(parserData)`, that will work automatically since the fields are now present in the API response.

- [ ] **Step 6: Ensure `handleSaveParserSettings` sends Ollama fields**

The existing call is `adminApi.updateAdminParserSettings(parserSettings)`. Since we extended the `updateAdminParserSettings` signature in Task 7, this will automatically include `ollamaUrl`/`ollamaModel` when spread from the state object. Verify the call passes the full `parserSettings` object (not just `{ allowUserApiKeys }`).

- [ ] **Step 7: Type-check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/pages/AdminPage.tsx
git commit -m "feat(admin): wire Ollama panel state and test-connection handler in AdminPage"
```

---

## Task 11: Final integration smoke test

- [ ] **Step 1: Start dev server**

```bash
cd /d/Projekte/TravStats && npm run dev
```
Wait for both backend (port 8000) and frontend (port 3000) to be ready.

- [ ] **Step 2: Verify admin parser settings API returns Ollama fields**

```bash
# Get a JWT first (replace with actual credentials):
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"..."}' \
  -c /tmp/cookies.txt | jq -r '.token // empty')
curl -s http://localhost:8000/api/v1/admin/parser-settings \
  -b /tmp/cookies.txt | jq '{ollamaUrl, ollamaModel}'
```
Expected: `{ "ollamaUrl": "...", "ollamaModel": "..." }` (from DB or null).

- [ ] **Step 3: Test connection endpoint**

```bash
curl -s -X POST http://localhost:8000/api/v1/admin/test-ollama \
  -H "Content-Type: application/json" \
  -b /tmp/cookies.txt \
  -d '{"ollamaUrl":"http://192.168.178.155:11434","ollamaModel":"qwen2.5:14b"}' | jq .
```
Expected: `{ "success": true, "models": [...] }`.

- [ ] **Step 4: Open Admin → Parser tab in browser**

Navigate to `http://localhost:3000` → Admin → Parser Settings tab.
- Verify Ollama section is visible with URL and model fields
- Enter URL `http://192.168.178.155:11434` and model `qwen2.5:14b`
- Click "Verbindung testen" — expect green "Verbunden" badge
- Click Save — verify toast "Parser-Einstellungen erfolgreich gespeichert!"
- Reload page — verify values are persisted

- [ ] **Step 5: Parse a multi-stop email via Parser tab**

Upload the `Buchungsdetails _ Abflug_ 10 Juni 2024 _ MUC-TRD_.msg` file on the Parser page.
Expected: 4 flights extracted (MUC→OSL, OSL→TRD, TRD→OSL, OSL→MUC), `parserTemplate: "ollama"`.

- [ ] **Step 6: Run type-checks and frontend tests**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit && npm run lint
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```
Expected: no errors, all existing tests pass.

- [ ] **Step 7: Final commit**

```bash
cd /d/Projekte/TravStats && git add -p  # stage any remaining tweaks
git commit -m "feat(ollama): complete integration – DB config, pipeline wiring, Admin UI"
```

---

## Self-Review

**Spec coverage:**
- ✅ Ollama URL/model from DB → `getParserConfig()` (Task 4)
- ✅ Dynamic URL/model in `OllamaTextParser` constructor (Task 2)
- ✅ Config forwarded to parser instance (Task 3)
- ✅ `parserUsed` / `ollamaAvailable` fixed (Task 5)
- ✅ Admin API GET/PUT extended (Task 6)
- ✅ Test-connection endpoint (Task 6 Step 5)
- ✅ Frontend API client updated (Task 7)
- ✅ i18n strings de + en (Task 8)
- ✅ Ollama panel UI with URL, model, status badge, test button (Task 9)
- ✅ AdminPage wired up (Task 10)
- ✅ Integration smoke test (Task 11)

**Type consistency:**
- `ParserSettingsData.ollamaUrl/ollamaModel`: `string | null` in all layers (DB, API, frontend state, component props) ✅
- `OllamaTextParser.getOllamaTextParser(url?, model?)`: optional params, instance cache keyed by URL+model ✅
- `getTextParserInstance(provider, config?)`: config is optional (won't break vision path) ✅
- `ParserConfig.ollamaUrl/ollamaModel`: `string | undefined` (DB null → undefined via `?? undefined`) ✅
