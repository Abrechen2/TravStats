# Block 5 — Statistik, Erfolge, Jahresrückblick. Bericht (teilweise)

Zweig `dev/design-system`, aufgesetzt auf Block 4. Auftrag:
`ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md` §4, Block 5.

**Drei der vier Punkte sind geliefert. Der Jahresrückblick ist nicht gebaut** —
siehe §4.

---

## 1. Gebaut

### Die Diagrammpalette, mit ihrer Regel
`lib/chartPalette.ts` bringt `chartColors` (acht Farben), `chartMutedBar` und
die Chrome-Farben (Gitter, Achsen, Ticks) an eine Stelle — und schreibt vor
allem die **Regel** auf, die die Runde-2-Rückmeldung als Korrektur nennt:

> Eine Serie, die eine **Domäne** ist, trägt `domainColor.<key>`.
> `chartColors` ist für Serien **ohne** Domäne — Airlines, Flughäfen,
> Kabinenklassen, Länder, Jahre.

Der Export hatte das falsch: die Kreuzfahrt-Serie in „Aktivität pro Jahr" war
`chart[1]`, das `info`-Blau, während die Kreuzfahrt-Kachel daneben, die
Dashboard-Legende und die Logbuch-Unterleiste das Domänen-Türkis führten. Auf
einem Bildschirm hieß Blau dann im Diagramm „Kreuzfahrt" und in der Pille
„Geplant".

**Gemessen, bevor gebaut wurde:** die App macht diesen Fehler nicht. Die
Domänen-Abschnitte lesen bereits `useDomainColors()`
(`CruiseStatsSection`, `PoiStatsSection`, `DomainToggleChips`), also die
Stelle, an der auch der Nutzer-Override liegt. Sie durch dieses Modul zu
schicken würde den Override still ignorieren — genau der Defekt, den #270
beseitigt hat. Deshalb steht das im Kopf der Datei, und die Domänen-Serien
bleiben, wo sie sind.

Was das Modul heute leistet: Serien ohne Domäne haben ab jetzt eine
Token-Farbe zur Hand statt `accent` für alles, und Gitter/Achsen werden nicht
mehr pro Datei entschieden. In `frontend/src/components/Stats` steht **kein
einziger Hex-Wert** — gemessen: null Treffer —, die Diagramme benutzen also
schon Variablen; ihre Umstellung auf `chartColor(i)` ist mechanisch und
passiert dort, wo eine zweite Serie tatsächlich auftaucht.

### Tier-Farben aus Tokens
`AchievementsPage` schrieb drei der fünf als Literal (`#f59e0b`, `#22d3ee`,
`#a855f7`), zwei als App-Variable. Sie **stimmten** zufällig mit `tierColor`
in der Tokendatei überein — Glück, keine Garantie: nichts band sie aneinander,
eine Änderung stromaufwärts hätte drei bewegt und zwei stehen lassen. Jetzt
lesen alle fünf `--ts-tier-*`.

### Die vierzehn h1-Varianten sind eine
Vorher: `text-2xl font-bold mb-2`, `text-3xl font-display font-bold
leading-tight`, eine in Mono, eine mit `dark:text-white` in einer Anwendung,
die nur dunkel ist — vierzehn Ketten, die sich in Größe, Gewicht, Familie und
Farbe unterschieden, ohne dass ein Unterschied etwas bedeutete.

Jetzt: `.t-screen-title`, erzeugt aus `typography.scale.screenTitle`. Was eine
Seitenüberschrift ist, ändert man in `design/tokens.json` und sonst nirgends.
Sechs Überschriften hatten zusätzlich eine Inline-Farbe, die die Utility
überstimmt hätte — die ist weg.

`src/__tests__/screenTitle.test.ts` hält es fest, in drei Fällen: es findet
überhaupt Überschriften (sonst wäre der Scan verrutscht und bestünde still),
jede trägt die Utility, und **keine stylt sich zusätzlich selbst** — eine
Handvoll Layout-Klassen (`mb-2`, `flex`, `gap-3`) ist erlaubt, weil sie sagt,
wo die Überschrift sitzt, nicht wie sie aussieht.

---

## 2. Entschieden, mit Grund

| Entscheidung | Grund |
|---|---|
| **Domänen-Serien gehen NICHT durch `chartPalette`** | Sie lesen `useDomainColors()`, wo der Beta-Override sitzt. Ein Diagramm über die Palette zu färben hieße, die Farbwahl des Nutzers zu ignorieren — der Defekt aus #270, nur in einer neuen Datei. Im Kopf des Moduls ausgeschrieben, damit die nächste Person nicht „vereinheitlicht". |
| **`chartColor(i)` läuft im Kreis, statt auszugehen** | Acht Airlines sind normal, eine neunte muss trotzdem gezeichnet werden. Eine Wiederholung ist ehrlich; die Legende ist es, die sie auseinanderhält, sobald es mehr Serien als unterscheidbare Töne gibt. |
| **Die h1 des Admin-Bereichs wird eine echte Überschrift** | Sie war ein `<h1>` mit `text-sm uppercase tracking-wider` in `muted` — ein Abschnittslabel in der Rolle einer Seitenüberschrift. Sie ist der Titel der Seite und sieht jetzt danach aus. |
| **Layout-Klassen an einer h1 sind erlaubt** | `mb-2` sagt, wo die Überschrift steht; `text-3xl` sagt, wie sie aussieht. Der Test unterscheidet die beiden über eine kurze Positivliste — ohne die wäre er entweder wirkungslos oder er verböte, eine Überschrift überhaupt zu platzieren. |

---

## 3. Neu, und ohne die Änderung rot

`src/__tests__/screenTitle.test.ts`, drei Fälle (siehe oben). Er wäre gegen
den Stand vor diesem Block mit vierzehn Einträgen rot.

---

## 4. Nicht gebaut

- **Der Jahresrückblick `/review/:year`** nach `Jahresrueckblick.dc.html` —
  heroGradient, Newsreader-Satz, vier Domänenkarten, Karte des Jahres,
  Erfolge, Vergleich, Druckansicht. Das ist eine **neue Seite mit eigenen
  Datenabfragen**, kein Umstellen einer bestehenden, und damit der größte
  Einzelposten, der von Block 5 übrig bleibt. Entscheidung 16 (eigene Route,
  aus der Statistik verlinkt) steht; gebaut ist nichts.
- **`StatTile` in der Statistik.** Das Primitiv steht seit Block 2, die
  Kacheln der Statistik nutzen es noch nicht.
- **„Kein Diagramm wird am Fold abgeschnitten."** Nicht gemessen. Es gibt
  einen Test `Overview/__tests__/wideContentContained.test.tsx`, der etwas
  Verwandtes prüft; ob er die Aussage trägt, wurde nicht nachgesehen.
- **Die Umstellung der Diagramme auf `chartColor(i)`** — das Modul steht, die
  Aufrufstellen sind noch `var(--accent)`. Solange jedes Diagramm eine Serie
  hat, ist das nicht falsch, nur unfertig.

---

## 5. Bilder

`ClaudeDesign/screenshots/design-system/block-5/`, je 1440×900 und 390×844:
`statistik`, `erfolge`.

---

## 6. Gates

```
frontend  npx tsc --noEmit    → keine Ausgabe
frontend  npm run lint        → keine Ausgabe
frontend  npx vitest --run    → 430 Dateien, 3708 Tests, alle grün
frontend  npx vite build      → grün
repo      npm run check:size  → 1154 Dateien, 20 in der Baseline, Grenze 800
```

Backend nicht berührt.
