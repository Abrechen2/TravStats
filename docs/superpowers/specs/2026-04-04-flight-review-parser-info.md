# Flight Review Modal — Parser Info & Source Text Design

## Goal

Show in the "Review flight" modal which template was used and how high the confidence is, and let the user expand the original email text for manual inspection.

## Architecture

Pure frontend change. All required data is already available:
- `initialData.parserTemplate` (string | undefined) — template name, e.g. "Lufthansa Buchungsdetails"
- `initialData.parserConfidence` (number | undefined) — 0–100
- `originalData.text` (string | undefined) — plain text of the email

No backend changes, no new API endpoints, no new props.

## Components

### FlightReviewModal.tsx (modify only)

**New state:**
```typescript
const [showSourceText, setShowSourceText] = useState(false);
```

**Parser info row** — under the "Flight X of Y" line in the sticky header:
- Shows `initialData.parserTemplate ?? t("flights:review.unknownParser")`
- Confidence pill colored: green (≥70), yellow (≥40), red (<40)
- Only render when `parserTemplate` or `parserConfidence` is present
- "Source text" toggle button on the right of the same row, only when `originalData?.text` is present

**Source text panel** — between the header `div` and the form:
- Only rendered when `showSourceText && originalData?.text`
- `<pre className="whitespace-pre-wrap font-mono text-xs ... max-h-48 overflow-y-auto">`
- Background: `bg-[var(--bg-elevated)]`, thin border
- Padding px-6 py-3 so it lines up flush with the header/form

## i18n Keys

`frontend/src/i18n/de/flights.ts` and `en/flights.ts`:

```typescript
// flights:review namespace
unknownParser: "Unbekannt",        // de: "Unbekannt"     en: "Unknown"
sourceText: "Quelltext",           // de: "Quelltext"     en: "Source text"
hideSourceText: "Ausblenden",      // de: "Ausblenden"    en: "Hide"
confidenceLabel: "Konfidenz",      // de: "Konfidenz"     en: "Confidence"
```

## Confidence Color Logic

```typescript
function getConfidenceColor(confidence: number): string {
  if (confidence >= 70) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (confidence >= 40) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
}
```

## Render Structure

```
<div sticky header>
  <div>
    <h2>Flug überprüfen</h2>
    <p>Flug 1 von 3</p>                          ← existing
    {parserTemplate || parserConfidence} &&
    <div parser-info-row>
      <span>🤖 {parserTemplate}</span>
      {parserConfidence !== undefined &&
        <span pill>{parserConfidence}% Konfidenz</span>
      }
      {originalData?.text &&
        <button toggle>{showSourceText ? hideLabel : sourceTextLabel}</button>
      }
    </div>
  </div>
  <button close />
</div>

{showSourceText && originalData?.text &&
  <div source-panel>
    <pre>{originalData.text}</pre>
  </div>
}

<form>...</form>
```

## Testing

- Existing tests in `FlightReviewModal.fieldSources.test.tsx` must continue to pass
- No new test required (pure render logic, no state management, no API call)

## Out of Scope

- Text highlighting (color-coding pattern matches) — YAGNI
- Tab layout in the modal
- Backend changes
