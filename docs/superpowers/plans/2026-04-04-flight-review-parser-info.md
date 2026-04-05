# Flight Review Modal — Parser Info & Quelltext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Im "Flug überprüfen" Modal Template-Name und Konfidenz im Header anzeigen, plus aufklappbaren Quelltext-Panel für manuelle Kontrolle.

**Architecture:** Reine Frontend-Änderung. `initialData.parserTemplate` und `initialData.parserConfidence` sind bereits auf `ParsedBooking` vorhanden und werden vom Backend gesetzt. `originalData.text` wird bereits als Prop übergeben. Nur `FlightReviewModal.tsx` und die beiden i18n-JSON-Dateien werden geändert.

**Tech Stack:** React 18, TypeScript (strict), Tailwind CSS, Vitest + Testing Library, react-i18next

---

## File Structure

| File | Change |
|------|--------|
| `frontend/src/components/FlightReviewModal.tsx` | Modify: neuer State, Parser-Info-Zeile, Quelltext-Panel |
| `frontend/src/i18n/resources/de/flights.json` | Modify: 4 neue Keys in `review` |
| `frontend/src/i18n/resources/en/flights.json` | Modify: 4 neue Keys in `review` |
| `frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx` | Modify: 2 neue Tests hinzufügen |

---

### Task 1: i18n Keys hinzufügen

**Files:**
- Modify: `frontend/src/i18n/resources/de/flights.json` (Zeile ~204, nach `selectedAirport`)
- Modify: `frontend/src/i18n/resources/en/flights.json` (gleiche Stelle)

- [ ] **Step 1: Neue Keys in `de/flights.json` eintragen**

Öffne `frontend/src/i18n/resources/de/flights.json`. Suche den Block `"review": {` (ca. Zeile 190). Füge **vor** der schließenden `}` des `review`-Objekts (nach `"selectedAirport"`) folgende 4 Zeilen ein:

```json
    "unknownParser": "Unbekannt",
    "confidenceLabel": "Konfidenz",
    "sourceText": "Quelltext",
    "hideSourceText": "Ausblenden"
```

Das `review`-Objekt sieht danach so aus (Auszug):
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

- [ ] **Step 2: Gleiche Keys in `en/flights.json` eintragen**

Öffne `frontend/src/i18n/resources/en/flights.json`. Gleiche Stelle im `review`-Objekt (nach `selectedAirport`):

```json
    "unknownParser": "Unknown",
    "confidenceLabel": "Confidence",
    "sourceText": "Source text",
    "hideSourceText": "Hide"
```

- [ ] **Step 3: TypeScript-Check**

```bash
cd frontend && npx tsc --noEmit
```

Erwartet: keine Fehler

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/resources/de/flights.json frontend/src/i18n/resources/en/flights.json
git commit -m "feat: add parser info i18n keys to flights review namespace"
```

---

### Task 2: Tests schreiben (TDD)

**Files:**
- Modify: `frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx`

- [ ] **Step 1: Tests hinzufügen**

Öffne `frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx`. Die Datei hat bereits Mocks für `airportsApi`, `parseApi`, `authStore` und `useTranslation`. Füge nach dem bestehenden `describe`-Block einen neuen Block an:

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

- [ ] **Step 2: Tests laufen lassen — müssen FEHLSCHLAGEN**

```bash
cd frontend && npx vitest --run src/__tests__/components/FlightReviewModal.fieldSources.test.tsx
```

Erwartet: Die 4 neuen Tests schlagen fehl (Component zeigt die Infos noch nicht an). Der bestehende Test ("applies green border class") muss weiterhin bestehen.

- [ ] **Step 3: Commit (failing tests)**

```bash
git add frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx
git commit -m "test: FlightReviewModal parser info + source text toggle tests (RED)"
```

---

### Task 3: FlightReviewModal implementieren

**Files:**
- Modify: `frontend/src/components/FlightReviewModal.tsx`

- [ ] **Step 1: `showSourceText` State hinzufügen**

Öffne `frontend/src/components/FlightReviewModal.tsx`. Die bestehenden States beginnen ab ca. Zeile 50. Füge direkt nach der letzten `useState`-Deklaration (suche nach dem letzten `useState` vor dem ersten `useEffect`) folgende Zeile ein:

```typescript
const [showSourceText, setShowSourceText] = useState(false);
```

- [ ] **Step 2: Hilfsfunktion `getConfidenceColor` hinzufügen**

Füge diese Funktion direkt nach der bestehenden `getFieldBorderClass`-Funktion ein (ca. Zeile 18, vor `interface FlightReviewModalProps`):

```typescript
function getConfidenceColor(confidence: number): string {
  if (confidence >= 70) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (confidence >= 40) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
}
```

- [ ] **Step 3: Parser-Info-Zeile in den Header einfügen**

Im JSX-Return, im Header-Block (ca. Zeile 354–377). Suche diesen exakten Block:

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

Ersetze es durch:

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

- [ ] **Step 4: Quelltext-Panel zwischen Header und Form einfügen**

Suche im JSX diesen exakten Kommentar + öffnende Form-Zeile:

```tsx
        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
```

Ersetze es durch:

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

- [ ] **Step 5: TypeScript-Check**

```bash
cd frontend && npx tsc --noEmit
```

Erwartet: keine Fehler

- [ ] **Step 6: Tests laufen lassen — müssen alle BESTEHEN**

```bash
cd frontend && npx vitest --run src/__tests__/components/FlightReviewModal.fieldSources.test.tsx
```

Erwartet: alle 5 Tests grün (1 bestehend + 4 neue)

- [ ] **Step 7: Alle Frontend-Tests**

```bash
cd frontend && npx vitest --run
```

Erwartet: alle Tests grün

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/FlightReviewModal.tsx
git commit -m "feat: show parser template name, confidence and source text toggle in FlightReviewModal"
```

---

### Task 4: Lokal testen

- [ ] **Step 1: Dev-Server starten (falls nicht läuft)**

```bash
# Im Root-Verzeichnis:
npm run dev
```

Backend läuft auf Port 8000, Frontend auf Port 3000.

- [ ] **Step 2: E-Mail hochladen und parsen**

1. Browser öffnen: `http://localhost:3000`
2. Als `dennis` oder `demo` einloggen
3. Auf **"+ Flug hinzufügen"** klicken → **"E-Mail importieren"**
4. Eine MSG-Datei aus `test-samples/emails/` hochladen (z.B. `Buchungsdetails _ Abflug_ 14 November 2024 _ MUC-FRA_.msg`)
5. Das "Flug überprüfen" Modal öffnet sich

- [ ] **Step 3: Parser-Info prüfen**

Erwartetes Ergebnis im Modal-Header:
- Unter "Flug 1 von 1" erscheint die Parser-Info-Zeile
- Template-Name: `🤖 Lufthansa Buchungsdetails` (wenn Template matcht) oder der Built-in-Name
- Konfidenz-Pill mit Farbe (grün/gelb/rot)
- Button "Quelltext"

- [ ] **Step 4: Quelltext-Toggle prüfen**

1. Auf "Quelltext" klicken
2. Panel öffnet sich mit dem E-Mail-Plaintext (scrollbar, max ~200px)
3. Button zeigt jetzt "Ausblenden"
4. Nochmal klicken → Panel schließt sich

- [ ] **Step 5: Commit falls alles OK**

Wenn der manuelle Test besteht, ist das Feature fertig. Kein weiterer Commit nötig (alles bereits committed in Task 1–3).
