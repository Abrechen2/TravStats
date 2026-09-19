# Block 2 — Primitive. Bericht

Zweig `dev/design-system`, aufgesetzt auf Block 1. Auftrag:
`ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md` §4, Block 2.

---

## 1. Gebaut

`frontend/src/components/ui/` — vierzehn Primitive, ein Barrel, eine
CSS-Schicht:

| Datei | Was |
|---|---|
| `AppShell.tsx`, `PageHeader.tsx` | aus Block 1 |
| `Button.tsx` | `primary` 52 · `secondary` 46 · `danger` (nur im Bestätigungsdialog) |
| `IconButton.tsx` | 44×44, Radius 14, `surface2`, Haarlinie |
| `Card.tsx` | `Card` · `Tile` · `HeroCard` · `SparseCard` |
| `Pill.tsx` | `Pill` · `StatusPill` · `DomainPill` |
| `Chip.tsx` | Filterchip, aktiv = Akzentfüllung |
| `StatTile.tsx` | `StatTile` · `SectionLabel` |
| `Dialog.tsx` | eine Shell, Fokusfalle, Escape, Scrim, eine Aktion |
| `Field.tsx` | `Field` · `Input` · `TextArea` · `Select` · `Switch` |
| `EmptyState.tsx` | vier Arten |
| `Table.tsx` | `Table` · `TableRow` · `ListRow` |
| `tokens.ts` | `alpha()` · `token()` · Status-/Domänen-Zuordnung · `MONO_KEYS` |
| `index.ts` | das Barrel — eine Seite importiert von hier |
| `theme/ui.css` | Hover, Aktiv, das schmale Tabellenlayout, die Keyframes |

Abnahmefläche: **`/design`**, nur im Dev-Build. Sie zeigt jedes Primitiv in
jedem Zustand mit dem Token daneben — Farbe, Typografie, Knöpfe, Pillen,
Chips, Flächen, Kennzahlen, Formularfelder, Tabelle, ListRow, die vier
Leerzustände und die Mono-Disziplin.

---

## 2. Entschieden, mit Grund

| Entscheidung | Grund |
|---|---|
| **`color-mix` statt ausgeschriebener Schattierungen** | Die Pillen-Rezeptur ist „Farbe als Text, 12 % Fläche, 45 % Rand" — drei Schattierungen einer Farbe. Ausgeschrieben wären das drei Hex-Werte je Status, vierundzwanzig insgesamt, keiner davon in der Tokendatei. `alpha()` leitet sie aus dem einen Eingabewert ab; ändert sich ein Ton in `tokens.json`, ändern sich alle drei mit. |
| **Die Dialog-Shell steht vollständig in `ui.css`** | Erst standen die Stile inline. Auf dem Desktop sah es richtig aus und war falsch: ein inline gesetztes `align-items: center` schlägt jede Media Query, also blieb der Dialog unter 640 px mittig stehen statt als Sheet unten anzudocken. **Gefunden im Browser, nicht von einem Test** — die 32 Tests waren grün, während es kaputt war. Nur die Breite des Aufrufers reist noch als `--ts-dialog-max` hinüber. |
| **Die Tabelle ist ein Grid mit ausgeschriebenen ARIA-Rollen** | Der Export zeichnet Tabellen als Grid-Zeilen ohne Rollen; für einen Screenreader ist das ein Stapel zusammenhangloser `div`s (Anhang A der Rückmeldung sagt es selbst). `role="table"/"row"/"columnheader"/"cell"` sind gesetzt und getestet. |
| **Ein DOM, zwei Layouts** | Unter 640 px wird dieselbe Zeile zur ListRow, per Grid-Areas. Jede Spalte sagt in `onNarrow`, was sie dort wird (`mark` · `title` · `subtitle` · `trailing` · `hide`). Zwei Komponenten für dieselben Zeilen würden driften; ein Media-Query-Hook würde beim ersten Anstrich die falsche Fassung zeigen. Die Lesereihenfolge im Markup bleibt unverändert, nur die visuelle Anordnung wechselt. |
| **Eine anklickbare Tabellenzeile ist ein `div` mit `role="row"`, kein `<button>`** | Im August wurde gemessen, dass eine anklickbare Zeile die Aktionen in ihr bricht — das passiert, weil ein interaktives Element in einem `<button>` verschachtelt liegt. Die Zeile ist ein Tab-Stopp mit `Enter`/`Leertaste`, die Aktionen sind die nächsten. |
| **`danger` ist kein roter Knopf, sondern ein getönter Umriss** | Eine zerstörerische Aktion wird bestätigt, nicht angeboten. Sie steht in einem Dialog, der Objekt, Reichweite und Folge bereits ausspricht; eine rote Füllung dort macht aus dem Dialog einen Alarm. |
| **Der Chip ist 34 px hoch, unter dem 44er-Minimum** | Eine Chipzeile ist dicht, und das Klickziel liefert die Zeile über ihren senkrechten Abstand. Bewusste Ausnahme, hier notiert statt stillschweigend. |
| **`Switch` statt `checkbox`** | Kein kosmetischer Unterschied: ein Kästchen ist eine Wahl, die man später bestätigt, ein Schalter wirkt beim Anfassen. Alles in den Einstellungen ist das Zweite, und die App zeichnet das Erste. |
| **`/design` ist unübersetzt** | Sie wird von dem gelesen, der das System baut, nicht von einem Nutzer. Vierzig Beschriftungen in die DE/EN-Dateien zu spiegeln hieße, Strings in den Paritätstest zu legen, die keine Produktfläche je zeigt. |
| **`/design` ist nur im Dev-Build montiert** (`import.meta.env.DEV`) | Nicht hinter einem Schalter versteckt, sondern im Produktions-Bündel gar nicht vorhanden — eine bewusst unübersetzte Seite hat auf der Instanz eines Nutzers nichts zu suchen. |
| **`MONO_KEYS` ist hier geschrieben, nicht aus dem Export übernommen** | Der Auftrag nennt „`MONO_KEYS` im Export ist die Liste", aber `ts-shared.js` der Runde 3 enthält keinen solchen Export (nachgesehen: null Treffer). Die Liste kommt daher aus `DESIGN_SYSTEM.md` §3.2, wo dieselbe Regel in Prosa steht. |

---

## 3. Neu, und ohne die Änderung rot

`src/components/ui/__tests__/primitives.test.tsx`, 32 Fälle:

- **StatusPill**: ein unbekannter Status wird historisch-grau, nicht
  storniert-rot (das war ein echter Defekt: der Catch-all-Else-Zweig der
  Flugtabelle färbte einen Flug von 2019 wie einen, der nie startete);
  gestrichelt nur bei „vorläufig"; `in_progress`/`completed` sind Synonyme der
  Geflogen-Farbe, keine neuen Töne; **nie mono**; die 12 %/45 %-Rezeptur.
- **EmptyState**: keine der vier Arten greift nach `--ts-bad`. Leer und
  wartend sind keine Fehler, offline ist ein Wartezustand.
- **Dialog**: Escape schließt; der Scrim schließt, die Karte nicht; `aria-modal`
  ist gesetzt; geschlossen rendert nichts.
- **Table**: die Rollen sind da; jede Zelle sagt, was sie unter 640 px wird;
  mono liegt auf der Code-Spalte und nicht auf der Strecke; eine anklickbare
  Zeile ist per Tastatur erreichbar.
- **Der Hex-Ratchet, auf die Bibliothek verengt**: jede Datei in
  `components/ui/` wird gescannt und darf **kein** Hex-Literal enthalten.
  Block 7 macht daraus den repo-weiten Scan mit eingefrorener Liste; hier kann
  er absolut sein, weil es nichts einzufrieren gibt.

---

## 4. Offen

- **Die Kopfleiste ist weiter die alte.** Sie ist jetzt baubar (IconButton,
  Chip, die Menü-Keyframes stehen), aber ihr Umbau berührt jede Seite und
  gehört zu Block 4, wo das Dashboard ohnehin die Leiste anfasst.
- **Kein Primitiv hat bisher einen Verbraucher.** Das ist die Reihenfolge des
  Auftrags: Block 3 setzt die vier Listen darauf, Block 7 räumt die 24
  eigenen Overlays und die alten Button-Utilities ab. Bis dahin stehen die
  alte und die neue Schicht nebeneinander — sichtbar auf `/design` gegen
  jede andere Seite.
- **`components/table/statusPillStyle.ts`** lebt noch und färbt die heutigen
  Listen nach der alten Palette (15 % Fläche, kein Rand, keine Versalien). Es
  fällt in Block 3 mit seinen Aufrufstellen.
- **Kein Icon-Set.** Der Export bringt ein Lucide-Sprite mit ~70 Pfaden; die
  App hat kein `lucide-react` und zeichnet ihre Icons als Inline-SVG. Das
  Ersetzen der vier Domänen-Emoji durch Lucide-Namen (DESIGN_SYSTEM §7)
  gehört zu Block 3/7, weil es `shared/domains.ts` auf beiden Seiten berührt.

---

## 5. Bilder

`ClaudeDesign/screenshots/design-system/block-2/`:

| Datei | Was |
|---|---|
| `primitives-1440x900.png` | `/design`, ganze Seite |
| `primitives-390x844.png` | dieselbe Seite bei 390 px — die Tabelle ist dort eine ListRow, kein waagerechter Bildlauf |
| `dialog-1440x900.png` | Dialog offen, zentriert |
| `dialog-390x844.png` | Dialog offen, unten angedockt — das Sheet |

Aufgenommen gegen den Dev-Server (Port 3002), weil `/design` im
Produktions-Build absichtlich nicht existiert.

---

## 6. Gates

```
npx tsc --noEmit          → keine Ausgabe
npm run lint              → eslint . --max-warnings 0, keine Ausgabe
npx vitest --run          → 428 Dateien, 3696 Tests, alle grün (+32 gegenüber Block 1)
npm run check:size        → 1151 Dateien geprüft, 20 in der Baseline, Grenze 800
npx prettier --check …    → alle geänderten frontend/src-Dateien sauber
```

Backend nicht berührt.
