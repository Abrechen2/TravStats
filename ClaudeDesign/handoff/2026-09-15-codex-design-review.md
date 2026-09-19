# TravStats: Design-Handoff und Review vom 15.09.2026

## Auftrag und Ergebnis

Das gesamte Webprodukt soll ein stimmiges Gesamtbild erhalten: alle Seiten,
Unterseiten, Eintragsdetails, Formulare, Dialoge, Sheets und Zustände. Die vier
Beispielabläufe des ursprünglichen Handoffs sind Prüfbeispiele und begrenzen
den Umfang nicht. Web, Companion und Website teilen die Markenidentität;
ihre unterschiedlichen Aufgaben bleiben berücksichtigt.

Die Designrichtung ist als Grundlage für die Umsetzung geeignet. Die unten
aufgeführten Korrekturen gehören zur Umsetzung. Der HTML-Export ist ein
Prototyp mit Beispieldaten und kein Nachweis fertiger Produktfunktionen.

Der Owner hat am 15.09.2026 beauftragt, die Ergebnisse festzuhalten und zu
pushen. Diese Lieferung dokumentiert den Auftrag und archiviert die Quellen.

## Einstieg für Claude

1. Dieses Review lesen: Es ergänzt die historischen Dokumente und trennt
   Befunde am Export von Befunden am Produktcode.
2. Den [ursprünglichen Gesamtauftrag](2026-09-15-codex-ausgangsauftrag/HANDOFF.md)
   mit den Referenzbildern verwenden.
3. Den [aktuellen Export](../export/2026-09-15-runde-4/Index.dc.html) öffnen.
   Die aktuellen Fassungen heißen Einstellungen v3, Admin v2 und Reisepass v2.
4. [Runde 4](../export/2026-09-15-runde-4/antwort-runde-4.md),
   [Statistik](../export/2026-09-15-runde-4/Statistik.dc.html) und
   [Routenmatrix](../export/2026-09-15-runde-4/ROUTENMATRIX.csv) abgleichen.
5. Vor weiterer Implementierung den aktuellen Stand von `dev/design-system`
   einschließlich `ClaudeDesign/handoff/2026-09-15-vereinheitlichung-umsetzung.md`
   lesen. Dort läuft bereits die Umsetzung. Keine vorhandenen Komponenten
   oder Endpunkte aufgrund der Exportliste ein zweites Mal bauen.

### Verbindlicher Arbeitsauftrag

Die vollständige Vereinheitlichung aller Seiten, Dialoge und Zustände umsetzen.
Die Review-Punkte mitbearbeiten. Gemeinsame Komponenten und die aktuellen
Repository-Tokens verwenden; Export und Bestand vor einer Übernahme abgleichen.
Bestehende Funktionen, Berechtigungen und Beta-Gates erhalten. Vorgeschlagene
API-Endpunkte gegen vorhandene Verträge prüfen. Prototyp-Hinweise aus der
Produktoberfläche entfernen. Desktop, Tablet und Mobil prüfen. In allen vier
Logbüchern bleiben Route beziehungsweise Ziel, Datum und Status mobil sichtbar.
Neuere Beschlüsse haben Vorrang vor widersprechenden historischen Abschnitten.

## Quellen und Stand

| Quelle | Festgehaltener Stand |
|---|---|
| Erster ZIP-Review | 7.921.935 Bytes; 52 HTML-Screens; Statistik 54.311 Bytes |
| Aktuelles ZIP | 7.931.346 Bytes; Dateiänderung 15.09.2026, 21:51:24 Ortszeit; 113 Einträge; 52 HTML-Screens |
| Aktuelle Statistik | 116.297 Bytes; neue Abschnitte für Kreuzfahrten, Unterkünfte und Orte |
| SHA-256 des aktuellen Original-ZIPs | `cd29680d6fa9a0e533f7f4f33ed991aff02a310862604c135c5547591a930d92` |
| Historische Designreferenz | `dev/design-system @ 51ea054925efc5add4d77fd7192915aac48ad3f5` |
| Bei Archivierung gelesener Implementierungsstand | `23b2736e88de5c2205235ec33166631dbc28ce9f`; Forgejo-Design-Branch; Arbeit läuft weiter |

Beim ersten Review wurden zentrale Screens in Chrome bei 390 × 844 und
1440 × 900 geprüft, insbesondere Flug-/Kreuzfahrtlogbuch, Dashboard,
Reisepass und Einstellungen. Das war eine Stichprobe, keine vollständige
Abnahme aller 52 Screens. Die spätere Statistik-Erweiterung wurde anhand
der Dateien geprüft; Chrome war in dieser Runde nicht verbunden.

Die acht Bilder im ursprünglichen Handoff zeigen den historischen Beta-Stand.
Sie sind weder Screenshots des neuen Exports noch der inzwischen laufenden
Implementierung. Der [frühere Statuscheck](2026-09-15-codex-status-snapshot.md)
bleibt als datierter Ausgangspunkt erhalten.

## Die fünf im gelieferten Paket protokollierten Entscheidungen

Das Paket bezeichnet diese Entscheidungen in Runde 4 §6 als umgesetzt.
Einstellungen als Routen und vier Domänen bei Tags/Mitreisenden waren bereits
vorher Owner-Vorgaben. Kartenvariante, Erfolgsplatzierung und PNG wurden in
dieser Unterhaltung zunächst als Empfehlungen formuliert und anschließend
so im vom Owner gelieferten Paket protokolliert. Die Protokollierung ist
keine technische Abnahme des Produktcodes.

| Nr. | Ziel |
|---|---|
| 1 | Kartenvariante 2: Domänenfarbe bleibt; geplant erhält zusätzlich gestrichelte Bögen, reduzierte Deckkraft und hohle Endpunkte. Der Export spezifiziert 55 % und 6/6. Renderer und Lesbarkeit prüfen. |
| 2 | Einstellungen bereits in 2.7 als echte Gruppenrouten, z. B. `/settings/account`; Navigation, Direktaufruf und Zurück-Verhalten gehören dazu. |
| 3 | Erfolge inhaltlich unter Statistik. Der Export ergänzt den Zugang über Mehr → Sammlungen und entfernt ihn aus dem Profilmenü. |
| 4 | Tags und Mitreisende für Flüge, Kreuzfahrten, Unterkünfte und Orte nach demselben Muster, einschließlich Verwaltung. |
| 5 | Jahresrückblick als serverseitiges PNG teilbar; Druck/PDF bleibt. Der Export schlägt 1200 × 630 vor. |

## Fortgeltende Gestaltungs- und Produktregeln

- Vier primäre Ziele: Dashboard, Logbuch, Reisen, Statistik. Weitere Ziele
  und Kontofunktionen folgen dem gemeinsamen Navigationsmodell.
- Hanken Grotesk als UI-Schrift; IBM Plex Mono für Codes und geeignete
  Mess-/Metadaten; Newsreader als gezielte Ausnahme. Schriften selbst hosten.
- Aktuelle gemeinsame Tokens verwenden. Companion ist die dokumentierte
  Quelle der gemeinsamen Tokens; generierte Theme-Dateien nicht von Hand ändern.
- Eine Domänenfarbe für alle Touren; Verkehrsmittel unterscheiden sich über Icons.
- Domänen-Overrides mit Farbwähler bleiben. Keine beliebige Farbe je Kreuzfahrt.
- Developer Mode und LoRA-Training gehören in den Adminbereich. Nutzer können
  Parser-Feedback geben. Parser-Werkzeuge und normale Dokumenterfassung trennen.
- Gleiche Regeln für Status, Datum, Zeit, Währung, Einheiten und Aktionen
  durchgängig anwenden. Lokalisierung und bestehende Formatpräferenzen beachten.
- Der ratifizierte Grenzwert von 800 Zeilen gilt für die spätere Implementierung.

## Review: offene Abweichungen im Export

Diese Tabelle beschreibt das Designpaket. Ein Punkt kann im Produktcode
bereits behoben sein; dort ist er gegen den aktuellen Branch nachzuprüfen.

| ID | Befund und Beleg | Erforderliches Ergebnis |
|---|---|---|
| R01 | Die mobile Shell benötigt bei 390 px eine Dokumentbreite von 462 px. Hinzufügen und Profil liegen rechts außerhalb. Gemessen an zentralen Screens beim ersten Browserreview. | Keine horizontal überlaufende Gesamtseite; globale Aktionen erreichbar bei 320/390 px. |
| R02 | Das Fluglogbuch besitzt mobile Zeilen. Im Kreuzfahrtlogbuch liegen Datum und Status rechts außerhalb des sichtbaren Ausschnitts; dieselbe Domänen-Datei bedient Unterkunft und Ort. | Gemeinsame mobile Zeilen für alle vier Domänen mit Ziel/Route, Datum und Status; Details weiterhin zugänglich. |
| R03 | Der mobile Reisepass stapelt vier große Kennzahlenkarten vor Erklärung und Länderliste. | Kompakte Zusammenfassung und Länderzeilen; Zählregeln und Nachweise gezielt aufklappen. |
| R04 | Export-Tokens sind `0.7.0-sammelauftrag`, Referenz/Repo `0.8.0-tour-motion`. `domainColor.tour` fehlt; Motion-Zahlen werden Strings; Kurven/Puls gehen verloren. | Aktuelle Repo-Tokens behalten und Ergänzungen ausdrücklich abgleichen. `map.plannedStroke = dashed info` im alten Export widerspricht zudem Kartenvariante 2. |
| R05 | Einstellungen v3 und EN Settings zeigen Developer/LoRA weiterhin im Nutzerbereich. | Admin-Zuordnung und Berechtigungen aus dem Produkt übernehmen. |
| R06 | Kreuzfahrt Detail enthält weiterhin zehn individuelle Kartenfarben für „Pro Reise“. | Domänen-Override erhalten; keine neue individuelle Kreuzfahrtfarbe aus dem Mockup übernehmen. |
| R07 | Runde 4 und README enthalten neue Beschlüsse neben historischen offenen Fragen und alten Menüzuordnungen. Der behauptete rootseitige `DESIGN_SYSTEM.md` fehlt. | Vorrang dieses Reviews und des aktuellen Auftrags; ältere Abschnitte als Historie behandeln. Die vorhandene Systemreferenz liegt im ursprünglichen Handoff. |
| R08 | EN-Dateien verlinken auf fehlende `Inbox.dc.html` und `Settings v3.dc.html`; EN Settings enthält deutsche Inhalte. | Links und vollständige Lokalisierung prüfen; keine neuen Übersetzungsdateinamen erfinden. |
| R09 | `ROUTENMATRIX.csv` hat 11 Spalten, aber Zeilen 10 und 26 besitzen jeweils 12; unquotierte Semikolons bei `/dashboard/:tab` und `/achievements`. | Matrix bei der weiteren Pflege korrekt als CSV serialisieren; „ja“ im Export ersetzt keine Abnahme. |
| R10 | Die Datumsregel in Runde 4 (ISO-Tabellen) entspricht nicht dem gezeigten Fluglogbuch. Auch deutsche und englische Ansichten sind nicht durchgängig vereinheitlicht. | Einheitliche, lokalisierte Formatierung aus dem Produkt übernehmen. Sortierung verwendet Datumswerte und benötigt keine bestimmte Anzeigeform. |
| R11 | Runde 4 beschränkt den Papiercharakter des Reisepasses auf den Druck, während der ursprüngliche Auftrag ihn bewahren sollte. | Diese Abweichung sichtbar behandeln und vor endgültiger visueller Abnahme mit dem Owner klären. |
| R12 | Toureneditor mobil nur teilweise, Admin und Parser mobil teilweise, Tablet-Zwischenstufe und Tabellenrollen nicht vollständig belegt. | Diese Bereiche in die Abnahme aufnehmen; keine Einschränkung bestehender Funktionen allein aus dem Prototyp ableiten. |
| R13 | Vorgeschlagene neue APIs vermischen UI-Routen, Renderer-Fähigkeiten, vorhandene Verträge und neue Produktfunktionen. | Bestandsaufnahme vor Umsetzung; neue Such-, Vorschau-, Import-Log- und Exportfunktionen mit Vertrag und Fehlerzuständen beschreiben. |

Die mobile Karte ist ebenfalls Teil der Abnahme: Panels, Aktivität, Zeitachse,
Sheet und Attribution müssen zusammenpassen. Der Zustandswähler des Prototyps
überlagert bei der Vorschau Teile der Oberfläche; er gehört nicht ins Produkt.

## Statistik-Erweiterung im aktuellen ZIP

| Bereich | Enthaltene Auswertungen |
|---|---|
| Flüge | 13 ausblendbare Abschnitte, u. a. Übersicht, Diagramme, Distanz, Pünktlichkeit, Kosten und Ranglisten |
| Kreuzfahrten | Häfen, Schiffe, Reedereien, Regionen, Länder, Distanzen, Seetage, Quoten und Rekorde |
| Unterkünfte | Kosten pro Nacht, Bewertungen, geografische Verteilung, Rhythmus, Ketten/Programme und Rekorde |
| Orte | Kategorien, Länder/Städte, häufigste Besuche, Rhythmus, Bewertungen, Checklisten und Besonderheiten |

Positiv sind die gemeinsamen Kennzahlenkacheln, Balken-Ranglisten und Säulen
in Domänenfarben sowie Hinweise auf fehlende Preise, Koordinaten und Daten
oder doppelt gebuchte Nächte. Dadurch werden die Berechnungsgrundlagen sichtbar.

### Im Prototyp noch offen

- Der Tab Gesamt enthält weiterhin nur Flug-/Kreuzfahrtserien und deren
  Domänenkarten; Unterkunft und Ort heißen dort „keine Daten“. Das widerspricht
  den neuen Detailtabs mit festen Beispieldaten.
- Die neuen Zahlen sind fest im HTML-Skript hinterlegt. Eine Zeitraumwahl
  beweist noch keine Filterung der Kennzahlen und Diagramme.
- Vergleich und ausblendbare Abschnitte müssen ein gemeinsames Bedienmuster
  erhalten. Das Abschnittsmenü ist im Export bislang nur für Flüge vorgesehen.
- Die dokumentierte Zielroute `/stats?tab=lodging` und der interne Prototyp-Key
  `hotel` müssen bei der Anbindung an bestehende Routen korrekt zugeordnet werden.

### Einordnung des inzwischen weiterentwickelten Produktcodes

Beim Archivieren wurde der Umsetzungsbericht auf `dev/design-system`
gelesen, zuletzt Commit `23b2736e` im lokalen Worktree und auf Forgejo.
Die folgenden Angaben sind aus diesem Bericht beziehungsweise dem Commitlog
übernommen und wurden in dieser Archivierungsrunde nicht erneut im Browser getestet:

- `4d4d7753` dokumentiert: Der Produkt-Tab Gesamt berücksichtigt bereits alle
  vier Domänen. Im dortigen Testdatensatz lagen Unterkünfte in 2024; die
  Gesamtansicht für 2026 zeigte sie folgerichtig nicht.
- Die drei Bereichsreiter zeigten dagegen Lebenszeitdaten. Unterschiedliche
  Zeiträume können so den Eindruck fehlender Domänen erzeugen.
- `23b2736e` ergänzt die Jahresfilterung für Cruise- und Lodging-Rollups.
  Eine gemeinsame Frontend-Zeitraumsteuerung war bei der Sichtung in Arbeit.
- Der Bericht hält die gemeinsame mobile Zeile als Block A sowie weitere
  Fortschritte an Shell und Dialogen fest. Die exportseitigen Mängel dürfen
  deshalb nicht ungeprüft als aktuelle Produktfehler gemeldet werden.

**Abnahmeziel:** Alle fünf Statistik-Tabs verwenden denselben Zeitraum und
Vergleichsbezug. Summen, Ranglisten, Diagramme und erläuternde Datenbasen passen
zusammen. Alle Jahre, ein Jahr ohne Daten, domänenspezifisch fehlende Daten und
deaktivierte Domänen werden ausdrücklich geprüft. Kein Datum ist nicht null;
fehlende Kosten oder Bewertungen werden mit ihrer Berechnungsbasis kenntlich.

## Empfohlene Umsetzungsreihenfolge

1. Laufenden Design-Branch und vorhandene Komponenten/Verträge abgleichen.
2. Shell, mobile Zeilen, Detailköpfe, Formulare, Dialoge und Speicherzustände
   als gemeinsame Bausteine vervollständigen.
3. Statistik-Zeiträume und Vergleich über alle fünf Tabs durchziehen.
4. Kartenvariante 2, Karten-Sheets, Settings-Routen, Tags/Mitreisende und
   Jahresrückblick entsprechend dem festgehaltenen Umfang umsetzen.
5. Restliche Seitenfamilien, Rollen, Gates, DE/EN und responsive Zwischenstufen
   anhand der Matrix prüfen; offene Punkte mit tatsächlichem Nachweis schließen.

## Archivierung und Grenzen dieser Lieferung

- Der öffentliche Export enthält 71 Quelldateien plus `SOURCE.json` mit
  Prüfsummen. Eine interne IPv4-Adresse in Admin v2 wurde durch eine
  Dokumentationsadresse ersetzt; diese Änderung ist im Manifest vermerkt.
- Die Original-Uploads und die Thumbnail-Datei des Designpakets gehören zum
  unveränderten Original-ZIP im privaten Repo `TravStats-local`, unter
  `design-archive/2026-09-15/`. Dort liegt auch das ursprüngliche Handoff-ZIP.
- Der ursprüngliche Gesamtauftrag mit seinen acht Referenzbildern liegt
  zusätzlich als lesbare Kopie neben diesem Review.
- Die exportseitigen Designmängel bleiben im archivierten Snapshot sichtbar.
  Dieses Review enthält den Korrekturauftrag; es behauptet keine Reparatur.
- Diese Lieferung enthält keine Produktimplementierung und kein Deployment.
  Laufende Arbeiten anderer Sessions bleiben ihrem jeweiligen Branch zugeordnet.
