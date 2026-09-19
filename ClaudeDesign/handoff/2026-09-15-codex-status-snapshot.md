# Historischer TravStats-Statuscheck vom 15.09.2026

## Geltungsbereich

Dies hält die erste Statusauskunft dieser Unterhaltung fest. Der Code wurde
danach weiterentwickelt. Branchstände, Releaseangaben und Instanzversionen
sind Momentaufnahmen dieser ersten Prüfung und vor neuen Entscheidungen
erneut zu ermitteln. Der [Design-Review](2026-09-15-codex-design-review.md)
enthält die spätere Einordnung der Statistik-Arbeiten.

## Damals direkt geprüft

- Hauptarbeitsverzeichnis: `chore/deps-2026-09-14 @ 0a1f9c5f`, mit bereits
  vorhandenen lokalen Änderungen an der zentralen Zod-/OpenAPI-Initialisierung.
- `main @ 94a24d7e` entsprach damals den Remotes. `fix/audit-round-2 @ e257f98a`
  lag 34 Commits davor und war noch nicht in main integriert.
- Beta lieferte Health HTTP 200 und Version `2.7.0-design.3`.
- RC lieferte Health HTTP 200, Version `2.6.3`, Build `2.6.3-rc.1`.
- Das damals letzte öffentliche finale GitHub-Release war 2.6.2;
  `v2.6.3-rc.1` existierte als Tag. Prod wurde nicht geprüft.
- TypeScript-Prüfung mit `tsc --noEmit --incremental false` bestand für
  Backend und Frontend. Unit- und Integrationstests wurden in dieser Runde
  nicht ausgeführt. Es gab keine Produktänderung und kein Deployment.

## Aus Commitverlauf und Audit-Unterlagen festgehaltene Fixes

- In main lagen zahlreiche Auth-/Session-/2FA- und Ownership-Korrekturen,
  Schutz vor fremden Reiseverweisen sowie Fixes für Reise-Löschen/-Zusammenführen,
  Datums-/Zeitfälle, Import, Preise, Aufenthalte und Einstellungen.
- `94a24d7e` verdrahtete WebDAV-Uploads nach Backup-Erstellung für manuelle,
  geplante und Import-Sicherungsbackups. Uploadfehler sollten lokale Backups
  erhalten. Retention blieb als eigener offener Punkt dokumentiert.
- Audit-Runde 2 enthielt weitere Fixes für Backup-Locks nach Restore,
  gebundene Integrationsschlüssel, Statistiken, Geo/FX, POIs, Kreuzfahrten,
  Flugvorschläge, Editoren und UI. Manche Issue-/Kampagnenstände hinkten den
  späteren Commits hinterher.
- Der Multer-Fall AUD-097 war im Dependencies-Branch behandelt.
- Beim Zod-4-Umbau war der importbedingte Fehler `.openapi is not a function`
  relevant. Eine zentrale lokale Initialisierung samt Regressionstest war
  vorhanden, aber damals noch uncommitted. Der behauptete Red/Green-Lauf
  stammte aus der vorhandenen Dokumentation, nicht aus einer neuen Testrunde.

## Damals offene beziehungsweise noch nicht freigegebene Punkte

- Parser-AUD-050: mehrere Buchungen desselben Hotels in einem Dokument.
- Parser-AUD-056: heuristische Hotelzuordnung ablehnen/korrigieren.
- Parser-AUD-057: fehlende Währungen, unter anderem AED/KWD.
- FR24-Golden-Fixture: erwartet acht unmittelbar nutzbare Zeilen, tatsächlich
  fünf nutzbare plus drei Problemfälle; als erwarteter Testfehler dokumentiert.
- Im Verlauf zu `e257f98a` waren 103 E2E-Fälle mit 79 bestanden und 24
  übersprungen dokumentiert. Das war ein historischer Lauf, keine neue Prüfung.

## Companion

Der damalige Stand `a0c2dc7` auf `fix/sheet-drag-on-device` enthielt unter anderem
Korrekturen an Kontogrenzen, Warteschlange/Löschen, Datumsvalidierung,
Preiserfassung, Hotelnächten, Kreuzfahrthäfen, Pagination/Statistiken,
Offline-Karten und Einstellungen sowie Passport-Vertrag und Tokenwiderruf.

Die frühere Geräteprüfung mit 59 Fällen (48 bestanden, 11 fehlgeschlagen)
betraf eine alte installierte APK 0.1.0 und Server 2.6.0. Sie belegte keine
Abnahme der neuen Commits. Dafür war ein neuer Build mit Geräteprüfung nötig.

## Einordnung beim späteren Archivieren

Beim Archivieren stand der lokale Hauptbranch bereits bei `da708147`, und der
Design-Worktree bei `23b2736e`. Die oben genannten offenen Fälle und
Merge-/Releasezustände dürfen deshalb nicht als aktueller Gesamtstatus
übernommen werden. Auf dem Design-Branch läuft die Umsetzung des Handoffs;
das neue Review trennt die Paketbefunde von dieser Weiterentwicklung.
