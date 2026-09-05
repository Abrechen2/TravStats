# Block 4 — Dashboard und Karten. Bericht (angefangen)

Zweig `dev/design-system`, aufgesetzt auf Block 3. Auftrag:
`ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md` §4, Block 4.

**Dieser Block ist angefangen, nicht fertig.** Geliefert ist der Teil, der ohne
eine offene Entscheidung auskommt; der Rest steht in §3 mit dem, was er
braucht.

---

## 1. Gebaut

### Touren haben eine Farbe — jetzt auch auf der Karte
`components/layers/tourPathsLayer.ts` führte fünf Farben, eine je
Verkehrsmittel (`road`, `ferry`, `rail`, `foot`, `bike`), plus ein neutrales
Grau für einen unbekannten Modus. Die Begründung stand im Kopf der Datei: „eine
Farbe ist eine Behauptung darüber, wie eine Etappe zurückgelegt wurde", und
ein unbekannter Modus dürfe nicht das Grün der Straße borgen, weil das einen
Van über den Skagerrak fahren ließe.

Der Owner hat es am 05.09. anders entschieden (Nr. 7): Touren sind **eine**
Domäne mit **einer** Farbe, das Verkehrsmittel unterscheidet nur das Icon. Die
fünf fallen, und mit ihnen das Problem, das das Grau löste — ein Farbton, der
nichts über den Modus sagt, kann darüber auch nichts Falsches behaupten. Die
Unterscheidung `isPlaceholder` bleibt: eine `straight`-Etappe ist ein Ersatz
für eine Messung, nicht eine Aussage über das Fahrzeug.

`TOUR_RGB` leitet sich aus `TOUR_COLOR` ab, und `TOUR_COLOR` steht seit diesem
Block in **beiden** `shared/domains.ts` — bewusst **kein** Mitglied von
`DOMAINS`: eine Tour hat keinen `enabledDomains`-Eintrag, kein eigenes
Routenpräfix und kein Parser-Ziel. Sie ist eine Farbe, die Karte und Legende
beide brauchen, und das ist die eine Stelle, an der sie steht.

Die Tour-Legende (`Dashboard/tabs/tourMapOverlay.tsx`) zeigt weiter eine Zeile
je Modus, alle in derselben Farbe. Sie hat damit eine andere Aufgabe als
vorher: sie entschlüsselt keine Farbe mehr, sondern zählt auf, welche
Verkehrsmittel auf dieser Karte vorkommen — das Icon unterscheidet sie.

### Ein Wächter mehr
`domainCssVars.test.ts` bindet jetzt auch `TOUR_COLOR` an `--ts-domain-tour`
in der generierten Tokendatei, so wie die vier Domänenfarben.

---

## 2. Entschieden, mit Grund

| Entscheidung | Grund |
|---|---|
| **`TOUR_COLOR` steht neben `DOMAINS`, nicht darin** | `DOMAIN_KEYS` ist die Gating-Liste: jeder Eintrag hat einen Schalter in den Einstellungen, ein Routenpräfix und einen Platz in `AVAILABLE_DOMAINS`, über das geteilte Codepfade iterieren. Eine Tour hat nichts davon. Sie als fünfte Domäne einzutragen hieße, das Domänen-Gating für eine Farbe umzubauen. |
| **Der neutrale Grauton für einen unbekannten Modus fällt** | Er existierte, um eine falsche Behauptung zu verhindern. Mit einer Farbe für alle Touren gibt es die Behauptung nicht mehr. Im Test ausgeschrieben, damit die alte Absicht nicht als Regression gelesen wird. |

---

## 3. Nicht gebaut, und was es braucht

### Die Kartenfarben der Karte selbst
Der Dashboard-Screenshot zeigt es: Kreuzfahrtrouten sind weiter **blau**, nicht
im neuen Türkis `#4aa6b0`. Das ist **kein vergessener Wert**, sondern der
Kartenfarbmodus, den `DESIGN_SYSTEM.md` §9 ausdrücklich behält:
`lib/cruiseColor.ts` steht im Modus `status` und färbt gefahrene Etappen blau,
geplante zyan — nach Status, nicht nach Domäne.

Die Regel des Systems dazu lautet: die Modi bleiben, **die Paletten, aus denen
sie wählen, werden Token-Paletten**. Konkret heißt das drei Dinge, und alle
drei sind Entscheidungen, keine Umbenennungen:

1. Der `status`-Modus müsste `statusColor.flown` und `statusColor.scheduled`
   lesen statt `#4a90d9`/`#22d3ee`. Das ändert die Kartenfarbe für jeden
   Nutzer, der die Voreinstellung nie angefasst hat.
2. `tokens.json → map` sagt `plannedStroke: "dashed info"` und
   `flownStroke: "accent"` — das ist eine **dritte** Aussage neben den beiden
   Modi und muss mit ihnen in Deckung gebracht werden.
3. `CRUISE_COLOR_PRESETS` bietet sechs freie Hexes an; `listColor.palette`
   ist die zehnfarbige Token-Liste mit `freeHex: false`, die sie ersetzen
   soll (Block 7).

Das ist der Kern von Block 4 und gehört in einem Zug gemacht, mit einem Blick
in den Browser danach.

### Der Rest von Block 4
- **Die Kopfleiste** ist weiter die alte (56 px, Suchpille, „Mehr"-Menü,
  Avatar-Menü aus dem Export fehlen). Die Primitive dafür stehen seit Block 2.
- **`DashboardLayout` bleibt außerhalb von `AppShell`.** Es ist ein
  `height: 100vh`-Flexlayout mit `overflow: hidden`, in dem die Karte den Rest
  füllt; `AppShell` bringt `min-h-screen`, Polsterung und eine Höchstbreite mit.
  Die Karte darunter zu zwingen wäre kein mechanischer Umbau, sondern die
  Frage, ob `AppShell` eine dritte Bauform braucht (`full`, randlos, nicht
  scrollend). Steht im Shell-Ratchet und ist dort sichtbar.
- **Globus nach `Globus.dc.html`** (vierzehn Festlegungen → Tokens unter
  `tokens.json → map`) und das mobile Bottom-Sheet „Karte" mit Reitern: nicht
  angefasst.
- **Kein waagerechter Bildlauf bei 390 px**: die Screenshots zeigen die
  Dashboard-Seite bei 390 px; die Kopfleiste ist die alte, also gilt der
  Befund des Exports hier noch nicht.

---

## 4. Bilder

`ClaudeDesign/screenshots/design-system/block-4/`, je 1440×900 und 390×844:
`dashboard-alle`, `dashboard-kreuzfahrten`. Sie sind vor allem **Beleg für
§3**: die Legende rechts unten nennt „Kreuzfahrten (gefahren)" in Blau,
während die Logbuchliste dieselbe Domäne türkis führt. Genau diese Differenz
schließt der Rest des Blocks.

---

## 5. Gates

```
frontend  npx tsc --noEmit    → keine Ausgabe
frontend  npm run lint        → keine Ausgabe
frontend  npx vitest --run    → 429 Dateien, 3703 Tests, alle grün
backend   npx tsc --noEmit    → keine Ausgabe
backend   npm run lint        → keine Ausgabe
repo      npm run check:size  → 1151 Dateien, 20 in der Baseline, Grenze 800
          npx vite build      → grün
```
