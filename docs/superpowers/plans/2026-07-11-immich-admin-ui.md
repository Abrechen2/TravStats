# Immich Admin UI + "External services" rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a UI to configure the global Immich instance, and rename the section that hosts it from "API keys" to "External services" in both the admin area and user settings.

**Architecture:** Frontend only — the backend (`routes/admin/immich.ts`, the `admin_settings.global_immich_*` columns, the user → admin-global → env resolver) is already complete and tested. The new `ImmichGlobalSettings` component is **self-contained** (zero props, fetches and saves itself), following `UsageStatsSettings` rather than the prop-drilled `GlobalApiKeysManager`, because `AdminPage.tsx` is already 821 lines — over the 800-line hard cap.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Vitest + Testing Library, react-i18next (via the project wrapper `hooks/useTranslation`), Tailwind + CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-07-11-immich-admin-ui-design.md`
**Issue:** #182 · **Branch:** `dev/immich-albums` (already merged up to `main`)

## Global Constraints

- `any` is **forbidden** — use `unknown` + type guards.
- i18n: **DE and EN are written together**, never one without the other. DE is the primary copy.
- `useTranslation` is imported from `"../../hooks/useTranslation"` (project wrapper), never from `react-i18next`.
- No `console.log`. Use `logger` from `"../../lib/logger"`.
- Prettier: `printWidth: 100`, `singleQuote: false`.
- Files: 200–400 lines ideal, **800 hard maximum**. `AdminPage.tsx` is at 821 — it may only grow by the two lines that import and render the new component.
- **Out of scope, do not add:** an `allowUserImmich` toggle; any change to `settings:apiTokens` (those are the mobile-app personal access tokens).
- Known pre-existing backend test flakes, **not caused by this work**: `parser.domain.test.ts` (live-LLM 30 s timeout) and `cruises.test.ts` (teardown deadlock). Everything else must be green.

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/sectionAliases.ts` | **Create.** Maps legacy section ids (`apiKeys`, `apikeys`) to `externalServices`. One export: `normalizeSectionId`. |
| `frontend/src/lib/api/immich.ts` | **Modify.** Gains `failureKey`, next to the `FAILURE_KINDS` vocabulary that defines it. |
| `frontend/src/components/Settings/ImmichConnectionCard.tsx` | **Modify.** Drops its private `failureKey`, imports the shared one. |
| `frontend/src/components/Settings/__tests__/ImmichConnectionCard.test.tsx` | **Modify.** Its `vi.mock` factory must also export `failureKey`, or the component gets `undefined`. |
| `frontend/src/pages/AdminPage.tsx` | **Modify.** `apiKeys` → `externalServices` in the union + tab map + section list + render guard; normalize the `?section=` read; import + render `ImmichGlobalSettings`. |
| `frontend/src/pages/SettingsPage.tsx` | **Modify.** `apikeys` → `externalServices`; normalize the `?section=` read **and** the hash read. |
| `frontend/src/components/Admin/ImmichGlobalSettings.tsx` | **Create.** Self-contained admin card for the global Immich connection. |
| `frontend/src/components/Admin/__tests__/ImmichGlobalSettings.test.tsx` | **Create.** Behaviour: masked key, unchanged-key save, clear, test-stored, error kinds. |
| `frontend/src/lib/__tests__/sectionAliases.test.ts` | **Create.** Legacy deep links keep resolving. |
| `frontend/src/i18n/resources/{de,en}/admin.json` | **Modify.** `tabs.apiKeys` → `tabs.externalServices`. |
| `frontend/src/i18n/resources/{de,en}/settings.json` | **Modify.** New `externalServices.title` / `.description`; `apiKeys.title` / `.description` removed. The other 28 `apiKeys.*` keys stay — they are the API-key card's own copy. |
| `frontend/src/i18n/resources/{de,en}/immich.json` | **Modify.** New `admin.*` subtree. |

---

### Task 1: Share `failureKey` between both Immich cards

`failureKey` is a private three-line function in `ImmichConnectionCard`. The new admin card needs the same mapping. Move it to where the failure vocabulary already lives, so a future seventh kind cannot be handled in one card and forgotten in the other.

**Files:**
- Modify: `frontend/src/lib/api/immich.ts` (after `immichFailureKind`, ~line 37)
- Modify: `frontend/src/components/Settings/ImmichConnectionCard.tsx:1-14`
- Modify: `frontend/src/components/Settings/__tests__/ImmichConnectionCard.test.tsx:26-33`
- Test: `frontend/src/lib/api/__tests__/immich.test.ts`

**Interfaces:**
- Produces: `export function failureKey(kind: unknown): string` in `lib/api/immich.ts` — returns `` `errors.${kind}` `` for a known kind, `"errors.unknown"` otherwise. Task 3 consumes it.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/api/__tests__/immich.test.ts`:

```ts
import { failureKey } from "../immich";

describe("failureKey", () => {
  it("maps every known kind to its errors.* key", () => {
    expect(failureKey("auth")).toBe("errors.auth");
    expect(failureKey("notConfigured")).toBe("errors.notConfigured");
    expect(failureKey("invalidUrl")).toBe("errors.invalidUrl");
  });

  it("falls back to errors.unknown for anything else", () => {
    // Never assert a network claim (`unreachable`) the app has not established,
    // and never leak raw backend prose into the UI.
    expect(failureKey("somethingNewFromTheBackend")).toBe("errors.unknown");
    expect(failureKey(undefined)).toBe("errors.unknown");
    expect(failureKey(null)).toBe("errors.unknown");
    expect(failureKey(42)).toBe("errors.unknown");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/lib/api/__tests__/immich.test.ts`
Expected: FAIL — `failureKey` is not exported from `../immich`.

- [ ] **Step 3: Move the function into `lib/api/immich.ts`**

Insert directly below `immichFailureKind` (which ends around line 37), before `export const immichApi = {`:

```ts
/**
 * Resolve a failure kind to its localized i18n key inside the `immich`
 * namespace. An unknown or absent kind (a future backend value, or a
 * validation error carrying no kind) falls back to a NEUTRAL generic string —
 * never `unreachable`, which would assert a network claim the app has not
 * established, and never the raw backend prose.
 *
 * Lives here rather than in a card because both the user card and the admin
 * card render the same vocabulary; a seventh kind must not be handled in one
 * and forgotten in the other.
 */
export function failureKey(kind: unknown): string {
  return isImmichFailureKind(kind) ? `errors.${kind}` : "errors.unknown";
}
```

- [ ] **Step 4: Delete the private copy and import the shared one**

In `frontend/src/components/Settings/ImmichConnectionCard.tsx`, delete the whole doc-comment + `function failureKey(...)` block (lines 6-14) and change the import on line 3 to:

```ts
import { failureKey, immichApi, immichFailureKind } from "../../lib/api/immich";
```

`isImmichFailureKind` is no longer used by this file — drop it from the import, or eslint `--max-warnings 0` will fail on the unused binding.

- [ ] **Step 5: Teach the existing card test's mock about the new export**

`ImmichConnectionCard.test.tsx` replaces the whole `lib/api/immich` module with a factory. If the factory does not export `failureKey`, the component imports `undefined` and every render throws. Extend the factory (around line 26) so it exports it too:

```ts
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getSettings, updateSettings, testConnection },
  isImmichFailureKind: (v: unknown) => typeof v === "string" && FAILURE_KINDS.includes(v),
  immichFailureKind: (error: unknown) => {
    const kind = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
    return typeof kind === "string" && FAILURE_KINDS.includes(kind) ? kind : null;
  },
  failureKey: (kind: unknown) =>
    typeof kind === "string" && FAILURE_KINDS.includes(kind) ? `errors.${kind}` : "errors.unknown",
}));
```

- [ ] **Step 6: Run the affected tests and the typechecker**

Run: `cd frontend && npx vitest --run src/lib/api/__tests__/immich.test.ts src/components/Settings/__tests__/ImmichConnectionCard.test.tsx && npx tsc --noEmit && npm run lint`
Expected: all PASS, tsc clean, lint clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api/immich.ts \
        frontend/src/lib/api/__tests__/immich.test.ts \
        frontend/src/components/Settings/ImmichConnectionCard.tsx \
        frontend/src/components/Settings/__tests__/ImmichConnectionCard.test.tsx
git commit -m "refactor(immich): share failureKey between the user and admin cards"
```

---

### Task 2: Rename the section to "External services", keeping old links alive

The section that will host Immich is called "API keys" in both the admin area and the user settings. That name is why the missing admin UI went unnoticed — nobody looks for an Immich instance under "API keys". Rename the section id and its label in both places, and alias the legacy ids so existing bookmarks still land correctly.

The **section** becomes "External services". The API-key **card inside it** keeps its own copy (`settings:apiKeys.help.*`, `.openai`, `.airlabs`, …) — that copy really is about API keys.

**Files:**
- Create: `frontend/src/lib/sectionAliases.ts`
- Create: `frontend/src/lib/__tests__/sectionAliases.test.ts`
- Modify: `frontend/src/pages/AdminPage.tsx:48-58` (union), `:68-79` (tab map), `:126` (param read), `:497` (section list), `:728` (render guard)
- Modify: `frontend/src/pages/SettingsPage.tsx:100` (section list), `:154` (param read), `:178` (hash read), `:392` (render guard)
- Modify: `frontend/src/i18n/resources/{de,en}/admin.json`, `frontend/src/i18n/resources/{de,en}/settings.json`

**Interfaces:**
- Produces: `export function normalizeSectionId(raw: string | null): string | null` in `lib/sectionAliases.ts`. Both pages consume it at every site that reads a section id out of the URL.
- Produces: the section id string `"externalServices"`, used by Task 4's render guard.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/__tests__/sectionAliases.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeSectionId } from "../sectionAliases";

describe("normalizeSectionId", () => {
  it("maps the admin's legacy id to the new one", () => {
    expect(normalizeSectionId("apiKeys")).toBe("externalServices");
  });

  it("maps the settings page's legacy id, which is spelled differently", () => {
    // AdminPage used "apiKeys", SettingsPage used "apikeys" (lowercase k).
    // Both are in the wild in bookmarks; both must survive.
    expect(normalizeSectionId("apikeys")).toBe("externalServices");
  });

  it("passes every other id through untouched", () => {
    expect(normalizeSectionId("system")).toBe("system");
    expect(normalizeSectionId("cruisePreferences")).toBe("cruisePreferences");
    expect(normalizeSectionId("externalServices")).toBe("externalServices");
  });

  it("passes null and the empty string through", () => {
    // The hash read site does `window.location.hash.slice(1)`, which is "" when
    // there is no hash — it must stay falsy, not become a section.
    expect(normalizeSectionId(null)).toBeNull();
    expect(normalizeSectionId("")).toBe("");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/lib/__tests__/sectionAliases.test.ts`
Expected: FAIL — cannot resolve `../sectionAliases`.

- [ ] **Step 3: Create the alias module**

Create `frontend/src/lib/sectionAliases.ts`:

```ts
/**
 * The section hosting external integrations used to be called "API keys" —
 * `apiKeys` on the admin page, `apikeys` (lowercase k) in user settings. It was
 * renamed to `externalServices` when the global Immich connection moved in,
 * because nobody looks for an Immich instance under "API keys" (see #182).
 *
 * Both pages read the active section out of the URL — from `?section=`, and in
 * user settings also from the hash. Bookmarks and copy-pasted links still carry
 * the old ids, so every read site funnels through `normalizeSectionId`;
 * otherwise an old link silently drops the user on the default section.
 */
const SECTION_ALIASES: Readonly<Record<string, string>> = {
  apiKeys: "externalServices",
  apikeys: "externalServices",
};

export function normalizeSectionId(raw: string | null): string | null {
  if (raw === null) return null;
  return SECTION_ALIASES[raw] ?? raw;
}
```

- [ ] **Step 4: Run the test — it must pass**

Run: `cd frontend && npx vitest --run src/lib/__tests__/sectionAliases.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rename in `AdminPage.tsx`**

Add the import next to the other `lib` imports:

```ts
import { normalizeSectionId } from "../lib/sectionAliases";
```

In the `ActiveSection` union (line ~56), replace `| "apiKeys"` with:

```ts
  | "externalServices"
```

In `TAB_FOR_SECTION` (line ~73), replace `apiKeys: "general",` with:

```ts
  externalServices: "general",
```

At the param read (line ~126), wrap it:

```ts
  const initialSectionParam = normalizeSectionId(
    searchParams.get("section")
  ) as ActiveSection | null;
```

In `allSections` (line ~497), replace the `apiKeys` entry with:

```ts
    { id: "externalServices", label: t("admin:tabs.externalServices") },
```

At the render guard (line ~728), replace `{activeSection === "apiKeys" && (` with:

```tsx
          {activeSection === "externalServices" && (
```

- [ ] **Step 6: Rename in `SettingsPage.tsx`**

Add the import:

```ts
import { normalizeSectionId } from "../lib/sectionAliases";
```

In the `general` section list (line ~100), replace the `apikeys` entry with:

```ts
      { id: "externalServices", label: t("settings:externalServices.title") || "External services" },
```

At the param read (line ~154):

```ts
  const initialSection = normalizeSectionId(searchParams.get("section"));
```

At the hash read (line ~178), inside the legacy-deep-link effect:

```ts
    const hash = normalizeSectionId(window.location.hash.slice(1));
    if (!hash) return;
```

At the render guard (line ~392), replace `{activeSection === "apikeys" && (` with:

```tsx
            {activeSection === "externalServices" && (
```

- [ ] **Step 7: Rename the i18n keys — DE and EN together**

`frontend/src/i18n/resources/de/admin.json` — inside `tabs`, replace `"apiKeys": "API-Schlüssel"` with:

```json
    "externalServices": "Externe Dienste",
```

`frontend/src/i18n/resources/en/admin.json` — inside `tabs`, replace `"apiKeys": "API Keys"` with:

```json
    "externalServices": "External services",
```

`frontend/src/i18n/resources/de/settings.json` — **remove** `title` and `description` from the `apiKeys` object (leave its other 28 keys untouched) and add a new top-level `externalServices` object:

```json
  "externalServices": {
    "title": "Externe Dienste",
    "description": "Verbindungen zu externen Diensten — API-Schlüssel für Flugdaten und deine Immich-Instanz. Vom Administrator bereitgestellte Verbindungen werden automatisch verwendet."
  },
```

`frontend/src/i18n/resources/en/settings.json` — same shape:

```json
  "externalServices": {
    "title": "External services",
    "description": "Connections to external services — API keys for flight data, and your Immich instance. Connections provided by the administrator are used automatically."
  },
```

- [ ] **Step 8: Find every remaining reference and fix it**

Run: `cd frontend && grep -rn '"apiKeys"\|"apikeys"\|apiKeys\.title\|apiKeys\.description\|tabs\.apiKeys' src --include=*.ts --include=*.tsx --include=*.json`

Expected: the only surviving hits are `settings:apiKeys.*` content keys (`help`, `openai`, `airlabs`, …), `parser.apiKeys.*`, and the aliases inside `sectionAliases.ts`. Any hit in `AdminPage.tsx` or `SettingsPage.tsx` is a miss — fix it.

- [ ] **Step 9: Typecheck, lint, full suite**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: tsc clean (the union rename makes TypeScript point at any site you missed), lint clean, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/sectionAliases.ts \
        frontend/src/lib/__tests__/sectionAliases.test.ts \
        frontend/src/pages/AdminPage.tsx \
        frontend/src/pages/SettingsPage.tsx \
        frontend/src/i18n/resources/de/admin.json \
        frontend/src/i18n/resources/en/admin.json \
        frontend/src/i18n/resources/de/settings.json \
        frontend/src/i18n/resources/en/settings.json
git commit -m "refactor(settings): rename the API-keys section to External services (#182)

The section hosts more than keys, and it is where the global Immich
connection belongs — but nobody looks for an Immich instance under
\"API keys\". Legacy ids (apiKeys / apikeys) alias to the new one so
bookmarked deep links keep resolving."
```

---

### Task 3: The `ImmichGlobalSettings` card

A self-contained admin card driving the three existing endpoints. Zero props, like `UsageStatsSettings` — `AdminPage.tsx` is over its line budget and must not absorb another six props' worth of state.

Semantics that the backend already enforces and this card must respect:
- `GET` returns the key **masked** (`abcd****wxyz`) — unlike the *user* card, which only gets a `hasKey` boolean.
- Sending a masked value back in the `PUT` means **"unchanged"**; the server refuses to store it (`looksMasked`).
- Sending `null` **clears** a field (`immichConnectionSchema` is `.nullable().optional()`).
- `POST /test` with **no** fields tests the **stored** connection; with fields, it tests that ad-hoc pair before saving.

**Files:**
- Create: `frontend/src/components/Admin/ImmichGlobalSettings.tsx`
- Create: `frontend/src/components/Admin/__tests__/ImmichGlobalSettings.test.tsx`
- Modify: `frontend/src/i18n/resources/{de,en}/immich.json`

**Interfaces:**
- Consumes: `failureKey` from `lib/api/immich` (Task 1); `immichApi.getAdminSettings` / `.updateAdminSettings` / `.testAdminConnection`, which already exist at `lib/api/immich.ts:59-78`.
- Produces: `export default function ImmichGlobalSettings(): JSX.Element` — **no props**. Task 4 renders it.

- [ ] **Step 1: Add the i18n keys — DE and EN together**

`frontend/src/i18n/resources/de/immich.json`, new top-level `admin` object (alongside the existing `title`, `errors`, …):

```json
  "admin": {
    "title": "Immich (instanzweit)",
    "subtitle": "Eine Immich-Instanz für alle Nutzer. Wer eine eigene hinterlegt, überschreibt sie.",
    "baseUrl": "Basis-URL",
    "baseUrlPlaceholder": "https://immich.example.com",
    "apiKey": "API-Schlüssel",
    "apiKeyPlaceholder": "Immich API-Schlüssel",
    "apiKeyHint": "Der gespeicherte Schlüssel wird nur maskiert angezeigt. Lässt du ihn unverändert, bleibt er erhalten.",
    "test": "Verbindung testen",
    "testing": "Teste …",
    "save": "Speichern",
    "saving": "Speichere …",
    "saved": "Instanzweite Immich-Verbindung gespeichert.",
    "cleared": "Instanzweite Immich-Verbindung entfernt.",
    "saveFailed": "Speichern fehlgeschlagen."
  },
```

`frontend/src/i18n/resources/en/immich.json`:

```json
  "admin": {
    "title": "Immich (instance-wide)",
    "subtitle": "One Immich instance for every user. Anyone who configures their own overrides it.",
    "baseUrl": "Base URL",
    "baseUrlPlaceholder": "https://immich.example.com",
    "apiKey": "API key",
    "apiKeyPlaceholder": "Immich API key",
    "apiKeyHint": "The stored key is only ever shown masked. Leave it untouched to keep it.",
    "test": "Test connection",
    "testing": "Testing …",
    "save": "Save",
    "saving": "Saving …",
    "saved": "Instance-wide Immich connection saved.",
    "cleared": "Instance-wide Immich connection removed.",
    "saveFailed": "Could not save."
  },
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/Admin/__tests__/ImmichGlobalSettings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getAdminSettings, updateAdminSettings, testAdminConnection } = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  updateAdminSettings: vi.fn(),
  testAdminConnection: vi.fn(),
}));

const FAILURE_KINDS = ["notConfigured", "unreachable", "auth", "notFound", "protocol", "invalidUrl"];

vi.mock("../../../lib/api/immich", () => ({
  immichApi: { getAdminSettings, updateAdminSettings, testAdminConnection },
  isImmichFailureKind: (v: unknown) => typeof v === "string" && FAILURE_KINDS.includes(v),
  failureKey: (kind: unknown) =>
    typeof kind === "string" && FAILURE_KINDS.includes(kind) ? `errors.${kind}` : "errors.unknown",
}));

// The wrapper returns the key itself, so assertions read as i18n keys.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import ImmichGlobalSettings from "../ImmichGlobalSettings";

beforeEach(() => {
  vi.clearAllMocks();
  getAdminSettings.mockResolvedValue({ baseUrl: "https://immich.example.com", apiKey: "abcd****wxyz" });
  updateAdminSettings.mockResolvedValue({ baseUrl: "https://immich.example.com", apiKey: "abcd****wxyz" });
  testAdminConnection.mockResolvedValue({ success: true, message: "", details: { version: "3.0.2" } });
});

describe("ImmichGlobalSettings", () => {
  it("shows the stored connection with the key MASKED, never in plaintext", async () => {
    render(<ImmichGlobalSettings />);
    expect(await screen.findByDisplayValue("https://immich.example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("abcd****wxyz")).toBeInTheDocument();
  });

  it("saving an untouched key sends the mask back, never a new secret", async () => {
    // The backend's `looksMasked()` treats an echoed mask as "unchanged". The
    // card must therefore send the mask verbatim rather than an empty string,
    // which would be a real value and would wipe the stored key.
    render(<ImmichGlobalSettings />);
    await screen.findByDisplayValue("abcd****wxyz");
    await userEvent.click(screen.getByRole("button", { name: "admin.save" }));

    await waitFor(() => expect(updateAdminSettings).toHaveBeenCalledTimes(1));
    expect(updateAdminSettings).toHaveBeenCalledWith({
      baseUrl: "https://immich.example.com",
      apiKey: "abcd****wxyz",
    });
  });

  it("clearing both fields sends null for both and reports the connection removed", async () => {
    render(<ImmichGlobalSettings />);
    const url = await screen.findByDisplayValue("https://immich.example.com");
    const key = screen.getByDisplayValue("abcd****wxyz");
    updateAdminSettings.mockResolvedValue({ baseUrl: null, apiKey: null });

    await userEvent.clear(url);
    await userEvent.clear(key);
    await userEvent.click(screen.getByRole("button", { name: "admin.save" }));

    await waitFor(() => expect(updateAdminSettings).toHaveBeenCalledTimes(1));
    expect(updateAdminSettings).toHaveBeenCalledWith({ baseUrl: null, apiKey: null });
    expect(addToast).toHaveBeenCalledWith("success", "admin.cleared");
  });

  it("testing with untouched fields tests the STORED connection", async () => {
    // Empty strings would trip the schema's .min(1); the route falls back to the
    // stored pair only when the fields are absent.
    getAdminSettings.mockResolvedValue({ baseUrl: null, apiKey: null });
    render(<ImmichGlobalSettings />);
    await screen.findByRole("button", { name: "admin.test" });

    await userEvent.click(screen.getByRole("button", { name: "admin.test" }));

    await waitFor(() => expect(testAdminConnection).toHaveBeenCalledTimes(1));
    expect(testAdminConnection).toHaveBeenCalledWith({});
  });

  it("renders a localized message for a known failure kind", async () => {
    testAdminConnection.mockRejectedValue({ response: { data: { error: "auth" } } });
    render(<ImmichGlobalSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "admin.test" }));

    expect(await screen.findByText("errors.auth")).toBeInTheDocument();
  });

  it("falls back to errors.unknown for an unrecognised failure", async () => {
    testAdminConnection.mockRejectedValue({ response: { data: { error: "brand-new-kind" } } });
    render(<ImmichGlobalSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "admin.test" }));

    expect(await screen.findByText("errors.unknown")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/components/Admin/__tests__/ImmichGlobalSettings.test.tsx`
Expected: FAIL — cannot resolve `../ImmichGlobalSettings`.

- [ ] **Step 4: Write the component**

Create `frontend/src/components/Admin/ImmichGlobalSettings.tsx`:

```tsx
import { useEffect, useState } from "react";
import { failureKey, immichApi, isImmichFailureKind } from "../../lib/api/immich";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import type { ImmichTestResult } from "../../types/immich";

/**
 * Instance-wide Immich connection (tier 2 of the resolver: user → admin-global
 * → env). Self-contained on purpose — AdminPage is already over its line budget
 * and must not grow another block of state.
 *
 * The API key round-trips MASKED. Echoing the mask back in the PUT is how the
 * backend (`looksMasked`) recognises "unchanged"; sending an empty string would
 * be a real value and would wipe the stored key. Sending `null` clears it.
 */
export default function ImmichGlobalSettings(): JSX.Element {
  const { t } = useTranslation(["immich", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ImmichTestResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void immichApi
      .getAdminSettings()
      .then((settings) => {
        if (cancelled) return;
        setBaseUrl(settings.baseUrl ?? "");
        setApiKey(settings.apiKey ?? "");
      })
      .catch((error: unknown) => logger.debug("failed to load global immich settings", error))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setTestResult(null);
    const trimmedUrl = baseUrl.trim();
    const trimmedKey = apiKey.trim();
    try {
      // An empty field is an explicit "remove this"; a filled one is sent as-is
      // (a masked key means "keep the stored one" to the backend).
      const next = await immichApi.updateAdminSettings({
        baseUrl: trimmedUrl === "" ? null : trimmedUrl,
        apiKey: trimmedKey === "" ? null : trimmedKey,
      });
      setBaseUrl(next.baseUrl ?? "");
      setApiKey(next.apiKey ?? "");
      addToast("success", next.baseUrl === null ? t("immich:admin.cleared") : t("immich:admin.saved"));
    } catch (error) {
      logger.debug("failed to save global immich settings", error);
      addToast("error", t("immich:admin.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    const trimmedUrl = baseUrl.trim();
    const trimmedKey = apiKey.trim();
    try {
      // Omit empty fields entirely: the route falls back to the STORED pair only
      // when they are absent. An empty string would trip the schema's .min(1).
      const payload: { baseUrl?: string; apiKey?: string } = {};
      if (trimmedUrl !== "") payload.baseUrl = trimmedUrl;
      if (trimmedKey !== "") payload.apiKey = trimmedKey;
      setTestResult(await immichApi.testAdminConnection(payload));
    } catch (error) {
      // A thrown error carries the same machine-readable `kind` vocabulary as a
      // 200 with success:false, so both paths render through failureKey.
      const kind = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
      setTestResult({
        success: false,
        message: "",
        kind: isImmichFailureKind(kind) ? kind : undefined,
      });
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) {
    return <p style={{ color: "var(--text-muted)" }}>{t("common:loading.title")}</p>;
  }

  return (
    <section className="flex flex-col gap-4 p-6">
      <div>
        <h3 className="font-medium" style={{ color: "var(--text-primary)" }}>
          {t("immich:admin.title")}
        </h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("immich:admin.subtitle")}
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm" htmlFor="immich-admin-base-url">
        <span style={{ color: "var(--text-primary)" }}>{t("immich:admin.baseUrl")}</span>
        <input
          id="immich-admin-base-url"
          className="w-full rounded border p-2"
          style={{ borderColor: "var(--color-border)", background: "var(--bg-elevated)" }}
          placeholder={t("immich:admin.baseUrlPlaceholder")}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm" htmlFor="immich-admin-api-key">
        <span style={{ color: "var(--text-primary)" }}>{t("immich:admin.apiKey")}</span>
        <input
          id="immich-admin-api-key"
          className="w-full rounded border p-2"
          style={{ borderColor: "var(--color-border)", background: "var(--bg-elevated)" }}
          placeholder={t("immich:admin.apiKeyPlaceholder")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("immich:admin.apiKeyHint")}
        </span>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing || saving}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          style={{ borderColor: "var(--color-border)", color: "var(--text-primary)" }}
        >
          {testing ? t("immich:admin.testing") : t("immich:admin.test")}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || testing}
          className="rounded-md px-3 py-1.5 text-sm bg-blue-600 text-white disabled:opacity-50"
        >
          {saving ? t("immich:admin.saving") : t("immich:admin.save")}
        </button>
      </div>

      {testResult && (
        <p className={`text-sm ${testResult.success ? "text-emerald-400" : "text-rose-400"}`}>
          {testResult.success
            ? t("immich:connected", { version: testResult.details?.version ?? "?" })
            : t(`immich:${failureKey(testResult.kind)}`)}
        </p>
      )}
    </section>
  );
}
```

Note the two guards used above are the **existing** exports from `lib/api/immich` — `failureKey` (Task 1) and `isImmichFailureKind`. Do not invent a local narrowing helper; the whole point of Task 1 was to have one source for this vocabulary.

- [ ] **Step 5: Run the tests — they must pass**

Run: `cd frontend && npx vitest --run src/components/Admin/__tests__/ImmichGlobalSettings.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck and lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: clean. If `ImmichTestResult.kind` is not optional in `types/immich.ts`, read the type and match it rather than casting.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Admin/ImmichGlobalSettings.tsx \
        frontend/src/components/Admin/__tests__/ImmichGlobalSettings.test.tsx \
        frontend/src/i18n/resources/de/immich.json \
        frontend/src/i18n/resources/en/immich.json
git commit -m "feat(immich): admin card for the instance-wide Immich connection (#182)"
```

---

### Task 4: Wire it in, verify end to end, review

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx` (import + render — **two lines only**)

**Interfaces:**
- Consumes: `ImmichGlobalSettings` (Task 3), the `externalServices` section id (Task 2).

- [ ] **Step 1: Render it below the API-keys card**

In `AdminPage.tsx`, add the import next to the other Admin components:

```ts
import ImmichGlobalSettings from "../components/Admin/ImmichGlobalSettings";
```

Inside the `externalServices` render guard (Task 2, Step 5), wrap the existing `<GlobalApiKeysManager …/>` and the new card in a fragment so both render in the section:

```tsx
          {activeSection === "externalServices" && (
            <>
              <GlobalApiKeysManager
                globalApiKeys={globalApiKeys}
                parserSettings={
                  parserSettings ? { allowUserApiKeys: parserSettings.allowUserApiKeys } : null
                }
                saving={savingGlobalApiKeys || savingParsers}
                onSave={handleSaveGlobalApiKeys}
                onGlobalApiKeysChange={setGlobalApiKeys}
                onParserSettingsChange={(apiKeySettings: ParserApiKeySettings) => {
                  if (parserSettings) {
                    setParserSettings({
                      ...parserSettings,
                      allowUserApiKeys: apiKeySettings.allowUserApiKeys,
                    });
                  }
                }}
              />
              <ImmichGlobalSettings />
            </>
          )}
```

- [ ] **Step 2: Check the line budget**

Run: `cd frontend && wc -l src/pages/AdminPage.tsx`
Expected: within a handful of lines of the 821 it started at. If it grew substantially, state was pulled into the page — move it back into the component.

- [ ] **Step 3: Full frontend verification**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: tsc clean, lint clean, every test passes.

- [ ] **Step 4: Backend verification (nothing should have changed, prove it)**

Run: `cd backend && npx tsc --noEmit && npm run lint`
Expected: clean. No backend file is touched by this plan.

- [ ] **Step 5: Drive it in a real browser**

Start the dev stack from **this worktree** (ports 8000/3000 may be busy — use 8002/3002 if so):

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  PORT=8002 FRONTEND_URL=http://localhost:3002 CORS_ORIGIN=http://localhost:3002 \
  NODE_ENV=development COOKIE_SECURE=false npx tsx src/index.ts
cd frontend && VITE_API_URL=http://localhost:8002 npx vite --port 3002 --host 0.0.0.0
```

Log in as `admin` / `admin123`. Verify, with your eyes:

1. The admin sidebar reads **"Externe Dienste"**, not "API-Schlüssel".
2. The Immich card is there, below the flight API keys.
3. Saving a bogus URL + key, then reloading, shows the key **masked** — never in plaintext.
4. **Test connection** against a wrong URL renders a localized error, not a raw key or English backend prose.
5. Clearing both fields and saving removes the connection.
6. `/admin?section=apiKeys` (the legacy link) still lands on the renamed section.
7. In **user settings**, the sidebar also reads "Externe Dienste", and `/settings?section=apikeys` still resolves.

A green test suite is not evidence the UI works — this step is the evidence. (2.3.0 shipped a dialog that never rendered while every test passed.)

- [ ] **Step 6: Cold review by Codex**

The reviewer must not have this conversation's context. Give it the diff and the spec only:

```bash
cd /d/TravStats_Projekt/TravStats/.claude/worktrees/immich-albums
git diff main...HEAD -- frontend/ > /tmp/immich-admin.diff
codex exec "Review this frontend diff for TravStats (React 18 + TS strict). Spec: docs/superpowers/specs/2026-07-11-immich-admin-ui-design.md. Focus on: (1) the masked-API-key round trip — can a stored secret ever be wiped or leaked? (2) the section rename — is any read site of the section id left unnormalized, so a legacy deep link breaks? (3) i18n — is any key referenced but missing in DE or EN, which would render the raw key on screen? Be adversarial; report only defects you can point at a line for."
```

Treat the findings as input, not as authority — verify each against the code before acting.

- [ ] **Step 7: Commit and close out**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat(immich): render the global Immich card in External services (#182)"
```

Then report to the owner: the merge blocker is cleared, and `dev/immich-albums` is ready for `superpowers:finishing-a-development-branch` together with #179 and #181.

---

## Self-Review

**Spec coverage.** Rename in both pages → Task 2. Deep-link alias at all three read sites → Task 2 (Steps 5, 6) + `sectionAliases.test.ts`. `ImmichGlobalSettings`, self-contained → Task 3. Shared `failureKey` → Task 1. i18n DE+EN → Tasks 2 (Step 7) and 3 (Step 1). Tests incl. the alias → Tasks 1-3. Out-of-scope items (`allowUserImmich`, `apiTokens`) are restated in Global Constraints. Browser verification and the Codex review → Task 4.

**Type consistency.** `normalizeSectionId(raw: string | null): string | null` is defined in Task 2 and used with that exact signature in both pages. `failureKey(kind: unknown): string` is defined in Task 1 and consumed in Task 3. `ImmichGlobalSettings` takes no props in Task 3 and is rendered with none in Task 4. The `isImmichFailureKind` guard is imported, not re-invented — Task 3, Step 4 calls that out explicitly, because the first draft of that step invented an `isKind` helper that does not exist.

**Known risk left in place.** `AdminPage.tsx` is over the 800-line cap before this work starts. This plan adds two lines and does not fix that; splitting the page is a separate change and is deliberately not bundled here.
