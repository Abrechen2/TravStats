# Flight Review Modal — Parser Info & Source Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the template name and confidence in the header of the "Review flight" modal, plus an expandable source-text panel for manual checks.

**Architecture:** Frontend-only change. `initialData.parserTemplate` and `initialData.parserConfidence` already exist on `ParsedBooking` and are set by the backend. `originalData.text` is already passed in as a prop. Only `FlightReviewModal.tsx` and the two i18n JSON files are touched.

**Tech Stack:** React 18, TypeScript (strict), Tailwind CSS, Vitest + Testing Library, react-i18next

---

## File Structure

| File | Change |
|------|--------|
| `frontend/src/components/FlightReviewModal.tsx` | Modify: new state, parser info row, source-text panel |
| `frontend/src/i18n/resources/de/flights.json` | Modify: 4 new keys in `review` |
| `frontend/src/i18n/resources/en/flights.json` | Modify: 4 new keys in `review` |
| `frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx` | Modify: add 2 new tests |

---

### Task 1: Add i18n keys

**Files:**
- Modify: `frontend/src/i18n/resources/de/flights.json` (line ~204, after `selectedAirport`)
- Modify: `frontend/src/i18n/resources/en/flights.json` (same place)

- [ ] **Step 1: Add new keys to `de/flights.json`**

Open `frontend/src/i18n/resources/de/flights.json`. Find the block `"review": {` (around line 190). Insert these 4 lines **before** the closing `}` of the `review` object (after `"selectedAirport"`):

```json
    "unknownParser": "Unbekannt",
    "confidenceLabel": "Konfidenz",
    "sourceText": "Quelltext",
    "hideSourceText": "Ausblenden"
```

The `review` object then looks like this (excerpt):
```json
  "review": {
    "title": "Flug überprüfen",
    "source": "Quelle",
    "flightIndex": "Flug {{index}} von {{total}}",
    "confirm": "Bestätigen",
    "edit": "Bearbeiten",
    "cancel": "Abbrechen",
    "discard": "Verwerfen",
    "saving": "Speichert...",
    "next": "Weiter",
    "costsTitle": "Kosten (optional)",
    "loadingAirports": "Flughäfen werden geladen...",
    "departureNotFound": "Abflughafen {{code}} nicht gefunden",
    "arrivalNotFound": "Ankunftsflughafen {{code}} nicht gefunden",
    "selectedAirport": "Ausgewählt: {{name}} ({{code}})",
    "unknownParser": "Unbekannt",
    "confidenceLabel": "Konfidenz",
    "sourceText": "Quelltext",
    "hideSourceText": "Ausblenden"
  },
```

- [ ] **Step 2: Add the same keys to `en/flights.json`**

Open `frontend/src/i18n/resources/en/flights.json`. Same place inside the `review` object (after `selectedAirport`):

```json
    "unknownParser": "Unknown",
    "confidenceLabel": "Confidence",
    "sourceText": "Source text",
    "hideSourceText": "Hide"
```

- [ ] **Step 3: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/resources/de/flights.json frontend/src/i18n/resources/en/flights.json
git commit -m "feat: add parser info i18n keys to flights review namespace"
```

---

### Task 2: Write the tests (TDD)

**Files:**
- Modify: `frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx`

- [ ] **Step 1: Add the tests**

Open `frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx`. The file already mocks `airportsApi`, `parseApi`, `authStore` and `useTranslation`. Append a new block after the existing `describe`:

```typescript
describe("FlightReviewModal parser info", () => {
  const parsedWithMeta: ParsedBooking = {
    flightNumber: "LH105",
    departureCode: "MUC",
    arrivalCode: "FRA",
    missing: [],
    parserTemplate: "Lufthansa Buchungsdetails",
    parserConfidence: 75,
    fieldSources: { flightNumber: "template" },
  };

  it("renders parser template name when parserTemplate is set", () => {
    render(
      <FlightReviewModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={async () => {}}
        initialData={parsedWithMeta}
        source="email"
      />
    );
    expect(screen.getByText("Lufthansa Buchungsdetails")).toBeInTheDocument();
  });

  it("renders confidence pill when parserConfidence is set", () => {
    render(
      <FlightReviewModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={async () => {}}
        initialData={parsedWithMeta}
        source="email"
      />
    );
    expect(screen.getByText(/75/)).toBeInTheDocument();
  });

  it("shows source text panel when toggle is clicked", async () => {
    const { getByText, queryByText } = render(
      <FlightReviewModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={async () => {}}
        initialData={parsedWithMeta}
        source="email"
        originalData={{ text: "Buchungscode: K9NB9B\nFlug: LH105" }}
      />
    );
    expect(queryByText("Buchungscode: K9NB9B")).not.toBeInTheDocument();
    const btn = getByText("flights:review.sourceText");
    btn.click();
    expect(getByText("Buchungscode: K9NB9B\nFlug: LH105")).toBeInTheDocument();
  });

  it("does not render parser info row when both parserTemplate and parserConfidence are absent", () => {
    const { container } = render(
      <FlightReviewModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={async () => {}}
        initialData={{ flightNumber: "LH1", departureCode: "MUC", arrivalCode: "FRA", missing: [] }}
        source="email"
      />
    );
    expect(container.querySelector("[data-testid='parser-info-row']")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests — they must FAIL**

```bash
cd frontend && npx vitest --run src/__tests__/components/FlightReviewModal.fieldSources.test.tsx
```

Expected: the 4 new tests fail (the component does not render the info yet). The existing test ("applies green border class") must still pass.

- [ ] **Step 3: Commit (failing tests)**

```bash
git add frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx
git commit -m "test: FlightReviewModal parser info + source text toggle tests (RED)"
```

---

### Task 3: Implement FlightReviewModal

**Files:**
- Modify: `frontend/src/components/FlightReviewModal.tsx`

- [ ] **Step 1: Add the `showSourceText` state**

Open `frontend/src/components/FlightReviewModal.tsx`. The existing states start around line 50. Insert this line directly after the last `useState` declaration (look for the last `useState` before the first `useEffect`):

```typescript
const [showSourceText, setShowSourceText] = useState(false);
```

- [ ] **Step 2: Add the helper function `getConfidenceColor`**

Add this function directly after the existing `getFieldBorderClass` function (around line 18, before `interface FlightReviewModalProps`):

```typescript
function getConfidenceColor(confidence: number): string {
  if (confidence >= 70) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (confidence >= 40) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
}
```

- [ ] **Step 3: Insert the parser info row into the header**

In the JSX return, in the header block (around line 354–377). Find this exact block:

```tsx
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{title}</h2>
            {showProgress && (
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {t("flights:review.flightIndex", { index: flightIndex! + 1, total: totalFlights })}
              </p>
            )}
          </div>
```

Replace it with:

```tsx
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{title}</h2>
            {showProgress && (
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {t("flights:review.flightIndex", { index: flightIndex! + 1, total: totalFlights })}
              </p>
            )}
            {(initialData.parserTemplate || initialData.parserConfidence !== undefined) && (
              <div
                data-testid="parser-info-row"
                className="flex items-center gap-2 mt-1.5 flex-wrap"
              >
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <span>🤖</span>
                  <span>{initialData.parserTemplate ?? t("flights:review.unknownParser")}</span>
                </span>
                {initialData.parserConfidence !== undefined && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${getConfidenceColor(initialData.parserConfidence)}`}
                  >
                    {initialData.parserConfidence}% {t("flights:review.confidenceLabel")}
                  </span>
                )}
                {originalData?.text && (
                  <button
                    type="button"
                    onClick={() => setShowSourceText((v) => !v)}
                    className="text-xs px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    {showSourceText
                      ? t("flights:review.hideSourceText")
                      : t("flights:review.sourceText")}
                  </button>
                )}
              </div>
            )}
          </div>
```

- [ ] **Step 4: Insert the source-text panel between header and form**

In the JSX, find this exact comment + opening form line:

```tsx
        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
```

Replace it with:

```tsx
        {/* Source text panel */}
        {showSourceText && originalData?.text && (
          <div className="border-b border-[var(--color-border)] bg-[var(--bg-elevated)] px-6 py-3">
            <pre className="whitespace-pre-wrap font-mono text-xs text-[var(--text-secondary)] max-h-48 overflow-y-auto leading-relaxed">
              {originalData.text}
            </pre>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
```

- [ ] **Step 5: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Run the tests — all must PASS**

```bash
cd frontend && npx vitest --run src/__tests__/components/FlightReviewModal.fieldSources.test.tsx
```

Expected: all 5 tests green (1 existing + 4 new)

- [ ] **Step 7: All frontend tests**

```bash
cd frontend && npx vitest --run
```

Expected: all tests green

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/FlightReviewModal.tsx
git commit -m "feat: show parser template name, confidence and source text toggle in FlightReviewModal"
```

---

### Task 4: Test locally

- [ ] **Step 1: Start the dev server (if not already running)**

```bash
# Im Root-Verzeichnis:
npm run dev
```

Backend on port 8000, frontend on port 3000.

- [ ] **Step 2: Upload and parse an email**

1. Open the browser: `http://localhost:3000`
2. Log in as `dennis` or `demo`
3. Click **"+ Flug hinzufügen"** → **"E-Mail importieren"**
4. Upload an MSG file from `test-samples/emails/` (e.g. `Buchungsdetails _ Abflug_ 14 November 2024 _ MUC-FRA_.msg`)
5. The "Review flight" modal opens

- [ ] **Step 3: Verify the parser info**

Expected result in the modal header:
- The parser info row appears below "Flug 1 von 1"
- Template name: `🤖 Lufthansa Buchungsdetails` (when a template matches) or the built-in name
- Confidence pill with color (green/yellow/red)
- A "Quelltext" button

- [ ] **Step 4: Verify the source text toggle**

1. Click "Quelltext"
2. The panel opens showing the email plaintext (scrollable, max ~200px)
3. The button now reads "Ausblenden"
4. Click again → the panel closes

- [ ] **Step 5: Commit if everything is OK**

If the manual test passes, the feature is done. No further commit needed (everything is already committed in tasks 1–3).
