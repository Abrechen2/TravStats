# Übergabe an Claude Design — TravStats Web auf das Companion-System

Stand 05.09.2026. Auftrag des Owners: „Es muss alles vereinheitlicht werden wie
im Companion App." Diese Datei ist die Arbeitsgrundlage für die Design-Sitzung;
das System selbst steht in `design/DESIGN_SYSTEM.md`, die Tokens in
`design/tokens.json` (Spiegel von `TravStatsCompanion/ClaudeDesign/handoff/
tokens.json` v0.7.0), die Screens unter `ClaudeDesign/screenshots/`.

Gleiche Konvention wie im Companion-Repo: `direction.md` und `system.md` dort
gelten hier mit; bei Widerspruch gewinnt das jüngere Dokument, und für Farben,
Typografie, Radien und Maße gewinnt immer `tokens.json`.

## 1. Was Claude Design bekommen soll

Das Web ist die ältere, größere Oberfläche: 33 Routen, 30 Seitenkomponenten,
etwa 600 Komponenten. Es ist dunkel, es trägt denselben Bernstein-Akzent, und es
ist trotzdem ein anderes Produkt als die App: kühles GitHub-Grau statt warmem
Schwarz, Inter statt Hanken Grotesk, zehn Radien statt sieben, sechs
Farbpaletten für Listen, keine Diagrammpalette, 24 selbstgebaute Dialoge neben
einem gemeinsamen. Gemessen am 05.09.:

| Merkmal | Companion | Web heute |
|---|---|---|
| Übereinstimmende Token | — | **5 von ~60**: Akzent, Flug-Farbe, Bronze, Platin, Diamant |
| Grundfläche | `#0b0d10` warm | `#0d1117` (GitHub-Dark) |
| Text | `#e7e3dc` warm | `#e6edf3` kühl |
| UI-Schrift | Hanken Grotesk 400–800 | Inter 400–600 + Syne als Display |
| Serif | Newsreader kursiv | keine |
| Kreuzfahrt-Farbe | `#4aa6b0` | `#6fa0d6` (das Companion-Blau ist dort `info`) |
| Unterkunft-Farbe | `#5ec2b2` | `#d4778f` (Companion-`#5ec2b2` ist im Web die POI-Farbe) |
| Orte-Farbe | `#e7e3dc` Tinte | `#5ec2b2` |
| Status-Pille | Recipe: 12 % Fläche, 45 % Rand, 11/700 Versalien, nie mono | 15 % Fläche, kein Rand, keine Versalien |
| Radien | 7 benannte (999 · 12 · 14 · 16 · 18 · 26 · 16) | 10 Tailwind-Varianten, 1133 Verwendungen (`rounded-lg` 446, `rounded-md` 213, `rounded-sm` 168 …) |
| Diagrammpalette | 8 Farben + `chartMutedBar` | keine — jede Serie ist `accent` oder `success` |
| Listenfarben | 10 benannte, kein freier Hex | 6 Paletten, freier Hex-Picker, darunter genau die Farben, die der Companion ausschließt |
| Dialog | eine Shell (Sheet) | `Modal.tsx` in 5 Dateien, 24 eigene `fixed inset-0`-Overlays |
| Buttons | 2 Varianten | 597 `<button>`, davon 464 ohne die Button-Utilities |
| Domänen-Icons | Lucide, keine Emoji | `✈ 🚢 🏨 📍` |
| Nicht definierte CSS-Variablen | — | 13 Variablen, 55 Referenzen (rendern still als nichts) |
| Tote `dark:`-Klassen | — | 93 in 15 Dateien (dark-only, `class="dark"` fest) |

Vollständige Messung: siehe Anhang A.

## 2. Zielbild, in einem Satz

Der Web-Nutzer und der App-Nutzer sehen dieselbe Farbe für dieselbe Domäne,
dieselbe Pille für denselben Status, dieselbe Schrift für dieselbe Rolle — und
merken erst an der Breite, auf welchem Gerät sie sind.

## 3. Was das Web bewusst anders macht (schon entschieden)

Diese Punkte sind im Designsystem festgelegt und stehen nicht zur Debatte, nur
zur Gestaltung:

1. **Drei Breiten statt 480dp**: `reading` 720 · `list` 1200 · `full`. Eine
   Flugtabelle braucht die Breite; ein Formular nicht.
2. **Zentrierte Dialoge statt Bottom-Sheets** — dieselbe Shell (surface2,
   Radius 26, Scrim, eine Aktion), unter 640px dockt der Dialog unten an und
   IST das Sheet.
3. **Tabellen** als Primitive. Zeilen 64px, Zellen mit denselben Pillen, mono
   Codes, tabellarischen Ziffern.
4. **Top-Navigation** statt Quickbar. Der Posteingang steht immer im Menü
   (Owner-Regel 05.09.).
5. **Hover, Fokus, Tastatur** sind Systemzustände: `accentHover`,
   `accentPressed`, `focusRing`, `:focus-visible` — kein Schatten bei Hover.
6. **Kartenfarbmodi** (Flug-/Kreuzfahrt-Färbung) bleiben; sie wählen die
   Regel, die Paletten sind die Token-Paletten.

## 4. Was gestaltet werden muss — die Blöcke, in dieser Reihenfolge

Jeder Block endet mit einem prüfbaren Ergebnis. Bitte in dieser Reihenfolge,
weil jeder spätere Block die Primitive des früheren braucht.

### Block 1 — Fundament (Token → CSS, Schriften, Shell)
- Generator `design/tokens.json` → `frontend/src/theme/tokens.css`
  (Custom Properties + Tailwind `@theme`), Schrift-Einbindung Hanken Grotesk /
  IBM Plex Mono / Newsreader, Typo-Utilities `.t-hero` … `.t-meta-mono`.
- `AppShell` (Navigation + Container) — heute importiert jede der 35 Seiten
  `NavigationBar` selbst und wählt ihr eigenes `max-w-*`.
- Ergebnis: eine Seite (Einstellungen) vollständig auf dem neuen Fundament,
  Screenshot vorher/nachher.

### Block 2 — Primitive (`components/ui/`)
Button · IconButton · Card/Tile/HeroCard · Pill/StatusPill · Chip ·
SectionLabel · StatTile · Dialog · Input/Select/Switch · EmptyState (4 Arten) ·
PageHeader · Table/ListRow. Jedes Primitiv liest nur Tokens.
- Ergebnis: Storybook-artige Übersichtsseite unter `/design` (nur dev),
  die jedes Primitiv in jedem Zustand zeigt — das ist die Abnahmefläche.

### Block 3 — Logbuch-Familie (Flüge, Kreuzfahrten, Unterkünfte, Orte)
Die vier Listen (Screens 08, 10, 12, 13) und die Detailseiten (09, 11,
Unterkunft-Detail, Ort-Detail). Hier sitzt die Status-Pille, der
Domänen-Farbwechsel, die Tabelle.
- Ergebnis: eine Zeile sieht in allen vier Listen gleich aus; ein Status ist
  überall dieselbe Pille.

### Block 4 — Dashboard und Karten (Screens 01–07, 25)
Tab-Leiste, Sichtbar-Panel, Legende, Aktivitäts-Seitenleiste, Globus-Karte.
Legende und Layer lesen Farben aus den Stores, die Stores aus den Tokens.
- Ergebnis: Legende und Routen stimmen mit den Domänenfarben der App überein.

### Block 5 — Statistik und Erfolge (17–20, 28)
Diagrammpalette einführen (heute keine), Kacheln auf `StatTile`, Tier-Farben
aus Tokens, die 17 h1-Varianten auf `.t-screen-title`.
- Ergebnis: jede Serie in jedem Diagramm hat eine Token-Farbe; ein Diagramm
  wird nie am Fold abgeschnitten.

### Block 6 — Reisen, Reisepass, Posteingang, Einstellungen (14–16, 21–24, 27)
Reise-Hero und Reise-Karten, der Reisepass als die eine helle Fläche
(`paper`), der Posteingang mit den vier Leerzuständen, Einstellungen als
`reading`-Breite.
- Ergebnis: der Reisepass ist der Signaturmoment und sieht aus wie auf dem
  Telefon.

### Block 7 — Aufräumen und Wächter
- 13 nie definierte CSS-Variablen (Anhang A.4) ersetzen; 93 `dark:`-Klassen
  löschen; 542 rohe Tailwind-Farbklassen; 6 Farbpaletten → `listColor`.
- Die vier Wächter aus `DESIGN_SYSTEM.md` §10 (Generator-Test, Hex-Ratchet,
  Palette-/`dark:`-Scan, Overlay-Scan).
- Ergebnis: die Ratchets sind grün und dürfen nur noch schrumpfen.

## 5. Abnahmekriterien (aus `direction.md`, für das Web ergänzt)

- Kein Emoji als Chrome, ein Icon-Set (Lucide).
- Nichts schwebt über Inhalt; ein Dialog hat Scrim, Fokusfalle, Escape.
- Status nie als Text, immer als Pille; eine Pille pro Zeile.
- Mono nur auf Codes, Meta, Messwerten; nie auf Pillen, Buttons, Namen.
- Höchstens eine Chip-Zeile vor einer Liste.
- Jede Domäne hat Zeile, Pillenfarbe und Icon.
- Touch-/Klickziele ≥ 44px, sichtbarer Fokusring.
- Diagramme nie geclippt; Ziffern tabellarisch.
- Offline und Leere sind gestaltete Zustände (vier Arten), nie rot.
- Alles Sichtbare kommt aus `tokens.json`; ein neuer Hex im Code ist ein
  Defekt, kein Stil.

## 6. Entscheidungen, die der Owner treffen muss

Nicht in der Design-Sitzung entscheiden, sondern als Frage zurückgeben:

1. **BRAND.md §3 und travstats.de.** Die Companion-Zuordnung der
   Domänenfarben gewinnt (Owner-Ansage „wie im Companion"). Damit sind die
   Marketing-Seite und ihre Screenshots falsch, bis BRAND.md nachzieht — wer
   zieht wann nach?
2. **Syne.** Die Marketing-Display-Schrift hat keinen Companion-Platz. Die App
   lässt sie fallen; bleibt sie auf der Website?
3. **Fünf weitere Domänen** (Zug, Wandern, Rad, Straße, Fähre) haben keine
   Companion-Tokens. Bekommen sie welche, oder bleiben sie web-only?
4. **Nutzerfarben für Domänen** (`domainColors`, Beta): behalten als Override
   über den Token-Defaults, oder streichen, weil ein Override die
   Karten-Bedeutung bricht (die Begründung, mit der der Companion den freien
   Hex-Picker abgeschafft hat)?
5. **Zeitpunkt.** 2.6.0 steht als rc.32 vor dem Promote. Die Vereinheitlichung
   ist 2.7.0-Arbeit auf einem `dev/design-system`-Zweig, nicht ein Fix am RC.

## 7. Was zu liefern ist

Pro Block: die gestalteten Screens (PNG, 1440×900 und 390×844) mit denselben
Namen wie in `ClaudeDesign/screenshots/`, plus ein kurzes `NN-antwort.md` im
Stil der Companion-Handoffs (`2026-09-04-charta-antwort.md`): was gebaut, was
offen, welche Frage an den Owner. Änderungen an Token-Werten gehen zuerst in
die Companion-Datei, dann per Kopie hierher — nie umgekehrt.

## Anhang A — Messung des Ist-Zustands (05.09.2026, `frontend/`)

### A.1 Token-Schicht
Eine Datei: `frontend/src/index.css` (606 Zeilen, Tailwind v4 `@theme` +
`:root`). Kein `tailwind.config`, kein `components/ui/`, kein Token-Modul.
Schriften in `index.html`: Syne 400–800, IBM Plex Mono 400/500, Inter
400/500/600. `class="dark"` fest, `prefers-color-scheme` 0 Treffer.

### A.2 Farben heute
Flächen `#0d1117 / #161b22 / #1c2128 / #21262d`, Rand `#30363d`, Text
`#e6edf3 / #8b949e / #a8b3bf`. Akzent `#f0a947`, `--accent-dim #c8842a`.
Semantik `--success #3fb950`, `--warning #d29922`, `--danger #f85149`
(`--danger-stamp #e65a4f` definiert, 0 Verwendungen). Kein `--info`; `#388bfd`
hart in `statusPillStyle.ts`. Domänen: flight `#f0a947`, cruise `#6fa0d6`,
lodging `#d4778f`, poi `#5ec2b2`, train `#8faa5f`, hike `#78966a`, bike
`#9fbe63`, road `#a89984`, ferry `#4aa6b0`; 27 `-locked`-Varianten ohne
Verwendung.

### A.3 Mengen
Radien 1133 Verwendungen in 10 Varianten · Schatten 166 (sm 66, xl 32, lg
28, 2xl 14 + 5 farbige Glows) · Rand-Syntaxen: inline `1px solid
var(--color-border)` 359, `borderColor:` 73, `border-[var(--…)]` 64,
`border-(--…)` 15 · Token-Referenzen in drei Schreibweisen: `style={{var(--…)}}`
2968, `[var(--…)]` 415, `(--…)` 1041 · rohe Tailwind-Farbklassen 542 ·
`font-mono` 77, `font-display` 18 (auf 14 Dateien, auf den 7 Hauptseiten
nicht), `tabular-nums` 36 · 17 verschiedene h1-Klassenketten · 10 `max-w-*`
Stufen · 597 `<button>`, 133 mit Utility · 24 eigene Overlays.

### A.4 Nie definierte CSS-Variablen (55 Referenzen)
`--border` 21 · `--color-amber` 10 · `--fx` 6 (mit Fallback `#6ab7d8`) ·
`--star` 3 (ohne Fallback) · `--bg-inset` 3 · `--bg-input` 3 · `--text-faint`
2 · `--color-error` 2 · `--card-bg` 2 · `--text-subtle` 1 · `--color-primary` 1
· `--bg-surface-2` 1. Betroffen u. a. `common/CurrencySelect.tsx`,
`lodging/LodgingStayCard.tsx`, `lodging/StarRatingInput.tsx`,
`SkeletonLoader.tsx`, `Admin/GlobalApiKeysManager.tsx`.

### A.5 Hex-Hotspots (277 Literale)
`NavigationBar.tsx` 15 (Ko-fi, Buy-me-a-coffee, Discord) · `TripDetailPage.tsx`
12 · `Cruise/CruiseEditModal.tsx` 11 (Handspiegel der Kreuzfahrtpalette) ·
`Settings/SpreadsheetSection.tsx` 10 (`#0b0f14`, eine 13. Grundfläche) ·
`PlaceListsPage.tsx` 8 · `NativeRoutesLayer.tsx` 8 · `FlightCertificate.tsx` 6
(eigene Papierpalette) · `lib/tripColors.ts` 10 (darunter `#38bdf8`, `#34d399`,
`#f472b6` — die Hexes, die BRAND.md §8 zum Löschen nennt).

### A.6 Inline-Farbstile (Zeilen)
`Stats/StatsFlightBreakdown.tsx` 38 · `AchievementsPage.tsx` 37 ·
`Stats/StatsAirportsSection.tsx` 36 · `TripDetailPage.tsx` 35 ·
`Stats/StatsYearFilter.tsx` 27 · `Stats/StatsBusinessSection.tsx` 26 ·
`PlaceDetailPage.tsx` 25 · `PendingUpdatesPage.tsx` 23 · `PassportPage.tsx` 22.

### A.7 Screens (Screenshots 01–28, Demo-Konto, rc.31/32)
01 Dashboard Alle · 02 Dashboard Flüge · 03 Globus · 04 Kreuzfahrten · 05
Unterkünfte · 06 Orte · 07 Touren · 08 Logbuch Flüge · 09 Flug-Detail · 10
Logbuch Kreuzfahrten · 11 Kreuzfahrt-Detail · 12 Unterkünfte (leer) · 13 Orte
(leer) · 14 Ortslisten · 15 Reisen · 16 Reise-Detail · 17 Erfolge · 18–20
Statistik (Gesamt, Flüge, Kreuzfahrten) · 21 Reisepass · 22 Posteingang ·
23–24 Einstellungen · 25–28 mobil (Dashboard, Logbuch, Reise-Detail,
Statistik). Nicht abgebildet, weil Admin oder ohne Demo-Daten: Admin, Parser,
Unterkunft-/Ort-Detail, Flugzeug-Seite, Setup, Login, 2FA.
