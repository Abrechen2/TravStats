# Block 4 — Dashboard und Karten. Bericht

Zweig `dev/design-system`, aufgesetzt auf Block 3. Auftrag:
`ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md` §4, Block 4.

**Der Kern ist geliefert: Legende und Routen stimmen mit den Domänenfarben der
App überein.** Was offen bleibt, steht in §4.

---

## 1. Gebaut

### Der Generator hat jetzt zwei Ausgaben
`scripts/generate-theme.mjs` schreibt neben `src/theme/tokens.css` auch
**`src/theme/tokens.ts`**. Grund: deck.gl und der Globus malen in eine
Leinwand, nehmen `[r, g, b]`-Arrays und können kein Custom Property lesen.
Ohne dieses Modul behalten die Kartenlayer ihre eigenen Literale — und genau so
ist die Karte dazu gekommen, der Legende zu widersprechen, unter der sie sitzt.
Der Companion erzeugt `app/src/theme/tokens.ts` aus derselben Datei aus
demselben Grund. Der Generator-Test deckt beide Ausgaben ab.

`scripts/generate-theme.d.mts` typisiert den Generator, damit der Test ihn ohne
`@ts-expect-error` importiert. Das Skript selbst bleibt ein reines
Build-Skript ohne Übersetzungsschritt.

### Touren haben eine Farbe — auch auf der Karte
`components/layers/tourPathsLayer.ts` führte fünf Farben, eine je
Verkehrsmittel, plus ein neutrales Grau für einen unbekannten Modus. Die
Begründung stand im Kopf der Datei: „eine Farbe ist eine Behauptung darüber,
wie eine Etappe zurückgelegt wurde", und ein unbekannter Modus dürfe nicht das
Grün der Straße borgen. Owner-Entscheidung 7 sagt das Gegenteil: eine Domäne,
eine Farbe, das Verkehrsmittel unterscheidet das Icon. Mit den fünf fällt auch
das Problem, das das Grau löste — ein Ton, der nichts über den Modus sagt, kann
darüber nichts Falsches behaupten. `isPlaceholder` bleibt: eine unrouted
`straight`-Etappe ist eine Aussage über die **Daten**, nicht über das Fahrzeug.

`TOUR_COLOR` steht in beiden `shared/domains.ts` und bewusst **nicht** in
`DOMAINS`: `DOMAIN_KEYS` ist die Gating-Liste, jeder Eintrag dort hat einen
Schalter, ein Routenpräfix und einen Platz in `AVAILABLE_DOMAINS`. Eine Tour
hat nichts davon.

### Die Kartenfarben lesen Tokens — nach der Regel der Statuspille
`lib/statusColors.ts` hält jetzt alle vier Status-Voreinstellungen der Karte,
und sie folgen dem Satz, den das System für die Pille schon ausspricht:
**der Status verdrängt die Domäne, außer der Eintrag ist geflogen.**

| Zustand | vorher | jetzt | warum |
|---|---|---|---|
| Flug geflogen | `#f0a947` | `domainColor.flight` (derselbe Wert) | Die Reise ist passiert; was zählt, ist die Domäne. `tokens.json → map` schreibt genau deshalb `flownStroke: "accent"` — die Flugdomäne **ist** der Akzent. |
| Flug geplant | Koralle `#fb7185` | `info` | Koralle bedeutete nichts außer „nicht die andere". `info` ist, was der Rest des Systems für „geplant, wartend, offline" sagt. |
| Kreuzfahrt gefahren | `#4a90d9` | `domainColor.cruise` | Ein zweites Blau, das anderswo `info` heißt. Jetzt das Türkis der Domäne — **das ist der Unterschied, den man auf dem Screenshot sieht.** |
| Kreuzfahrt geplant | Zyan `#22d3ee` | `info` | Zyan ist die Platin-Tier-Farbe. |

**Der Handel, offen gesagt:** ein geplanter Flug und eine geplante Kreuzfahrt
sind jetzt dasselbe Blau, wo sie Koralle und Zyan waren. Im Reiter „Alle"
unterscheidet man sie nicht mehr am Farbton, nur an der Linienform, der
Legende und dem Tooltip. Das ist der Preis dafür, „geplant" mit einer Farbe zu
sagen — und derselbe Handel, den die Statuspille in jeder Zeile macht. Es sind
**Voreinstellungen**; die Farbschlitze bleiben einstellbar.

### Sechs Farbpaletten werden eine
`lib/listPalette.ts` ist `listColor.palette` — die zehn benannten Token-Farben,
in Hex für ein Feld im DOM und als `[r, g, b]` für einen deck.gl-Layer. Die
sechs handgebauten Listen (Flug, Kreuzfahrt, Unterkunft, Ort, zweimal
Ortslisten) zeigen darauf; jede Domänen-Palette wird von ihrer eigenen
Domänenfarbe angeführt, weil ein Wähler, dessen aktueller Wert in seiner
eigenen Musterreihe fehlt, kaputt aussieht.

Die sechs boten zwischen sich viermal dasselbe Slate-200 an und, schlimmer,
mehrere Töne, die das System reserviert: das `info`-Blau, das `good`-Mint, das
Kreuzfahrt-Türkis. Eine Karte liest Farbe als **Bedeutung** — wer seine Liste
in genau dem Blau anmalt, das „geplant" heißt, bricht sich die Legende. Ein
Test hält das jetzt fest.

---

## 2. Entschieden, mit Grund

| Entscheidung | Grund |
|---|---|
| **„Status verdrängt die Domäne, außer geflogen"** als Kartenregel | `tokens.json → map` sagt `flownStroke: "accent"` und `plannedStroke: "dashed info"`; die Domänen-Charta sagt „Farbe gehört der Domäne". Beides gilt gleichzeitig, wenn man denselben Satz anwendet, den §2.6 für die Pille schon schreibt. Für Flüge fallen beide Lesarten zusammen, weil die Flugdomäne der Akzent ist — vermutlich der Grund, warum das Token so heißt. |
| **Der Strich ist nicht gestrichelt** | `map.plannedStroke` verlangt `dashed`. deck.gls `PathLayer` und `ArcLayer` können das nicht ohne `PathStyleExtension`, die auf Bögen gar nicht anwendbar ist. Geplante Routen sind einfarbig `info`; die Farbe trägt die Bedeutung, der Strich ist als `PLANNED_STROKE_IS_DASHED = false` im Quelltext benannt statt stillschweigend weggelassen. |
| **Kein freier Hex entfernt** | `listColor` sagt `freeHex: false` — der Nutzer wählt einen **Namen**. Die Wähler bieten weiter ein freies Farbfeld neben den Mustern. Das zu entfernen sind fünf Bedienfelder und gehört zum Aufräumen in Block 7; die Werte sind jetzt richtig, die Eingabeform noch nicht. |
| **Vier Tests hielten ihre Aussage an einem Literal fest** | „Voreinstellung ist Orange + Koralle", „Sky-Blue bleibt als Preset verfügbar", zweimal ein Musterklick auf `rgb(126,200,122)`. Die ersten beiden waren Aussagen über einen Wert, der sich geändert hat; die letzten beiden wollten in Wahrheit prüfen, **welchen Schlitz** ein Klick beschreibt, nicht welchen Farbton. Alle vier leiten den Erwartungswert jetzt aus dem Token ab oder greifen einen Ton aus der geteilten Palette. |

---

## 3. Neu, und ohne die Änderung rot

- `tokens.generated.test.ts` deckt jetzt **beide** Generatorausgaben ab.
- `flightColor.test.ts`: die Palette wird von der Domänenfarbe angeführt und
  ist sonst die geteilte; **und sie enthält keinen Ton, den das System für eine
  Bedeutung reserviert** (`bad`, `info`, `good`).
- `cruiseColor.test.ts`, `buildGlobeLayers.color.test.ts`: die
  Voreinstellungen sind die Tokens, aus ihnen abgeleitet statt danebengeschrieben.

---

## 4. Nicht gebaut

- **Die Kopfleiste ist weiter die alte** (56 px, Suchpille mit ⌘K,
  „Mehr"-Menü mit Gruppen, Avatar-Menü). Die Primitive dafür stehen seit
  Block 2; der Umbau berührt jede Seite.
- **`DashboardLayout` steht außerhalb von `AppShell`** und im Shell-Ratchet.
  Es ist ein `height: 100vh`-Flexlayout mit `overflow: hidden`, in dem die
  Karte den Rest füllt; `AppShell` bringt `min-h-screen`, Polsterung und eine
  Höchstbreite mit. Die Karte darunter zu zwingen ist kein mechanischer Umbau,
  sondern die Frage, ob das Primitiv eine dritte Bauform braucht — randlos und
  nicht scrollend.
- **Globus nach `Globus.dc.html`** (vierzehn Festlegungen → Tokens unter
  `tokens.json → map`) und das **mobile Bottom-Sheet „Karte"** mit Reitern:
  nicht angefasst.
- **Sichtbarkeit im Reiter „Alle"** (Entscheidung 14) ist bereits so gebaut —
  das Bereiche-Panel schaltet Domänen, es wählt keinen Modus. Nichts zu tun.

---

## 5. Bilder

`ClaudeDesign/screenshots/design-system/block-4/`, je 1440×900 und 390×844:
`dashboard-alle`, `dashboard-kreuzfahrten`. Auf `dashboard-alle` sind die
Seerouten türkis und die Legende nennt „Kreuzfahrten (gefahren)" in demselben
Türkis, das die Logbuchliste führt — das ist das Abnahmekriterium des Blocks.
Die beiden „geplant"-Zeilen der Legende tragen jetzt dasselbe Blau; siehe den
Handel in §1.

---

## 6. Gates

```
frontend  npx tsc --noEmit    → keine Ausgabe
frontend  npm run lint        → keine Ausgabe
frontend  npx vitest --run    → 429 Dateien, 3705 Tests, alle grün
frontend  npx vite build      → grün
backend   npx tsc --noEmit    → keine Ausgabe
backend   npm run lint        → keine Ausgabe
repo      npm run check:size  → 1153 Dateien, 20 in der Baseline, Grenze 800
          prettier --check    → alle geänderten frontend/src-Dateien sauber
```

`src/theme/tokens.ts` steht wie `tokens.css` in `.prettierignore` — beides sind
Generatorausgaben, und ein Prettier-Lauf darüber macht den Generator-Test rot.
