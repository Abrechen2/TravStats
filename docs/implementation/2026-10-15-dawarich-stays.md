# Dawarich-Aufenthalte: unabhängige Nutzung und klare Zustände

## Ziel

Die vorhandene Erkennung aus eigenen Dawarich-Daten wird vervollständigt,
keine zweite Erkennung angelegt. Prod ist davon zunächst unberührt.
Ein Vorschlag bleibt eine Vermutung; nur die Bestätigung schreibt einen Besuch.
Die Quelle ist Dawarich, nicht automatisch GPS: importierte Fotopositionen können
in derselben Historie liegen. Keine neue externe Geocoding-Datenweitergabe.

## Verhalten bei unterschiedlicher Nutzung

| Konfiguration | Verhalten |
| --- | --- |
| Nur Dawarich | Eigene Verbindung und eigene Einwilligung genügen. Immich wird nicht benötigt oder aktiviert. |
| Nur Immich | Unveränderter Foto-Scan; Dawarich bleibt aus. |
| Beide Quellen | Bereits erfasste Besuche am gewählten Ort und im passenden Zeitraum werden bei der Bestätigung wiederverwendet, unabhängig von ihrer Quelle. Separate ausstehende Foto-Vorschläge werden nicht ohne Prüfung zusammengeführt. |
| Keine Reise | Vorschläge und Bestätigung ohne Reise sind möglich. Es wird keine Reise erzeugt. |
| Überlappende Reisen | Keine automatische Auswahl. Bei nur teilweise abgedecktem Aufenthalt ebenfalls manuelle Zuordnung. |
| Flüge/Hotels/Bahn usw. aus | Keine Voraussetzung für die Aufenthaltserkennung; daraus werden keine Buchungen oder Übernachtungen abgeleitet. |
| Orte ausgeblendet | Automatische und manuelle Scans pausieren vor dem Abruf. Einwilligung und vorhandene Vorschläge bleiben erhalten; bestehende Daten und bewusste manuelle Prüfung bleiben über die API zugänglich, wie bei der Orte-API. Wiederaktivierung von Orte setzt die bereits eingewilligte Automatik fort. |
| Verbindung entfernt/nie gespeichert | Keine neuen Scans; klare Erklärung. Vorhandene Vorschläge bleiben prüfbar. Gemeinsame Server-Zugangsdaten ersetzen keine eigene Verbindung. |
| Einwilligung widerrufen | Keine neuen Vorschläge, auch nicht aus einer noch laufenden Anfrage. Wiedereinschalten verwirft jede alte Reservierung. |
| Keine/wenige/alte Punkte | Kein erfundener Besuch. Neuester gelieferter Punkt und Datenalter werden getrennt vom erfolgreichen technischen Abruf angezeigt. |
| Begrenzte Antwort/Ausfall | Teilweise/fehlgeschlagen bleibt sichtbar; frühere Belege und Datenstände werden nicht gelöscht. |
| Mehrere Orte in 100 m | Keine automatische Ortsauswahl; Namen und Koordinaten bedürfen der Prüfung. |

## Umsetzung und Prüfkriterien

- Eine serverseitige Scan-Voraussetzung für manuelle Scans und Scheduler,
  mit erneuter Prüfung nach dem Abruf und atomarer Prüfung vor dem Schreiben.
- Eigener Pausengrund sowie nächster Termin in der bestehenden Statusantwort;
  Anzeige in Profil-Zeitzone. Keine Behauptung einer nächtlichen Auswertung:
  der Scheduler läuft 00:15/06:15/12:15/18:15 UTC.
- Kein veraltetes Scan-Ergebnis als aktuelle Daten ausgeben. Ohne Punkte,
  mit mehr als 24 Stunden alten Daten und bei deaktiviertem Orte-Bereich
  unterschiedliche Hinweise anzeigen.
- Keine automatische Reisezuordnung, wenn nur ein Teil des Aufenthalts
  in deren lokalen Kalendertagen liegt. Mehrdeutigkeit ausdrücklich markieren.
- Robuste Positionsmittelung an der Datumsgrenze und keine ungültigen
  Geschwindigkeiten als stationäre Belege zählen.
- Regressionstests für Teilnutzung, Datenschutz/Einwilligungswechsel,
  Grenzen und Mehrdeutigkeit, bestehende Besuchs-Wiederverwendung sowie UI.

## Bewusste Grenzen

Keine automatische Übernahme oder nachträgliche Änderung akzeptierter Belege.
Keine Annahme, dass ein Aufenthalt an einem Hotel eine Übernachtung belegt.
Keine Bezeichnung unbekannter Koordinaten als konkret besuchtes Restaurant oder
Sehenswürdigkeit. Verschiedene Quellen behalten ihre eigenen Rohbelege; ein
bestätigter gemeinsamer Besuch kann von mehreren Vorschlägen referenziert werden.
Ein Zeitfenster von sieben Tagen ist kein vollständiger historischer Import.

## Validierung

- 24 Dawarich-Integrationsprüfungen mit einer neuen lokalen PostgreSQL-Testdatenbank und ausschließlich synthetischen Nutzern/Positionen bestanden.
- 30 zusätzliche Backend-Prüfungen bestanden: Erkennungsgrenzen, UTC-Termine,
  Scheduler und bestehende Immich-Besuchsübernahme.
- 28 Frontend-Prüfungen bestanden, einschließlich des gemeinsamen Posteingangs.
- Backend-Typprüfung bestanden; wegen extern verknüpfter lokaler Abhängigkeiten
  mit `tsc --noEmit --preserveSymlinks`, ohne Änderungen an produktivem TypeScript-Code für diesen Umgebungseffekt.
- Frontend-Typprüfung mit `tsc --noEmit` bestanden.
- Test-Typprüfung: 1.191 Backend-Testdateien, keine Fehler.
- Lint der geänderten produktiven Dateien und Frontend-Tests sowie Dateigrößenprüfung bestanden.
- Die vorhandenen Backend-Integrationstests benötigen weiterhin den etablierten
  Jest-Parameter `--forceExit` wegen offener Handles. Serialisierungs-Konflikte
  werden im Parallelannahme-Test absichtlich ausgelöst und erfolgreich behandelt.
- Keine Änderung am Datenbankschema und keine neue Migration erforderlich.
  Kein Deployment, kein Neustart und keine Änderungen an Prod-Einstellungen.
