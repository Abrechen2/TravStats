# What's-New Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show authenticated users a dismissible "What's new in vX.Y.Z" modal once per version bump, with an `extraSlot` that a later plan fills with the usage-stats consent card.

**Architecture:** A hand-authored content module lists highlights per version. A hook compares the running backend version (from the existing `GET /api/v1/version`) against a `whatsNewSeenVersion` key stored in the user's existing `UserSettings.data` JSON blob. A presentational modal renders the highlights plus an optional `extraSlot` child. No Prisma migration.

**Tech Stack:** React 19, TypeScript (`strict`), Zustand, react-i18next (via the project wrapper), Vitest + Testing Library, Express + Zod backend.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-10-whats-new-modal-design.md`. Read it first.
- Branch: `dev/usage-stats`. Worktree: `.claude/worktrees/usage-stats`. Never `rebase main`; `merge main` only.
- **Never touch `backend/VERSION` or `CHANGELOG.md`** — owned by `/deploy` on `main`.
- `any` is FORBIDDEN. Use `unknown` + type guards. Exception: `.d.ts` files only.
- Backend logging: `import { logger } from '../utils/logger'`. Never `console.log`.
- Frontend translation: `import { useTranslation } from "../hooks/useTranslation"` — **never** from `react-i18next`.
- i18n copy: German is primary, English is a mirror. Both updated in the same change, never one side alone.
- Prettier: `printWidth 100`, `singleQuote: false` (frontend TS/TSX uses double quotes).
- Async: always `async/await`, never `.then()`.
- Immutability: spread `{...obj, field: value}`, never in-place mutation.
- File size: 200–400 lines ideal, 800 hard max.
- Build gates before finishing: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run` and `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`.

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/content/whatsNew.ts` | **Create.** Typed data only — entries + item types. No JSX, no logic. |
| `frontend/src/hooks/useWhatsNew.ts` | **Create.** Resolves version + settings → `{ entry, shouldShow, dismiss }`. |
| `frontend/src/components/WhatsNewModal.tsx` | **Create.** Presentation. Props-driven, renders `extraSlot`. |
| `frontend/src/i18n/resources/de/whatsNew.json` | **Create.** DE copy. |
| `frontend/src/i18n/resources/en/whatsNew.json` | **Create.** EN mirror. |
| `frontend/src/i18n/config.ts` | **Modify.** Register the `whatsNew` namespace (3 places × 2 languages). |
| `frontend/src/lib/api/types.ts` | **Modify.** Add `whatsNewSeenVersion?: string` to `UserSettings`. |
| `frontend/src/App.tsx` | **Modify.** Mount the modal inside `AppContent`, gated on auth. |
| `backend/src/routes/settings/general.ts` | **Modify.** Accept + persist `whatsNewSeenVersion` in the `data` blob. |
| `frontend/src/content/__tests__/whatsNew.i18n.test.ts` | **Create.** Asserts every key resolves in DE **and** EN. |
| `frontend/src/hooks/__tests__/useWhatsNew.test.tsx` | **Create.** Trigger-logic tests. |
| `frontend/src/components/__tests__/WhatsNewModal.test.tsx` | **Create.** Rendering + `extraSlot` tests. |

---

### Task 1: Backend accepts `whatsNewSeenVersion`

**Files:**
- Modify: `backend/src/routes/settings/general.ts`
- Test: `backend/src/__tests__/routes/settings.whatsNew.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `PUT /api/v1/settings` accepts `{ whatsNewSeenVersion: string }` and `GET /api/v1/settings` returns it. Task 3 relies on this round-trip.

Read `backend/src/routes/settings/general.ts` first. It defines a Zod schema
(`.partial()`), a `SettingsDataJson` type, and `buildSettingsResponse()` which
spreads `record.data` into the response. `whatsNewSeenVersion` rides along in that
blob, so the response needs no change — only the schema must stop stripping it.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/routes/settings.whatsNew.test.ts`. Mirror the mock
idiom from `backend/src/services/__tests__/flightEnrichmentService.test.ts`: the
`jest.mock` call must precede the import of the module under test.

```typescript
jest.mock("../../db", () => ({
  prisma: {
    userSettings: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  },
}));

import { settingsUpdateSchema } from "../../routes/settings/general";

describe("settings schema: whatsNewSeenVersion", () => {
  it("accepts a version string", () => {
    const parsed = settingsUpdateSchema.parse({ whatsNewSeenVersion: "2.4.0" });
    expect(parsed.whatsNewSeenVersion).toBe("2.4.0");
  });

  it("rejects a non-string", () => {
    expect(() => settingsUpdateSchema.parse({ whatsNewSeenVersion: 240 })).toThrow();
  });

  it("rejects an over-long value", () => {
    expect(() => settingsUpdateSchema.parse({ whatsNewSeenVersion: "x".repeat(33) })).toThrow();
  });

  it("still accepts a payload without the key", () => {
    expect(() => settingsUpdateSchema.parse({})).not.toThrow();
  });
});
```

If the Zod schema in `general.ts` is not currently exported, export it as
`settingsUpdateSchema` as part of Step 3. Do not rename it if it already has a name —
adapt the import instead.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npm test -- --forceExit settings.whatsNew
```
Expected: FAIL — either "settingsUpdateSchema is not exported" or the first
assertion fails because Zod strips the unknown key (`parsed.whatsNewSeenVersion`
is `undefined`).

- [ ] **Step 3: Widen the schema and the data type**

In `backend/src/routes/settings/general.ts`, add the field to the Zod object
(alongside `enabledDomains`), and export the schema if it is not already exported:

```typescript
  enabledDomains: z.array(z.enum(DOMAIN_KEYS as unknown as [DomainKey, ...DomainKey[]])).optional(),
  whatsNewSeenVersion: z.string().max(32).optional(),
}).partial();
```

Add the key to the `SettingsDataJson` type in the same file so the merge preserves it:

```typescript
  whatsNewSeenVersion?: string;
```

The existing merge path (`data: merged as Prisma.InputJsonValue`) already persists
any key present on the parsed body. No route-handler change and **no migration**.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npm test -- --forceExit settings.whatsNew
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
cd backend && npx tsc --noEmit && npm run lint
git add backend/src/routes/settings/general.ts backend/src/__tests__/routes/settings.whatsNew.test.ts
git commit -m "feat(settings): accept whatsNewSeenVersion in the user settings blob"
```

---

### Task 2: Content module + i18n namespace

**Files:**
- Create: `frontend/src/content/whatsNew.ts`
- Create: `frontend/src/i18n/resources/de/whatsNew.json`
- Create: `frontend/src/i18n/resources/en/whatsNew.json`
- Modify: `frontend/src/i18n/config.ts`
- Test: `frontend/src/content/__tests__/whatsNew.i18n.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WHATS_NEW_ENTRIES: WhatsNewEntry[]`, `findEntryForVersion(version: string): WhatsNewEntry | undefined`, and the exported types `WhatsNewEntry` / `WhatsNewItem`. Tasks 3 and 4 import all four.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/content/__tests__/whatsNew.i18n.test.ts`. This test is the
whole reason the DE/EN mirror never silently rots.

```typescript
import { describe, it, expect } from "vitest";
import { WHATS_NEW_ENTRIES, findEntryForVersion } from "../whatsNew";
import de from "../../i18n/resources/de/whatsNew.json";
import en from "../../i18n/resources/en/whatsNew.json";

function resolve(bundle: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

describe("whatsNew content", () => {
  it("finds an entry by exact version", () => {
    expect(findEntryForVersion("2.4.0")?.version).toBe("2.4.0");
  });

  it("returns undefined for an unknown version", () => {
    expect(findEntryForVersion("9.9.9")).toBeUndefined();
  });

  it("caps highlights at five per entry", () => {
    for (const entry of WHATS_NEW_ENTRIES) {
      expect(entry.highlights.length).toBeGreaterThan(0);
      expect(entry.highlights.length).toBeLessThanOrEqual(5);
    }
  });

  it("resolves every title and body key in BOTH de and en", () => {
    for (const entry of WHATS_NEW_ENTRIES) {
      for (const item of entry.highlights) {
        for (const key of [item.titleKey, item.bodyKey]) {
          expect(resolve(de, key), `missing DE key: ${key}`).toBeTypeOf("string");
          expect(resolve(en, key), `missing EN key: ${key}`).toBeTypeOf("string");
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/content/__tests__/whatsNew.i18n.test.ts
```
Expected: FAIL — "Failed to resolve import ../whatsNew".

- [ ] **Step 3: Create the content module**

`frontend/src/content/whatsNew.ts`. The `titleKey`/`bodyKey` values are dotted keys
**within** the `whatsNew` namespace (no `whatsNew:` prefix — the namespace is
supplied at `useTranslation` time).

```typescript
/**
 * Hand-authored release highlights, shown once per version by WhatsNewModal.
 *
 * Deliberately not parsed from CHANGELOG.md: the changelog is English-only and
 * developer-facing, while this copy is DE-primary and user-facing.
 *
 * Adding an entry is part of the release routine. A missing entry is not an
 * error — the modal simply does not show.
 */

export interface WhatsNewItem {
  /** lucide-react icon name */
  icon: string;
  /** dotted key inside the `whatsNew` i18n namespace */
  titleKey: string;
  bodyKey: string;
}

export interface WhatsNewEntry {
  /** Exact match against the backend `appVersion` (prerelease suffix stripped). */
  version: string;
  /** 1-5 items. More than five is a changelog, not a modal. */
  highlights: WhatsNewItem[];
}

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
  {
    version: "2.4.0",
    highlights: [
      {
        icon: "BarChart3",
        titleKey: "entries.v240.stats.title",
        bodyKey: "entries.v240.stats.body",
      },
      {
        icon: "Sparkles",
        titleKey: "entries.v240.whatsNew.title",
        bodyKey: "entries.v240.whatsNew.body",
      },
    ],
  },
];

export function findEntryForVersion(version: string): WhatsNewEntry | undefined {
  return WHATS_NEW_ENTRIES.find((entry) => entry.version === version);
}
```

- [ ] **Step 4: Create both i18n bundles**

`frontend/src/i18n/resources/de/whatsNew.json` (primary):

```json
{
  "title": "Neu in TravStats {{version}}",
  "subtitle": "Ein kurzer Überblick über die wichtigsten Änderungen.",
  "dismiss": "Verstanden",
  "entries": {
    "v240": {
      "stats": {
        "title": "Anonyme Nutzungsstatistik",
        "body": "Du kannst TravStats jetzt freiwillig anonyme Nutzungsdaten senden lassen. Standardmäßig ist das aus, und du kannst es jederzeit wieder abschalten."
      },
      "whatsNew": {
        "title": "Dieses Fenster",
        "body": "Nach jedem Update siehst du hier einmalig, was sich geändert hat."
      }
    }
  }
}
```

`frontend/src/i18n/resources/en/whatsNew.json` (mirror — identical key structure):

```json
{
  "title": "New in TravStats {{version}}",
  "subtitle": "A short overview of the most important changes.",
  "dismiss": "Got it",
  "entries": {
    "v240": {
      "stats": {
        "title": "Anonymous usage statistics",
        "body": "TravStats can now optionally send anonymous usage data. It is off by default, and you can turn it back off at any time."
      },
      "whatsNew": {
        "title": "This dialog",
        "body": "After every update you will see a one-time summary of what changed."
      }
    }
  }
}
```

- [ ] **Step 5: Register the namespace**

`frontend/src/i18n/config.ts` needs **three** edits per language. Follow the exact
shape of the existing `setup` namespace:

1. Imports: `import deWhatsNew from "./resources/de/whatsNew.json";` and
   `import enWhatsNew from "./resources/en/whatsNew.json";`
2. `resources.de` gains `whatsNew: deWhatsNew,`; `resources.en` gains `whatsNew: enWhatsNew,`
3. The `ns: [...]` array gains `"whatsNew"`.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/content/__tests__/whatsNew.i18n.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/content/whatsNew.ts frontend/src/content/__tests__/whatsNew.i18n.test.ts \
        frontend/src/i18n/resources/de/whatsNew.json frontend/src/i18n/resources/en/whatsNew.json \
        frontend/src/i18n/config.ts
git commit -m "feat(whats-new): add release-highlight content module and i18n namespace"
```

---

### Task 3: `useWhatsNew` hook

**Files:**
- Create: `frontend/src/hooks/useWhatsNew.ts`
- Modify: `frontend/src/lib/api/types.ts`
- Test: `frontend/src/hooks/__tests__/useWhatsNew.test.tsx`

**Interfaces:**
- Consumes: `findEntryForVersion` + `WhatsNewEntry` (Task 2); `versionApi.get()` from `frontend/src/lib/api/version.ts`; `settingsApi.get()` / `settingsApi.update()` from `frontend/src/lib/api/settings.ts`.
- Produces: `useWhatsNew(isAuthenticated: boolean): { entry: WhatsNewEntry | null; shouldShow: boolean; dismiss: () => Promise<void> }`. Task 4 consumes this exact shape.

First add to the `UserSettings` interface in `frontend/src/lib/api/types.ts`:

```typescript
  whatsNewSeenVersion?: string;
```

(The interface has an index signature, so this is additive and safe; explicit is
preferred over relying on the index signature.)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/__tests__/useWhatsNew.test.tsx`. Note `vi.mock` factories
are hoisted, so the mock functions are declared with `vi.hoisted`.

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  versionApi: { get: mocks.getVersion },
  settingsApi: { get: mocks.getSettings, update: mocks.updateSettings },
}));

vi.mock("../../content/whatsNew", () => ({
  findEntryForVersion: (v: string) =>
    v === "2.4.0" ? { version: "2.4.0", highlights: [{ icon: "X", titleKey: "a", bodyKey: "b" }] } : undefined,
}));

import { useWhatsNew } from "../useWhatsNew";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVersion.mockResolvedValue({ version: "2.4.0" });
  mocks.getSettings.mockResolvedValue({});
  mocks.updateSettings.mockResolvedValue({});
});

describe("useWhatsNew", () => {
  it("shows when an entry exists and the version was never seen", async () => {
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    expect(result.current.entry?.version).toBe("2.4.0");
  });

  it("hides when the running version was already seen", async () => {
    mocks.getSettings.mockResolvedValue({ whatsNewSeenVersion: "2.4.0" });
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  it("hides when no entry exists for the running version", async () => {
    mocks.getVersion.mockResolvedValue({ version: "9.9.9" });
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getVersion).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });

  it("never calls the API when unauthenticated", async () => {
    const { result } = renderHook(() => useWhatsNew(false));
    await waitFor(() => expect(result.current.shouldShow).toBe(false));
    expect(mocks.getVersion).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("dismiss persists the version and hides the modal", async () => {
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    await act(async () => { await result.current.dismiss(); });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ whatsNewSeenVersion: "2.4.0" });
    expect(result.current.shouldShow).toBe(false);
  });

  it("stays hidden when the dismiss PUT fails", async () => {
    mocks.updateSettings.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    await act(async () => { await result.current.dismiss(); });
    expect(result.current.shouldShow).toBe(false);
  });

  it("hides when /version rejects", async () => {
    mocks.getVersion.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useWhatsNew(true));
    await waitFor(() => expect(mocks.getVersion).toHaveBeenCalled());
    expect(result.current.shouldShow).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/hooks/__tests__/useWhatsNew.test.tsx
```
Expected: FAIL — "Failed to resolve import ../useWhatsNew".

- [ ] **Step 3: Implement the hook**

`frontend/src/hooks/useWhatsNew.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import { settingsApi, versionApi } from "../lib/api";
import { findEntryForVersion, type WhatsNewEntry } from "../content/whatsNew";
import { logger } from "../lib/logger";

interface UseWhatsNewResult {
  entry: WhatsNewEntry | null;
  shouldShow: boolean;
  dismiss: () => Promise<void>;
}

/**
 * Decides whether the release-highlights modal should appear.
 *
 * Shows when: authenticated, a content entry matches the running backend
 * version, and that version is not recorded as seen for this user.
 *
 * Every failure path hides the modal. It is not important enough to surface
 * an error, and a modal that appears on a broken request is worse than none.
 */
export function useWhatsNew(isAuthenticated: boolean): UseWhatsNewResult {
  const [entry, setEntry] = useState<WhatsNewEntry | null>(null);
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setEntry(null);
      setShouldShow(false);
      return;
    }
    let cancelled = false;

    const check = async (): Promise<void> => {
      try {
        const [{ version }, settings] = await Promise.all([
          versionApi.get(),
          settingsApi.get(),
        ]);
        if (cancelled) return;

        const match = findEntryForVersion(version);
        if (!match || settings.whatsNewSeenVersion === version) {
          setShouldShow(false);
          return;
        }
        setEntry(match);
        setShouldShow(true);
      } catch (error) {
        if (!cancelled) setShouldShow(false);
        logger.debug("whats-new check failed", error);
      }
    };

    void check();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const dismiss = useCallback(async (): Promise<void> => {
    // Close first: the user asked to close, and a failed PUT must never
    // leave the modal open. Worst case it reappears next session.
    setShouldShow(false);
    if (!entry) return;
    try {
      await settingsApi.update({ whatsNewSeenVersion: entry.version });
    } catch (error) {
      logger.debug("whats-new dismiss failed to persist", error);
    }
  }, [entry]);

  return { entry, shouldShow, dismiss };
}
```

Check `frontend/src/lib/logger.ts` for the exact export name before committing; if
it exports a default, adapt the import rather than the logger.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/hooks/__tests__/useWhatsNew.test.tsx
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useWhatsNew.ts frontend/src/hooks/__tests__/useWhatsNew.test.tsx \
        frontend/src/lib/api/types.ts
git commit -m "feat(whats-new): add useWhatsNew hook resolving version against seen-state"
```

---

### Task 4: `WhatsNewModal` component

**Files:**
- Create: `frontend/src/components/WhatsNewModal.tsx`
- Test: `frontend/src/components/__tests__/WhatsNewModal.test.tsx`

**Interfaces:**
- Consumes: `WhatsNewEntry` (Task 2).
- Produces: `WhatsNewModal` (default export) with props `{ isOpen: boolean; entry: WhatsNewEntry | null; onClose: () => void; extraSlot?: ReactNode }`. **Plan 2 renders the consent card through `extraSlot`.** Do not change this signature without updating Plan 2.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/__tests__/WhatsNewModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WhatsNewModal from "../WhatsNewModal";
import type { WhatsNewEntry } from "../../content/whatsNew";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const entry: WhatsNewEntry = {
  version: "2.4.0",
  highlights: [
    { icon: "📊", titleKey: "entries.v240.stats.title", bodyKey: "entries.v240.stats.body" },
    { icon: "✨", titleKey: "entries.v240.whatsNew.title", bodyKey: "entries.v240.whatsNew.body" },
  ],
};

describe("WhatsNewModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<WhatsNewModal isOpen={false} entry={entry} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the entry is null", () => {
    const { container } = render(<WhatsNewModal isOpen entry={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every highlight", () => {
    render(<WhatsNewModal isOpen entry={entry} onClose={vi.fn()} />);
    expect(screen.getByText("entries.v240.stats.title")).toBeInTheDocument();
    expect(screen.getByText("entries.v240.whatsNew.body")).toBeInTheDocument();
  });

  it("renders the extraSlot when provided", () => {
    render(<WhatsNewModal isOpen entry={entry} onClose={vi.fn()} extraSlot={<p>consent card</p>} />);
    expect(screen.getByText("consent card")).toBeInTheDocument();
  });

  it("omits the slot region entirely when not provided", () => {
    render(<WhatsNewModal isOpen entry={entry} onClose={vi.fn()} />);
    expect(screen.queryByTestId("whats-new-extra-slot")).not.toBeInTheDocument();
  });

  it("calls onClose from the dismiss button", async () => {
    const onClose = vi.fn();
    render(<WhatsNewModal isOpen entry={entry} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "whatsNew:dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/components/__tests__/WhatsNewModal.test.tsx
```
Expected: FAIL — "Failed to resolve import ../WhatsNewModal".

- [ ] **Step 3: Implement the component**

`frontend/src/components/WhatsNewModal.tsx`. Overlay/shell markup matches
`frontend/src/components/DiagnosticExportModal.tsx` (house style: CSS custom
properties, not Tailwind colour classes).

> **Icons are emoji glyphs, not a library.** The frontend has no icon package —
> `shared/domains.ts` uses glyphs (`"✈"`, `"🚢"`) and other components hand-roll
> inline SVG. `WhatsNewItem.icon` holds the glyph itself and is rendered as text.
> **Do not import `lucide-react`**; it is not a dependency, and adding one for two
> icons would leave the project with a third icon idiom.

```tsx
import type { ReactNode } from "react";
import { useTranslation } from "../hooks/useTranslation";
import type { WhatsNewEntry } from "../content/whatsNew";

interface WhatsNewModalProps {
  isOpen: boolean;
  entry: WhatsNewEntry | null;
  onClose: () => void;
  /** Rendered below the highlights. The usage-stats consent card passes through here. */
  extraSlot?: ReactNode;
}

export default function WhatsNewModal({
  isOpen,
  entry,
  onClose,
  extraSlot,
}: WhatsNewModalProps): JSX.Element | null {
  const { t } = useTranslation(["whatsNew", "common"]);

  if (!isOpen || !entry) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
      <div
        className="rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("whatsNew:title", { version: entry.version })}
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none"
            style={{ color: "var(--text-muted)" }}
            aria-label={t("common:buttons.close")}
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex flex-col gap-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("whatsNew:subtitle")}
          </p>

          <ul className="flex flex-col gap-4">
            {entry.highlights.map((item) => (
              <li key={item.titleKey} className="flex gap-3">
                <span className="mt-0.5 text-xl leading-none" aria-hidden="true">
                  {item.icon}
                </span>
                <span>
                  <span className="font-medium block" style={{ color: "var(--text-primary)" }}>
                    {t(`whatsNew:${item.titleKey}`)}
                  </span>
                  <span className="text-sm block" style={{ color: "var(--text-muted)" }}>
                    {t(`whatsNew:${item.bodyKey}`)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {extraSlot ? <div data-testid="whats-new-extra-slot">{extraSlot}</div> : null}
        </div>

        <div
          className="px-6 py-4 border-t flex justify-end"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium"
            style={{ background: "var(--color-accent)", color: "var(--text-on-accent)" }}
          >
            {t("whatsNew:dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Verify `--color-accent` / `--text-on-accent` exist in the project's CSS variables
(`frontend/src/index.css` or equivalent). If not, copy the button styling from an
existing primary button instead of inventing variable names.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/components/__tests__/WhatsNewModal.test.tsx
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/WhatsNewModal.tsx frontend/src/components/__tests__/WhatsNewModal.test.tsx
git commit -m "feat(whats-new): add WhatsNewModal with an extraSlot for injected cards"
```

---

### Task 5: Mount the modal and stamp fresh installs

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/SetupPage.tsx`

**Interfaces:**
- Consumes: `useWhatsNew` (Task 3), `WhatsNewModal` (Task 4).
- Produces: the modal is live. Plan 2 later passes `extraSlot={<UsageStatsConsentCard />}` at this call site.

A brand-new install must not greet its first user with "what's new" about a version
they never ran. `SetupPage` stamps the current version at account creation.

- [ ] **Step 1: Mount in `AppContent`**

In `frontend/src/App.tsx`, inside `AppContent()`, read the auth state the component
already uses (it renders auth-gated routes, so an `isAuthenticated` value is in
scope — reuse it, do not add a second source of truth). Add:

```tsx
import WhatsNewModal from "./components/WhatsNewModal";
import { useWhatsNew } from "./hooks/useWhatsNew";
```

and inside the component, above the returned JSX:

```tsx
  const { entry, shouldShow, dismiss } = useWhatsNew(isAuthenticated);
```

then render it as a sibling of `<Routes>` (never inside a `<Route>`, or it
unmounts on navigation):

```tsx
      <WhatsNewModal isOpen={shouldShow} entry={entry} onClose={() => void dismiss()} />
```

- [ ] **Step 2: Stamp the version on fresh installs**

In `frontend/src/pages/SetupPage.tsx`, inside `handleSubmit`, after the successful
`setupApi.initialize(...)` call and **before `setAuth(response.user)`**:

```tsx
      // Stamp BEFORE setAuth: setAuth flips isAuthenticated, which fires the
      // useWhatsNew effect. If the stamp has not landed by then, the hook reads a
      // pre-stamp snapshot and greets a brand-new install about a version it never
      // ran. The JWT cookie is already set by initialize(), so this call is
      // authenticated. Non-fatal: worst case is one stale modal.
      try {
        const { version } = await versionApi.get();
        await settingsApi.update({ whatsNewSeenVersion: version });
      } catch (error) {
        logger.debug("failed to stamp whatsNewSeenVersion during setup", error);
      }
```

**The ordering is load-bearing.** Stamping after `setAuth` races the hook and loses:
`setAuth` only writes client-side Zustand state, while the auth cookie arrives with
the `initialize` response — so the stamp is already authenticated before `setAuth`,
and running it first is both safe and deterministic.

Add the imports `import { settingsApi, setupApi, versionApi } from "../lib/api";`
and `import { logger } from "../lib/logger";` (merge with the existing `setupApi`
import line rather than adding a second one).

- [ ] **Step 3: Verify the full frontend suite and typecheck**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```
Expected: typecheck clean, lint clean, all suites PASS (previous count + 17 new).

- [ ] **Step 4: Manual smoke test**

Start the dev stack per `CLAUDE.local.md` (backend on 8000, frontend on 3000, dev
DB on 5433). Log in as `admin`/`admin123`.

1. Temporarily set the `WHATS_NEW_ENTRIES[0].version` to the value `GET /api/v1/version` returns (currently `2.3.0`) so the modal triggers before 2.4.0 exists.
2. Reload → the modal appears once.
3. Click "Verstanden" → it closes.
4. Hard-reload → it does **not** reappear.
5. Switch the UI language to English → reopen by clearing `whatsNewSeenVersion` via `PUT /settings` → all copy is English, no raw i18n keys visible.
6. **Revert the temporary version change.**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/SetupPage.tsx
git commit -m "feat(whats-new): mount the modal app-wide and stamp fresh installs at setup"
```

---

## Done criteria

- `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run` — all green.
- `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit` — all green.
- The modal shows once per version, per user, on any browser.
- `WhatsNewModal` accepts `extraSlot` and renders nothing extra without it.
- No Prisma migration was generated.
- `backend/VERSION` and `CHANGELOG.md` are untouched.
