# Nachprüfung der Korrekturen

## Prüfstände und Aussagegrenzen

- Ursprüngliche Befunde: `ef62a8f8ba1817a2df03c96451eb806d95aa4102` (09.09.2026), siehe `FINDINGS.md`.
- Fix-Nachprüfung: `c824ea3beff13121a387e0e55f1584f8c6dfdb28` (Release 2.6.3, 10.09.2026).
- `ANTWORT.md` ist die Rückmeldung der Implementierung, nicht das Ergebnis dieser unabhängigen Nachprüfung. Nicht überschreiben.
- Historisch **bestätigt** bedeutet nicht **am aktuellen Stand noch offen**. Gemeldete Korrektur, Quellprüfung und erfolgreicher Laufzeit-Gegentest werden getrennt ausgewiesen.
- Keine Anwendungscodeänderungen. Laufzeittests ausschließlich in eigener eingefrorener Kopie und eigener Wegwerfdatenbank, niemals gegen die vorhandene Entwicklungsinstanz.

## Ergebnisübersicht dieses Prüfblocks

### Ergänzung: 39715ec5, 13.09.2026

**Abschließende Ergänzung:** Inzwischen auch vollständiger Backend-Gesamtlauf dieses festen Commits grün: **4.274 Pass/0 Fail/11 Skip**, 492 bestandene/2 übersprungene Dateien, nativer Exit 0. Frontend unverändert **3.710 Pass/433 Dateien**. Beide Typechecks, Projektlints und Produktionsfrontend-Build bestanden, Dateigrößengate grün. Die nachstehende frühere Aussage „keine komplette Backendwiederholung“ ist damit überholt. Neue Befunde AUD-099–103 sind Analyseergebnisse, keine eigenen Korrekturen. Detailberichte siehe AUDIT_REPORT.

Vier nachfolgende Commits getrennt geprüft: WebDAV-Testbeschriftung, Flughafenanzeige, striktes Frontend-Testnetzwerk, Hotelcheck-in nach Ortszeit. Separate feste Quellkopie; **433 Frontenddateien/3.710 Tests grün**, **7 Backenddateien/64 Tests grün**, beide Typechecks grün, jeweils nativer Exit 0. Berichte `block17-current-frontend-full.json`, `block17-current-backend.json`, `block18-current-*-typecheck.log`. Keine komplette Backendwiederholung dieses Commits behauptet. Echter zusätzlicher Upcoming-Grenzfall an der UTC-Tagesgrenze bestätigt **AUD-099**, trotz grüner gezielter Tests. Die vorherige Prüfbasis 9678e6cd bleibt für ältere Befunde/Läufe ausdrücklich erhalten.

### Vorheriger Nachprüfstand: 9678e6cd, 13.09.2026

Neue eigene feste Quellkopie. Backend-Fixregressionen: 9 Dateien, **150 unterschiedliche Tests bestanden / 9 private Sample-Skips** über Erstlauf und gezielten Nachlauf. Erstlauf 149/1/9; einzige Abweichung war der fehlende Hotelkettenkatalog in unserer frischen Datenbank. Nach Anwendung des echten Katalogseeders bestand die gesamte betroffene Datei (29/29), einschließlich der zuvor fehlgeschlagenen Testidentität. Frontend: **4 Dateien / 74 Tests bestanden**. Backend-Build/Typecheck bestanden. Kein neuer Gesamtlauf dieses Commits behauptet.

| Befunde | Unabhängige Nachprüfung am 13.09. |
| --- | --- |
| AUD-006/007 | Echter Full-Restore unter Linux: vorherige DB-Daten und Dateien aus allen sieben Upload-Verzeichnissen korrekt zurückgespielt. Separater ungültiger SQL-Dump wird abgelehnt; vorangehende SQL-Änderung atomar zurückgerollt. Neue Folgeblockade siehe AUD-069. |
| AUD-029/030 | Eigene reale DB-Gegenproben: Mehrquellen-Duplikatmerge gelingt; Titelbild folgt nach Deduplikation der überlebenden Fotozeile. Ursprüngliche Restfälle geschlossen. Keine neue Bilddatei/HTTP-Auslieferung in dieser speziellen Mergeprobe behauptet. |
| AUD-037 | Acht echte Browser-Tabschritte mit normalen sichtbaren Controls bleiben im Dialog. Ursprünglicher Fokus-Ausbruch korrigiert; keine Vollabdeckung aller verschachtelten Dialoge. |
| AUD-043–049/054/055 | Vier bereits in Block 11 geprüfte Regressionstestdateien erneut am neuesten Commit ausgeführt; grün nach Katalogseed. Keine pauschale Wiederholung jeder historischen eigenen Probe. |
| AUD-050 | **Teilweise.** Ursprüngliche Fälle korrigiert. Zwei Buchungen desselben Hotels im selben Dokument bleiben falsch: 100/500 → 100/100 EUR. Eigene echte Parser-/HTTP-Probe. |
| AUD-051/052/053/058 | Eigene Gegenproben korrigiert: String-null bleibt fehlend; Template 135.87 USD bleibt 135.87; verneintes Frühstück/optionale Mahlzeit korrekt; tröpfelnder HTTP-Body endet nach 126 ms bei 120-ms-Budget, abgebrochener Body nach 42 ms mit nutzbarem Fallback. |
| AUD-056 | **Teilweise.** Einfacher Name-/Stadtmatch ablehnbar. Heuristische Zuordnung mit `stay_same_dates` oder stays-only-Namensjoin (`none`) weiterhin nicht ablehnbar; echte Preview → Browserpayload, bei Namensjoin zusätzlich DB-Commit. |
| AUD-057 | **Teilweise.** Fehlende Währung sperrt Commit, EUR ergänzbar und im Payload erhalten. AED/KWD bei leerem Ausgangswert im Dropdown nicht wählbar. |
| AUD-059/060 | Eigene kombinierte Browser-CSV-Gegenprobe bewahrt 52.520/13.405 und Bewertung 0.5 ohne Zeilenwarnung; erweiterte Projektregressionen grün. |
| AUD-069–071 | Neue separat dokumentierte Befunde: Restore-Jobzustand blockiert weitere Backups (P1), Geocoder-Fairness ab 501 Einträgen (P2), ungültige Providerkoordinaten gespeichert (bedingter P3). |

Artefakte: `block12-parser-probes.*`, `block12-data-probes.*`, `block12-ui-probes.*`, `block12-restore.*`, `block12-geo-*`, `block12-backend-regressions.json`, `block12-backend-seeded-rerun.json`, `block12-frontend-regressions.json`. Browserprüfungen betreffen echte Komponenteninteraktion mit ersetzter Übersetzung/Logger, keine vollständige Seite/CSS-Abnahme. Linux-Lauf nutzt vorhandenes Runtimeimage ausschließlich als Werkzeugumgebung mit aktuellem kompiliertem Auditcode; normaler App-Entrypoint wurde nicht gestartet.

Zusätzliche Analyse am selben aktuellen Fixstand `9678e6cd` in Blöcken 13/14: neue AUD-072–080 in FINDINGS; POI **68**, Listen **61** und Statistik **48** weitere Projektprüfungen bestanden. Das sind neue Analysebereiche, keine zusätzlichen Fixfreigaben. POI-Webimport ist noch deaktiviert; API- und UI-Reichweite stehen jeweils beim Befund. Quellprobe und JSON-Ergebnisse vollständig im Auditverzeichnis.

### Historische Bewertung des Fixstands c824ea3b

Fortsetzung 11.09.2026: Acht neue Befunde AUD-061–068 separat auf der eingefrorenen 2.6.3-Kopie bestätigt (Geocoding/FX/Koordinatenvalidierung); siehe FINDINGS und Block-11-Artefakte. AUD-067 ist P3 und setzt eine fehlerhafte Providerantwort voraus. Der vollständige Backendlauf für c824ea3b ist inzwischen erfolgt: 4.216 unterschiedliche Tests bestanden nach gezielter Wiederholung zweier eigener Umleitungsfehler, 11 Skips; siehe COVERAGE. Die nachfolgende Tabelle bleibt ausdrücklich die Bewertung dieses Fixstands.

**Zusätzliche Nachprüfung des neueren Import-Fix-Commits `4956235f`:** AUD-043–049/054/055 werden dort adressiert. Eigene separate Commitkopie; alle sechs produktiven Diffs gelesen; vier geänderte Regressionsdateien mit **59 Tests bestanden**, außerdem **Backend-Typecheck bestanden**. Ergebnis `block11-import-fixes-4956235f.json`; 29 Importcommit-, 18 Preview-, 9 Undo-/Batch- und 3 Flugbatchtests. Dies bestätigt die dort geprüften Regressionsfälle, ersetzt aber weder eine vollständige Wiederholung aller früheren eigenen Proben noch einen neuen Gesamtlauf. Keine Freigabe noch uncommitteter Parserkorrekturen. Anfangs vom eigenen Dependency-Link verursachter TS2742 nach physischer Trennung verschwunden; keine Produktregression.

Endkontrolle 11.09.: Haupt-HEAD inzwischen `7ef4ef11` (Parser AUD-050–053/058), noch nicht nachgeprüft; nächster Einstieg laut STATUS.

| Befunde | Unabhängiger Status am Fix-Stand c824ea3b |
| --- | --- |
| AUD-001 | Teilweise abgesichert; lokale Dev-DBs weiter ohne Opt-in zugelassen. Guard-Gegenprobe bestätigt. |
| AUD-002–005, AUD-012–013 | Ursprüngliche Fälle durch geprüfte Diffs und ausgeführte reale Regressionstests geschlossen. |
| AUD-006–007 | Fix im Quellcode nachvollzogen; eigener vollständiger Restore-Roundtrip noch offen. Dateitest unter Windows übersprungen. |
| AUD-008 | UI-Falle entfernt. Alte HTTP-Clients können den weiterhin stillschweigend verworfenen Zielparameter senden; API-Restgrenze bleibt. |
| AUD-009 | Laut `ANTWORT.md` bewusst unverändert: Schlüssel separat sichern. Datenverlustfolge bei Restore ohne Schlüssel bleibt; ergänzende Dokumentation noch prüfen. |
| AUD-010 | Laut `ANTWORT.md` bewusst zurückgestellt: automatische Retention/WebDAV-Synchronisation nicht Teil der Fix-Runde. |
| AUD-011 | Betroffenes Eingabefeld entfernt; im Browser bestätigt. |
| AUD-014 | Neue Schlüssel korrekt verschlüsselt/lesbar; bestehende lange Klartextwerte bleiben ohne erneutes Speichern unlesbar. Keine automatische Altbestandsreparatur. |
| AUD-015 | Kaltstart eines echten Kreuzfahrt-Details ohne Settings-Storage erfolgreich, kein Redirect. |
| AUD-016–018, AUD-020–021, AUD-023–024 | Ursprüngliche Fälle: Fix-Diffs geprüft und relevante Regressionstests grün. Kein Anspruch auf sämtliche Datum-/FX-Randfälle. |
| AUD-019 | Neuer Uploadbesitz korrekt abgesichert, echte Zugriffs-/Löschtests grün. Migration des Altbestands bleibt heuristisch (siehe unten). |
| AUD-022 | Feldparität/Snapshotergänzung geprüft; neue fehlerhafte Zuordnung bei null-Provenienz: **AUD-049**. |
| AUD-025–026 | UI-Falle durch schreibgeschützten Namen entfernt; Feldlabels zugeordnet; Tests grün. Keine Umbenennungsfunktion implementiert. |
| AUD-027–028, AUD-031–032 | Ursprüngliche Fälle durch Fix-Diffs und relevante Regressionstests bestätigt korrigiert. |
| AUD-029 | Ursprünglicher Relations-/Fotodatenverlust geschlossen; Mehrquellen-Duplikatmerge scheitert noch (Rollback statt Datenverlust). |
| AUD-030 | Einfacher Cover-Merge korrigiert; Cover auf wegdeduplizierte Foto-ID bleibt kaputt. Eigene DB-Gegenprobe. |
| AUD-033–034 | Neue Trackimporte bewahren Segmentgrenzen/Rohdistanzen; Tests grün und Schreib-/Lesepfade geprüft. Alte Tracks haben weiterhin null-Metadaten und werden nicht rückwirkend repariert. |
| AUD-035 | Eigene verzögerte Autosave-Gegenprobe erfolgreich: A2 und B2 geschrieben, Server/Client B2, nichts mehr offen. |
| AUD-036 | Profil-Hydrierung im Diff korrigiert; Store-Regressionstests grün. Eigene vollständige Kontowechsel-UI-Gegenprobe noch offen. |
| AUD-037 | Kleines Layout, initialer Fokus und Escape korrigiert; Tab-Fokus kann den modalen Dialog weiterhin verlassen. |
| AUD-038–042 | Ursprüngliche Fälle: Diffs geprüft und reale API-/DB-/Datei-Regressionsprüfungen grün. Weiter reichende Undo-Löschwirkung siehe AUD-047. |
| AUD-043–045 | Weiterhin vorhanden; eigene Schema-/Service-/DB-Gegenproben auch am Fix-Stand erfolgreich reproduziert. |
| AUD-046–048 | Neue bestätigte Import-/Undo-Befunde, siehe `FINDINGS.md`. |
| AUD-049 | Neue Regression durch Batch-FX-Ergänzung; echte API-/DB-Probe bestätigt falsche Basisbeträge. |
| AUD-050–060 | Neue Befunde aus Fortsetzungsblock 10 am selben Stand: Parserpreise/-Timeout, Unicode-Matching, Importreihenfolge, fehlende UI-Entscheidungen/Währung, CSV-Koordinaten und Halb-Stern-Verlust. Jeweils eigene Gegenproben; noch keine Fix-Rückmeldung zu diesen neuen IDs. |

Hinweis zur Zuordnung: `ANTWORT.md` bezeichnet die Bootstrap-Race an einer Stelle als AUD-002. Im unveränderten Befundregister ist sie **AUD-004**; AUD-002 betrifft Schreibzugriffe mit Lese-PAT. Keine IDs umnummerieren.

## Prüfprotokoll und Nachweise

### Ergänzung Fortsetzungsblock 10

- HEAD blieb `c824ea3b`, keine neuen Anwendungsänderungen während dieses Blocks. AUD-050–060 sind neue Fehler, keine pauschale Wiedereröffnung der ursprünglichen Fixrunde.
- Backend gezielt 9 Dateien: **106 Tests bestanden, 9 übersprungen**, Exit 0; `block10-backend-tests.json`. Die 9 Skips betreffen nicht vorhandene private Buchungssamples in der eingefrorenen Kopie; lokale Stub-/Synthetiktests liefen. Frontend gezielt 5 Dateien: **76 Tests bestanden**, Exit 0; `block10-frontend-tests.json`. Kein vollständiger neuer Backend-/Frontend-Gesamtlauf in diesem Block.
- Die grünen vorhandenen Tests schließen die zusätzlich selbst reproduzierten Randfälle nicht aus. Die Anwendung und bestehende Tests wurden nicht gepatcht; die eigenen Parser-/DB-/Browserproben liefen als kurzlebige Diagnoseprozesse.
- Frühere Auditcontainer nicht mehr vorhanden. Neuer eigener Container `travstats-audit-block10-20260910`, tmpfs, 127.0.0.1:55439, DB `travstats_fixes_probe_audit`, 132 Migrationen erfolgreich. Keine Nutzung der Dev-DB. Keine externen KI-/FX-/Geocoding-Anfragen bei den eigenen Gegenproben.

### Laufende Ergebnisse, erster Block

- GitNexus aktualisiert: 9.048 Symbole, 23.954 Beziehungen, 300 Flüsse; keine Embeddings vorhanden. MCP liefert teilweise weiterhin alte Zeilenlagen, Quelle bleibt maßgeblich.
- Fix-Kopie erstellt; Backend- und Frontend-Abhängigkeiten **physische Kopien**, keine Junctions. Prisma 5.22 ausschließlich darin regeneriert.
- Eigene Datenbanken `travstats_fixes_audit` (Jest) und `travstats_fixes_probe_audit` (eigene Gegenproben) im bereits isolierten Container auf Loopback-Port 55439. Jeweils alle **132 Migrationen bestanden**. Bestehende Audit-/Entwicklungsdatenbanken unangetastet.
- Backend-Typecheck bestanden. Frontend-Gesamtsuite: **432 Testdateien, 3.686 Tests bestanden**, Exit 0; Ergebnis `fix-frontend-tests.json`. jsdom-/Mockwarnungen wie beim Ausgangslauf; grüne Tests sind keine vollständige visuelle Prüfung.
- Gezielt alle seit Auditbasis neuen/geänderten Backend-Regressionsdateien ausgewählt, nicht mit vollständiger Backend-Gesamtsuite verwechseln.
- **Abschluss dieses Regressionstestlaufs:** 26 Backend-Testdateien / 159 Tests bestanden; 1 Datei / 1 Test (Uploads-Backup-Roundtrip) unter Windows ausdrücklich übersprungen. Exit 0, 121,148 s, `fix-backend-regressions.json`. Keine fehlgeschlagenen Tests. Damit wurden die Implementierungs-Gegentests zu Auth/Sessions/PAT/Bootstrap, Flugchronologie und Feld-/Batchparität, Settingsvertrag, Uploadbesitz, Reiseerhalt/-status/-cleanup, Tracks, bewegten Stopps, Kostenquotienten sowie Unterkunftszuordnung/-preis/-foto tatsächlich unabhängig ausgeführt. Noch kein vollständiger Backend-Gesamtlauf des Fix-Stands.
- Frontend-Typecheck ebenfalls bestanden.
- Eigene Schema+Prisma-Gegenprobe auf `travstats_fixes_probe_audit`: **AUD-043–045 weiter vorhanden**. 100 EUR + 500 EUR am selben Check-in-Tag ergibt gespeicherte Basisbeträge 100 + 100; Berlin/Paris mit gleichen Hotelnamen und unterschiedlichen externen Referenzen ergibt ein Hotel mit zwei Aufenthalten; Check-in 10.05.2026 / Check-out 01.05.2026 wird unverändert gespeichert. Kein Geocoding und keine externen FX-Aufrufe (EUR→EUR).
- Neue, tatsächlich am Fix-Stand bestätigte Befunde **AUD-046–048**: falsche Domäne bei Importliste/-rücknahme, Verlust nachträglich hochgeladener Hotelfotos durch Undo sowie Nachtpreis mit erfundener EUR-Einheit. Siehe `FINDINGS.md`. Nicht als Wiedereröffnung bereits korrigierter AUD-038–042 verwechseln.
- AUD-001 Guard unabhängig ausgeführt (echte transpiliert geladene `jest.globalSetup.ts`, Prisma vollständig gestubbt, **keine Netzwerkverbindung**): `example.invalid/review_test` und `127.0.0.1/personal_travel` verweigert; lokale `flights_dev`, `travstats_dev`, `isolated_test` ohne Override zugelassen. Damit ist die genannte Restgrenze tatsächlich nachgewiesen.

### Eigene Kombinationsproben: Reise-Merge noch nicht vollständig erledigt

- **AUD-029, ursprünglicher Datenverlust behoben, Kollisionsrandfall offen:** Die neue Implementierung bewahrt Aufenthalte/POI/Alben im einfachen Merge (Regressionstest grün). Bei drei Reisen (leeres Ziel + zwei Quellen mit demselben `immichAssetId`) wirft der reale Merge-Service weiterhin Prisma **P2002** auf `(trip_id, immich_asset_id)`. `mergeTripPhotos` sammelt nur bereits im Ziel vorhandene Asset-IDs; Kollisionen zwischen mehreren Quellen fehlen. Alle drei Reisen bleiben nach Rollback erhalten, kein Datenverlust in dieser Probe. Verbesserung: pro Asset über Ziel und sämtliche Quellen genau einen Überlebenden wählen und Referenzen konsistent umsetzen. Fundstelle `services/trip/mergeTripRelations.ts:92–115`.
- **AUD-030 teilweise behoben:** Quelle und Ziel besitzen dasselbe Immich-Asset mit unterschiedlichen Foto-IDs; das Ziel hat noch kein Titelbild, die Quelle verwendet ihre eigene Foto-ID als Cover. Merge gelingt und löscht die Quell-Fotozeile als Duplikat. `retargetCoverUrl` ersetzt aber nur die Reise-ID und übernimmt weiterhin die nun gelöschte Foto-ID. Reale DB: Ziel-Foto vorhanden, referenziertes Quell-Foto gelöscht, gespeichertes Cover zeigt auf fehlende Zeile; GET 404. In dieser Probe bewusst keine physische Bilddatei angelegt, daher ist **die nachgewiesene fehlende DB-Referenz**, nicht allein der HTTP-Status, der entscheidende Beleg. Verbesserung: Duplikatabbildung alte Foto-ID → überlebende Foto-ID auch auf das Cover anwenden. Fundstellen `mergeTripRelations.ts:105`, `:140`; `tripCleanupService.ts:286`.

### Neu eingeführte Regression bei AUD-022

**AUD-049:** Batch-FX nach optionaler `externalRef` speichert für zwei manuelle EUR-Flüge (100/500) zweimal 500 als Basisbetrag. Eigene API-Probe 201 und DB-Zeilen geprüft; Details im Befundregister. Die ursprünglich fehlenden Zusatzfelder/FX sind ergänzt und deren einfache Tests grün, aber die neue Snapshotzuordnung ist bei null-Provenienz nicht korrekt. AUD-022 daher nicht ohne diesen Folgefehler als vollständig abgehakt darstellen.

### Eigene UI-Gegenprobe: AUD-011/037 (Ergebnis)

- Neuer Backend-/Viteprozess ausschließlich für die Fix-Kopie auf `127.0.0.1:18010` / `:13010`; synthetisches Konto `audit-fix-ui`. Im Browserkontext sämtliche nichtlesenden Backup-Requests blockiert; Liste durch eindeutig synthetischen Eintrag ersetzt. **Kein Restore ausgeführt.**
- 320×568: Dialog innerhalb des Viewports (oben 28,41; unten 539,59; Höhe 511,19 px). Beide Aktionsbuttons vollständig sichtbar, Ziel-URL-Feld entfernt, Fokus beim Öffnen innerhalb, Escape schließt. Keine `pageerror`s. Screenshot `fix-ui-restore-mobile-320x568.png`.
- **AUD-037 nur teilweise geschlossen:** Nach sechs Tab-Tastendrücken verlässt der Fokus weiterhin den als `aria-modal=true` bezeichneten Dialog. Gemeinsamer `Modal.tsx` hat initialen Fokus/Escape/Body-Scrollsperre, aber keinen Tab-Fokusfang oder inerten Hintergrund. Layout- und Escapeprobleme behoben, Tastaturisolation noch offen. Kein erneuter pauschaler Befund „Dialog unverändert kaputt“.
- Screenshot vollständig visuell geprüft: Dialog, Warnung und Buttons liegen im Bild. Der Formularkörper ist intern scrollbar; kein Nachweis einer erneut abgeschnittenen Panelunterkante.
- AUD-015: echte synthetische Kreuzfahrt `309602a4-c984-4c6c-9435-a8bc02f34e4b` (Konto `audit-fix-ui`), direkter Cold-Aufruf ohne `settings-storage`: URL bleibt auf dem Detail, „Synthetic Audit Cruise“ sichtbar, keine `pageerror`s. `fix-ui-cold-cruise-detail.png` gespeichert und visuell geprüft.
- AUD-035: echte SettingsPage und Store, erster PUT kontrolliert verzögert; währenddessen von A2 zu B2 editiert. Nach **Abschluss der B2-Antwort**: Schreibfolge `[A2,B2]`, HTTP 200, Server und lokaler Store B2, Pending false. Erster eigener Messlauf las zwischen den zwei Antworten (A auf Server, B in Bearbeitung); das war kein Produktfehler. Wiederholung wartet ausdrücklich auf die zweite Antwort und den finalen Snapshot.
- AUD-014: eigene reine Helfergegenprobe mit synthetischem 200-Zeichen-Schlüssel: neu verschlüsselt korrekt rücklesbar; schon als langer Klartext gespeicherter Altwert weiterhin nicht rücklesbar. Keine echten Schlüssel gelesen oder ausgegeben.
- Eigener Fixturefehler beim ersten Settings-Seed: `enabledDomains` irrtümlich auf `AdminSettings` gesetzt; Prisma lehnte vor dem Schreiben ab. Korrigierte synthetische Fixture enthält nur `maxUsers`/`allowRegistration`; kein Produktbefund.

### Bereits gelesene Fix-Diffs / Einschränkungen

| Befund | Unabhängiger Zwischenstand |
| --- | --- |
| AUD-001 | **Teilweise abgesichert.** Guard verweigert nichtlokale Hosts und nicht freigegebene lokale Namen. `flights_dev` und `travstats_dev` bleiben ohne Opt-in zerstörbar; Guard-Gegenprobe bestätigt. |
| AUD-002/003/004/005/012 | Browser-only-Middleware, Session-Epoch, gemeinsamer Transaktionslock und nachgelagerte Passwortänderungs-Challenge im Diff geprüft; reale Regressionstests grün. |
| AUD-006/007 | Extraktionsziel korrigiert; neue Dumps mit `--clean --if-exists`, Restore mit `ON_ERROR_STOP` und einer Transaktion. Eigene vollständige Restore-Gegenprobe noch offen. Der neue Datei-Roundtriptest überspringt Windows ausdrücklich. |
| AUD-008/011 | **UI-Ursache entfernt**, indem Ziel-URL-Feld und Frontend-Parameter entfallen. Kein implementierter Restore in eine andere Datenbank. Unveränderte Backend-API `routes/backup.ts:39`, `:297`, `:315` verwirft den zusätzlichen Parameter weiter; kein strikter Reject. |
| AUD-015/016/017 | Detailrouten nutzen nun wartenden DomainGuard; Cruise-Slice wird hydriert; Backend-Schema akzeptiert Features. Diff geprüft; Frontend-Gesamtsuite grün. |
| AUD-019 | Eigene Upload-Eigentümertabelle entscheidet statt frei schreibbarer Belegreferenz. Upload/GET/DELETE und Migration gelesen; Regressionstests grün. Altbestand-Backfill beruht auf frühestem Erstellungsdatum eines referenzierenden Datensatzes, nicht auf gesicherter Upload-Provenienz; diese Grenze nicht übersehen. |
| AUD-025/026 | Benutzername ist ausdrücklich schreibgeschützt mit Hinweis; fünf Inputs haben Label-/ID-Zuordnung. Diff geprüft, Frontend-Gesamtsuite grün. **Keine Kontoumbenennung implementiert.** |
| AUD-035/036 | Warteschlange plus Snapshot des tatsächlich gesendeten Settings-Stands; altes Profil vor statt nach Hydrierung verworfen. Diff geprüft, Frontend-Gesamtsuite grün; eigene UI-In-flight-Gegenprobe zu AUD-035 ebenfalls grün. |
| AUD-037 | Gemeinsamer Modal-Rahmen und Labels; Komponententests und kleines Browserlayout grün; fehlende Tastaturisolation separat nachgewiesen. |
| AUD-038–042 | Eigentümerprüfungen, Null-/Undefined-Merge, gemeinsame Nachtberechnung, Erhalt von Gesamtpreis 0 und Datei-Cleanup in Diffs geprüft. Reale Regressionstests grün. |

## Nächste konkrete Schritte

Prüfumgebung am Blockende: Neue eigene UI-Prozesse auf 18010/13010 nach Port-/PID-Abgleich gestoppt; alle kurzen Probeprozesse abgeschlossen. Quellkopie, eigene Testdatenbanken und Berichte bleiben für Fortsetzung erhalten. Haupt-HEAD weiterhin `c824ea3b`; nur Auditdokumentation und Prüfartefakte geändert, kein Anwendungscode.

1. Bei Fortsetzung zuerst Haupt-HEAD und neue Implementierungsantworten prüfen. Neue Commitstände nicht stillschweigend mit `c824ea3b` vermischen.
2. AUD-046–049 und Merge-/Modal-Restpunkte zur Nachprüfung vormerken; nur nach tatsächlicher Korrektur als geschlossen markieren.
3. Eigene vollständige Datei-/DB-Restore-Gegenprobe (nur Wegwerfdaten), insbesondere Altbackups; weitere Migrations-/Altbestandsgrenzen prüfen.
4. Gesamtaudit mit noch ungeprüften Import-Preview-/Parser-/FX-Pfaden fortsetzen; danach offene Statistik-, Integrations-, Jobs- und Frontendbereiche anhand `COVERAGE.md`. Nicht das ganze Repository als geprüft bezeichnen.
