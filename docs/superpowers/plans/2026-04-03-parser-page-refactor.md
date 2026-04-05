# Parser Page Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ersetze die LLM-Training-zentrierte TrainingPage durch eine aufgeräumte „Parser"-Seite mit 4 Tabs: Annotieren, Meine Templates, Community Templates, Parse-Logs.

**Architecture:** `TrainingPage.tsx` wird durch `ParserPage.tsx` ersetzt. Ein neues `MyTemplates`-Komponente listet User-Templates via `parserTemplatesApi`. Der Developer-Mode-Gate fliegt raus — Template-Management ist produktiv, nicht experimentell. TrainingGuide und Admin-TrainingConfig werden gelöscht. Training-Einstellungen aus der SettingsPage entfernt.

**Tech Stack:** React 18, TypeScript strict, Vitest, Tailwind CSS, react-i18next (`useTranslation` eigener Hook)

---

### Task 1: MyTemplates-Komponente + Tests

**Files:**
- Create: `frontend/src/components/Parser/MyTemplates.tsx`
- Create: `frontend/src/__tests__/components/Parser/MyTemplates.test.tsx`

- [ ] **Step 1: Test schreiben**

```tsx
// frontend/src/__tests__/components/Parser/MyTemplates.test.tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import MyTemplates from "../../../components/Parser/MyTemplates";
import * as api from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  parserTemplatesApi: {
    list: vi.fn(),
    setStatus: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const mockTemplates = [
  {
    id: "t1",
    name: "Lufthansa DE",
    status: "active" as const,
    createdAt: "2026-04-01T10:00:00Z",
    updatedAt: "2026-04-01T10:00:00Z",
    stats: { matchCount: 12, successRate: 0.92, lastUsedAt: "2026-04-02T08:00:00Z" },
  },
  {
    id: "t2",
    name: "Ryanair EN",
    status: "disabled" as const,
    createdAt: "2026-03-28T12:00:00Z",
    updatedAt: "2026-03-28T12:00:00Z",
  },
];

describe("MyTemplates", () => {
  beforeEach(() => {
    vi.mocked(api.parserTemplatesApi.list).mockResolvedValue(mockTemplates);
    vi.mocked(api.parserTemplatesApi.setStatus).mockResolvedValue(undefined);
    vi.mocked(api.parserTemplatesApi.delete).mockResolvedValue(undefined);
  });

  it("zeigt Templates nach Laden", async () => {
    render(<MyTemplates />);
    await waitFor(() => expect(screen.getByText("Lufthansa DE")).toBeInTheDocument());
    expect(screen.getByText("Ryanair EN")).toBeInTheDocument();
  });

  it("zeigt Empty-State wenn keine Templates", async () => {
    vi.mocked(api.parserTemplatesApi.list).mockResolvedValue([]);
    render(<MyTemplates />);
    await waitFor(() => expect(screen.getByText("parser:myTemplates.empty")).toBeInTheDocument());
  });

  it("aktiviert ein disabled Template", async () => {
    render(<MyTemplates />);
    await waitFor(() => screen.getByText("Ryanair EN"));
    fireEvent.click(screen.getByTestId("activate-t2"));
    await waitFor(() =>
      expect(api.parserTemplatesApi.setStatus).toHaveBeenCalledWith("t2", "active")
    );
  });

  it("deaktiviert ein aktives Template", async () => {
    render(<MyTemplates />);
    await waitFor(() => screen.getByText("Lufthansa DE"));
    fireEvent.click(screen.getByTestId("disable-t1"));
    await waitFor(() =>
      expect(api.parserTemplatesApi.setStatus).toHaveBeenCalledWith("t1", "disabled")
    );
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss FAIL**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/components/Parser/MyTemplates.test.tsx
```

Erwartet: FAIL — `Cannot find module '../../../components/Parser/MyTemplates'`

- [ ] **Step 3: MyTemplates implementieren**

```tsx
// frontend/src/components/Parser/MyTemplates.tsx
import { useEffect, useState } from "react";
import { parserTemplatesApi, type UserTemplateItem } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

export default function MyTemplates(): JSX.Element {
  const { t } = useTranslation(["parser", "common"]);
  const [templates, setTemplates] = useState<UserTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    parserTemplatesApi
      .list()
      .then(setTemplates)
      .catch((err) => logger.error({ err }, "MyTemplates: failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const handleSetStatus = async (
    id: string,
    status: "active" | "disabled"
  ): Promise<void> => {
    setActionLoading(id);
    try {
      await parserTemplatesApi.setStatus(id, status);
      setTemplates((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status } : t))
      );
    } catch (err) {
      logger.error({ err }, "MyTemplates: failed to set status");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm(t("parser:myTemplates.confirmDelete"))) return;
    setActionLoading(id);
    try {
      await parserTemplatesApi.delete(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      logger.error({ err }, "MyTemplates: failed to delete");
    } finally {
      setActionLoading(null);
    }
  };

  const statusBadge = (status: UserTemplateItem["status"]): JSX.Element => {
    const styles: Record<UserTemplateItem["status"], string> = {
      active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      disabled: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status]}`}>
        {t(`parser:myTemplates.status.${status}`)}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500 dark:text-gray-400">
        <div className="text-4xl mb-4">🧩</div>
        <p className="text-lg font-medium">{t("parser:myTemplates.empty")}</p>
        <p className="text-sm mt-1">{t("parser:myTemplates.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {templates.map((tmpl) => (
        <div
          key={tmpl.id}
          className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-5 py-4 flex items-center justify-between gap-4"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-gray-900 dark:text-white truncate">
                {tmpl.name}
              </span>
              {statusBadge(tmpl.status)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex gap-4">
              {tmpl.stats && (
                <>
                  <span>{tmpl.stats.matchCount} {t("parser:myTemplates.matches")}</span>
                  <span>{Math.round(tmpl.stats.successRate * 100)}% {t("parser:myTemplates.successRate")}</span>
                </>
              )}
              <span>
                {t("parser:myTemplates.created")}{" "}
                {new Date(tmpl.createdAt).toLocaleDateString("de-DE")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {tmpl.status === "disabled" || tmpl.status === "pending" ? (
              <button
                data-testid={`activate-${tmpl.id}`}
                onClick={() => handleSetStatus(tmpl.id, "active")}
                disabled={actionLoading === tmpl.id}
                className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors"
              >
                {t("parser:myTemplates.activate")}
              </button>
            ) : (
              <button
                data-testid={`disable-${tmpl.id}`}
                onClick={() => handleSetStatus(tmpl.id, "disabled")}
                disabled={actionLoading === tmpl.id}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                {t("parser:myTemplates.disable")}
              </button>
            )}
            <button
              onClick={() => handleDelete(tmpl.id)}
              disabled={actionLoading === tmpl.id}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
            >
              {t("common:buttons.delete")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Test laufen lassen — muss PASS**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/components/Parser/MyTemplates.test.tsx
```

Erwartet: 4 Tests PASS

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/Parser/MyTemplates.tsx \
        frontend/src/__tests__/components/Parser/MyTemplates.test.tsx
git commit -m "feat: MyTemplates component — list/activate/disable/delete user templates"
```

---

### Task 2: i18n — parser namespace (de + en)

**Files:**
- Create: `frontend/src/i18n/resources/de/parser.json`
- Create: `frontend/src/i18n/resources/en/parser.json`
- Modify: `frontend/src/i18n/resources/de/dashboard.json` — Key `"training"` → `"parser"`
- Modify: `frontend/src/i18n/resources/en/dashboard.json` — Key `"training"` → `"parser"`
- Modify: `frontend/src/i18n/i18n.ts` (oder wo die Namespaces registriert sind) — `parser` hinzufügen

Zuerst prüfen wie Namespaces registriert werden:
```bash
grep -n "training\|namespace\|resources" /d/Projekte/TravStats/frontend/src/i18n/i18n.ts | head -20
```

- [ ] **Step 1: DE parser.json erstellen**

```json
// frontend/src/i18n/resources/de/parser.json
{
  "title": "Parser",
  "description": "E-Mail- und Boarding-Pass-Templates verwalten",
  "tabs": {
    "annotate": "Annotieren",
    "myTemplates": "Meine Templates",
    "communityTemplates": "Community Templates",
    "parseLogs": "Parse-Logs"
  },
  "annotate": {
    "title": "Datei annotieren",
    "description": "Lade eine E-Mail oder einen Boarding Pass hoch und markiere die Felder. TravStats leitet automatisch ein Regex-Template ab.",
    "emailButton": "E-Mail hochladen",
    "emailFormats": ".eml, .msg, .txt",
    "boardingPassButton": "Boarding Pass hochladen",
    "boardingPassFormats": ".png, .jpg, .jpeg"
  },
  "myTemplates": {
    "empty": "Noch keine eigenen Templates",
    "emptyHint": "Annotiere eine E-Mail oder einen Boarding Pass, um dein erstes Template zu erstellen.",
    "matches": "Treffer",
    "successRate": "Erfolgsrate",
    "created": "Erstellt",
    "activate": "Aktivieren",
    "disable": "Deaktivieren",
    "confirmDelete": "Template wirklich löschen?",
    "status": {
      "active": "aktiv",
      "pending": "ausstehend",
      "disabled": "deaktiviert"
    }
  },
  "communityTemplates": {
    "title": "Community Templates",
    "description": "Vorgeladene Airline-Templates aus dem öffentlichen Repository"
  }
}
```

- [ ] **Step 2: EN parser.json erstellen**

```json
// frontend/src/i18n/resources/en/parser.json
{
  "title": "Parser",
  "description": "Manage email and boarding pass templates",
  "tabs": {
    "annotate": "Annotate",
    "myTemplates": "My Templates",
    "communityTemplates": "Community Templates",
    "parseLogs": "Parse Logs"
  },
  "annotate": {
    "title": "Annotate file",
    "description": "Upload an email or boarding pass and mark the fields. TravStats automatically derives a regex template.",
    "emailButton": "Upload email",
    "emailFormats": ".eml, .msg, .txt",
    "boardingPassButton": "Upload boarding pass",
    "boardingPassFormats": ".png, .jpg, .jpeg"
  },
  "myTemplates": {
    "empty": "No custom templates yet",
    "emptyHint": "Annotate an email or boarding pass to create your first template.",
    "matches": "matches",
    "successRate": "success rate",
    "created": "Created",
    "activate": "Activate",
    "disable": "Disable",
    "confirmDelete": "Really delete this template?",
    "status": {
      "active": "active",
      "pending": "pending",
      "disabled": "disabled"
    }
  },
  "communityTemplates": {
    "title": "Community Templates",
    "description": "Pre-loaded airline templates from the public repository"
  }
}
```

- [ ] **Step 3: Navigation-Label aktualisieren**

In `frontend/src/i18n/resources/de/dashboard.json` Zeile mit `"training": "Training"` → `"parser": "Parser"`:
```json
"parser": "Parser"
```

Gleich in `frontend/src/i18n/resources/en/dashboard.json`.

- [ ] **Step 4: `parser` Namespace in i18n.ts registrieren**

Zunächst prüfen:
```bash
grep -n "training" /d/Projekte/TravStats/frontend/src/i18n/i18n.ts | head -10
```

Dann `parser` analog zu `training` einfügen (import + resources-Eintrag).

- [ ] **Step 5: TypeScript-Check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Erwartet: keine Fehler

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/i18n/resources/de/parser.json \
        frontend/src/i18n/resources/en/parser.json \
        frontend/src/i18n/resources/de/dashboard.json \
        frontend/src/i18n/resources/en/dashboard.json \
        frontend/src/i18n/i18n.ts
git commit -m "feat: add parser i18n namespace, rename nav label"
```

---

### Task 3: ParserPage.tsx erstellen

**Files:**
- Create: `frontend/src/pages/ParserPage.tsx`

Ersetzt `TrainingPage.tsx` vollständig. Kein Developer-Mode-Gate, kein LLM-Jargon, keine Jobs/Dashboard/Guide Tabs.

- [ ] **Step 1: ParserPage.tsx erstellen**

```tsx
// frontend/src/pages/ParserPage.tsx
import { useState, useRef } from "react";
import { trainingApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useAuthStore } from "../store/authStore";
import NavigationBar from "../components/NavigationBar";
import EmailAnnotation from "../components/Training/EmailAnnotation";
import BoardingPassAnnotation from "../components/Training/BoardingPassAnnotation";
import ParseLogStats from "../components/Training/ParseLogStats";
import TemplateStatusView from "../components/TemplateStatusView";
import MyTemplates from "../components/Parser/MyTemplates";
import { useTranslation } from "../hooks/useTranslation";

type Tab = "annotate" | "my-templates" | "community" | "parse-logs";

export default function ParserPage(): JSX.Element {
  const { t } = useTranslation(["parser", "common"]);
  const user = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<Tab>("annotate");
  const [uploadedFile, setUploadedFile] = useState<{ id: string; type: string } | null>(null);
  const emailFileInputRef = useRef<HTMLInputElement>(null);
  const boardingPassFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File, type: "email" | "boarding_pass"): Promise<void> => {
    try {
      const result = await trainingApi.upload(file, type);
      setUploadedFile({ id: result.id, type: result.type });
    } catch (error) {
      logger.error({ err: error }, "ParserPage: upload failed");
    }
  };

  const handleAnnotationComplete = (): void => {
    setUploadedFile(null);
    setActiveTab("my-templates");
  };

  const handleCancel = (): void => {
    setUploadedFile(null);
  };

  const tabs: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: "annotate", label: t("parser:tabs.annotate") },
    { id: "my-templates", label: t("parser:tabs.myTemplates") },
    { id: "community", label: t("parser:tabs.communityTemplates") },
    ...(user?.isAdmin ? [{ id: "parse-logs" as Tab, label: t("parser:tabs.parseLogs"), adminOnly: true }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <NavigationBar />
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t("parser:title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("parser:description")}
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab: Annotieren */}
        {activeTab === "annotate" && (
          <div className="space-y-6">
            {!uploadedFile ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  {t("parser:annotate.title")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                  {t("parser:annotate.description")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <input
                      ref={emailFileInputRef}
                      type="file"
                      accept=".eml,.msg,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file, "email");
                      }}
                    />
                    <button
                      onClick={() => emailFileInputRef.current?.click()}
                      className="w-full p-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-center"
                    >
                      <div className="text-4xl mb-2">📧</div>
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {t("parser:annotate.emailButton")}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {t("parser:annotate.emailFormats")}
                      </div>
                    </button>
                  </div>
                  <div>
                    <input
                      ref={boardingPassFileInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file, "boarding_pass");
                      }}
                    />
                    <button
                      onClick={() => boardingPassFileInputRef.current?.click()}
                      className="w-full p-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-center"
                    >
                      <div className="text-4xl mb-2">🎫</div>
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {t("parser:annotate.boardingPassButton")}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {t("parser:annotate.boardingPassFormats")}
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <button onClick={handleCancel} className="btn-secondary">
                    ← {t("common:buttons.cancel")}
                  </button>
                </div>
                {uploadedFile.type === "email" ? (
                  <EmailAnnotation
                    trainingDataId={uploadedFile.id}
                    onComplete={handleAnnotationComplete}
                    onCancel={handleCancel}
                  />
                ) : (
                  <BoardingPassAnnotation
                    trainingDataId={uploadedFile.id}
                    onComplete={handleAnnotationComplete}
                    onCancel={handleCancel}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab: Meine Templates */}
        {activeTab === "my-templates" && <MyTemplates />}

        {/* Tab: Community Templates */}
        {activeTab === "community" && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
              {t("parser:communityTemplates.title")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {t("parser:communityTemplates.description")}
            </p>
            <TemplateStatusView />
          </div>
        )}

        {/* Tab: Parse-Logs (Admin only) */}
        {activeTab === "parse-logs" && user?.isAdmin && (
          <div className="p-4">
            <ParseLogStats />
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript-Check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Erwartet: keine Fehler

- [ ] **Step 3: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/pages/ParserPage.tsx
git commit -m "feat: ParserPage — 4 tabs: Annotieren, Meine Templates, Community, Parse-Logs"
```

---

### Task 4: Routing + Navigation auf Parser umstellen

**Files:**
- Modify: `frontend/src/App.tsx` — lazy import + Route
- Modify: `frontend/src/components/NavigationBar.tsx` — Pfad, Label, Bedingung

- [ ] **Step 1: App.tsx aktualisieren**

Zeile mit `const TrainingPage = lazy(...)`:
```tsx
const ParserPage = lazy(() => import("./pages/ParserPage"));
```

Route ändern (Zeile mit `path="/training"`):
```tsx
<Route
  path="/parser"
  element={isAuthenticated ? <ParserPage /> : <Navigate to="/login" />}
/>
```

- [ ] **Step 2: NavigationBar aktualisieren**

Zeile mit `path: "/training"` → `/parser`, Label → `t("dashboard:parser")`.

Developer-Mode-Gate entfernen: Den `developerModeEnabled`-State und den `settingsApi.getDeveloperMode()`-Aufruf in NavigationBar entfernen, `show`-Bedingung zu `show: hasTrainingAccess`.

Vorher:
```tsx
show: hasTrainingAccess && developerModeEnabled,
```

Nachher:
```tsx
show: hasTrainingAccess,
```

Den `developerModeEnabled` useState und den `useEffect` zum Laden des Dev-Mode in NavigationBar **vollständig entfernen** (falls kein anderer Code dort darauf zugreift — mit `grep -n "developerMode" frontend/src/components/NavigationBar.tsx` prüfen).

- [ ] **Step 3: TypeScript + Lint**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint
```

Erwartet: keine Fehler

- [ ] **Step 4: Tests laufen lassen**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Erwartet: alle Tests PASS (NavigationBar-Tests ggf. Mocks anpassen falls sie `developerMode` mocken)

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/App.tsx frontend/src/components/NavigationBar.tsx
git commit -m "feat: route /training → /parser, nav label + remove developer-mode gate"
```

---

### Task 5: Training-Abschnitt aus SettingsPage entfernen

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

Entfernen:
- Den Eintrag `{ id: "training", label: ... }` aus dem Sections-Array (Zeile ~468)
- Den gesamten `{activeSection === "training" && (...)}` Block (Zeile ~1770–1870, ca. 100 Zeilen)
- Die State-Variablen `trainingSettings` und `savingTrainingConfig` falls danach ungenutzt
- Die Funktionen `loadTrainingConfig` und `handleSaveTrainingConfig` falls danach ungenutzt

- [ ] **Step 1: Training-Section aus SettingsPage entfernen**

```bash
grep -n "training" /d/Projekte/TravStats/frontend/src/pages/SettingsPage.tsx | head -30
```

Dann die identifizierten Blöcke mit dem Edit-Tool entfernen.

- [ ] **Step 2: Ungenutzte Imports prüfen und entfernen**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | grep "SettingsPage"
npm run lint 2>&1 | grep "SettingsPage"
```

Alle unused-Warnungen aus SettingsPage beheben.

- [ ] **Step 3: Tests**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Erwartet: alle Tests PASS

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/pages/SettingsPage.tsx
git commit -m "refactor: remove LLM training section from settings"
```

---

### Task 6: Training-Tab aus AdminPage entfernen + TrainingConfig.tsx löschen

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`
- Delete: `frontend/src/components/Admin/TrainingConfig.tsx`

- [ ] **Step 1: Training-Tab aus AdminPage entfernen**

Aus `AdminPage.tsx` entfernen:
- `import TrainingConfigTab from "../components/Admin/TrainingConfig";`
- `import type { TrainingConfigData } from "../components/Admin/TrainingConfig";`
- Den `{ id: "training", ... }` Eintrag aus dem Tabs-Array (Zeile ~474)
- Den `<TrainingConfigTab ...>` Render-Block (Zeile ~614)
- Die State-Variablen `trainingConfig` und `savingTrainingConfig`
- Die Funktion `handleSaveTrainingConfig` und `loadTrainingConfig`

- [ ] **Step 2: TrainingConfig.tsx löschen**

```bash
rm /d/Projekte/TravStats/frontend/src/components/Admin/TrainingConfig.tsx
```

- [ ] **Step 3: TrainingGuide.tsx löschen**

```bash
rm /d/Projekte/TravStats/frontend/src/components/Training/TrainingGuide.tsx
```

- [ ] **Step 4: TypeScript + Lint**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint
```

Erwartet: keine Fehler, keine Warnings für gelöschte Dateien

- [ ] **Step 5: Tests**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Erwartet: alle Tests PASS

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/pages/AdminPage.tsx
git rm frontend/src/components/Admin/TrainingConfig.tsx
git rm frontend/src/components/Training/TrainingGuide.tsx
git commit -m "refactor: remove training config from admin, delete TrainingGuide + TrainingConfig"
```

---

### Task 7: TrainingPage.tsx löschen + Volltest

**Files:**
- Delete: `frontend/src/pages/TrainingPage.tsx`
- Verify: alle Tests laufen durch

- [ ] **Step 1: TrainingPage.tsx löschen**

```bash
rm /d/Projekte/TravStats/frontend/src/pages/TrainingPage.tsx
```

- [ ] **Step 2: Etwaige Test-Dateien für TrainingPage prüfen**

```bash
ls /d/Projekte/TravStats/frontend/src/pages/TrainingPage*.test.tsx 2>/dev/null
```

Falls vorhanden: prüfen ob sie auf `ParserPage` umgeschrieben werden können oder gelöscht werden sollen.

- [ ] **Step 3: Volles Test-Suite**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Erwartet: alle Tests PASS

- [ ] **Step 4: TypeScript + Lint**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint
```

Erwartet: sauber

- [ ] **Step 5: Backend TypeCheck**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit && npm run lint
```

Erwartet: keine Fehler (Backend unverändert)

- [ ] **Step 6: Final Commit**

```bash
cd /d/Projekte/TravStats
git rm frontend/src/pages/TrainingPage.tsx
# ggf. auch test-Dateien:
# git rm frontend/src/pages/TrainingPage.parseLogStats.test.tsx
git commit -m "refactor: delete TrainingPage — replaced by ParserPage"
```

---

## Zusammenfassung

| Task | Ergebnis |
|------|---------|
| 1 — MyTemplates | Neue Komponente: Templates listen, aktivieren, deaktivieren, löschen |
| 2 — i18n | `parser`-Namespace (de + en), Nav-Label "Parser" |
| 3 — ParserPage | Neue Seite mit 4 Tabs, kein LLM-Jargon |
| 4 — Routing/Nav | `/parser` Route, Dev-Mode-Gate weg |
| 5 — Settings | Training-Abschnitt entfernt |
| 6 — Admin | Training-Tab + TrainingConfig.tsx + TrainingGuide.tsx entfernt |
| 7 — Cleanup | TrainingPage.tsx gelöscht, Volltest grün |
