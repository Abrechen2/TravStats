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
