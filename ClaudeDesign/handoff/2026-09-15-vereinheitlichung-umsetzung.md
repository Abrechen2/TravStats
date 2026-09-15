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
| A | Mobile Zeile für alle vier Logbücher | D-02, Abnahmefrage 1, Owner-Wiederholung | offen |
| B | Eine Detail-Familie (Flug, Kreuzfahrt, Unterkunft, Ort) | D-08 | offen |
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
