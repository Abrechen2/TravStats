# Block 3 — Logbuch-Familie. Bericht

Zweig `dev/design-system`, aufgesetzt auf Block 2. Auftrag:
`ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md` §4, Block 3.

**Dieser Block ist teilweise geliefert.** Was fehlt, steht in §4 mit Grund —
kein „später", sondern eine benannte Grenze mit einem Ratchet, der sie misst.

---

## 1. Gebaut

### Der Domänen-Farbwechsel — die Änderung mit der größten Reichweite
`frontend/src/shared/domains.ts` und der Backend-Spiegel tragen die
Companion-Werte: Kreuzfahrt `#4aa6b0` statt `#6fa0d6`, Unterkunft `#5ec2b2`
statt `#d4778f`, Orte `#e7e3dc` statt `#5ec2b2`. Zwei Farbtöne sind also
umgezogen, und einer hat den Bereich gewechselt.

Die Verrohrung war schon richtig: `DOMAINS[key].color` ist seit #270 der
**Default**, auf dem der Nutzer-Override sitzt (`hooks/useDomainColors.ts`),
und alles außerhalb der Karte liest dort. Entscheidung 4 („so wie jetzt: der
Beta-Override bleibt, die Token-Defaults sind die Companion-Farben") war damit
eine Wertänderung an einer Stelle, keine Umbauarbeit.

`index.css` trägt zusätzlich keine eigenen Hex-Werte mehr: `--domain-flight`
und Geschwister lesen `--ts-domain-*`. Vorher waren es zwei Kopien einer
Entscheidung — und zwei Kopien einer Entscheidung sind eine Entscheidung, die
driftet; genau das war hier passiert.

**Touren haben eine Farbe** (Entscheidung 7). `--domain-tour` liest
`--ts-domain-tour`; die fünf alten Namen (`train`, `hike`, `bike`, `road`,
`ferry`) bleiben als **Aliase darauf** stehen, damit Block 4 die Layer einzeln
umziehen kann, ohne dass eine Tourroute in der Zwischenzeit in nichts
gezeichnet wird.

### Ein Status ist überall dieselbe Pille
`components/table/statusPillStyle.ts` gibt jetzt die Rezeptur aus:
Farbe als Text, 12 % Fläche, 45 % Rand, 11/700 versal, nie mono, gestrichelt
bei „vorläufig". Die vier Aufrufstellen (Flugtabelle, Aufenthalts-Pille,
Kreuzfahrt-Stil, Orteliste) ändern sich dadurch **ohne eigene Änderung** —
und die Zuordnung Status → Token steht nur einmal, in
`components/ui/tokens.ts` neben dem `StatusPill`-Primitiv, damit eine Liste
und ein Primitiv nicht verschieden antworten können.

### Die vier Listen auf der Shell
`FlightsTablePage`, `CruisesPage`, `LodgingListPage`, `PlacesListPage` bauen
ihre Shell nicht mehr selbst: kein `NavigationBar`-Import, kein eigenes
`max-w-*`, kein eigener `min-h-screen`-Rahmen. Alle vier sagen
`<AppShell width="list">`, alle vier tragen ihre Überschrift als
`.t-screen-title`.

---

## 2. Entschieden, mit Grund

| Entscheidung | Grund |
|---|---|
| **`in_progress` verliert sein eigenes Lila** | Die alte Palette gab „läuft gerade" ein eigenes `#a371f7`, damit eine laufende Kreuzfahrt weder Vergangenheit noch Zukunft las. `DESIGN_SYSTEM.md` §2.6 sagt ausdrücklich das Gegenteil: das Web bildet `in_progress` und `completed` auf die Geflogen-Farbe ab, wie es der `StatusPill` des Companions tut — und selbst dort ist `live` derselbe Wert wie `good`. Das Laufende sagt ab jetzt die **Beschriftung**, nicht der Farbton; das Farbvokabular bleibt klein. Bewusst gegen eine frühere, gut begründete lokale Entscheidung — deshalb hier notiert und im Test ausgeschrieben. |
| **`historical` wird Grau statt Bernstein** | Bernstein ist im gemeinsamen Vokabular `warn`, also „hier ist eine Entscheidung fällig". Ein Flug, der nur ohne genaue Zeiten erfasst wurde, ist nichts zu entscheiden. Der Token-Wert ist `rgba(231,227,220,0.62)`. |
| **Zwei Tests hielten ihre Aussage an einem Hex fest** | `lodgingColor.test.ts` behauptete „abgeleitet aus `DOMAINS.lodging.color`, kein zweites Literal" — und schrieb daneben `#d4778f` als Literal. Dasselbe in `AllTab.lodging.test.tsx`. Beide leiten den Erwartungswert jetzt aus der Registry ab; die Aussage bleibt, das Literal fällt. Es ist genau der Fall, für den sie gebaut wurden, nur andersherum aufgetreten. |
| **Die fünf Tourfarben werden Aliase, nicht gelöscht** | Ein gelöschtes Custom Property rendert als **nichts**, nicht als Fehler. Zwischen diesem Block und Block 4 hätte eine Tourroute damit unsichtbar gezeichnet. |
| **`ListFilterBar` sitzt jetzt im Container statt über ihm** | Vorher lag sie zwischen Navigation und Inhaltsbreite und lief über die volle Fensterbreite. In der Shell liegt sie im `list`-Container und ist damit auf die Spalten ausgerichtet, die sie filtert. |

---

## 3. Neu, und ohne die Änderung rot

- `src/__tests__/appShell.ratchet.test.ts` — **der Shell-Ratchet.** Eine Seite
  importiert `NavigationBar` nicht selbst. Neunzehn Seiten tun es noch; sie
  stehen als eingefrorene Liste darin. Der Test scheitert an einem **neuen**
  Eintrag ebenso wie an einem **veralteten**, kann also nur schrumpfen — die
  Bauform der Datei-Größen- und OpenAPI-Ratchets, aus demselben Grund. Dazu
  ein Fall, der die vier Logbuchlisten und die Einstellungen namentlich auf
  der Shell festhält.
- `src/__tests__/domainCssVars.test.ts` — erweitert: kein `--domain-*` in
  `index.css` trägt noch einen Hex; jede Domäne zeigt auf ihr Token; Touren
  haben eine Farbe mit fünf Aliasen; und die Registry stimmt mit der
  generierten Tokendatei überein.
- `components/table/__tests__/statusPillStyle.test.ts` und
  `Cruise/cruiseStatusStyle.test.ts` — umgeschrieben auf die Aussage statt auf
  vier Literale: jede Farbe kommt aus der Tokenschicht, die Rezeptur ist
  12 %/45 %, „vorläufig" ist gestrichelt, und Kreuzfahrten delegieren, statt
  eine vierte Privatpalette zu führen.

---

## 4. Nicht geliefert, und warum

**Die Zeilen selbst sitzen noch nicht auf `Table`/`TableRow`.** Das Primitiv
steht und ist getestet (Block 2), aber die vier Listen zeichnen ihre Zeilen
weiter mit ihrem eigenen `<table>` samt Spaltenwähler, Sortierung, Zellenset
und `useColumnPrefs`/`useSortPrefs`. Die Umstellung ist kein Austausch eines
Wrappers, sondern eine Neuverdrahtung dieser Maschinerie — allein
`FlightsTablePage` ist 921 Zeilen davon. Ehrlicher Stand: **eine Zeile sieht
in allen vier Listen gleich aus, soweit Pille, Farbe, Breite und Überschrift
sie ausmachen; die Zellengeometrie ist noch die alte.**

**Die sechs Detailseiten** (Flug, Kreuzfahrt, Unterkunft, Ort, Kette,
Flugzeug) bauen ihre Shell noch selbst und stehen im Ratchet.

**Flaggen.** Der Auftrag nennt „Flaggen aus `/api/v1/country-flags/:cc`
(18×13, Radius 2)". **Diesen Endpunkt gibt es nicht** — gemessen: null Treffer
im Backend. Flaggen kommen aus `flagcdn.com` (`lib/countryFlag.tsx`), tragen
bereits Radius 2 und ein 4:3-Seitenverhältnis. Einen Backend-Endpunkt zu
erfinden wäre eine Produktänderung, die der Auftrag nicht verlangt; die
Größenangabe 18×13 ist 1,385:1 und passt zu keinem der beiden. Unverändert
gelassen und hier als Frage hinterlegt.

**Die Domänen-Emoji** (`✈ 🚢 🏨 📍` in beiden `shared/domains.ts`) stehen
noch. `DESIGN_SYSTEM.md` §7 verlangt Lucide-Namen an ihrer Stelle; das ändert
den Typ eines Feldes, das 24 Stellen als Text rendern, und braucht ein
Icon-Set, das die App noch nicht hat. Gehört zu Block 7.

---

## 5. Bilder

`ClaudeDesign/screenshots/design-system/block-3/`, je 1440×900 und 390×844:
`logbuch-fluege`, `logbuch-kreuzfahrten`, `logbuch-unterkuenfte`,
`logbuch-orte`. Aufgenommen gegen den Produktions-Build.

---

## 6. Gates

```
frontend  npx tsc --noEmit    → keine Ausgabe
frontend  npm run lint        → keine Ausgabe
frontend  npx vitest --run    → 429 Dateien, 3702 Tests, alle grün
backend   npx tsc --noEmit    → keine Ausgabe
backend   npm run lint        → keine Ausgabe
repo      npm run check:size  → 1151 Dateien, 20 in der Baseline, Grenze 800
          prettier --check    → alle geänderten frontend/src-Dateien sauber
```

Backend-Jest nicht gelaufen: die geteilte Dev-Datenbank läuft, aber der
einzige Backend-Eingriff ist ein Farbwert in `shared/domains.ts`, den kein
Test liest. `check:drift` ebenfalls nicht — kein Schema angefasst.
