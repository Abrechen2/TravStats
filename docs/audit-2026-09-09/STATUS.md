# TravStats – vollständige Codeprüfung (nur Analyse)

## Auftrag und Grenzen

Auftrag vom 09.09.2026: gesamten Code gewissenhaft auf Fehler, Logikprobleme, Sicherheitsrisiken, Best-Practice-Verstöße, UI-Probleme und fehlende Funktionalität prüfen. Zuerst planen, schrittweise arbeiten, Fortschritt und Befunde sofort dauerhaft festhalten. Keine Fehler beheben und keinen Anwendungscode ändern. Neue Dateien in diesem Auditverzeichnis dienen ausschließlich der gewünschten Dokumentation. Keine Commits, Deployments, Nachrichten an Dritte oder Änderungen an Nutzerdaten.

Ausgangsstand: `ef62a8f8ba1817a2df03c96451eb806d95aa4102`. Vorhandene Änderung: `CLAUDE.md`; SHA-256 zu Beginn `210C9979146EA9728EF0F094F3CE31DFF4AD44A46392200C76466BD36A6AE1ED`. Diese Änderung gehört dem Nutzer und bleibt unangetastet.

**Parallelbearbeitung:** Nutzer meldet während Block 5, dass Claude bereits Befunde korrigiert. Arbeitsverzeichnis inzwischen auf HEAD `2f89bfd120a0253abd0a33a00a475459f009867d` mit laufenden Änderungen an Auth/Testdateien. Ab jetzt alle Quellprüfungen und Reproduktionen ausdrücklich auf der eingefrorenen Auditkopie des Ausgangscommits. Zeilen/Befunde beziehen sich auf diesen Stand, nicht automatisch auf Claudes zwischenzeitliche Korrekturen. Keine Fremdänderungen anfassen; keine bereits behobenen Fehler ohne separate Nachprüfung als weiterhin vorhanden behaupten.

## Prüfplan

| Phase | Inhalt | Status |
| --- | --- | --- |
| 1 | Inventar aller versionierten Dateien, Architektur/Aufrufketten, vorhandene Prüfungen, sichere Prüfbedingungen | läuft |
| 2 | Backend: Einstieg, Authentifizierung, Rechte, Datenzugriff, API-Verträge, Validierung, Fehlerbehandlung | läuft; Auth geprüft, übrige Bereiche offen |
| 3 | Datenmodell/Migrationen, Reise- und Statistiklogik, Datum/Zeitzonen, Währungen, Duplikate, Transaktionen | offen |
| 4 | Parser/Import/Export, Integrationen, Hintergrundjobs, Backups, Initialisierung und Betrieb | läuft; Backup vertieft |
| 5 | Frontend: Navigation, Zustände, Formulare, Datenkonsistenz, Barrierefreiheit, mobile Darstellung, visuelle Prüfung soweit lokal möglich | offen |
| 6 | Tests/CI/Abhängigkeiten, Gegenprüfung aller Befunde, Priorisierung und Abschlussbericht mit tatsächlicher Prüfabdeckung | offen |

## Vorgehen und Belegstandard

- GitNexus zur konzeptionellen Navigation und zum Nachverfolgen von Aufrufketten; Quelldateien entscheiden über einen Befund, nicht Suchtreffer allein.
- Jeden belegten Befund zeitnah in `FINDINGS.md` eintragen: ID, Priorität, Status, Datei/Zeile, Auslöser, Auswirkung, Beleg, Verbesserung, Prüfbedarf.
- P0 = unmittelbar kritischer Schaden; P1 = schwerwiegender Funktions-/Sicherheits-/Datenfehler; P2 = begrenzter Fehler bzw. relevantes Qualitätsproblem; P3 = kleineres Problem/Verbesserung.
- Bestätigte Fehler, bedingte Risiken, Verbesserungsvorschläge und noch ungeprüfte Hypothesen unterscheiden. Keine spekulativen Sicherheitsbehauptungen.
- Tatsächliche Abdeckung in `COVERAGE.md` dokumentieren. Inventar/Suche, vollständige Quellprüfung und Laufzeitprüfung nicht gleichsetzen. Generierte Dateien, Datenbestände und Fremdcode ausdrücklich gesondert behandeln.
- Prüfkommandos zuerst auf Nebenwirkungen untersuchen. Backendtests löschen teils ganze Tabellen: niemals gegen die vorhandene Entwicklungs-/Nutzerdatenbank ausführen. Keine geheimen Konfigurationen oder personenbezogenen Beispielfiles ins Audit kopieren.
- Nach jedem Arbeitsblock Status, Befunde und nächsten konkreten Einstieg aktualisieren. Nach Kontextwechsel zuerst dieses Dokument, dann Befunde/Abdeckung lesen und an der nächsten offenen Stelle fortsetzen.

## Laufendes Arbeitsprotokoll

### Block 1 – Vorbereitung

- Projektregeln gelesen; keine untergeordneten `AGENTS.md` gefunden.
- GitNexus-Skills `gitnexus-exploring`, `gitnexus-debugging`, `gitnexus-cli` vollständig gelesen.
- Repository umfasst 2.908 versionierte Dateien. React/TypeScript/Vite im Frontend, Express/TypeScript/Prisma/PostgreSQL im Backend. Produktziel laut README: selbst betriebenes Reisetagebuch für 1–10 Nutzer.
- GitNexus meldet zwei Commits Rückstand. Bestehende Embeddings: 0. Aktualisierung mit `npx gitnexus analyze --skip-agents-md` vorgesehen; dieser Schalter schützt die vorhandenen Anweisungsdateien.
- Root-/Frontend-/Backend-Paketskripte, Jest-/Vitest-/Playwright-Konfiguration und CI-Workflow gelesen.
- Backend-Jest benötigt PostgreSQL und enthält destruktive Testbereinigung. Tests erst bei nachgewiesen isolierter Testdatenbank starten.
- CI dokumentiert bereits bekannte Probleme; diese gelten noch nicht als in diesem Audit bestätigt.

## Nächster konkreter Einstieg

### Block 11 – laufende Fortsetzung, 11.09.2026

Nutzer: „mache weiter mit den tests“. Haupt-HEAD unverändert `c824ea3b`, keine neuen Implementierungsantworten. Prüfung weiter ausschließlich auf `.tmp/audit-fixes-20260910`; beide Dependencyverzeichnisse sind physisch isoliert. Vorheriger Auditcontainer existiert nicht mehr. Neuer eigener Container `travstats-audit-block11-20260911` mit tmpfs und Loopback-Port 55439 angelegt; 132 Migrationen erfolgreich. Neue Datenbanken `travstats_block11_audit` (Tests, Kataloge neu gesät) und `travstats_block11_probe_audit` (eigene synthetische Proben, vom leeren migrierten Schema geklont). Keine Dev-/Homelab-/Nutzerdatenzugriffe, keine Neustarts. Anwendungscode bleibt unverändert.

Prüfung: Geocoding-/Website-/Hotelkettenpfad, FX-Provider/Datum/Cache/Timeout. Aktueller Backend-Gesamtlauf gestartet; Ergebnis noch offen. Neue Befunde erst nach Gegenprobe, nächste ID 061.

### Aktueller Einstieg nach Block 5 (dieser Abschnitt hat Vorrang vor älteren Schritten)

Abschlusskontrolle Block 10: `git diff --check` ohne Fehler (nur LF/CRLF-Hinweise); 60 eindeutige Befundüberschriften, keine doppelte ID. Aktuelle Fix-UI-Ports 18010/13010 frei. Ältere eigene Baseline-UI-Prozesse laufen noch auf 18009 (PID 56800) und 13009 (PID 54628); wegen inzwischen verschwundener alter Auditdatenbanken nicht ungeprüft wiederverwenden. Sie wurden in diesem Block weder verändert noch gestoppt.

**Checkpoint nach Block 10 – maßgeblicher aktueller Stand (10.09.2026):** Befundregister **AUD-001–060**, davon **11 neue am aktuellen Stand reproduzierte Befunde AUD-050–060**. HEAD weiterhin `c824ea3beff13121a387e0e55f1584f8c6dfdb28`; nur Auditdokumentation/-ergebnisse geändert, keine App-Fixes/Commits. Zusammenfassung: dokumentweite Summenübernahme/Währungsverwechslung (050), String-null als Gratispreis (051), Template-Dezimalpunktverfälschung (052), verneintes Frühstück positiv gelesen (053), nichtlateinische Namen kollidieren (054), reihenfolgeabhängiger Preview→Commit (055), falscher Match in UI nicht ablehnbar (056), Preisnachtrag ohne Währung verschwindet (057), Parserdeadline/Antwortabbruch (058), CSV-Koordinaten mit 3 Dezimalstellen (059), CSV verliert 0,5-Sternwerte (060). Belegumfang und Einschränkungen je Befund in FINDINGS; Fixstatus getrennt in FIX_REVIEW.

**Aktuelle Checks/Umgebung:** 9 ausgewählte Backend-Testdateien mit 106 Pass/9 privaten Sample-Skips; 5 Frontend-Testdateien mit 76 Pass. Beide Prozesse Exit 0, Backend-Session `43783` abgeschlossen. Eigene Kurzproben/Browser/HTTP-Stubs beendet. Aktuell eigener DB-Container **`travstats-audit-block10-20260910`**, tmpfs, `127.0.0.1:55439`, **`travstats_fixes_probe_audit`**, User/Passwort `travstats_audit` / `audit-only-local-20260909`; 132 aktuelle Migrationen erfolgreich. Alte Container/DBs waren nicht mehr vorhanden; frühere UI-Accounts/-Cruise-IDs daher nicht voraussetzen. Quellen unverändert `.tmp/audit-fixes-20260910`, physisch isolierte Dependencies. Bei JEDEM Backend-Node-Aufruf explizite eigene DATABASE_URL/NODE_ENV/JWT_SECRET/ENCRYPTION_KEY setzen; auch vermeintlich reine Helfer können DB importieren. Keine Tests parallel mit eigenen DB-Proben auf derselben DB.

**Nächster konkreter Plan (Block 11):** (1) HEAD/ANTWORT und neue Fixdateien abgleichen, nicht historische Fehler als heute offen pauschalisieren. (2) `services/lodging/geocodeBackfill.ts`, `chainFromWebsite.ts` und Location-/Google-/Websitekette vollständig quellenprüfen; lokal stubben, keine realen Zugangsdaten/Anfragen. (3) FX-Kurs-/Datums-/Cache-/Timeoutverträge mit kontrollierten Providerantworten prüfen; bisher nur Quellen gelesen, noch kein neuer bestätigter FX-Befund außerhalb 043/049. (4) Buchungsreferenzen mehrerer Anbieter und CSV-/Maps-/Mapping-UIparität weiterverfolgen. `lodgingCsv.ts` (614 Zeilen), Bookingparser (490), Previewmodal (506), MappingSuggestion (400) und die in COVERAGE genannten Helfer sind vollständig gelesen, nicht neu starten. Untere alte Einstiege nur historisch. Eigener Restore-Roundtrip, große Statistik-/POI-/Cruise-/Job-/Integrationsbereiche und vollständiger Gesamtaudit bleiben offen. Letzte ID 060; neue Findings ab 061.

**Block 10 fortgesetzt, 10.09.2026:** HEAD unverändert `c824ea3b`. AUD-050/051 neu mit echtem Parser und lokalem Ollama-Stub bestätigt: dokumentweite Summenübernahme ohne Buchungs-/Währungsbindung, numerische Nullstrings als 0. Frühere Auditcontainer/DBs sind nicht mehr vorhanden (Dockerinventar geprüft); neuer eigener Container `travstats-audit-block10-20260910`, tmpfs, ausschließlich `127.0.0.1:55439`, DB `travstats_fixes_probe_audit`, dieselben synthetischen Zugangsdaten. 132 Migrationen frisch erfolgreich. Keine frühere Testfixture/Accounts als noch vorhanden annehmen. GitNexus-CLI zweimal „Already up to date“, MCP-Übersicht weiterhin alter Cache; Quelldateien maßgeblich. Nächste Proben: Preview→Commit-Zeilenreihenfolge, Unicode-Namen, Templatepreisformate und UI-Auflösung eines falschen Matchvorschlags. Keine Anwendungscodeänderungen.

**Neuer Prüfblock 10, Fortsetzung nach AUD-049:** Nutzer „dann weiter“. Haupt-HEAD noch `c824ea3b`, keine neuen App-Fixes im Worktree. Neue Quellprüfung auf `.tmp/audit-fixes-20260910` (2.6.3), bestehende unabhängige Backend-/Frontend-Dependencies verwenden. GitNexus-Exploring/-Debugging erneut vollständig gelesen; lokale Indexmetadaten passen zum Commit. Plan: (1) Lodging-Preview/Matching und Candidate-Vertrag vervollständigen, (2) Booking-/Dokumentparser und Normalisierung, (3) FX-Provider/Snapshot-Verträge, (4) relevante UI-Importkette und gezielte eigene Gegenproben. Findings erst nach Beleg, aktueller letzter Befund AUD-049. Restore-Roundtrip bleibt separat offen; keine Tests gegen Dev-DB, keine externen Parser-/Geocodinganfragen mit echten Daten.

**Abschluss Fix-Nachprüfblock, 10.09.2026:** Befundregister jetzt AUD-001–049. Haupt-HEAD unverändert `c824ea3b`. Vier neue aktuelle Befunde AUD-046–049: falsche Importdomäne bei Undo, Verlust nachträglicher Hotelfotos, erfundene Nachtpreiswährung, **neue Flugbatch-FX-Regression bei null-externalRef (100+500 → 500+500)**. AUD-043–045 am Fixstand erneut bestätigt. Unabhängige Ergebnisübersicht für alle IDs in `FIX_REVIEW.md`; nicht die historischen Befunde pauschal offen nennen.

Zusätzliche Restpunkte im Fixbericht: AUD-001 lokale Dev-DB-Ausnahme; AUD-008 alter HTTP-Zielparameter weiter verworfen (UI entfernt); AUD-014 Alt-Klartextwerte ohne erneutes Speichern weiter unlesbar; AUD-029 Mehrquellen-Fotoduplikate verursachen P2002-Rollback; AUD-030 Cover auf gelöschte Duplikatfoto-ID; AUD-037 Tab verlässt modalen Dialog. Dagegen eigene UI-Gegenproben AUD-015 (echtes Cold-Cruise-Detail) und AUD-035 (A2/B2 bei verzögertem PUT, final Server=Client=B2/Pending=false) erfolgreich. Aktuelle kleine Restore-Oberfläche passt; beide neuen Screenshots visuell geprüft.

**Umgebung für Fortsetzung:** Neue Fix-Backend-/Viteprozesse (Sessions `57382`/`57048`, PIDs `59064`/`53848`, Ports 18010/13010) nach Port-/PID-Prüfung gestoppt; alle Headless-Probeprozesse beendet. Eigener Auditcontainer und ältere Baseline-UI-Prozesse bleiben wie zuvor vorhanden. Fix-Datenbanken `travstats_fixes_audit` und `travstats_fixes_probe_audit` bleiben ausschließlich synthetisch im eigenen Container; letztere enthält Konto `audit-fix-ui` und synthetische Cruise-ID `309602a4-c984-4c6c-9435-a8bc02f34e4b`. Quelle `.tmp/audit-fixes-20260910`, getrennte physische Dependencies. Nächster Einstieg: HEAD/Antworten erneut abgleichen; eigene Restore-Roundtrips bzw. ungeprüfte Lodging-Preview/Parser/FX-Pfade. Vollständiger Gesamtaudit und aktueller Backend-Gesamtlauf bleiben offen. Keine Anwendungscodeänderungen/Commits.

**Neuester Stand der Fix-Nachprüfung:** `FIX_REVIEW.md` enthält Ergebnisse. 132 Migrationen auf zwei eigenen neuen DBs bestanden; beide Typechecks grün; Frontend 432 Dateien/3.686 Tests grün; Backend gezielt 26 Dateien/159 Tests grün, 1 Windows-Skip. Alle Kurztestprozesse beendet. Eigene Proben bestätigen AUD-043–045 auch in 2.6.3; neue AUD-046–048 sofort dokumentiert. Beide aktuellen node_modules-Verzeichnisse physisch isoliert. Noch offen: übrige Fix-Diffs (Flug-/Reise-/Trackdetails), eigener Restore-/kleiner UI-Gegentest, Guard-Nachprüfung und anschließender Gesamtaudit. Auditbasis und Fix-Nachprüfung nicht vermischen; kein vollständiger aktueller Backend-Gesamtlauf erfolgt.

**Fix-Nachprüfung, 10.09.2026:** Hauptstand jetzt `c824ea3beff13121a387e0e55f1584f8c6dfdb28` (2.6.3). `ANTWORT.md` vollständig gelesen; separate Bewertung in `FIX_REVIEW.md` begonnen. Laut Implementierung AUD-001–042 außer 009/010 korrigiert; diese Aussage noch nicht pauschal übernommen. Neue Prüfkopie/DB für aktuellen Commit vorbereiten. AUD-043–045 betreffen unveränderte Importdateien. AUD-002/004 in Antworttext verwechselt, stabile Register-IDs beibehalten. Der Gesamtaudit bleibt unvollständig.

**Aktuelle Nutzerergänzung:** „weiter, und es wurden schon sachen gefixed“. Deshalb als nächster Block zusätzlich einen getrennten Fixstatus gegen den aktuellen Hauptstand erheben; historische Bestätigung nicht als heutiges Offensein darstellen. Baselinebefunde bis AUD-045. Neue Importproben bestätigen FX-Betragscache, Namenszusammenlegung verschiedener Städte und umgekehrte Aufenthaltsdaten. Noch NICHT bestätigt: Undo akzeptiert fremde Domänen/entfernt nachträgliche Fotos. Die kombinierte Probe stoppte vor diesen beiden Fällen wegen eines eigenen Fixturefehlers (`Flight.batchId` heißt tatsächlich `importBatchId`), kein Produktbefund und keine zweite Client-Isolationsstörung.

**Jüngster Einstieg, Block 9:** AUD-001–041 dokumentiert. `routes/lodging.ts` und `schemas/lodging.ts` vollständig, Timing/Pricing und StayMembership vollständig geprüft. Neue bestätigte Fehler: fremde Trip-/Booking-/Membership-IDs akzeptiert (A-Aufenthalt erscheint in Bs Reise), Null-Datumsedit nutzt alte Ableitungswerte, Preisbildung ignoriert Präzision/explizite Nächte, Gesamtpreis 0 überschrieben. Alle Nachweise nur eigene Audit-API/-DB. Nächste Schritte: Unterkunftsmitgliedschaften/Photos/Geocode/Import und Shared Counting vervollständigen; spezifische Cold-Detail- und Settingsfolgen nach Bedarf. UI-Restore-Nachweis stabil neu aufgenommen (Dateien mit `before-scroll`/`after-scroll`); ursprünglicher leerer Übergangsscreenshot ist kein belastbarer Bildbeleg. Alle kurzlebigen Probesessions abgeschlossen.

**Block 8, jüngster Stand:** AUD-001–037 dokumentiert. Reise-/Tourblock einschließlich aller Routingadapter und Trackservices vollständig gelesen; `tripCountries.ts` und breit genutzte Schematic-/CruiseDistance-Helfer noch offen. Neue Bestätigungen: Micro-Cleanup, Storno statt Ersatzflug, GPX-Segmentbrücken, Rohdistanzverlust bei Trackadoption, Settings-In-flight-Save-Verlust, Profilverlust nach Kontowechsel und nicht scrollbar abgeschnittener Restore-Dialog bei 320×568. AUD-011 inzwischen UI-reproduziert. Tour-GET/Read-PAT-Verdacht durch reale 200-Gegenproben widerlegt. Keine symbolischen Korrekturen, keine Commits. Aktueller nächster Quellread: `backend/src/routes/lodging.ts` ab 201 (1–200 gelesen), danach Schema und Shared Timing/Pricing/Counting. Vollständige Gesamtprüfung weiterhin offen.

**Aktuell 10.09.2026, Block 8:** Fortsetzung auf unveränderter Auditbasis; eigener Container läuft weiter. AUD-028–030 sofort dokumentiert: Erkennungs-Cleanup löscht fluglose kuratierte Reisen einschließlich Tagebuch/Stopps; Merge entkoppelt Aufenthalte/POI und löscht Album/importierte Fotos; übernommenes Cover zeigt 404. Echte Express-/Prisma-Proben mit neuem synthetischen Konto, keine Nutzerdaten und kein externer Immich-Zugriff. Backendabhängigkeiten inzwischen unabhängig; alte Umgebungsstörung behoben. Nächster konkreter Einstieg: Micro-Trip-Kandidaten mit Hotel/POI/Album prüfen, anschließend `tripDetectionService.ts` 245–530 vollständig lesen und übrige Tour-/Geometrieservices prüfen. AUD-027 ist inzwischen ebenfalls tatsächlich reproduziert. Gesamtprüfung weiter offen.

**Aktualisierung Block 6/7:** Befunde inzwischen AUD-001–023. Flight-CRUD/Batch/Schemas vollständig gelesen; Tripsrouter und Tripschema vollständig gelesen, TripStatusService gelesen. Neue Hypothesen: Tripdatum-Edit ohne Statusneuberechnung (auch Sweep ignoriert eigene Daten und Lodging); Profile-Benutzername nur JSON statt echter Identität; Profilfelder ohne Labelzuordnung; geänderte TripStop-Koordinaten invalidieren bestehende Routelegs nicht. Reproduktion der ersten zwei wurde durch folgende Umgebungsänderung gestoppt, daher NOCH NICHT als Laufzeitbefund werten:

**Nachtrag 22:10 Uhr:** Abhängigkeitstrennung erfolgreich: ausschließlich geprüfte Backend-Junction per nichtrekursiver Directory.Delete entfernt, 30.035 Abhängigkeitsdateien/585 MB physisch in Auditkopie kopiert. Client dort aus Baselineschema regeneriert (Prisma meldet explizit lokale Audit-node_modules als Ziel). Wiederholungen jetzt erfolgreich; Reise-/Profilhypothesen sind AUD-024/025, Labelbefund AUD-026. Frontend-node_modules bleibt bisher Junction; Backendabhängigkeiten sind KEINE Junction mehr. Neue Moduleimporte gegen diese Kopie funktionieren wieder ohne `sessions_valid_from`-Fehler. Nächste offene konkrete Probe: Stopkoordinatenänderung vs. gespeicherte Legdistanz/Geometrie.

Claude hat den gemeinsamen generierten Prisma-Client verändert; ein neu gestarteter Auditprozess fordert jetzt `users.sessions_valid_from`, die alte Auditbasis/-DB hat diese Spalte nicht. Fehler am 09.09.2026 in Auditprobe, kein neuer Produktfehler. Bestehender UI-Backendprozess besitzt noch seinen vorher geladenen Client. Die Backend-node_modules-Junction wird jetzt nach expliziter Linkprüfung durch eine eigene physische Abhängigkeitskopie ersetzt; danach Prisma-Client ausschließlich in dieser Kopie aus der alten Auditschema-Datei regenerieren. Keine Nutzerdatenbank/-dependencies verändern. Auch reine Mathematik-Helfer können indirekt `db.ts` importieren; künftig bei JEDEM Node-Probeprozess eigene DATABASE_URL/NODE_ENV setzen (eine Kostenprobe ohne explizite Variablen löste einen nicht-mutierenden Settings-SELECT aus; es wurden keine Werte ausgegeben).

Mobile Headless-Prüfung abgeschlossen: flights/cruises/lodging/trips/stats/settings/admin bei 390×844, alle `scrollWidth=390`, keine pageerrors. Screenshots `ui-mobile-*.png`; settings/stats visuell gelesen, übrige noch öffnen. Profilinputs besitzen sichtbare, aber unverbundene Labels; Suchfeldheuristik zunächst nur Kandidat (Placeholder kann zugänglichen Namen liefern). `ui-cold-cruise-link.png` und `ui-settings-desktop.png` inzwischen visuell geprüft. Nächster Lauf: Umgebungsisolation reparieren, offene Trip-/Profil-/Routenproben, dann Trips-Services vollständig lesen.

- Auditbasis bleibt `ef62a8f8…` in `.tmp/audit-20260909/`; Hauptarbeitsverzeichnis wird durch Claude verändert. Alle weiteren Quellreads mit cwd der Auditkopie, Dokumentation weiter im Hauptverzeichnis `docs/audit-2026-09-09/`.
- Neue Befunde AUD-008 bis AUD-017 sofort dokumentiert: Restore-Zieldatenbank, Secrets/Retention/Cloud, Eingabefeld, weitere Read-PAT-Mutationen, Uploadcleanup, Ciphertextheuristik, Detailguards und zwei Settingsvertragsfehler.
- Baseline-Jest abgeschlossen, einziger anfänglicher Fehler auf eigene Testvorbereitung zurückgeführt und durch 17/17 bestandene Wiederholung bereinigt. Ergebnisdetails siehe COVERAGE.
- UI-Testdatenbank `travstats_audit_ui` im eigenen Container angelegt und migriert, getrennt von Jest. Eigene synthetische Konten `audit-ui` (Admin) und `audit-scope-*` (kein Admin); keine echten Nutzerdaten oder externen Credentials. App ohne Startupjobs (`NODE_ENV=test`) per explizitem `app.listen` gestartet.
- Eigene Prozesse: Backend Terminal-Session `17203`, PID `56800`, `127.0.0.1:18009`; Vite Session `52177`, `127.0.0.1:13009`. Am Ende nur eigene Prozesse stoppen. Vite meldet veraltete optimizeDeps-Einträge für three/react-globe.gl, läuft aber; Login und Dashboard gerendert ohne pageerror.
- CUA findet keinen verfügbaren Browser. Lokale UI-Diagnose deshalb über das vorhandene projektbezogene Headless-Playwright/Chromium in einem getrennten Kontext, nicht über den Nutzerbrowser. Erster Dev-Coldload erreichte den 30s-Timeout, nach Aufwärmen sauber; nicht als Produktionsfehler gewertet.
- Screenshot `ui-login-desktop.png` geprüft; `ui-cold-cruise-link.png` und `ui-settings-desktop.png` noch visuell prüfen. `ui-dashboard-desktop.png` ist nur ein zu früh aufgenommener Ladezustand, KEIN belastbarer fertiger Dashboard-Screenshot.
- Eigene Laufzeitproben abgeschlossen: weitere Read-PAT-Routen, Domain-Uploadleak (Markerdatei verbleibt nur in Auditkopie), lange Klartextschlüssel, Features-/Cruisesettings und Cold-Detailredirect.
- Nächste Schritte: UI responsive/Backupdialog und Settingsfehlerszenarien; dann systematisch Reise-/Flug-/Unterkunft-/POI-/Statistikservices, Parser/Jobs/Integrationen und vollständige Abdeckungsmatrix. Sicherheitsaudit-Paketpfade noch auf tatsächliche Erreichbarkeit prüfen. Gesamtprüfung ausdrücklich noch nicht abgeschlossen.

1. GitNexus aktualisieren und aktuelle Architekturflüsse lesen.
2. Inventar mit Dateizahlen/Größen und Prüfgruppen vervollständigen; sicheren lokalen Test-/UI-Zugang ermitteln.
3. Typechecks/Lint und sichere Frontendtests durchführen, Ergebnisse dokumentieren.
4. Backend-Einstieg, Middleware und Authentifizierung vollständig lesen und verdächtige Pfade nachverfolgen.

### Block 2 – Baseline und erste Backendprüfung

- `npm run typecheck`: Backend und Frontend bestanden, Exit 0.
- `npm run lint`: Backend und Frontend bestanden, Exit 0.
- Frontend-Gesamtsuite gestartet (Terminal-Session `4325`); läuft noch. Viele Mock-/act-/jsdom-Netzwerkwarnungen, noch keine abschließende Fehlerwertung.
- GitNexus erfolgreich aktualisiert: HEAD `ef62a8f…`, 1.715 Dateien, 8.967 Symbole, 23.692 Beziehungen. MCP-Overview zeigt trotz Aktualisierung noch alte Metadaten; zweiter CLI-Aufruf bestätigt „Already up to date“. Graph enthält offensichtlich falsche Namenszuordnung (`jwt.verify` → Dateigrößenprüfer `verify`) und Prozess-Resource liefert für zurückgegebene ID „not found“. Deshalb Graphresultate stets am Quellcode prüfen; kein Anlass für Änderungen am Anwendungscode.
- Anwendung auf Port 8000 vorhanden; bestehender Datenbankcontainer `travstats-db-dev` auf Port 5433 wird nicht für Audittests verwendet.
- Eigener temporärer PostgreSQL/PostGIS-Container `travstats-audit-20260909`, nur an `127.0.0.1:55439`, Daten im tmpfs und `--rm`. Ausschließlich synthetische Auditdaten. Vor Tests Migrationen/Seeds anwenden. Am Ende diesen eigenen Container stoppen; dadurch werden nur seine wegwerfbaren Testdaten entfernt.
- Vorhandene `CLAUDE.md` unverändert (Hash erneut identisch).
- Backend-Auth, Sessionausgabe, JWT, Passwortreset, Admin-Benutzerverwaltung und PAT-Verwaltung gelesen. Registrierung zählt Benutzer vor der Serializable-Transaktion; parallele Bootstrap-Registrierungen/Benutzerlimit als Hypothese prüfen. Passwortwechsel invalidiert bestehende JWTs nicht; konkrete Authentifizierungskette geprüft, Laufzeitbeleg folgt.
- H-002 teilweise widerlegt: aktueller Test-Seed enthält bereits `seedLodgingChainsFromCSV`; CI-Kommentar ist in diesem Punkt veraltet.

Nächste Schritte: Containerbereitschaft prüfen; isolierte Migrationen/Seeds; Frontendtest-Ergebnis sichern; Befunde zu Testdatenschutz, Registrierung und Sessionwiderruf bestätigen und eintragen. Noch offene Quelle: `index.ts` ab Zeile 441 bis Ende; Abschnitte vor 220 teilweise nur abgeschnitten gesehen. Danach 2FA/Passkeys/Setup, Rechte aller Router.

### Block 3 – Isolierte Reproduktion der Authentifizierungsfehler

- Frontend-Gesamtsuite abgeschlossen: 426 Testdateien, 3.661 Tests bestanden, Exit 0, 32,16 s. Warnungen über fehlerhafte Mocks/act und jsdom sind kein fehlgeschlagener Test, aber bei Testqualität später prüfen.
- Alle 129 Migrationen auf separater Auditdatenbank erfolgreich angewendet.
- Zusätzlich isolierte Quellkopie des Ausgangscommits angelegt: `.tmp/audit-20260909/` (git archive). `backend/node_modules` und `frontend/node_modules` sind Junctions auf bestehende Abhängigkeiten. Nicht rekursiv löschen: Junctions zeigen außerhalb der Auditkopie! Quelldateien der Kopie werden nicht verändert. Dadurch bleiben lokale Uploads/Caches/Logs bei Backendtests getrennt.
- Katalogseed läuft in dieser Kopie, Session `68581`; bereits Airlines 1125, Aircraft 236, Ships 30, Ports 12059, Lodging-Chains 10 und Achievements erfolgreich.
- Reproduktion mittels echter Express-Authrouter + Supertest + echtem Prisma, ohne Mocking der entscheidenden Funktionen. Nur synthetische Daten auf `127.0.0.1:55439/travstats_audit`. Keine Nachricht/Email versendet und keine externe Authentifizierung durchgeführt.
- AUD-002 bis AUD-005 bestätigt und sofort dokumentiert: Lese-PAT mutiert Kontosicherheit, fehlender Sessionwiderruf bei Passwortreset, paralleler Bootstrap erstellt mehrere Admins, 2FA umgeht erzwungenen Passwortwechsel.
- Die Auditdatenbank enthält jetzt synthetische Testbenutzer; Bootstrapreproduktion darf nicht nochmals blind gegen die nichtleere Datenbank laufen. Weitere Prüfläufe isolieren eigene Datensätze bzw. legen eine zweite Wegwerfdatenbank im Auditcontainer an.
- Vollständig gelesen: Auth-2FA-/Passkeyrouter, Setup, WebAuthn-Challengestore/RP-Konfiguration, TOTP/Recoverycodes, Authschemas, Admin-/Settings-Mounts. Logger/Encryption/Seeddateien erst teilweise.

Nächster Einstieg: Ergebnis Seed-Session 68581 einholen; Backend-Gesamtsuite aus isolierter Kopie starten (eigene DATABASE_URL, synthetische JWT-/Encryption-Schlüssel, NODE_ENV=test). Vorher nach Testcode mit absoluten Pfaden/externen Nebenwirkungen suchen. Vollständige Routen-Autorisierungsmatrix und restliche Auth-Races prüfen; dokumentierte Erstbefunde gegen Mountreihenfolge verifizieren; dann Uploads/Backup/Import.

### Block 4 – Gesamttests und Backup

- Katalogseed abgeschlossen: zusätzlich 18.017 Airport-Zeitzonen gesetzt. Backend-Gesamtsuite gestartet, Session `59196`; läuft isoliert mit `--ci --forceExit --silent --json`, Ergebnisdatei `backend-tests.json` im Auditverzeichnis. Noch keinen Endstatus annehmen.
- `INVENTORY.md` enthält alle 2.908 versionierten Dateien mit Größe (zusammen 65.844.203 Bytes).
- Route-Scope-Matrix über 94 Quelldateien erhoben. Weitere fehlende Write-Guards: manuelle Flughafenanlage, Training und Fotojourney-Status; Preview/Parse-POSTs sind teilweise bewusst lesende Operationen und nicht pauschal als Fehler zu werten. Unterrouter von Admin/Settings erben korrekten Schutz. Diese weiteren Kandidaten noch mit konkreten Pfaden bestätigen.
- AUD-006/AUD-007 reproduziert: Uploadrestore erzeugt verschachtelten Pfad; Datenbankrestore lässt veränderte vorhandene Daten stehen und ignoriert SQL-Fehler über Exit 0.
- Eigene zweite Datenbank im Auditcontainer: `travstats_audit_restore`, enthält nur synthetische Markertabelle. Wird mit dem Wegwerfcontainer entfernt.
- Repro-Dateiartefakte unter `.tmp/audit-20260909/evidence-backup-paths/`; einzige manuell angelegte Markerdatei in der isolierten Kopie `backend/uploads/receipts/audit-restore-marker.txt`.
- Weiter prüfen: automatische Backups enthalten keine Secrets-Dateien (Archivliste zeigt nur SQL, Uploads, Metadaten); Restore-Sperre/Cloud-Downloadregistrierung; fehlendes Rate-Limit und frühe Cleanup-Lücke bei ungültiger Domain in `/parse-email-file`.
- E2E-Konfiguration: Default wartet auf 5173, Vite startet auf 3000. `e2e/flights.spec.ts` enthält noch unauthentifizierte Platzhaltertests mit bedingten Assertions. Noch gesondert als Testqualitätsbefund bestätigen.

Nächster konkreter Einstieg: Backend-Testsession 59196 abfragen; Backup- und Uploadbefunde vervollständigen; weitere Scope-/Cleanup-Hypothesen dokumentieren. Driftcheck nur mit expliziter eigener SHADOW_DATABASE_URL ausführen (URL-Ableitung wirkt für Queryparameter fehlerhaft, noch verifizieren). UI-Prüfung über eigene lokale Frontendinstanz gegen isolierte Audit-App vorbereiten, nachdem Gesamttests abgeschlossen sind.

Wichtige Einschränkung zum ersten Backend-Gesamtlauf: Die vorherige Bootstrap-Reproduktion ließ `AdminSettings.maxUsers=1` zurück. `admin.invitations.test.ts` meldet deshalb zunächst 409 statt 200. Das ist möglicherweise Audit-Testvorbereitung, kein belastbarer Produktbefund. Nicht als neuen Fehler berichten. Nach dem Lauf fehlgeschlagene Suites mit explizit zurückgesetzten synthetischen Einstellungen bzw. neuer isolierter DB gegenprüfen. Keine Einstellungen während des laufenden Tests ändern. Für weitere eigene DB-Reproduktionen eine separate Datenbank verwenden.
