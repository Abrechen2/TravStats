# LLM Training Cleanup — Design Spec

**Date:** 2026-04-03
**Goal:** Remove all dead LLM training code (frontend + backend) that was left over after the TrainingPage → ParserPage refactor. The result is a lean parser-focused codebase with no LLM fine-tuning remnants in active code paths.

---

## Context

The `TrainingPage` was replaced by `ParserPage` (PR #48). The new page has 4 tabs: Annotate, My Templates, Community, Parse Logs. The LLM training dashboard (`TrainingDashboard`) and its sub-components were never wired into the new page — they're orphaned. Additionally, both annotation components (`EmailAnnotation`, `BoardingPassAnnotation`) still contain a "Save + Train" button that triggers LoRA fine-tuning, which is no longer desired.

---

## What Stays (needed for parsing)

### Frontend
- `Training/EmailAnnotation.tsx` — annotation UI, single "Save" button calling `annotate`
- `Training/BoardingPassAnnotation.tsx` — annotation UI, single "Save" button calling `annotate`
- `Training/ParseLogStats.tsx` — admin Parse-Logs tab
- `Training/TemplateReviewCard.tsx` — shown after annotation derives a template
- `Training/ConfirmModal.tsx` — still used by `FlightsTablePage`
- `Training/types.ts` — used by annotation components
- `trainingApi`: `upload`, `annotate`, `getById`, `getParseLogStats`, `exportParseLogs`, `promoteCorrections`
- Types: `TrainingDataEntry`, `TrainingUploadResult`, `TrainingAnnotationResult`

### Backend
- `POST /training/upload` — file upload for annotation
- `POST /training/:id/annotate` — save annotation + derive template
- `GET /training/:id` — load existing training data for annotation UI
- `trainingService.ts` — untouched (`getTrainingConfig` used by `admin.ts` + `modelManager.ts`)
- `trainingRecorder.ts` — untouched (`recordParseResult`, `buildAirlineNotice` used by `templateParser.ts`)

---

## What Gets Removed

### Frontend — Delete Files
| File | Lines | Reason |
|------|-------|--------|
| `Training/TrainingDashboard.tsx` | 1306 | Not imported anywhere after TrainingPage deletion |
| `Training/TrainingDataFilters.tsx` | 222 | Only used by TrainingDashboard |
| `Training/TrainingDataPreview.tsx` | 307 | Only used by TrainingDashboard |

### Frontend — Modify `EmailAnnotation.tsx`
- Remove `andTrain: boolean` parameter from `handleSave`
- Remove the `if (andTrain)` branch — always call `trainingApi.annotate`
- Remove the second button "Speichern + Trainieren" (`handleSave(true)`)
- One button remains: "Speichern" (`handleSave()`)

### Frontend — Modify `BoardingPassAnnotation.tsx`
- Same changes as EmailAnnotation

### Frontend — `lib/api.ts` (trainingApi)
Remove methods: `saveAndTrain`, `trainOnly`, `getData`, `getJobs`, `getJobLogs`, `triggerTraining`, `cancelTraining`, `deleteTrainingData`

### Frontend — `types/index.ts`
Remove interfaces: `TrainingJob`, `TrainingJobLog`, `TrainingJobLogsResponse`

### Backend — `routes/training.ts`
Remove endpoints:
- `POST /:id/save-and-train`
- `POST /:id/train-only`
- `GET /data`
- `GET /jobs`
- `GET /jobs/:id/logs`
- `DELETE /:id`
- `POST /trigger`
- `POST /jobs/:id/cancel`
- `GET /data/analysis`

Remove unused imports: `triggerTraining`, `shouldTriggerTraining`, `cancelTraining`, `analyzeTrainingData`, `trainingTriggerLimiter`

---

## Out of Scope

- `trainingService.ts` — not touched (still exports `getTrainingConfig`)
- `trainingRecorder.ts` — not touched
- `training:` i18n namespace — keys from annotation components remain valid; `training:annotation.saveAndTrain` key becomes unused but cleaning i18n is cosmetic
- DB schema / Prisma — no changes
- `ConfirmModal.tsx` — stays, still used by `FlightsTablePage`

---

## Verification

After implementation:
```bash
# Frontend: no dead imports, all tests pass
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run

# Backend: no dead imports, type-clean
cd backend && npx tsc --noEmit && npm run lint
```
