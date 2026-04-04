# Flight Review Modal — Parser Info & Quelltext Design

## Goal

Zeige im "Flug überprüfen" Modal welches Template genutzt wurde, wie hoch die Konfidenz ist, und ermögliche dem User den Original-E-Mail-Text aufzuklappen zur manuellen Kontrolle.

## Architecture

Reine Frontend-Änderung. Alle nötigen Daten sind bereits vorhanden:
- `initialData.parserTemplate` (string | undefined) — Template-Name, z.B. "Lufthansa Buchungsdetails"
- `initialData.parserConfidence` (number | undefined) — 0–100
- `originalData.text` (string | undefined) — Plaintext der E-Mail

Keine Backend-Änderungen, keine neuen API-Endpoints, keine neuen Props.

## Components

### FlightReviewModal.tsx (modify only)

**Neuer State:**
```typescript
const [showSourceText, setShowSourceText] = useState(false);
```

**Parser-Info-Zeile** — unter der "Flug X von Y" Zeile im sticky Header:
- Zeigt `initialData.parserTemplate ?? t("flights:review.unknownParser")`
- Konfidenz-Pill mit Farbe: grün (≥70), gelb (≥40), rot (<40)
- Nur rendern wenn `parserTemplate` oder `parserConfidence` vorhanden
- "Quelltext"-Toggle-Button rechts in derselben Zeile, nur wenn `originalData?.text` vorhanden

**Quelltext-Panel** — zwischen Header-`div` und Form:
- Nur gerendert wenn `showSourceText && originalData?.text`
- `<pre className="whitespace-pre-wrap font-mono text-xs ... max-h-48 overflow-y-auto">`
- Hintergrund: `bg-[var(--bg-elevated)]`, dünner Border
- Padding px-6 py-3 damit es bündig mit Header/Form liegt

## i18n Keys

`frontend/src/i18n/de/flights.ts` und `en/flights.ts`:

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

- Vorhandene Tests in `FlightReviewModal.fieldSources.test.tsx` müssen weiterhin bestehen
- Kein neuer Test nötig (pure render logic, kein State-Management, kein API-Call)

## Out of Scope

- Text-Highlighting (Pattern-Matches farbig markieren) — YAGNI
- Tab-Layout im Modal
- Backend-Änderungen
