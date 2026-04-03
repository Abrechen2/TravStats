# LLM Training Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all dead LLM fine-tuning code (frontend + backend) left over from the TrainingPage → ParserPage refactor, leaving a lean parser/template-focused codebase.

**Architecture:** Delete 3 orphaned Training components, simplify annotation components to single-button save, strip dead API methods + types from frontend, remove LLM-only endpoints from backend training route.

**Tech Stack:** React 18, TypeScript strict, Vitest + React Testing Library, Express + TypeScript, Zod

**Spec:** `docs/superpowers/specs/2026-04-03-llm-training-cleanup-design.md`

---

## File Map

| File | Action |
|------|--------|
| `frontend/src/components/Training/TrainingDashboard.tsx` | DELETE |
| `frontend/src/components/Training/TrainingDataFilters.tsx` | DELETE |
| `frontend/src/components/Training/TrainingDataPreview.tsx` | DELETE |
| `frontend/src/components/Training/EmailAnnotation.tsx` | MODIFY — remove saveAndTrain button/branch |
| `frontend/src/components/Training/BoardingPassAnnotation.tsx` | MODIFY — same |
| `frontend/src/lib/api.ts` | MODIFY — remove 8 dead trainingApi methods |
| `frontend/src/types/index.ts` | MODIFY — remove 3 dead Training* interfaces |
| `backend/src/routes/training.ts` | MODIFY — remove 9 LLM-only endpoints + unused imports |

---

### Task 1: Delete orphaned Training components

**Files:**
- Delete: `frontend/src/components/Training/TrainingDashboard.tsx`
- Delete: `frontend/src/components/Training/TrainingDataFilters.tsx`
- Delete: `frontend/src/components/Training/TrainingDataPreview.tsx`

- [ ] **Step 1: Confirm no imports before deleting**

```bash
grep -rn "TrainingDashboard\|TrainingDataFilters\|TrainingDataPreview" /d/Projekte/TravStats/frontend/src --include="*.tsx" --include="*.ts"
```

Expected: only self-references inside those 3 files (no external imports).

- [ ] **Step 2: Delete the files**

```bash
rm /d/Projekte/TravStats/frontend/src/components/Training/TrainingDashboard.tsx
rm /d/Projekte/TravStats/frontend/src/components/Training/TrainingDataFilters.tsx
rm /d/Projekte/TravStats/frontend/src/components/Training/TrainingDataPreview.tsx
```

- [ ] **Step 3: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats
git rm frontend/src/components/Training/TrainingDashboard.tsx \
       frontend/src/components/Training/TrainingDataFilters.tsx \
       frontend/src/components/Training/TrainingDataPreview.tsx
git commit -m "refactor: delete orphaned TrainingDashboard, TrainingDataFilters, TrainingDataPreview"
```

---

### Task 2: Simplify EmailAnnotation — remove saveAndTrain

**Files:**
- Modify: `frontend/src/components/Training/EmailAnnotation.tsx`
- Create: `frontend/src/__tests__/components/Training/EmailAnnotation.saveButton.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/__tests__/components/Training/EmailAnnotation.saveButton.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import EmailAnnotation from "../../../components/Training/EmailAnnotation";
import * as api from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  trainingApi: {
    getById: vi.fn(),
    annotate: vi.fn(),
  },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const mockTrainingData = {
  id: "td1",
  type: "email",
  status: "pending",
  annotations: {
    type: "email",
    fullText: "Sehr geehrter Herr Muster, Ihr Flug LH123 Frankfurt - Berlin am 01.04.2026.",
    textSelections: [],
  },
  extractedData: [],
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("EmailAnnotation — save buttons", () => {
  beforeEach(() => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(mockTrainingData);
    vi.mocked(api.trainingApi.annotate).mockResolvedValue({
      id: "td1",
      status: "annotated",
      annotations: {},
      extractedData: [],
      flightsCreated: 0,
    });
  });

  it("shows exactly one save button", async () => {
    render(
      <EmailAnnotation trainingDataId="td1" onComplete={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(api.trainingApi.getById).toHaveBeenCalled());
    const saveButtons = screen
      .getAllByRole("button")
      .filter((b) => b.textContent?.includes("training:annotation.save"));
    expect(saveButtons).toHaveLength(1);
  });

  it("does not render a Save+Train button", async () => {
    render(
      <EmailAnnotation trainingDataId="td1" onComplete={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(api.trainingApi.getById).toHaveBeenCalled());
    expect(
      screen.queryByText("training:annotation.saveAndTrain")
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — must FAIL**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/components/Training/EmailAnnotation.saveButton.test.tsx
```

Expected: FAIL (component still has two buttons).

- [ ] **Step 3: Modify EmailAnnotation.tsx**

In `frontend/src/components/Training/EmailAnnotation.tsx`:

**3a — Simplify `handleSave`** (around line 348). Replace the entire function:

```tsx
const handleSave = async (): Promise<void> => {
  setSaving(true);
  try {
    const annotationData = {
      type: "email",
      fullText: originalEmailText,
      textSelections: annotations,
    };

    const flightsForBackend = flights.map((flight) => {
      const converted = { ...flight };
      if (flight.departureDate || flight.departureTime) {
        const combined = combineDateTime(flight.departureDate, flight.departureTime);
        if (combined) {
          converted.departureTime = combined;
        }
        delete converted.departureDate;
      }
      if (flight.arrivalDate || flight.arrivalTime) {
        const combined = combineDateTime(flight.arrivalDate, flight.arrivalTime);
        if (combined) {
          converted.arrivalTime = combined;
        }
        delete converted.arrivalDate;
      }
      return converted;
    });

    const response = await trainingApi.annotate(
      trainingDataId,
      annotationData,
      flightsForBackend,
      tags
    );

    if (response.templateId) {
      setDerivedTemplateId(response.templateId);
    }

    onComplete();
  } catch (error) {
    logger.error("Failed to save annotation:", error);
    alert(t("training:errors.saveFailed"));
  } finally {
    setSaving(false);
  }
};
```

**3b — Replace the two-button block** (around lines 797–808). The existing code:

```tsx
<button onClick={() => handleSave(false)} disabled={saving} className="btn-secondary">
  {saving ? t("training:annotation.saving") : t("training:annotation.saveOnly")}
</button>
<button onClick={() => handleSave(true)} disabled={saving} className="btn-primary">
  {saving ? t("training:annotation.saving") : t("training:annotation.saveAndTrain")}
</button>
```

Replace with:

```tsx
<button onClick={() => void handleSave()} disabled={saving} className="btn-primary">
  {saving ? t("training:annotation.saving") : t("training:annotation.saveOnly")}
</button>
```

- [ ] **Step 4: Run test — must PASS**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/components/Training/EmailAnnotation.saveButton.test.tsx
```

Expected: 2 tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/Training/EmailAnnotation.tsx \
        frontend/src/__tests__/components/Training/EmailAnnotation.saveButton.test.tsx
git commit -m "refactor: EmailAnnotation — remove Save+Train button, always use annotate"
```

---

### Task 3: Simplify BoardingPassAnnotation — remove saveAndTrain

**Files:**
- Modify: `frontend/src/components/Training/BoardingPassAnnotation.tsx`
- Create: `frontend/src/__tests__/components/Training/BoardingPassAnnotation.saveButton.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/__tests__/components/Training/BoardingPassAnnotation.saveButton.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import BoardingPassAnnotation from "../../../components/Training/BoardingPassAnnotation";
import * as api from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  trainingApi: {
    getById: vi.fn(),
    annotate: vi.fn(),
  },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock("tesseract.js", () => ({
  default: { recognize: vi.fn().mockResolvedValue({ data: { text: "" } }) },
}));

const mockTrainingData = {
  id: "td2",
  type: "boarding_pass",
  status: "pending",
  annotations: {
    type: "boarding_pass",
    imageBase64: "data:image/png;base64,abc",
    boundingBoxes: [],
  },
  extractedData: [],
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("BoardingPassAnnotation — save buttons", () => {
  beforeEach(() => {
    vi.mocked(api.trainingApi.getById).mockResolvedValue(mockTrainingData);
    vi.mocked(api.trainingApi.annotate).mockResolvedValue({
      id: "td2",
      status: "annotated",
      annotations: {},
      extractedData: [],
      flightsCreated: 0,
    });
  });

  it("shows exactly one save button", async () => {
    render(
      <BoardingPassAnnotation trainingDataId="td2" onComplete={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(api.trainingApi.getById).toHaveBeenCalled());
    const saveButtons = screen
      .getAllByRole("button")
      .filter((b) => b.textContent?.includes("training:annotation.save"));
    expect(saveButtons).toHaveLength(1);
  });

  it("does not render a Save+Train button", async () => {
    render(
      <BoardingPassAnnotation trainingDataId="td2" onComplete={vi.fn()} onCancel={vi.fn()} />
    );
    await waitFor(() => expect(api.trainingApi.getById).toHaveBeenCalled());
    expect(
      screen.queryByText("training:annotation.saveAndTrain")
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — must FAIL**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/components/Training/BoardingPassAnnotation.saveButton.test.tsx
```

Expected: FAIL (component still has two buttons).

- [ ] **Step 3: Modify BoardingPassAnnotation.tsx**

In `frontend/src/components/Training/BoardingPassAnnotation.tsx`:

**3a — Simplify `handleSave`** (around line 509). Replace the entire function:

```tsx
const handleSave = async (): Promise<void> => {
  setSaving(true);
  try {
    const annotationData = {
      type: "boarding_pass",
      imageBase64: imageBase64,
      boundingBoxes,
    };

    const flightsForBackend = flights.map((flight) => {
      const converted = { ...flight };
      if (flight.departureDate || flight.departureTime) {
        const combined = combineDateTime(flight.departureDate, flight.departureTime);
        if (combined) {
          converted.departureTime = combined;
        }
        delete converted.departureDate;
      }
      if (flight.arrivalDate || flight.arrivalTime) {
        const combined = combineDateTime(flight.arrivalDate, flight.arrivalTime);
        if (combined) {
          converted.arrivalTime = combined;
        }
        delete converted.arrivalDate;
      }
      return converted;
    });

    await trainingApi.annotate(trainingDataId, annotationData, flightsForBackend, tags);

    onComplete();
  } catch (error) {
    logger.error("Failed to save annotation:", error);
    alert(t("training:errors.saveFailed"));
  } finally {
    setSaving(false);
  }
};
```

**3b — Replace the two-button block** (around lines 954–959). The existing code:

```tsx
<button onClick={() => handleSave(false)} disabled={saving} className="btn-secondary">
  {saving ? t("training:annotation.saving") : t("training:annotation.saveOnly")}
</button>
<button onClick={() => handleSave(true)} disabled={saving} className="btn-primary">
  {saving ? t("training:annotation.saving") : t("training:annotation.saveAndTrain")}
</button>
```

Replace with:

```tsx
<button onClick={() => void handleSave()} disabled={saving} className="btn-primary">
  {saving ? t("training:annotation.saving") : t("training:annotation.saveOnly")}
</button>
```

- [ ] **Step 4: Run test — must PASS**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/components/Training/BoardingPassAnnotation.saveButton.test.tsx
```

Expected: 2 tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/Training/BoardingPassAnnotation.tsx \
        frontend/src/__tests__/components/Training/BoardingPassAnnotation.saveButton.test.tsx
git commit -m "refactor: BoardingPassAnnotation — remove Save+Train button, always use annotate"
```

---

### Task 4: Clean up dead trainingApi methods from api.ts

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Verify each method is truly unused**

```bash
grep -rn "saveAndTrain\|trainOnly\|\.getData\b\|\.getJobs\b\|getJobLogs\|triggerTraining\|cancelTraining\|deleteTrainingData" /d/Projekte/TravStats/frontend/src --include="*.tsx" --include="*.ts" | grep -v "api.ts"
```

Expected: zero results (the 3 dashboard files are gone; annotation components no longer call saveAndTrain after Task 2+3).

- [ ] **Step 2: Remove the 8 dead methods from trainingApi in `frontend/src/lib/api.ts`**

In `frontend/src/lib/api.ts`, remove these methods from the `trainingApi` object (lines approx 1010–1057):

- `saveAndTrain` (calls `/training/${id}/save-and-train`)
- `trainOnly` (calls `/training/${id}/train-only`)
- `getData` (calls `/training/data`)
- `getJobs` (calls `/training/jobs`)
- `getJobLogs` (calls `/training/jobs/${jobId}/logs`)
- `triggerTraining` (calls `/training/trigger`)
- `cancelTraining` (calls `/training/jobs/${jobId}/cancel`)
- `deleteTrainingData` (calls `/training/${id}`)

The remaining `trainingApi` object should contain exactly:

```ts
export const trainingApi = {
  upload: async (file: File, type: "email" | "boarding_pass"): Promise<TrainingUploadResult> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);
    const { data } = await api.post<TrainingUploadResult>("/training/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  annotate: async (
    id: string,
    annotations: Record<string, unknown>,
    extractedData: Record<string, unknown>[],
    tags?: string[]
  ): Promise<TrainingAnnotationResult> => {
    const { data } = await api.post<TrainingAnnotationResult>(`/training/${id}/annotate`, {
      annotations,
      extractedData,
      tags: tags || [],
    });
    return data;
  },
  getById: async (id: string): Promise<TrainingDataEntry> => {
    const { data } = await api.get<TrainingDataEntry>(`/training/${id}`);
    return data;
  },
  getParseLogStats: async (): Promise<import("../types").ParseLogStats> => {
    const { data } = await api.get<import("../types").ParseLogStats>("/admin/parse-logs/stats");
    return data;
  },
  exportParseLogs: async (): Promise<void> => {
    const response = await api.get<Blob>("/admin/parse-logs/export", {
      responseType: "blob",
    });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parse-training-logs.jsonl";
    a.click();
    URL.revokeObjectURL(url);
  },
  promoteCorrections: async (): Promise<import("../types").PromoteCorrectionsResult> => {
    const { data } = await api.post<import("../types").PromoteCorrectionsResult>(
      "/admin/parse-logs/promote"
    );
    return data;
  },
};
```

- [ ] **Step 3: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/lib/api.ts
git commit -m "refactor: remove dead trainingApi methods (saveAndTrain, trainOnly, getJobs, etc.)"
```

---

### Task 5: Remove dead Training types from types/index.ts

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Verify types are unused outside api.ts**

```bash
grep -rn "TrainingJob\b\|TrainingJobLog\b\|TrainingJobLogsResponse\b" /d/Projekte/TravStats/frontend/src --include="*.tsx" --include="*.ts" | grep -v "types/index.ts\|api.ts"
```

Expected: zero results (TrainingDashboard is deleted).

- [ ] **Step 2: Remove the 3 interfaces from `frontend/src/types/index.ts`**

Find and remove these three interfaces (they were around lines 211–235 before the dashboard was deleted):

```ts
export interface TrainingJobLog {
  // ... entire interface
}

export interface TrainingJob {
  // ... entire interface
}

export interface TrainingJobLogsResponse {
  job: TrainingJob;
  logs: TrainingJobLog[];
}
```

Also check if `TrainingDataEntry` still has `jobs` or `jobLogs` fields that reference the deleted types — if so, remove those fields.

- [ ] **Step 3: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/types/index.ts
git commit -m "refactor: remove dead TrainingJob, TrainingJobLog, TrainingJobLogsResponse types"
```

---

### Task 6: Backend — remove LLM-only endpoints from training.ts

**Files:**
- Modify: `backend/src/routes/training.ts`

- [ ] **Step 1: Remove unused imports at top of file**

In `backend/src/routes/training.ts`, replace line 11:

```ts
import { triggerTraining, shouldTriggerTraining, cancelTraining, analyzeTrainingData } from '../services/trainingService';
```

with nothing (delete the line entirely — none of these functions will be used after this task).

Also remove line 16:

```ts
import { trainingTriggerLimiter } from '../middleware/rateLimit';
```

- [ ] **Step 2: Remove the 9 dead endpoint handlers**

Delete these route blocks entirely from `backend/src/routes/training.ts`:

1. `router.post('/:id/save-and-train', ...)` — approx lines 301–368
2. `router.post('/:id/train-only', ...)` — approx lines 374–424
3. `router.get('/data', ...)` — approx lines 425–495
4. `router.get('/jobs', ...)` — approx lines 496–528
5. `router.get('/jobs/:id/logs', ...)` — approx lines 529–600
6. `router.delete('/:id', ...)` — approx lines 628–687
7. `router.get('/data/analysis', ...)` — approx lines 688–745
8. `router.post('/trigger', ...)` — approx lines 746–772
9. `router.post('/jobs/:id/cancel', ...)` — approx lines 773–end

After this, the file should contain exactly 3 routes:
- `POST /upload`
- `POST /:id/annotate`
- `GET /:id`

And the local helper function `createFlightsFromGroundTruth` (used by `/:id/annotate`).

- [ ] **Step 3: TypeScript check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Lint check**

```bash
cd /d/Projekte/TravStats/backend && npm run lint
```

Expected: no warnings for unused imports.

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/routes/training.ts
git commit -m "refactor: remove LLM-only endpoints from training route (save-and-train, trigger, jobs, etc.)"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full frontend test suite**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Expected: all tests PASS.

- [ ] **Step 2: Full frontend type + lint check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint
```

Expected: no errors, no warnings.

- [ ] **Step 3: Full backend type + lint check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit && npm run lint
```

Expected: no errors, no warnings.

- [ ] **Step 4: Verify Training folder contents**

```bash
ls /d/Projekte/TravStats/frontend/src/components/Training/
```

Expected exactly these files (no TrainingDashboard/Filters/Preview):
```
BoardingPassAnnotation.tsx
ConfirmModal.tsx
EmailAnnotation.tsx
ParseLogStats.tsx
ParseLogStats.test.tsx
TemplateReviewCard.tsx
types.ts
```

- [ ] **Step 5: Verify training route has only 3 endpoints**

```bash
grep -n "^router\." /d/Projekte/TravStats/backend/src/routes/training.ts
```

Expected:
```
router.post('/upload', ...)
router.post('/:id/annotate', ...)
router.get('/:id', ...)
```
