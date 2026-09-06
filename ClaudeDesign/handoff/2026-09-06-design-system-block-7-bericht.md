# Block 7 — Aufräumen und Wächter. Bericht (Wächter fertig, Aufräumen offen)

Zweig `dev/design-system`. Auftrag:
`ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md` §4, Block 7.

**Die vier Wächter stehen und sind grün.** Vorgezogen, weil sie messen, was die
Blöcke 3–6 noch abzuarbeiten haben — ein Aufräumen ohne Wächter ist eine
Handbewegung, ein Wächter ohne Aufräumen ist eine Richtung.

---

## 1. Die zwölf nie definierten Variablen sind zu

Anhang A.4 der Übergabe zählte 55 `var(--…)`-Verwendungen von Namen, die
**nirgends definiert** waren. Eine fehlende Custom Property wirft keinen
Fehler: die Deklaration fällt weg, und der Rand, der Hintergrund oder die Farbe
ist einfach nicht da. Das ist die leiseste Fehlerklasse der Anwendung.

Sie sind in `index.css` als Aliase auf das gemeinte Token definiert:

| Name | zeigt jetzt auf | war |
|---|---|---|
| `--border` (21×) | `--ts-border` | nichts |
| `--color-amber` (10×) | `--ts-accent` | nichts |
| `--fx` (6×) | `--ts-info` | Rückfall `#6ab7d8` |
| `--star` (3×) | `--ts-tier-gold` | teils ohne Rückfall |
| `--bg-inset`, `--bg-surface-2` | `--ts-surface2` | nichts |
| `--bg-input`, `--card-bg` | `--ts-surface` | nichts |
| `--text-faint` | `--ts-faint` | Rückfall `#5c6878` |
| `--text-subtle` | `--ts-muted` | Rückfall |
| `--color-error` | `--ts-bad` | Rückfall `#f87171` |
| `--color-primary` | `--ts-accent` | nichts |

Die Aufrufstellen selbst bleiben vorerst; sie zeigen jetzt auf das Richtige,
statt ins Leere. **Als Alias definiert statt 55 Stellen umgeschrieben**, weil
das Ergebnis dasselbe ist und das Risiko nicht: der Wächter unten hält den
dreizehnten Namen ab.

---

## 2. Die vier Wächter

`src/__tests__/designWardens.test.ts` mit
`designWardens.baseline.json`, plus der Generator-Test aus Block 1.

| Wächter | Bauform | Stand heute |
|---|---|---|
| Generator-Ausgabe = Tokendatei | absolut | `theme/__tests__/tokens.generated.test.ts`, deckt CSS **und** TS ab |
| Kein Hex außerhalb von `theme/` | **Ratchet** | 81 Dateien eingefroren |
| Keine rohe Tailwind-Palettenklasse | **Ratchet** | 83 Dateien (567 Klassen) |
| Kein `dark:`-Variant | **Ratchet** | 18 Dateien (92 Vorkommen) |
| Ein Overlay lebt im Dialog-Primitiv | **Ratchet** | 44 Dateien mit `fixed inset-0` |
| Jede gelesene CSS-Variable ist definiert | **absolut** | grün, siehe §1 |

Jeder Ratchet scheitert an einem **neuen** Eintrag ebenso wie an einem
**veralteten** — eine Datei, die repariert wurde, muss die Liste verlassen.
Das ist der Unterschied zwischen einem Wächter und einem Wunsch: eine Regel
gegen 567 bestehende Verstöße ist ein Wunsch; eine, die zusätzlich verbietet,
dass eine reparierte Datei auf der Liste stehen bleibt, ist eine Regel mit
Richtung.

Dazu die zwei aus den früheren Blöcken, gleicher Bauart:
`appShell.ratchet.test.ts` (19 Seiten bauen ihre Shell selbst) und
`screenTitle.test.ts` (jede `<h1>` ist `.t-screen-title`, absolut).

---

## 2.1 Drei Fehlalarme, die der Variablen-Wächter zuerst meldete

Aufgeschrieben, weil ein Scan, der falsch meldet, nach zwei Wochen
ausgeschaltet wird:

- `--color-gray-200` — Tailwinds eigene Palette, vom Framework definiert
  (steht in der Border-Kompatibilitätsregel von Tailwind 4).
- `--ts-` — `token()` baut seinen Namen zusammen (`var(--ts-${name})`); der
  Scan las das Präfix. Ein Name, der auf einen Bindestrich endet, ist keiner.
- `--domain-color` — inline gesetzt als `["--domain-color" as string]: …`, die
  Schreibweise, mit der TypeScript eine Custom Property in ein
  `CSSProperties`-Objekt lässt. Der Scan kannte nur die Form ohne Cast.

---

## 3. Nicht aufgeräumt

Der Auftrag nennt vier Aufräumarbeiten. Die erste ist erledigt (§1), die
anderen drei sind **gemessen und eingefroren**, nicht behoben:

- **92 `dark:`-Klassen in 18 Dateien.** TravStats ist nur dunkel, `class="dark"`
  steht fest in `index.html` — jeder `dark:`-Variant ist also ein Zweig, der
  immer genommen wird, und die helle Farbe daneben hat nie jemand gesehen.
- **567 rohe Tailwind-Palettenklassen in 83 Dateien** (`bg-slate-800`,
  `text-red-500`). Eine Farbe, die niemand entschieden hat.
- **44 eigene `fixed inset-0`-Overlays.** Jedes ist ein neu gebauter Scrim mit
  eigenem Radius, eigenem Hintergrund und — das ist der Teil, der zählt —
  eigener Antwort darauf, ob Escape schließt und ob der Fokus hinausdarf.

Auch offen: **Inter und Syne** sind aus `index.html` und aus den Token-Rollen
raus (Block 1), aber die Klasse `font-display` steht noch an 18 Stellen. Sie
zeigt auf Hanken Grotesk, rendert also richtig; sie zu entfernen ist Teil
desselben Durchgangs.

---

## 4. Gates

```
frontend  npx tsc --noEmit    → keine Ausgabe
frontend  npm run lint        → keine Ausgabe
frontend  npx vitest --run    → 431 Dateien, 3715 Tests, alle grün
frontend  npx vite build      → grün
repo      npm run check:size  → 1154 Dateien, 20 in der Baseline, Grenze 800
          prettier --check    → alle geänderten frontend/src-Dateien sauber
```

Backend nicht berührt.

---

## 5. Nachtrag — der `dark:`-Wächter ist geschlossen

Aus einem Ratchet mit 18 Dateien ist eine absolute Regel geworden: **92
`dark:`-Varianten sind weg**, in allen 18 Dateien.

Beide Hälften eines Paares fallen, und die **dunkle entscheidet** — sie ist
der Wert, der tatsächlich gerendert hat, also sagt sie, was gemeint war:

| vorher | jetzt |
|---|---|
| `text-gray-500 dark:text-gray-400` | `text-(--text-muted)` |
| `text-gray-900 dark:text-white` | `text-(--text-primary)` |
| `text-gray-700 dark:text-gray-300` | `text-(--text-secondary)` |
| `text-red-600 dark:text-red-400` | `text-(--danger)` |
| `text-green-600 dark:text-green-400` | `text-(--success)` |
| `text-amber-700 … dark:text-amber-400` | `text-(--warning)` |
| `border-gray-300 dark:border-gray-600` | `border-(--color-border)` |

Das erschlägt **zwei** Wächter auf einmal, denn jedes Paar waren auch zwei
rohe Tailwind-Palettenklassen: die Palettenliste fällt von **80 auf 72
Dateien**.

Zwei Stellen brauchten ein Urteil statt einer Tabelle:

- **Der Parser-Trainings-Marker** ließ vier handverlesene Tailwind-Tönungen
  kreisen, um zu sagen „zu welchem Flug gehört dieser Token". Das ist eine
  kategoriale Serie **ohne Domäne** — genau wofür `chartColors` da ist. Er
  liest jetzt die Diagrammpalette.
- **Die Vertrauens-Plaketten im Review-Dialog** waren drei Farbpaare, die für
  einen Status standen. Sie lesen die semantischen Tokens.

Der Wächter ist damit **absolut, kein Ratchet mehr**. Sein Baseline-Eintrag
bleibt als leere Liste stehen — er hält fest, dass die Liste **null erreicht
hat**, nicht dass es die Regel nie gebraucht hätte.

**Im Browser nachgesehen, nicht nur getestet.** Eine mechanische
Klassen-Umschreibung scheitert nicht laut, sondern leise: eine falsche
Zuordnung macht etwas unsichtbar, nicht kaputt. Admin-Oberfläche, Posteingang
und die 404-Seite wurden angesehen; alles liest sich.

## 6. Nachtrag — der Shell-Ratchet steht bei 17

`AppShell` hat eine dritte Bauform bekommen: **`viewport`** — die Seite IST
das Fenster, exakt 100vh, nichts scrollt auf dieser Ebene. Das Dashboard war
die letzte Hauptfläche außerhalb der Shell, und aus einem echten Grund: eine
Karte braucht eine Höhe, und `min-h-screen` mit scrollendem Body gibt ihr
keine. Es ist eine dritte **Form**, keine dritte **Breite** — `width` sagt,
wie breit der Inhalt sein darf, `viewport` sagt, wem die Höhe gehört.

Eine Falle, die die Form treffen musste: eine `viewport`-Seite steckt **nicht**
in `PageTransition`. Die Übergangsanimation bewegt ein `transform`, und ein
transformierter Vorfahr lässt jeden `position: fixed`-Nachfahren gegen **ihn**
positionieren statt gegen das Fenster — worauf sich die schwebende
Kartensteuerung verlässt.
