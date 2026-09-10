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

### Aktueller Einstieg nach Block 5 (dieser Abschnitt hat Vorrang vor älteren Schritten)

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
