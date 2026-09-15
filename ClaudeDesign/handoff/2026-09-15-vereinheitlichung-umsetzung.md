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
| B | Eine Detail-Familie (Flug, Kreuzfahrt, Unterkunft, Ort) | D-08 | **fertig + abgenommen** (`6acbb1cd`) |
| C | Shell: 17 Seiten von der Eigenbau-Shell auf `AppShell` | D-01 | **fertig + abgenommen** (`0263b509`) |
| D | Eine Dialog-Shell für die 44 eigenen Overlays | E11, §6 Zustände | **19 offen, 5 begründet ausgenommen**, Shell abgenommen |
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

## Block C — fertig, Browserblick offen (15.09.2026)

Commit `0263b509`. Die dreizehn verbliebenen Seiten sind auf `AppShell`;
`appShell.ratchet.test.ts` ist damit **absolut** statt eingefroren, wie der
`dark:`-Wächter, als er zuging. Die leere Liste bleibt mit Absicht in der
Datei: sie hält fest, dass die Zahl null erreicht hat.

Was die dreizehn an Breite verbrauchten: zehn verschiedene Werte, und drei
Seiten trugen zwei bis drei Shells **je Seite** — eine für Laden, eine für
Fehler, eine für den Inhalt, jede mit eigener Navigation, eigenem
`min-h-screen` und eigenem Container. `AchievementsPage` hatte drei,
`TripRouteEditorPage` drei, die Orte-Familie je zwei.

Drei Seiten haben dabei ein handgebautes Bedienelement verloren: ein
Zurück-`button` wurde ein `Link`, zwei Wiederholen-`button` wurden `Button` —
aus demselben Grund wie in Block B.

**Die Kopfleiste selbst lief über**, gemessen bei 390 px auf der Flugliste:
die Seite scrollte um 14 px seitlich, während der Tisch darin exakt 335 von
335 maß. Die Zeile konnte nirgends schrumpfen, also wurde das Konto-Menü über
den rechten Rand geschoben. Die linke Hälfte gibt jetzt nach (`min-w-0`), der
Schriftzug verschwindet unter 400 px — die Marke allein sagt weiter, welche
Anwendung das ist — und die rechte Hälfte ist `shrink-0`, weil ein auf halbe
Tap-Fläche gequetschtes Bedienelement schlimmer ist als ein Schriftzug, der
zur Seite tritt.

**Das letzte Stück ist begründet, nicht gesehen.** Der Browserblick steht für
B und C gemeinsam aus, aus dem Grund, der oben unter Block B steht.

### Stand der Zähler nach A–C

| Wächter | 15.09. früh | jetzt |
|---|---|---|
| Seiten mit eigener Shell | 17 | **0 — geschlossen** |
| rohe Tailwind-Palettenklassen | 72 | 70 |
| Hex-Literale | 80 | 80 |
| eigene `fixed inset-0`-Overlays | 44 | 44 |
| Tests | 3715 | 3737 |
| Datei-Größen-Baseline | 20 | 19 |

## Browserblick nachgeholt — A bis D abgenommen (15.09.2026, abends)

Der Owner hat `taskkill` ausdrücklich freigegeben; die acht verwaisten
Dev-Server wurden beendet (jede Kommandozeile vorher gegen
`worktrees\design-system` geprüft, damit keine fremde Suite und kein
MCP-Server getroffen wird). Danach **ein** Stack: Backend 8000 gegen die
isolierte Datenbank auf 5434, Vite 3000 mit `--force`, `CORS_ORIGIN` als
Liste. Beim ersten Versuch hätte das alles vermieden.

### Was gemessen wurde

| Prüfung | Ergebnis |
|---|---|
| Flugliste 390 px, Seitenüberlauf | **0** — die 14 px aus Block A sind weg |
| Flugliste 390 px, Tischüberlauf | 0, 123 Zeilen |
| Zeile mobil | Marke · `MUC ✈ CPH` · `GEPLANT` · `Mi 13.01.27 · LH2462 · 1h 30min` |
| Flugliste 1440 px | 10 Spalten, sortierbare Köpfe, **schmale Zusammenfassung ausgeblendet** |
| Flug-, Kreuzfahrt-, Unterkunfts-, Ort-Detail bei 390 px | je Überlauf 0, ein `h1` als `.t-screen-title`, Zurück als echtes `<a>` mit Ziel, eine Statuspille |
| Unterkunft-Detail | zeigt jetzt „Abgeschlossen" — die Pille, die diese Seite nie hatte |

### Der Dialog-Vertrag, im Browser

Am Flug-Bearbeiten-Dialog geprüft: Portal an `document.body`,
`role="dialog"`, `aria-modal="true"`, Radius 26 px, Verdunkelung
`rgba(7,9,12,.6)` aus `--ts-scrim`, Fokus im Panel, `body` auf
`overflow: hidden`. Escape schließt, die Sperre löst sich, und der Fokus
kehrt zum **Bearbeiten**-Knopf zurück, nicht zu `<body>`.

**Und die eine Prüfung, von der die Testdatei selbst sagt, dass nur ein
Browser sie leisten kann:** `document.elementFromPoint` auf der Mitte des
ersten Knopfes liefert den Dialog — nicht die Verdunkelung. Das ist der
Stapelfehler, der monatelang unsichtbar ausgeliefert wurde.

### Eine Messung, die ich verworfen habe

Der erste Durchgang über die vier Details lief per `history.pushState` +
`popstate`. React Router hat darauf nicht neu gerendert, also stand in allen
vier Zeilen dasselbe Ergebnis („Wonder of the Seas"). Das sah aus wie eine
Messung und war keine. Jede Seite wurde danach einzeln angesteuert.

### Was dabei aufgefallen ist, aber nicht hierher gehört

D-07 ist innerhalb **einer** Domäne sichtbar: die Kreuzfahrtliste schreibt
`2026-11-27`, das Kreuzfahrtdetail `10.11.2026 – 17.11.2026`. Gleiche Daten,
gleiche Sitzung, zwei Formate. Block E.

## Statistik — die zwei Review-Punkte des Owners, nachgemessen (15.09., abends)

Nachtrag zum Paket (21:51 Uhr): drei Statistik-Reiter für Kreuzfahrten,
Unterkünfte und Orte, Route `/stats?tab=cruise|lodging|poi`.

**Erster Befund: die Route und die drei Abschnitte gibt es schon.**
`AdvancedStatsPage` liest `?tab=` seit Längerem, samt Absicherung, dass ein
Deep-Link keine abgeschaltete Domäne aufzieht; `CruiseStatsSection`,
`LodgingStatsSection` und `PoiStatsSection` existieren und zeichnen. Im
Browser gegengeprüft: der Unterkunfts-Reiter zeigt „Was eine Nacht kostet",
„Wie es dir gefallen hat", Ranglisten nach Kette, Land, Verpflegung und
Sternekategorie — die Blöcke, die der Export als neu beschreibt. Der Export
wurde gegen den Referenzstand vom 06.09. gebaut und konnte das nicht wissen.

### Punkt 1 ist eine FOLGE von Punkt 2, keine eigene Ursache

Der Owner sieht in „Gesamt" bei Unterkünften und Orten „keine Daten", während
deren Reiter Daten zeigen. Gemessen auf der isolierten Datenbank:

| Zeitraum | Zusammensetzung in „Gesamt" |
|---|---|
| Jahr 2026 | `6 Flüge · 1 POI / Besuche · 2 Kreuzfahrten` — Unterkünfte fehlen |
| Alle Jahre | `115 Flüge · 1 POI / Besuche · 4 Unterkünfte · 19 Kreuzfahrten` |

„Gesamt" ignoriert die beiden Domänen also **nicht**. Es filtert nach Jahr, und
meine Demo-Aufenthalte liegen in 2024. Die Bereichsreiter filtern dagegen
**gar nicht** — sie zeigen Lebenszeitdaten. Beide Aussagen stimmen für sich und
widersprechen sich auf dem Bildschirm, und genau das sieht man.

### Punkt 2, die Ursache, gemessen

| Reiter | Zeitraumleiste | Vergleich | Abschnitte ausblenden |
|---|---|---|---|
| Gesamt | ja (eigene) | ja | – |
| Flüge | ja (eigene) | ja | ja |
| Kreuzfahrten | **nein** | **nein** | **nein** |
| Unterkünfte | **nein** | **nein** | **nein** |
| Orte | **nein** | **nein** | **nein** |

Im Code: `SectionVisibilityMenu` steht hinter `effectiveFilter === "flight"`
(`AdvancedStatsPage.tsx:681`), und die drei Bereichs-Abschnitte nehmen **gar
keine Eigenschaften** entgegen — kein Jahr, keinen Vergleich. Es gibt zwei
unabhängige Zeitraumleisten (eine für Gesamt, eine für Flüge) und drei
Abschnitte ohne jede.

### Was das für die Umsetzung heißt

`/stats/cruise` und `/stats/lodging` nehmen **kein** Jahr entgegen; beide laden
Zeilen und reichen sie an einen gemeinsamen Rechner weiter. `PoiStatsSection`
holt dagegen die Rohliste und rechnet im Client — dort ist das Filtern reine
Frontend-Arbeit. Die Reihenfolge ist damit vorgegeben:

1. **Backend**: `?year=` für `/stats/cruise` und `/stats/lodging`, gefiltert
   nach der Regel, die `Overview/aggregate.ts` bereits schreibt — ein Ereignis
   zählt in dem Jahr, in dem es *beginnt*.
2. **Frontend**: EINE Zeitraumleiste für alle fünf Reiter statt zweier, Jahr
   und Vergleich in die drei Abschnitte durchgereicht.
3. **Abschnitte ausblenden** für alle Reiter — der Haken
   `useSectionVisibility(filter)` ist bereits bereichsweise, nur das Menü ist
   auf Flüge beschränkt.

### Umsetzung: erster Schritt getan, zweiter genau beschrieben

**Backend fertig** (`23b2736e`): `/stats/cruise` und `/stats/lodging` nehmen
`?year=`. Fenster halboffen, Kreuzfahrten nach `startDate`, Aufenthalte nach
`checkIn`, Häuserliste folgt unter einem Jahr den Aufenthalten. Eigenes
`YearQuerySchema` statt `SummaryQuerySchema`, weil ein Schema ein Versprechen
ist. Vergleich = zwei Aufrufe aus dem Client, damit die Antwortform der
Umschlag-Familie nicht zwei Gestalten bekommt (ADR 0001). Wächter:
`stats.domainYear.test.ts`, per Mutation geprüft.

**Frontend angefangen:** `components/Stats/useStatsPeriod.ts` hebt den
Jahres- und Vergleichszustand aus `Overview/OverviewTab.tsx` heraus — die
Logik ist **verschoben, nicht neu geschrieben**, weil jedes Stück davon
bezahlt ist: einmaliges Vorwählen des jüngsten Jahres, gemerkte
Vergleichs-Einstellung (#188), Auflösung eines veralteten Vergleichsjahres,
und die Bedingung, dass die Veraltet-Prüfung **nicht** vor dem Laden laufen
darf (sonst wirkt jede gemerkte Wahl veraltet und wird gelöscht).

> **Der Haken ist noch nirgends eingehängt.** Er übersetzt und die Suite ist
> grün, aber `OverviewTab` hält weiterhin seinen eigenen Zustand. Ein Commit
> mit ungenutztem Code ist bewusst in Kauf genommen, damit der Schritt nicht
> verlorengeht; der nächste Anlauf hängt ihn ein.

**Was noch fehlt, in Reihenfolge:**

1. `OverviewTab` auf den Haken umstellen (eigenen `useState` und die zwei
   Effekte entfernen, Werte als Eigenschaften entgegennehmen).
2. **Eine** Zeitraumleiste auf Seitenebene für alle fünf Reiter. Heute gibt es
   zwei Bauformen für einen Regler: `<select>` in `StatsYearFilter`
   (Zeilen 37–130) und Pillen in `Overview/CrossDomainYearFilter`. Die Pillen
   sind die neuere Form — sie wird die gemeinsame. `StatsYearFilter` behält
   nur seine Flug-Kennzahlenkarten und sollte dann auch so heißen; ein
   Bauteil namens „YearFilter", das nicht mehr filtert, ist eine Lüge.
3. Die Jahresliste der gemeinsamen Leiste ist die **Vereinigung** über alle
   Domänen (`collectYears` über alle `stats`), nicht die Flugjahre.
4. Jahr und Vergleich in `CruiseStatsSection`, `LodgingStatsSection` und
   `PoiStatsSection` durchreichen. Die ersten beiden rufen ihren Endpunkt
   dann zweimal auf, wenn verglichen wird; POI rechnet im Client und filtert
   dort.
5. `SectionVisibilityMenu` für alle Reiter statt nur für Flüge
   (`AdvancedStatsPage.tsx:681`). Der Haken `useSectionVisibility(filter)` ist
   bereits bereichsweise — es fehlt je Domäne eine Abschnittsliste wie
   `FLIGHT_SECTIONS`.
