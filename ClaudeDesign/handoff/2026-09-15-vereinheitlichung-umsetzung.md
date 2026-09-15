# Vollständige Vereinheitlichung — Umsetzung des Handoffs vom 15.09.2026

Auftrag: `Design setup choices needed.zip` (Paketstand 15.09., 52 Screens,
Referenz `dev/design-system @ 51ea0549`). Owner-Anweisung: vollständige
Vereinheitlichung aller Seiten, Dialoge und Zustände; die Review-Punkte
D-01…D-08 verbindlich; gemeinsame Komponenten und **die Tokens des Repos**;
Funktionen, Berechtigungen und Beta-Gates bleiben erhalten; vorgeschlagene
Endpunkte gegen vorhandene Verträge prüfen; Prototyp-Hinweise raus; Desktop,
Tablet, Mobil; **Route/Ziel, Datum und Status in allen vier Logbüchern mobil
sichtbar**. Neuere Beschlüsse schlagen historische Abschnitte.

Diese Datei ist der Messstand, nicht die Absichtserklärung. Jede Zahl darin
kommt aus einem Lauf auf dieser Maschine, mit Datum.

## Zwei Befunde aus dem Abgleich, vor der ersten Zeile Code

### 1. Die `design/tokens.json` DES PAKETS ist älter als die im Repo

Semantisch verglichen, nicht nach Bytes:

| Datei | Fassung | Urteil |
|---|---|---|
| `referenzen/tokens.json` im Paket | `0.8.0-tour-motion` | **identisch mit dem Repo** — die richtige Grundlinie |
| `design/tokens.json` im Paketwurzelverzeichnis | `0.7.0-sammelauftrag` | **zwölf Abweichungen, alle Rückschritte** |

Was eine Übernahme gekostet hätte: `domainColor.tour` (`#8faa5f`) fehlt dort
ganz — das ist die Owner-Entscheidung vom 05.09., dass alle Touren EINE Farbe
haben. Dazu `motion.fast/base/enter` als Zeichenketten `"120ms"` statt Zahlen,
`motion.easing` auf `"ease-out"` eingedampft statt der beiden Kurven, und
`motion.skeletonPulse` weg.

**Entschieden: die Repo-Fassung gilt.** Das ist keine Auslegung, sondern die
Anweisung selbst — „gleiche den Export vor einer Übernahme damit ab" und „die
neueren Beschlüsse haben Vorrang". Der Export beschreibt Bildschirme, er ist
nicht die Quelle der Tokens. Die Quelle liegt ohnehin stromaufwärts im
Companion.

### 2. Die Wächter waren nur auf Linux grün (behoben, `48e26292`)

Drei der sieben Zusicherungen in `designWardens.test.ts` schlugen auf dieser
Maschine an `51ea0549` fehl — an einem Commit, dessen eigene Standnotiz sie
grün nennt. Beides stimmte: die Notiz entstand auf CT142. `rel()` schnitt den
Quellpfad mit `file.replace("<SRC>/", "")` ab, `join` trennt auf Windows mit
Backslash, der Ersatz griff nie, und die Ratsche schlug in beide Richtungen
zugleich aus.

Der Grund, warum das hier oben steht und nicht in einer Fußnote: die Wächter
SIND das Messinstrument dieses Auftrags. Ein Auftrag „vereinheitliche alles"
ohne eine Zahl, die kleiner wird, ist eine Meinung.

## Ausgangsstand, gemessen am 15.09.2026 auf `48e26292`

| Wächter | misst | Stand |
|---|---|---|
| `designWardens` | Hex-Literale | **80** Dateien |
| — | rohe Tailwind-Palettenklassen | **72** Dateien |
| — | `dark:`-Varianten | 0 — geschlossen, absolut |
| — | eigene `fixed inset-0`-Overlays | **44** Dateien |
| `appShell.ratchet` | Seiten, die ihre Shell selbst bauen | **17** Seiten |
| `screenTitle` | jede `<h1>` ist `.t-screen-title` | absolut, grün |
| `primitives` | kein Hex in `components/ui/` | absolut, grün |
| `tokens.generated` | Generatorausgabe = Tokendatei | absolut, grün |

Vorhandene Primitive (`components/ui/`): `AppShell` `Button` `Card` `Chip`
`Dialog` `EmptyState` `Field` `IconButton` `PageHeader` `Pill` `StatTile`
`Table`. Dazu die Tabellenfamilie `components/table/`: `ColumnPicker`
`ListEmptyState` `ListFilterBar` `ListSummaryStrip` `RowActionButton`
`SortableHeader` `statusPillStyle` `useColumnPrefs` `useSortPrefs`.

**Was der Export für neu hält und schon da ist.** Die vier Logbücher teilen
sich bereits sieben der neun Tabellenbausteine — `ListFilterBar`,
`ListSummaryStrip`, `ListEmptyState`, `ColumnPicker`, `SortableHeader`,
`useColumnPrefs`, `useSortPrefs` sind in allen vier im Einsatz. Die
Umsetzungsliste des Exports führt „FilterChips" und „ListRow" als neue
Komponenten; nur die zweite ist wirklich neu. Ebenso stehen `companions.ts`
und `countryFlags.ts` bereits als Router im Backend, die der Export als
„NEU" markiert.

**Was wirklich fehlt und den bindenden Punkt trägt:** keine der vier
Logbuchseiten hat eine mobile Zeilendarstellung. Keine trägt eine einzige
responsive Spaltenregel. Das ist D-02 und zugleich die Abnahmefrage, die der
Owner ausdrücklich wiederholt hat.

## Endpunkte des Exports gegen die vorhandenen Verträge

Gemessen gegen `backend/src/routes/mounts.ts`.

| Vorschlag | Lage im Repo |
|---|---|
| `GET /api/v1/country-flags/:cc` | **existiert** (`countryFlags`) |
| Companions | **existiert** (`companions`) — Domänenabdeckung noch zu prüfen |
| `GET /api/v1/review/:year` (+ `/image`) | fehlt |
| `POST /api/v1/preview/effects` | fehlt |
| `GET /api/v1/search?q=` | fehlt |
| Tags je Domäne | fehlt |
| `GET /api/v1/import/log` | fehlt |
| `POST /api/v1/places/from-checklist` | fehlt |
| Reisepass-Zählschwelle persistieren, Belege je Land | fehlt |

**Haltung dazu:** der Auftrag sagt „prüfe", nicht „baue". Ein fehlender
Vertrag wird hier benannt und die Oberfläche zeigt an der Stelle Unsicherheit,
statt eine Fähigkeit zu behaupten — genau wie es der Handoff in §7 selbst
verlangt. Neue Endpunkte entstehen nur dort, wo eine vereinheitlichte
Oberfläche sonst lügen müsste, und dann als eigener Commit mit eigenem Test.

## Blöcke

Reihenfolge nach Bindungsgrad, nicht nach Aufwand. Priorisierung streicht
nichts aus dem Auftrag.

| # | Block | Bindender Punkt | Zustand |
|---|---|---|---|
| A | Mobile Zeile für alle vier Logbücher | D-02, Abnahmefrage 1, Owner-Wiederholung | **fertig** (`eb5723db`) |
| B | Eine Detail-Familie (Flug, Kreuzfahrt, Unterkunft, Ort) | D-08 | **fertig** (`6acbb1cd`), Browserblick offen |
| C | Shell: 17 Seiten von der Eigenbau-Shell auf `AppShell` | D-01 | offen |
| D | Eine Dialog-Shell für die 44 eigenen Overlays | E11, §6 Zustände | offen |
| E | Status- und Datumsvokabular über alle Domänen | D-07 | offen |
| F | Kartensteuerung und Sheet-Höhen | D-03 | offen |
| G | Reisepass mobil, Nachweisstufen | D-04 | offen |
| H | Einstellungen: Alltag vor Technik, Speicherstatus | D-05 | offen |
| I | Kontrast der tatsächlichen Kombinationen | D-06 | offen |
| J | Prototyp-Hinweise aus der Produktoberfläche | Owner-Anweisung | offen |

Jeder Block endet mit einem Wächter, der seinen Punkt misst, und zieht die
Zahlen oben nach. Ein Block ohne Zahl gilt als nicht erledigt.

## Block A — fertig, im Browser abgenommen (15.09.2026)

Commit `eb5723db`. Der Baustein war da und ungenutzt: `Table`/`TableRow`
fallen unter 640 px in eine Zeile zusammen und geben jeder Spalte ihren
schmalen Platz per Name — gebaut in Block 2, gerendert nur von `/design`.
Die vier echten Listen zeichneten daneben ihre eigene
`<table class="min-w-[960px]">` in einem `overflow-x-auto`.

**Gemessen bei 390 × 844, angemeldet, gegen die Dev-Datenbank:**

| Logbuch | Titel | Unterzeile | Pille | Überlauf des Tisches |
|---|---|---|---|---|
| Flüge | MUC → CPH | `Mi 13.01.27 · LH2462 · 1h 30min` | Geplant | 0 |
| Kreuzfahrten | Wonder of the Seas | `2026-11-27 – 2026-12-04` | Geplant | 0 |
| Unterkünfte | Pension Alpenblick | `13.09.2024` | Abgeschlossen | 0 |
| Orte | Nyhavn | `—` | Merkliste | 0 |

Das `—` bei den Orten ist richtig, nicht leer: der Ort hat kein Besuchsdatum,
und eine Null wäre eine Behauptung. Bild: `screenshots/design-system/2026-09-15-logbuch/`.

### Zwei Befunde aus derselben Sitzung, die NICHT zu Block A gehören

**Die Seite läuft um 14 px über — aus der Kopfleiste, nicht aus der Liste.**
Der Tisch misst 335 von 335 px. Die 14 px kommen vom Konto-Menü
(`aria-label="Konto-Menü"`) in `HEADER.sticky`, das bei 390 px rechts
hinausragt. Das ist D-01 und gehört in Block C; hier steht es, damit es dort
nicht neu gefunden werden muss.

**D-07 ist live bestätigt, in EINER deutschen Sitzung:** Flüge zeigen
`Mi 13.01.27`, Kreuzfahrten `2026-11-27`, Unterkünfte `13.09.2024`. Drei
Datumsformate auf drei Seiten derselben Anwendung — genau der Befund des
Handoffs, jetzt mit eigener Messung statt aus zweiter Hand. Block E.

### Falle für jeden, der hier nachmisst

Die Dev-Datenbank auf `localhost:5433` ist **von allen Worktrees geteilt**.
Am 15.09. um 19:17 startete im Haupt-Checkout ein `npm test -- --forceExit`
(Jest, PID 50464) und leerte mitten in der Abnahme die Benutzertabelle — die
angemeldete Sitzung im Browser landete auf `/setup`, weil der Server null
Admins zählte. Kein Produktfehler: die Backend-Suite räumt die Tabellen ab,
und sie lief gegen dieselbe Datenbank.

Wer im Browser abnimmt, prüft vorher, ob eine Suite läuft — und seedet NICHT
blind nach, weil das in den fremden Lauf greift.

## Block B — fertig, Browserblick offen (15.09.2026)

Commit `6acbb1cd`. `DetailHeader` in `components/ui/`, von allen vier
Eintragsdetails benutzt; die vier haben dabei ihre selbstgebaute Shell
verlassen. Wächter: `detailHeaderFamily.test.ts`.

Gemessener Ausgangszustand — vier Antworten auf eine Frage, keine davon vom
Inhalt verlangt:

| | Flug | Kreuzfahrt | Unterkunft | Ort |
|---|---|---|---|---|
| Rahmen | Karte | Karte | Karte | **keiner** |
| Breite | `max-w-6xl` | `max-w-6xl` | `max-w-6xl` | `max-w-[1100px]` |
| Marke | 48-px-Kachel | 48-px-Kachel | 48-px-Kachel | **im `h1`** |
| Status | Pille | Pille + 3 Kästchen | **keiner** | eigene Pille, eigene Farben |
| Zurück | `button` | `button` | `button` | stiller Link |
| Bearbeiten | Akzentfläche | Akzentfläche | Akzentfläche | Umriss |

Vier Dinge wurden dabei geändert statt verschoben, jedes mit Grund: Zurück ist
ein `Link` (ein `button` nimmt Mittelklick und „in neuem Tab öffnen"); der
Pfeil ist `aria-hidden` (er war Teil der Beschriftung, ein Screenreader las
„Pfeil links Kempinski"); die Unterkunft zeigt jetzt dieselbe Lebenszyklus-Pille
wie die Liste, über denselben Helfer; und Löschen ist ein Sekundärknopf, weil
`Button` selbst festlegt, dass Gefahr in den Bestätigen-Dialog gehört.

Zahlen danach: Shell-Ratsche **17 → 13**, Tailwind-Paletten **72 → 70**,
Tests 3737 in 433 Dateien.

### Der Browserblick fehlt — und warum

Nicht aus Nachlässigkeit, sondern weil die Umgebung zumachte:

1. Die geteilte Dev-Datenbank auf 5433 wird von einer fremden Backend-Suite
   geleert (siehe Block A). Also eine **eigene** Datenbank aufgesetzt:
   Container `travstats-db-design`, Postgis 15-3.4, Port **5434**, Datenbank
   `flights_design`, migriert, Kataloge (30 Schiffe, 12 059 Häfen) und
   Demo-Seed eingespielt. Die steht und ist isoliert.
2. Am Dev-Server ist es gescheitert. `TaskStop` beendet den `npx`-Wrapper,
   nicht das `tsx`/`vite`-Kind — die bekannte Verwaisung. Jeder Neustart
   brauchte deshalb einen neuen Port, jeder neue Port eine neue CORS-Herkunft,
   und `taskkill` ist in diesem Projekt untersagt. Ergebnis: fünf verwaiste
   Vite-Server auf 3003–3007 und zwei Backends auf 8002/8003.

**Für den nächsten Anlauf, damit das nicht wieder passiert:** Backend mit
`CORS_ORIGIN` als **Liste** starten (`http://localhost:3003,…,3010`) — die
Variable nimmt kommagetrennte Werte, das beendet das Portkarussell sofort.
Und: `VITE_API_URL` aus der **Shell** schlägt `.env.local`; ein `--force` ist
nötig, weil Vite den `import.meta.env`-Block in den Transform-Cache backt und
sonst die alte Backend-Adresse weiterliefert.
