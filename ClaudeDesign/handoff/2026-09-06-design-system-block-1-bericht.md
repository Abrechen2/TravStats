# Block 1 — Fundament. Bericht

Zweig `dev/design-system`, Commit `e64ee51c`, aufgesetzt auf
`forgejo/dev/v2.7` (`5fa30087`). Auftrag:
`ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md` §4, Block 1.

---

## 1. Gebaut

### Der Generator
`frontend/scripts/generate-theme.mjs` liest `design/tokens.json` und schreibt
`frontend/src/theme/tokens.css` — Custom Properties plus einen Tailwind-
`@theme`-Block plus eine Utility-Klasse je Rolle aus `typography.scale`.
Aufruf: `npm run tokens` im Frontend.

Vier Fälle in `src/theme/__tests__/tokens.generated.test.ts` halten ihn:

1. Die eingecheckte Datei ist byteweise das, was der Generator erzeugt. Der
   Build ist in eine `buildThemeCss()`-Funktion getrennt, damit der Test nicht
   das Artefakt neu schreibt, das er prüft — sonst bestünde er jede
   Handänderung.
2. Jede Farbe aus `color` und `domainColor` kommt in der CSS vor.
3. Jede Rolle aus `typography.scale` hat eine `@utility t-…`.
4. **Kein Hex in der CSS, das nicht in der JSON steht.** Das ist der
   Hex-Ratchet aus `DESIGN_SYSTEM.md` §10 in seiner ersten, engsten Form: für
   die generierte Schicht. Der Scan über den restlichen Quelltext ist Block 7.

### Selbst gehostete Schriften
`frontend/scripts/fetch-fonts.mjs` lädt Hanken Grotesk 400–800, IBM Plex Mono
400–600 und Newsreader kursiv 400/500 (latin + latin-ext, 20 Schnitte, 588 kB)
nach `frontend/public/fonts/` und schreibt `src/theme/fonts.css` dazu.
`index.html` verliert die Google-Fonts-Zeile und lädt stattdessen die zwei
Schnitte vor, die der erste Anstrich braucht.

### `AppShell` und `PageHeader`
`components/ui/AppShell.tsx` trägt Navigation und Container in den drei
Breiten (`reading` 720 · `list` 1200 · `full`). `components/ui/PageHeader.tsx`
ist die eine Seitenüberschrift, Titel als `.t-screen-title`.

### Einstellungen als Routen pro Gruppe
`/settings/account` · `/settings/display` · `/settings/data` ·
`/settings/services` plus `/settings/flight` · `/settings/cruise` ·
`/settings/lodging`. Die Zuordnung Sektion → Gruppe steht **einmal** in
`pages/Settings/settingsModel.ts`; `groupOfSection()` wird daraus abgeleitet,
damit keine zweite Liste veralten kann.

`/settings` ist der Alt-Eingang und löst jeden Link von vor 2.7 auf:
`?section=`, `?tab=`, `#hash`, die umbenannten Ids (`apiKeys` →
`externalServices`) und `?section=admin` für Admins. Die Sektion reist als
`?section=` mit auf die Zielroute, wo ein Effekt zu ihr scrollt — ein
Lesezeichen landet also weiter auf der Karte, nicht nur auf der Seite.

---

## 2. Entschieden, mit Grund

| Entscheidung | Grund |
|---|---|
| **Präfix `--ts-…`** für alle generierten Custom Properties, und `--color-ts-…` / `--radius-ts-…` / `--spacing-ts-…` im `@theme` | Die alte Palette besitzt `--color-surface`, `--color-border` und `--color-accent` noch bis Block 7. Zwei Systeme unter einem Namen sind genau die Drift, gegen die diese Datei gebaut ist. Das Präfix fällt weg oder bleibt — das entscheidet Block 7, wenn die alten Namen tot sind. |
| **Scrim aus `canvas` abgeleitet** (`rgba(7,9,12,0.6)`) statt der in `DESIGN_SYSTEM.md` §2.1 notierten `rgba(4,6,8,0.6)` | §2.1 sagt im selben Absatz „nichts anderes darf ein fünftes Grau einführen". `rgba(4,6,8,…)` wäre eines. Der Wert kommt jetzt aus `color.canvas`, also aus einem Token. Abweichung von einem Satz des Dokuments zugunsten der Regel desselben Dokuments. |
| **`domainColor.tour` = `#8faa5f`** | Owner-Entscheidung 7 verlangt eine Farbe, nennt sie aber nicht. `#8faa5f` ist der bisherige Web-Ton für „Zug" — also kein neu erfundener Hex, sondern ein bestehender, zur einen Tourfarbe befördert. Weit genug entfernt von Bernstein, Türkis, Mint und Tinte, dass eine Legende ihn nicht verwechselt. Zuerst in der Companion-Datei (dort Zweig `design/tokens-tour-motion`, Commit `63aa4fe`), dann hierher kopiert. |
| **`motion`-Block in die Companion-Datei**, Version dort auf `0.8.0-tour-motion` | Der Export hatte die Bewegungswerte direkt in die Web-Kopie geschrieben; §4 des Auftrags nennt das den falschen Weg. `app/src/theme/tokens.ts` im Companion wurde mit dessen eigenem Generator nachgezogen. |
| **`features` und `autoupdate` bleiben im Flug-Reiter** | Der Export legt „Funktionen" unter Darstellung und „Automatische Updates" unter Daten. Beide sind flugspezifisch: die zwei Funktionen-Schalter werden vom Flugformular und der Flugkosten-Aufschlüsselung gelesen, Auto-Update läuft ganz in `services/flightAutoUpdate.ts` gegen `PendingFlightUpdate`. Sie wurden am 23.08.2026 mit dieser Begründung dorthin verschoben; der Export-Autor kannte die Notiz nicht. Die Regel „was nur eine Ansicht betrifft, sitzt an der Ansicht" (Rückmeldung §1.8) spricht dafür, nicht dagegen. |
| **`about` liegt in „Daten"** | Der Export kennt den Abschnitt nicht. Von den vier Gruppen ist Daten die, in der die Instanz selbst vorkommt (Sicherung, Import, automatische Updates) — und „Über TravStats" sagt, welche Fassung dieser Instanz läuft. |
| **„Bereichsfarben" wird ein eigener Eintrag** | Steckte bisher unten in `DisplaySection`. Der eine Schalter, der jede Karte und jede Legende umfärbt, saß drei Bildläufe unter der Sprachwahl. Der Export listet ihn getrennt; hier auch. |
| **Beta-Tor an „Geräte" bleibt ein Tor** | Mit ausgeschaltetem Schalter ist der Abschnitt nicht auf `/settings/account` — und erscheint, sobald eine URL ihn nennt. `?section=devices` ist weiterhin der einzige Weg zu einem Kopplungscode. Ent-gaten ist Owner-Sache (§6). |
| **Der Beta-Scan lernt eine dritte Schreibweise** | Das Tor steht jetzt als Daten in `gatedSections: { devices: "devicePairing" }`, die Seite löst es über eine Variable auf. Ein Scan, der nur Aufrufstellen kennt, hätte `devicePairing` am Tag des Umbaus für ungetort erklärt. Der Test kennt die Tabellenform jetzt mit — dieselbe Alterung, die der Datei-Kommentar schon einmal beschreibt. |
| **`src/theme/*.css` in `.prettierignore`** | Beide sind Generatorausgaben. Der Pre-Commit-Hook formatiert alles unter `frontend/src`; ein Prettier-Lauf über `tokens.css` hätte den Generator-Test rot gemacht, statt irgendetwas aufzuräumen. |
| **`--font-display` und `--font-sans` zeigen auf Hanken Grotesk** | Syne und Inter fallen (Entscheidung 6), aber 18 `font-display`-Verwendungen leben noch. Sie auf die richtige Familie zu zeigen statt auf `sans-serif` zurückfallen zu lassen, kostet zwei Zeilen; die Klasse selbst räumt Block 7 ab. |

### Nicht getan, obwohl naheliegend
- **Die Kopfleiste ist noch die alte.** Der Export zeichnet sie neu (56 px,
  Suchpille mit ⌘K, „Mehr"-Menü mit Gruppen, Avatar-Menü). Sie braucht
  `IconButton`, `Chip` und die Menü-Shell — also Block 2. `AppShell` ist
  bereits die Stelle, an der sie eingebaut wird; keine Seite importiert
  `NavigationBar` mehr selbst, sobald sie auf `AppShell` steht.
- **Die Karten sind noch die alten Flächen** (`--bg-surface` `#161b22`, kühl).
  Der Seitengrund ist bereits `--ts-bg` (`#0b0d10`, warm). Der Unterschied
  ist auf den Nachher-Bildern sichtbar und Absicht: Karten sind das
  `Card`-Primitiv aus Block 2.
- **`CruisesPage.tsx` behält den alten Import-Link** (`/settings?section=import`,
  über den Alt-Eingang weiterhin gültig). Die Datei ist nicht
  Prettier-formatiert; eine Einzeiländerung hätte 490 Zeilen Formatierungs-
  rauschen in diesen Commit gezogen. Flug- und Unterkunftsliste haben den
  neuen Link, weil dort keine Formatierung mitkam. Der Rest fällt in Block 3,
  wo die Datei ohnehin angefasst wird.
- **„Datenschutz" und „Mitreisende"** aus dem Export-Index fehlen: Für
  Datenschutz gibt es heute keinen Abschnitt (nur die Zustimmungskarte beim
  ersten Start), Mitreisende ist Block 6. Beides ist im Modell nicht
  vorgesehen und nicht als leerer Eintrag gebaut.
- **Entscheidung 2 (Developer Mode / Training nur Admin)** brauchte keine
  Änderung: In den Nutzer-Einstellungen gibt es heute keinen solchen
  Abschnitt. Der Export zeigt ihn unter Dienste; er entsteht also gar nicht
  erst. Die i18n-Schlüssel `settings:developer` und `settings:training`
  bestehen und werden anderswo gelesen — nicht angefasst.

---

## 3. Offen für spätere Blöcke

- Die fünf Web-Tourfarben (`--domain-train/hike/bike/road/ferry` in
  `index.css`) leben noch. Sie fallen in Block 4, wo Legende und Layer die
  Farben aus den Stores und die Stores aus den Tokens lesen.
- `shared/domains.ts` (Frontend **und** Backend-Spiegel) trägt weiter die
  alten Domänenfarben `cruise #6fa0d6`, `lodging #d4778f`, `poi #5ec2b2` und
  die vier Emoji. Das ist der Farbtausch mit der größten Reichweite; er
  gehört zu Block 3/4, nicht in ein Fundament.
- Die drei anderen Wächter aus §10 (Hex-Scan über den Quelltext,
  Palette-/`dark:`-Scan, Overlay-Scan) sind Block 7.
- Der Hinweis von `check:size`, dass eine Baseline-Datei geschrumpft ist,
  steht seit vor diesem Zweig. Die Baseline wurde nicht angefasst — sie darf
  nur schrumpfen, und das Nachziehen ist eine eigene Entscheidung.

---

## 4. Bilder

`ClaudeDesign/screenshots/design-system/block-1/`, je 1440×900 und 390×844,
Vollseite, deviceScaleFactor 2, DE:

| Datei | Was |
|---|---|
| `settings-vorher-*` | Einstellungen vor diesem Commit (Basis `5fa30087`), gebaut und aufgenommen aus demselben Stack |
| `settings-nachher-konto-*` | `/settings/account` |
| `settings-nachher-darstellung-*` | `/settings/display` |
| `settings-nachher-daten-*` | `/settings/data` |
| `settings-nachher-dienste-*` | `/settings/services` |
| `settings-nachher-flug-*` | `/settings/flight` |

Aufgenommen gegen einen Produktions-Build (`vite build` + `vite preview` auf
3001) und ein Backend auf 8001 gegen die lokale Dev-Datenbank mit dem
Demo-Konto (`admin`, `seed:dev-admin`). Das Werkzeug dafür ist committed:
`scripts/design-screenshots.mjs`, aufgerufen als
`node scripts/design-screenshots.mjs <block> <name>=<pfad> …`. Bei 390 px
gibt es keinen waagerechten Bildlauf; Reiterleiste und Gruppenindex laufen
beide als scrollbare Zeilen.

---

## 5. Gates

Alle gegen `e64ee51c`, Frontend:

```
npx tsc --noEmit          → keine Ausgabe
npm run lint              → eslint . --max-warnings 0, keine Ausgabe
npx vitest --run          → 427 Dateien, 3664 Tests, alle grün
npm run check:size        → 1138 Dateien geprüft, 20 in der Baseline, Grenze 800
npx prettier --check …    → alle geänderten frontend/src-Dateien sauber
npx vite build            → grün (auch als Beleg, dass @utility und @theme tragen)
```

Backend nicht berührt, deshalb keine Backend-Gates. `check:drift` ebenfalls
nicht — kein Schema angefasst.

Neu und ohne die Änderung rot:
`src/theme/__tests__/tokens.generated.test.ts` (4 Fälle) und
`src/__tests__/pages/SettingsPage.routes.test.tsx` (9 Fälle; die
Routen-Fälle scheitern gegen die alte Seite schon daran, dass es
`/settings/:group` nicht gab).

---

## 6. Was der PC wissen muss

Die Companion-Tokendatei wurde geändert. Sie liegt in
`/home/claude/projekte/TravStatsCompanion` auf dem Zweig
**`design/tokens-tour-motion`** (Commit `63aa4fe`, **nicht gepusht**, nicht
nach `main` gemergt) und enthält `domainColor.tour`, den `motion`-Block und
das nachgezogene `app/src/theme/tokens.ts`. `design/tokens.json` in diesem
Repo ist die Kopie davon — bis auf die `_source`-Zeile byteidentisch. Wer den
Companion-Zweig verwirft, muss auch diese Kopie zurückdrehen, sonst behauptet
der Web-Spiegel eine Fassung, die stromaufwärts nicht existiert.
