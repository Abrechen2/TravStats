# TravStats – Auditbericht

**Prüfabschluss: 13.09.2026.** Analyse, Reproduktionen, automatische Tests und lokale UI-Prüfung sind für die unten ausgewiesenen Prüfstände konsolidiert. Das Ergebnis ist **keine Freigabe zum Ausrollen**: Es bestehen bestätigte Sicherheits-, Daten- und Funktionsfehler trotz grüner Unit-/Integrationstests. Anwendungscode, Nutzerdaten und laufende Homelab-Instanzen wurden durch diesen Audit nicht verändert; keine Commits oder Deployments vorgenommen.

## Wichtigste noch relevante Befunde

| Priorität | Befund | Auswirkung / nächster Korrekturschritt |
| --- | --- | --- |
| P1 | **AUD-087** – Immich-/Dawarich-Verbindungstest | Ein normaler angemeldeter Nutzer kann gemeinsame Provider-Schlüssel an ein selbst gewähltes Ziel senden lassen. Ziel und verwendete Credential-Quelle gemeinsam autorisieren. Mit eigenen lokalen Empfängern und synthetischen Schlüsseln belegt. |
| P1 | **AUD-097** – Multer 2.2.0 | Eine kleine authentifizierte Uploadanfrage erzeugt unter Linux/Node 22 eine unbehandelte Ausnahme und damit einen App-Ausfall. Korrigierte Parser-Version einsetzen und auf der Containerlaufzeit gegenprüfen. |
| P1 | **AUD-069** – Restore-/Backupzustand | Erfolgreicher Restore stellt einen laufenden Backupzustand wieder her und blockiert weitere Backups. Restoreabschluss und wiederhergestellte Jobzustände sauber abgleichen. |
| P1, teilweise korrigiert | **AUD-050** – Buchungsbeträge | Bei zwei Buchungen desselben Hotels im selben Dokument bleibt eine falsche Summenzuordnung: 100/500 EUR werden zu 100/100 EUR. Preise an die konkrete Buchung binden. |
| P2 | **AUD-092–095** – Flugvorschläge | Überschreiben späterer Nutzeränderungen, fehlende Chronologieprüfung, erneutes Bearbeiten mit 500 und verschobene UI-Zeiteingabe. |
| P2 | **AUD-099–102** – letzte Integrationsprüfung | Hotelcheck-in an UTC-Tagesgrenze fehlt in Upcoming; AirLabs verliert Nutzerkontext; OpenSky-Basic-Feldnamen passen nicht; OAuth-Cache verwechselt externe Konten. |
| P2/P3 | **AUD-096/098/103** – UI und Testaussage | Barrierefreiheitslücken, ohne Aktion bestehende E2E-Gerüste und abgeschnittene mobile Formularschaltfläche. |

Details, Auslöser, genaue Beleggrenzen und Verbesserungen stehen in [FINDINGS.md](FINDINGS.md). Das Register enthält **103 historische IDs**, **nicht 103 aktuell offene Fehler**. Viele frühere Befunde sind bereits durch fremde Änderungen korrigiert. Maßgeblich ist [FIX_REVIEW.md](FIX_REVIEW.md); dort sind unter anderem die korrigierten Restore-/Mergefälle, bewusst zurückgestellten Altgrenzen und nur teilweise korrigierten AUD-050/056/057 getrennt aufgeführt.

## Abschließende Prüfungen

Neuester fest eingefrorener Stand: **39715ec56d3879723af4e0ab4c98bd1d997a971f**. Beide Dependencyverzeichnisse sind physisch isoliert; PostgreSQL/PostGIS läuft ausschließlich als eigene lokale Wegwerf-Testinstanz.

| Prüfung | Ergebnis |
| --- | --- |
| Vollständige Backend-Suite | **4.274 bestanden, 0 fehlgeschlagen, 11 übersprungen**; 492 bestandene/2 übersprungene Dateien, 790,616 s, nativer Exit 0 |
| Vollständige Frontend-Suite | **3.710 bestanden, 0 fehlgeschlagen**, 433 Dateien, nativer Exit 0 |
| Gesamtzahl dieser beiden Suiten | **7.984 bestandene Tests**; eigene Reproduktionen und frühere Nachläufe nicht hinzuaddiert |
| Backend-/Frontend-Typecheck | Beide Exit 0 |
| Backend-/Frontend-Projektlint | Beide Exit 0; Backend drei ungenutzte Imports als Warnungen |
| Frontend-Produktionsbuild | Exit 0, 28,11 s; Größenwarnungen für große Chunks |
| Dateigrößengate | Exit 0, 1.149 Quelldateien, 20 bestehende Baseline-Ausnahmen |
| npm audit | Root 0, Backend 4, Frontend 15 Paketmeldungen; konkrete Erreichbarkeit separat in [DEPENDENCIES.md](DEPENDENCIES.md) bewertet |
| Unveränderte Projekt-E2E auf 9678e6cd | **69 bestanden/33 fehlgeschlagen**, 102 Fälle in drei Engines; Aussageproblem AUD-098 |
| Eigene Browserprüfungen auf 9678e6cd | Navigation in drei Größen, mobile Anlegeabläufe, Bearbeiten/Löschen, CSV-Import und gezielte Negativfälle; Details in [UI_REPORT.md](UI_REPORT.md) |
| Restore unter Linux auf 9678e6cd | Eigener vollständiger DB-/Dateiroundtrip, sieben Dateiordner bytegenau, SQL-Fehler mit Rollback; neue Zustandsblockade AUD-069 separat bestätigt |

Die **11 Backend-Skips** sind zehn Tests mit privaten, nicht in die Auditkopie übernommenen Buchungsbelegen und ein unter Windows übersprungener Dateirestoretest. Der eigene Linux-Restorebeleg ergänzt letzteres, ändert aber den Projekt-Skip nicht in „bestanden“. Es wurden keine privaten Belege oder echten Secrets ungefragt gelesen. Testidentitäten und Zahlen sind in `block18-validation.json` maschinell abgeglichen.

Die früheren roten Backendläufe mit unvollständigen eigenen Katalog-/Konfigurationsvorbedingungen bleiben unverändert dokumentiert. Ihre gezielten Nachläufe wurden einzeln abgeglichen. Der **abschließende Lauf 39715ec5 ist eigenständig vollständig grün**, daher braucht dieses Endergebnis keine Addition verschiedener Wiederholungen.

## Prüfumfang und Aussagegrenzen

Inventar, statische Gates und automatische Projekttests erfassen das gesamte Projekt. Die manuelle Quellenprüfung und eigenen Gegenproben konzentrieren sich auf Authentifizierung/Rechte, Datenzugriff, Flug-/Reise-/Hotel-/POI-/Cruise-Logik, Zeiten/Währungen, Import/Parser, Integrationen/Jobs, Backups und wesentliche UI-Abläufe. Die tatsächlich vollständig beziehungsweise teilweise gelesenen Dateien und ausgeführten Fälle stehen in [COVERAGE.md](COVERAGE.md). Das ist keine Behauptung eines manuellen Zeilenreviews sämtlicher 1.149 Quellen oder einer Prüfung jeder möglichen UI-Kombination.

Die Fix-Nachprüfung wurde wegen paralleler fremder Änderungen mehrfach auf feste Commits getrennt. Laufzeitbefunde bis AUD-098 und die breite Browserprüfung beziehen sich überwiegend auf **9678e6cd**; neue Upcoming-/Providerproben und abschließende Gesamttests auf **39715ec5**. Der letzte Versionsvergleich enthält keine Korrektur der oben als weiter relevant genannten P1-Pfade. Unbestätigte Randfallideen werden nicht als weitere Fehler gezählt; insbesondere die dokumentierte Unique-Statistik-Semantik wird nicht mit einer neuen ungeprüften Regression gleichgesetzt.

Externe Provider wurden bei Fehlerreproduktionen lokal ersetzt. Ausgenommen sind die ausdrücklich erlaubten öffentlichen UI-Asset-Hosts. Kein Live-Test mit echten Flug-API-, Immich-, Dawarich-, Mail- oder WebDAV-Zugängen; keine Produktions-, Last- oder Cluster-Ausfalltests. Die Linux-Multerprobe ist gezielt belegt, die komplette Backend-Suite lief unter Windows/Node 24.

## Artefakte und Umgebung

Maßgebliche Rohberichte: `block18-current-backend-full.json`, `block17-current-frontend-full.json`, `block17-e2e-production.json`, `block18-validation.json`; spezifische Reproduktionen sind bei jeder Befund-ID verlinkt beziehungsweise benannt. Frühere fehlerhafte eigene Prüfaufbauten sind ausdrücklich als solche gekennzeichnet.

Die eigenen UI-Listener **13017, 13018, 13019 und 18017** wurden über ihre vorgesehenen lokalen Shutdown-Endpunkte geschlossen und anschließend ohne Listener vorgefunden. Der eigene Audit-DB-Container `travstats-audit-block12-20260913` bleibt mit synthetischen Daten auf Loopback-Port **55439** bestehen; keine Container oder Datenbestände gelöscht. Alle Test-/Browserläufe sind beendet. Mögliche verbleibende interne Timer der beendeten UI-Listener werden nicht mittels Prozesskill beseitigt. Bestehende Entwicklungs- und Homelab-Dienste bleiben unangetastet.
