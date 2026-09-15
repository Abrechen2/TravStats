# Prüfabdeckung

## Abschlussstand 13.09.2026

Gesamtscope und Grenzen in [AUDIT_REPORT.md](AUDIT_REPORT.md), konkrete Bedienfälle in [UI_REPORT.md](UI_REPORT.md). Die nachstehenden Blöcke sind chronologisch; frühere Zwischenstände nicht als aktueller Teststatus lesen.

- **39715ec5:** vollständiges Backend **494 Dateien, 492 Pass/2 Skip; 4.274 Pass/0 Fail/11 Skip**, nativer Exit 0, 790,616 s. Vollständiges Frontend **433 Dateien/3.710 Pass**, nativer Exit 0. Beide Typechecks, beide Projektlints und Produktionsfrontend-Build Exit 0; Backend drei Warnungen, Vite Chunkgrößenwarnung. Dateigrößengate 1.149 Quellen/20 Baseline-Ausnahmen grün. `block18-validation.json` gleicht Zahlen und 103 eindeutige Befund-IDs ab.
- **Browser 9678e6cd:** die fünf sofort bestandenen Anlege-/Besuchsfälle plus korrigierte POI-Suchassertion ergeben sechs nachgewiesene Abläufe. Hotel-CSV vollständig einschließlich bewusster Ablehnung eines heuristischen Matches, korrektem HTTP 201 und Reload; eigener erster Erwartungswert 200 korrigiert. Flug-Edit: PUT 200 und gespeichertes Gate beim erneuten Öffnen; Löschen des soeben selbst angelegten Testflugs: 204 und anschließendes GET 404. Keine echten Datensätze verändert.
- Zugänglicher Browserbaum geprüft: drei unbenannte Comboboxen in manueller Fluganlage, eine in Reiseanlage; eigener Passwortdialog ohne Rolle/Escape, Abbrechen funktioniert. Bei 320 px teilweise links abgeschnittene Flug-Aktionszeile, sichtbarer Abbrechen-Rest tatsächlich klickbar (AUD-103). Kein kompletter Bedienausfall behauptet.
- Zusätzliche visuelle Reads: POI-Modal/Reisepass, mobile Importauswahl, Settings/Flugformular/Passwortoverlay, Spaltenmapping, ungeklärte und aufgelöste CSV-Vorschau, Importresultat sowie Desktop-Cruise-/Hotel-/Reisedetails. Alte falsche Cruise-Fixture und blockierte Kartenressourcen bleiben als Auditaufbaugrenzen markiert.
- Weitere Quelle: `jobs/flightUpdateScheduler.ts`, `services/instanceSettingsService.ts`, `services/cruiseDistance/types.ts`, `components/Settings/ImportSection.tsx`, `import/LodgingCsvImportTile.tsx`, `import/Fr24ImportTile.tsx` vollständig im ausführbaren Code gelesen. `flightLookup.ts` ausführbaren Code durch Kontrollreads der zunächst gekürzten Mittelabschnitte vervollständigt; `aviationstackBudget.ts` vollständig. ApiKeyResolver bis Ende ergänzt (erste 200 Zeilen aus früherem Block). Navigation/Profil-/Form-/Mapping-/WebDAV-Kontext gezielt ergänzt, keine vollständige manuelle Prüfung aller Frontendquellen behauptet.
- **AUD-100–102:** tatsächliche Lookup-Implementierung auf 39715ec5 mit ersetzten Resolver-/HTTP-Grenzen geprüft, keine externen Aufrufe: Nutzerkontextverlust bei AirLabs, OpenSky-Basic-Feldvertrag, zwischen Credentials ungetrennter OAuth-Cache. Quellenvertrag und positive Kontrollen getrennt von einem echten externen Providerlauf ausweisen. Neuer Upcoming-Router und StayInstant vollständig sowie echte DB-/HTTP-Gegenprobe AUD-099.
- Paketprüfung erneut aktuell: 0/4/15 Meldungen Root/Backend/Frontend, erwartete npm-Exitcodes 0/1/1. Erreichbarkeit und Primärquellen in DEPENDENCIES. Keine automatische Aktualisierung.
- Manuelle Zeilenprüfung ist risikoorientiert und ergänzt die projektweiten Gates/Suiten. Vollständiges Inventar und automatische Prüfung werden nicht mit vollständigem manuellen Lesen jeder Datei gleichgesetzt. Private Samplefälle, echte Providerzugänge, physische Mobilgeräte und Produktions-/Last-/Clustertests gehören nicht zu den ausgeführten Läufen.

### Block 18 – neue Fixprüfungen und Ergänzung zu Block 17

- `39715ec5`: komplette Frontendsuite **433 Dateien/3.710 Tests**, gezielte Backendprüfungen **7 Dateien/64 Tests**, beide Typechecks bestanden, native Exitcodes 0. Aktueller Upcoming-Router und `stayInstant.ts` vollständig gelesen. Echte API-/DB-Gegenprobe an der UTC-Tagesgrenze bestätigt AUD-099; positiver Folgekalendertag erscheint korrekt.
- Maßgeblicher E2E-Lauf Block 17 beendet: 102 Fälle, 69 Pass/33 Fail, drei Engines. Ursache und Aussagegrenze der Gerüsttests in AUD-098. Kein pauschal grüner Browser-Gesamtlauf.
- Karten-/Font-/Flaggenprüfung mit erlaubten öffentlichen Asset-Hosts: 51 externe Antworten alle 200; drei Ansichten ohne pageerror. Alle drei Screenshots `block17-assets-*.png` visuell gelesen, Kartenrouten/Flaggen erkennbar korrekt gerendert. Frühere absichtlich blockierte externe Assets sind keine Produktfehler.

Ausgangscommit: `ef62a8f8ba1817a2df03c96451eb806d95aa4102`.

## Bedeutung der Prüfstufen

- Inventar: Pfad und Rolle erfasst; keine inhaltliche Vollprüfung behauptet.
- Statisch: angegebene Dateien/Abschnitte gelesen und fachlich geprüft.
- Automatisch: genau benannte Prüfläufe ausgeführt; Ergebnis einschließlich Auslassungen erfasst.
- Laufzeit/UI: konkret beschriebene Abläufe tatsächlich ausgeführt bzw. gerendert.

## Bisher gelesen

### Block 16 – laufende Integrationsprüfung, 13.09.2026

- Dawarich: ausführbarer Quelltext vollständig geprüft in `services/dawarich/{countryDaySweep,dawarichClient,dawarichResolver,dawarichTester}.ts`, `services/countryDays/store.ts`, `jobs/dawarichCountryDaySweepScheduler.ts`, `routes/settings/dawarich.ts`, `schemas/dawarich.ts`. Größere Erläuterungskommentare teilweise ausgelassen, Verträge gezielt gegengeprüft.
- Immich: `routes/settings/immich.ts`, `services/immich/immichTester.ts`, `schemas/immich.ts` vollständig; `immichClient.ts` bis 235. Echter vollständiger Settingsrouter in lokalem HTTP-Schlüsselexfiltrationstest für beide Dienste: AUD-087 bestätigt. Keine externen Systeme angesprochen.
- AUD-086 ergänzt: Track-only- und gemischte Passport-/CountryDetail-Zeitspannen reproduziert. `block15-loader-probes.*` endgültig Exit 0 mit sechs Ergebnisgruppen.
- Statistik: `services/stats/records.ts`, `utils/stats/uniqueStats.ts`, `airportStats.ts`, `services/countryThresholdResolver.ts`, `utils/lodgingStats/nights.ts` und `money.ts` vollständig gelesen. Ausführbarer Quelltext/Typen aller übrigen `utils/lodgingStats/*.ts` vollständig geprüft, lange Erläuterungskommentare teilweise ausgelassen. Offen zu entscheiden: fehlende Ankunftszeitsemantik im Unique-Loader, Home-Airport-Lookup außerhalb geflogener Flughäfen; noch keine Befund-IDs dafür vergeben.
- Ein versehentlich nicht wirksamer Jest-Dateifilter hat einen **vollständigen** Backendlauf gestartet (Session 56410), weiterhin ausschließlich auf `travstats_block12_audit`. Noch kein Endergebnis; Katalogvorbedingungsfehler bei Cruise-Tests erkannt. Keine konkurrierenden Test-/Seedänderungen in dieser Datenbank, gezielter Seed-/Nachlauf erst nach Prozessende. Konsolenausgabe wird als teilweise aufgezeichnet gekennzeichnet; kein JSON-Gesamtbericht angefordert.

### Block 15 – laufende Statistikvertiefung, 13.09.2026

- Vollständige Quellprüfung: `services/stats/daysAwayLoader.ts`, `utils/stats/daysAway.ts`, `services/stats/passportLoader.ts`, `passport.ts`, `countryDetailLoader.ts`, `countryDetail.ts`, `evidenceCountry.ts`, `lodgingStamp.ts`, `flightEvidence.ts`, `trackEvidence.ts`, `shared/countryEvidence.ts`; jeweils unter `backend/src/`. Schlussabschnitt von `services/places/visitSuggestions.ts` und `utils/stats/businessStats.ts` ergänzt.
- Eigene tatsächliche Helferproben zur 15-Minuten-Grenze und zum Breiten-/Längengradraster (`block15-helper-probes.*`); authentifizierte Aufenthalts-/POI-POSTs und Statistik-GETs auf synthetischer DB (`block15-loader-probes.*`). AUD-081–085 bestätigt, beide Prozesse Exit 0, 0 externe Fetch-Versuche in API-Probe.
- Bewusste Produktentscheidungen abgegrenzt: UTC-Tagesdefinition von `daysAway`, Checkout als erster Hotelbeleg und dokumentierte Antimeridian-Grenze von Besuchsvorschlägen sind keine neu behaupteten Fehler. Projektregressionen dieses Blocks noch offen.

### Block 14 – Listen und Statistik am Fixstand 9678e6cd (13.09.2026)

- Vollständig quellengeprüft: `backend/src/routes/placeLists.ts`, `schemas/placeList.ts`, `routes/placeLists/curated.ts`, `services/places/visitSuggestions.ts`. Mitgliedschaften/Löschverhalten, Lazy-Materialisierung, Filterverbrauch und Eigentümerprüfung verfolgt. GitNexus Query und Context `listPlaceLists` genutzt; keine produktiven Symbols geändert.
- Statistikrouter `backend/src/routes/stats.ts` vollständig gelesen. Zusätzlich vollständig: `services/stats/timeseriesRows.ts`, `departureClock.ts`, `wrapped.ts`, `network.ts`, `travelAccount.ts`, `tripAccount.ts`, `utils/stats/timeseries.ts`, `dedupedCost.ts`, `businessStats.ts`, `funStats.ts`, `utils/cruiseStats.ts`, `services/punctualityStats.ts`; Barrel `utils/statsCalculator.ts`. `daysAwayLoader.ts` nur bis 95, weitere Passport-/CountryDetail-/Recordloader und Lodging-/Unique-/Airportstatistikhelfer noch offen; sie sind nicht durch bloßes Lesen des Routers vollständig geprüft.
- Frontend: `pages/AircraftPage.tsx` vollständig; `pages/PlacesListPage.tsx` nun bis 260, `Dashboard/tabs/PoiTab.tsx` Filterbereich 85–110; `StatsYearFilter.tsx` bis 125, Übersetzung `resources/de/stats.json` 602–649. Keine neue vollständige Browserprüfung dieser Seiten. Die fehlende CSV-Webfreigabe für POI aus Block 13 bleibt beachtet.
- Eigene echte API-/DB-Proben bestätigen AUD-076 (Wiederabonnieren verliert Mitgliedschaft), AUD-077 (Jahresgrenze zwischen Summary/Timeseries/Wrapped), AUD-078 (Aircraft-Profil zählt andere Statuspopulation), AUD-079 (UTC-Mitternacht als Flugnacht) und AUD-080 (Reisekosten ohne Buchungspreis/Steuern/Gebühren). Synthetische Konten, Orte, Flughafen-Zeitzonen, Flüge und EUR-Kosten; kein Produktcode ersetzt. Nur asynchrone Adressanreicherung im Listenprobeprozess gestubbt. Beide Probeskripte messen **0 externe Fetch-Versuche**. Artefakte: `block14-lists-probes.*`, `block14-stats-probes.*`.
- Positive Kontrollen: vorhandene Orte/Besuche bleiben beim Abbestellen bestehen; ausdrückliches erneutes Tick repariert Mitgliedschaft; Fremdkonto-GET/PATCH/DELETE und Fremdortaufnahme je 404. Jahresvergleich Mitte des Jahres auf allen drei API-Pfaden identisch. Summary zählt dieselbe EUR-Buchung und Einzelkosten korrekt mit 430 EUR. Erstentwurf einer Probe nutzte einen nicht existierenden Backend-Listenfilter; endgültiger Nachweis verwendet echte Listeneinträge und quellengeprüfte Frontendfilter.
- Vorhandene Projektprüfungen: **3 Listendateien / 61 Tests**, **8 Statistikdateien / 48 Tests**, alle bestanden, Exit 0. Zusammen Blöcke 12–14: **327 unterschiedliche ausgeführte Backendtests bestanden** nach Seed-Nachlauf, 9 private Sample-Skips; Testidentitäten abgeglichen, einziger ursprünglicher Seed-Setupfehler nachweislich grün wiederholt. Frontend dieses Fortsetzungsstands weiterhin 74 Tests aus Block 12. Keine Wiederholung eines vollständigen Gesamtlaufs behauptet.
- Offene kleinere Quellkandidaten, ausdrücklich noch keine bestätigten Findings: Pünktlichkeitsgrenze bei exakt 15 Minuten gegenüber `<15` im Nutzertext; geografisches Vorschlagsraster verwendet dieselbe 1-Grad-Nachbarschaft für Längen- und Breitengrad auch in hohen Breiten. Bereits erklärte Antimeridian-Einschränkung nicht als neu gefundenes Problem zählen.

### Block 13 – POI am eingefrorenen Fixstand 9678e6cd (13.09.2026)

- Vollständig gelesen: `backend/src/routes/places.ts`, `schemas/place.ts`, `shared/placeCounting.ts`, `utils/placeStats.ts`, `routes/places/visitPhotos.ts`, `services/places/placeImportCommit.ts`, `placeImportPreview.ts`, `schemas/placeImport.ts`, `routes/placeImport.ts`; `frontend/src/lib/importers/placeCsv.ts`, `components/import/adapters/poiAdapter.tsx`. Adressbackfill siehe Block 12. `PlacesListPage.tsx` bisher bis 175, API `places.ts` bis 145; keine vollständige UI-Prüfung.
- Echte authentifizierte API-/Prisma-/Multipart-Dateiproben auf separater synthetischer Probe-DB: abgeleitete Sortierung über verschiedene Seitengrößen (AUD-072); Foto-DELETE gegenüber Visit-/Place-DELETE inklusive fremdem Konto und Dateiexistenz (AUD-073). Alle geprüften Fremdkontozugriffe abgelehnt, direkte Fotolöschung bereinigt Datei korrekt.
- Echter Schema-/Preview-/Commitpfad mit vergangenen und künftigen Besuchsdaten sowie deutschem Ländernamen; gespeicherte Daten, Statistik und authentifizierter Länderfilter gegengeprüft (AUD-074/075). Manueller Länder-POST als positive Kontrolle. Keine vollständigen Import-HTTP-Aufrufe behauptet. Backend-Import vorhanden, Web-Import noch mit `POI_IMPORT_READY=false` deaktiviert und als solche Lücke in `config/betaFeatures.ts` dokumentiert.
- Eigene Probe `block13-poi-probes.cjs` / `.json` hat externe Fetch-Aufrufe abgefangen; gemessene Aufrufversuche: **0**. Alle Konten/Daten/Dateien synthetisch und ausschließlich lokal. Projekt-Tests gesondert: **5 Dateien / 68 Tests bestanden**, Exit 0 (`block13-backend-poi.json`), kein neuer Gesamtlauf.
- AUD-072 betrifft den paginierten API-Vertrag; aktuelle Webliste lädt alle Seiten und sortiert selbst. Kein reproduzierter Sortierfehler der Webliste behauptet. Ortslisten/kuratierten Listen sowie weitere Statistikpfade folgen in Block 14.

### Block 12 – eingefrorener Fixstand 9678e6cd (13.09.2026)

- Neue getrennte Quell-/Dependencykopie. GitNexus-Index passt zu HEAD; Query/Context für Parser, Restore und Geocoder verwendet. Eine genannte Prozessressource `proc_129_main` meldet „not found“; diese außerdem aus einem alten Auditprobe-Einstieg abgeleitete Graphkette nicht als Produktionsnachweis verwendet.
- Fix-Diffs und Kontext: Parser/DocumentTotal/BoundedHttp/FieldNormalization/Bookingtemplate, Importpreview/CSV/Types/Schema, Reise-Fotomerge/Cover, Modal-Fokus. Betroffene Änderungen der drei seit Block 11 neuen Fixcommits gezielt geprüft, neue Tests ausgeführt. Die Importpreview-/CSV-Diffs waren zunächst in der gemeinsamen Toolausgabe gekürzt; betroffene Funktionsblöcke anschließend gezielt nachgelesen. Keine pauschale Prüfung aller zugehörigen UI-Seiten behauptet.
- Backup-Dateikette und Restore vollständig nachgelesen; createBackup bis Ende, Datenbankdump-Auswahl und Spawnzweige erneut gelesen. Echte Linux-Prüfung des aktuellen kompilierten Codes mit lokaler synthetischer DB: vollständige Datenersetzung, alle sieben Dateiordner bytegenau, kein `uploads/uploads`; absichtlich fehlerhaftes SQL verworfen und erste Änderung zurückgerollt. Neuer AUD-069 über authentifizierte Status-/Backup-/Restore-HTTP-Endpunkte bestätigt.
- Eigene Parserproben schließen ursprüngliche AUD-051/052/053/058, belegen Restfall AUD-050. Eigene DB-Proben schließen Merge-Restfälle AUD-029/030; Preview-/Browser-Kette zeigt Restfälle AUD-056/057. Acht echte Tab-Schritte bleiben im normalen Modal; kombinierter CSV-Builder liefert genaue Koordinaten und halbe Sterne. Kein Screenshot-/Layout-Volltest in diesem Block.
- Geo: Kandidatenwahl/Schleifen, `backfillScan.ts`, `places/addressBackfill.ts` bis `writeCompletion` vollständig gelesen; Photon/Nominatim-Antwortparser nachgelesen. Fairness mit echter Lodging-DB-Selektion und gestubbter Providergrenze über drei Läufe bestätigt (AUD-070). Ungültige Providerantworten durch echte Fetch-Normalisierung/Backfill/DB bestätigt (AUD-071, P3). Kein externer Geocoder aufgerufen.
- Prüfzahlen: Backend 9 Dateien initial 149 bestanden/1 fehlgeschlagen/9 übersprungen; fehlender eigener Hotelkettenseed korrigiert, betroffene Datei 29/29 grün. Zusammen **150 unterschiedliche ausgeführte Tests bestanden**, 9 private Sample-Skips. Frontend **4 Dateien/74 Tests grün**, Backend-Build/Typecheck grün. Kein vollständiger neuer Backend-/Frontend-Gesamtlauf. Eigene Proben getrennt von Projekt-Testzahlen ausweisen.
- Keine Anwendungscodeänderungen, Commits oder Deployments. Eigene kurzlebige Tests/HTTP-Server/Browser abgeschlossen. Neuer lokaler Audit-DB-Container läuft; einmaliger Restore-Runtimecontainer regulär mit Exit 0 beendet. Keine Dienste/Container neu gestartet.

### Block 11 – eingefrorener Fixstand c824ea3b (11.09.2026)

- Vollständig gelesen/geprüft: `backend/src/services/lodging/geocodeBackfill.ts`, `chainFromWebsite.ts`; `services/geo/googlePlaces.ts`, `photon.ts`, `nominatim.ts`, `backfillScan.ts`; `services/fx/frankfurter.ts`, `currencyApiCdn.ts`, `resolver.ts`, `snapshot.ts`; `frontend/src/components/location/LocationInput.tsx`, `useLocationSearch.ts`; `components/lodging/LodgingFormModal.tsx`. ApiKey-Resolver nur bis 200, ParserSettings bis FX-Helfer, Client-/Format-/Routeausschnitte gezielt nachgelesen; diese Zusatzdateien nicht als vollständig geprüft zählen.
- Eigene isolierte Gegenproben: AUD-061–064 über echte Geocoding-/Prisma-Pfade mit vollständig ersetztem Fetch, keine externen Provideranfragen. 10 Probegruppen einschließlich FX-Metadaten-/Validierungsbeobachtungen und positiver Kontrollen für bekannte Website-Domains vs. Lookalikes. Ergebnisse/Quellprobe `block11-probes.json`/`.cjs`.
- AUD-065–067: echte API-/Snapshot-/DB-Kette mit lokalem HTTP-Provider; Clientabbruch nach 10 Sekunden, danach dennoch persistierter Aufenthalt; neuer Snapshot mit veraltetem aktuellem Tageskurs; ungültiger Nullkurs durch echten Stay-POST gespeichert. `block11-fx-http.json`/`.cjs`. Keine Echtkurse oder personenbezogenen Buchungen angefragt. Ungültiger Kurs bleibt ein bedingtes Robustheitsproblem (P3), keine Behauptung eines realen Providerfehlers.
- Frontend gezielt: **7 Testdateien / 79 Tests bestanden**, Exit 0 (`block11-frontend-tests.json`); LocationInput/-MapModal, CurrencySelect, LodgingFormat und CurrencyBreakdown. Zusätzlich **3 eigene React/jsdom-Reproduktions-/Kontrolltests** mit echtem Hotel-Modal + LocationInput für AUD-068 (`block11-location-ui.json`). Kein vollständiger neuer Frontendlauf/keine visuelle Layoutprüfung.
- Neuer ausschließlich lokaler tmpfs-Container für dieses Audit; **132 Migrationen erfolgreich**, Kataloge samt 18.017 Flughafen-Zeitzonen auf separater Jest-DB gesät. Eigene Proben laufen auf einer anderen Datenbank im selben Container. Backend-Gesamtlauf gestartet, endgültiges Ergebnis wird nachgetragen; bisherige Photon-/Nominatim-Testabweichungen stammen von der eigenen vorsorglichen URL-Umleitung, Wiederholung ohne diese Variable vorgesehen.
- Während der Prüfung fremder Dokucommit `d3755c68` und neue laufende Import-/Batch-Fixes im Hauptworktree beobachtet. Eingefrorene Prüfkopie bleibt unverändert (nur eigenes Testskript unter `frontend/audit/` ergänzt). Hash-Gegenprüfung: sechs betroffene Geo-/FX-Kerndateien waren bei Prüfung weiterhin identisch. Neue fremde Fixes sind noch nicht durch diesen Lauf validiert.
- Weitere offene Punkte: vollständiger Restore-Roundtrip, Fairness/erneute Versuche bei mehr als 500 dauerhaft unauflösbaren Geocoderzeilen, mehrsprachige Ortsvergleiche, Providerantworten mit unzulässigen Koordinaten, übrige Buchungsanbieter-/CSV-/Maps-/Mappingparität; große Statistik-/POI-/Cruise-/Job-/Integrationsbereiche laut Gesamtplan weiterhin offen.

**Abschluss Backend-Gesamtlauf:** 492 Testdateien erfasst, 488 bestanden, 2 fehlgeschlagen, 2 komplett übersprungen; 4.214 Tests bestanden, 2 fehlgeschlagen, 11 übersprungen, 730,228 s (`block11-backend-full.json`). Die beiden Fehler sind der erklärte eigene URL-Umleitungseffekt. Nachlauf ohne PHOTON_URL/NOMINATIM_URL: **2 Dateien / 42 Tests bestanden**, Exit 0 (`block11-backend-geocoder-rerun.json`). Beide ursprünglich fehlgeschlagenen Testidentitäten wurden einzeln mit dem Nachlauf abgeglichen. Ergebnis über Erstlauf und gezielten Nachlauf: **alle 4.216 ausgeführten Tests bestanden**, 11 weiterhin übersprungen; kein in einem einzigen Lauf vollständig grünes Erstresultat behauptet. Skips: 1 Windows-Datei-Restoretest und 10 nicht mitkopierte private Parser-Sampletests.

**Neuer separater Fixstand `4956235f`:** während des Blocks abgeschlossen, behebt laut Commit AUD-043–049/054/055. Neue eingefrorene Kopie `.tmp/audit-import-fixes-4956235f`. Prisma-Schema und Backend-Pakete gegenüber c824ea3b unverändert. Vier geänderte Testdateien auf eigener Jest-DB ausgeführt: **59/59 bestanden**, 23,767 s, Exit 0 (`block11-import-fixes-4956235f.json`); 29 Commit-, 18 Preview-, 9 Undo-/Batch- und 3 Flugbatchtests. Alle sechs produktiven Fix-Diffs gelesen. Kein neuer Gesamtlauf und keine vollständige Wiederholung aller früheren eigenen Reproduktionen für diesen Stand behauptet. Typecheck mit anfänglicher Verknüpfung auf die eigene vorherige Audit-Dependencykopie meldete TS2742 wegen des kopienübergreifenden Paketpfads; deshalb ausschließlich die eigene geprüfte Junction nichtrekursiv entfernt und durch physische Dependencies ersetzt. Keine Installation/Prisma-Regeneration, keine Änderung an anderen Abhängigkeiten.

Abschließender Typecheck der separaten 4956235f-Kopie mit physischen Dependencies: **bestanden, Exit 0**, `block11-import-fixes-typecheck-rerun.log` leer. Der vorherige TS2742 war damit als eigener Isolationseffekt eingegrenzt. Alle Test-/Probeprozesse dieses Blocks abgeschlossen; eigener Datenbankcontainer bleibt für die Fortsetzung vorhanden.

### Block 10 – aktueller Fixstand c824ea3b (10.09.2026)

- Abschluss dieses Blocks: zusätzlich `frontend/src/lib/importers/lodgingCsv.ts` **vollständig (614 Zeilen inklusive zuvor gekürztem Aliasabschnitt)** und `lib/lodgingImportResult.ts` vollständig gelesen. Bisheriges „noch in Arbeit“ in der folgenden chronologischen Liste ist damit überholt.
- Neue eigene Laufzeitbelege AUD-057–060: echter Browserpreisnachtrag plus unverändertes Browserpayload im echten Commit (Preis fällt weg); lokaler Parser-Stream mit kleiner Deadline tröpfelt darüber hinaus bzw. bleibt nach Abbruch unerledigt; tatsächlicher CSV-Builder + Schema zeigt falsche Koordinaten mit 3 Nachkommastellen und still verworfene 0,5-Bewertungen. Alle Probeprozesse einschließlich Browser und Stubserver beendet.
- Vorhandene zielgerichtete Tests: Backend **9 Dateien / 106 bestanden / 9 private-Sample-Skips**, Frontend **5 Dateien / 76 bestanden**, beide Exit 0. JSON-Berichte `block10-backend-tests.json`, `block10-frontend-tests.json`. Keine neuen persistenten Anwendungstests implementiert. Kein vollständiger Backend-Gesamtlauf in diesem Block.
- Offene Gegenproben nach Quellread, **nicht als neue bestätigte Findings gezählt**: FX-Provider ohne eigene Deadline, tatsächlicher Kursstichtag gegenüber angefragtem Tag und Cachelebensdauer; Bestätigungsreferenzen verschiedener Buchungsanbieter; CSV-Feldwarnungen werden eventuell irreführend als ausgelassene Zeilen dargestellt; Maps-Listen/visited-Parität. Geocoding-/Websiteketten und übrige CSV-/Mapping-/Mapsexport-Helfer noch vertiefen. Vollständiger Gesamtaudit bleibt offen.

- Vollständig quellengeprüft in `.tmp/audit-fixes-20260910`: `services/lodging/lodgingImportPreview.ts`, `lodgingCandidates.ts`, `nameSimilarity.ts`, `proximityMatch.ts`, `lodgingBookingParser.ts`, `bookingComTemplate.ts`, `lodgingFieldNormalization.ts`, `documentTotal.ts`, `mappingSuggestion.ts`; FX `resolver.ts`, `frankfurter.ts`, `currencyApiCdn.ts`. Commit/Schema anhand der neuen Fälle nachgelesen (bereits vollständig in vorherigem Block).
- Frontend vollständig: `components/lodging/LodgingImportPreviewModal.tsx`, `components/import/adapters/lodgingAdapter.tsx`, `LodgingCsvImportTile.tsx`, `MapsExportImportTile.tsx`, `lib/api/lodgingImport.ts`. Noch in Arbeit: `lib/importers/lodgingCsv.ts` (1–240 gelesen, ein Aliasabschnitt aus gekürzter Ausgabe nachholen), übrige CSV-/Mapping-/Mapsexport-Helfer.
- Echte Parseraufrufe mit lokalem Ollama-HTTP-Stub, synthetischen Dokumenten und explizit isolierten Umgebungsvariablen bestätigen AUD-050/051. Template-/Board-Helferproben bestätigen AUD-052/053. Keine externen KI-Anfragen. Erste Unicode-Templateprobe durch Shellencoding ungültig; korrekt mit Unicode-Escapes wiederholt, nur Wiederholung als Beleg verwendet.
- Neuer eigener PostgreSQL/PostGIS-Container `travstats-audit-block10-20260910` (tmpfs, Loopback 55439); 132 aktuelle Migrationen erfolgreich. Frühere Auditcontainer sind verschwunden; keine alten Fixtures vorausgesetzt. Echte Preview-/Commit-Schemas und Prisma bestätigen Unicode-Fehlzuordnung AUD-054 sowie Reihenfolgeproblem AUD-055 mit erfolgreicher umgekehrter Kontrollreihenfolge auf getrennten Konten. Erste Probe ohne Pflichtfeld `fileName` war ein Fixturefehler; danach mit `fileName:null` wiederholt. Die erste Reihenfolgekontrolle traf zusätzlich eine Namensheuristik auf vorherige Testdaten; getrennte frische Konten vermeiden diese Störung.
- AUD-056: echte React-Importvorschau in Headless-Chromium (Übersetzung/Logger isoliert, keine Netzwerkzugriffe): Name/Stadt nicht editierbar, kein Match-Ablehnen, create übermittelt Bestands-ID. Separater echter Service-/DB-Nachweis: 0 neue Hotels, Aufenthalt an vorgeschlagener ID. Nur Komponenteninteraktion geprüft, keine neue vollständige Seiten-/CSS-Abdeckung.
- GitNexus Navigation/Context verwendet, aber Overview-MCP meldet trotz CLI „Already up to date“ weiterhin alten Cache. Keine zuverlässigen Prozessressourcen für diese Symbole vorhanden (`processes:[]`); vollständige Quellketten als maßgeblichen Nachweis benutzt.

### Fix-Nachprüfung am 10.09.2026 (Commit c824ea3b, getrennt von Ausgangsprüfung)

- Nachtrag: Fix-Diffs Flug-CRUD/Batch/Chronologie/Zusatzfelder/Delay; Reise-Status/Bounds/Sweep/Cleanup/Detection/MergeRelations/Stop-Leg-Neuberechnung; Trackparser/Ingestion/Adoption und zugehörige Schreibpfade jetzt gegengelesen. Vorher gekürzte Stellen `mergeTripRelations.ts`, `tripCleanupService.ts`-Leerheitsregel und `ingestTrack.ts`-Indexzuordnung nachgelesen. Zusätzliche Diffs E-Mail-Dateicleanup, Katalog-/Training-/Fotojourney-PAT-Schutz und Encryptionmarker geprüft.
- Eigene aktuelle Kombinationsproben ergänzen grüne Projekt-Regressionssuite: Mehrquellen-Fotoduplikatmerge P2002, Cover nach Foto-Deduplikation kaputt, Flugbatch-FX-null-Key-Kollision (AUD-049), Guard-Ausnahmen und Alt-Klartext-Lesbarkeit. Details und Grenzen `FIX_REVIEW.md`.
- Browser-Gegenproben Fixstand: Restore bei 320×568 innerhalb Viewport, Escape/Initialfokus korrekt, Tab-Fokus verlässt Dialog; echter Cold-Cruise-Detailaufruf ohne Settings-Storage erfolgreich; Settings-Autosave mit verzögertem PUT und weiterer Änderung vollständig gespeichert. Zwei neue Screenshots gespeichert und visuell geprüft. Keine echten Restores und keine Nutzerdaten. Neue eigene UI-Backend-/Viteprozesse danach gezielt gestoppt.

- Neue eingefrorene Kopie `.tmp/audit-fixes-20260910`; beide Abhängigkeitsverzeichnisse physisch isoliert. Zwei neue eigene Testdatenbanken (Jest / separate eigene Proben), je 132 Migrationen bestanden. Beide Typechecks bestanden.
- Frontend-Gesamtsuite: 432 Dateien, 3.686 Tests bestanden. Backend: **nur** 27 seit Auditbasis neue/geänderte Regressionsdateien ausgewählt; 26/159 grün, 1/1 Windows-Skip. JSON-Ergebnisse im Auditverzeichnis, Einzelheiten `FIX_REVIEW.md`.
- Fix-Diffs Auth/PAT/JWT/Session/Passwortreset/Admin-Userlock, Uploadbesitz, Settingsstore/-vertrag, Domainrouten, Profil und Restore-Dialog, Backup-DB/-Restore sowie Unterkünfte/StayMerge/Pricing/Dateicleanup gelesen. Reise-/Track-/Flug-Fixdetails noch in Nachprüfung; grüne Tests ersetzen nicht diese Quellprüfung.
- Original-Unterkunftsprüfung vervollständigt: `lodgingMemberships.ts`, `lodging/photos.ts`, `lodgingGeocode.ts`, `lodgingImport.ts`, `lodgingImportBatches.ts`, `lodgingImportCommit.ts`, `schemas/lodgingImport.ts` und `shared/lodgingCounting.ts` vollständig (vorher fehlende Ausgabestücke nachgelesen). Parser/Preview/Candidates und weitere Import-/FX-Services überwiegend noch offen.
- Eigene aktuelle Proben: AUD-043–045 über echtes Schema+Service+Prisma erneut bestätigt; AUD-046 via echter Batch-GET/-DELETE; AUD-047 via tatsächlichem Upload und Undo mit Dateiexistenzprüfung; AUD-048 via Schema+Service+Prisma. Nur synthetische Datensätze, keine Geocodingjobs, keine externen FX-Anfragen. Ergebnisse `FINDINGS.md`/`FIX_REVIEW.md`.

### Ergänzung Block 8 (10.09.2026)

- Unterkunftsblock: `backend/src/routes/lodging.ts` (785 Zeilen) und `schemas/lodging.ts` vollständig; `shared/lodgingTiming.ts`, `shared/stayPricing.ts`, `services/lodging/stayMembership.ts` vollständig. `shared/lodgingCounting.ts` nahezu vollständig, ein Kommentarabschnitt in Ausgabe gekürzt – vor Abschluss kurz nachlesen. AUD-038–041 über echte Create-/PATCH-/Trip-GET-Endpunkte mit neuen synthetischen Konten bestätigt. Keine Geocoding-/FX-Provideranfragen: Hotel direkt als Fixture angelegt, nur EUR bzw. fehlende Datumswerte.
- Nachprüfung der kleinen Restore-Screenshots: Erstes Bild war leer am Scrollübergang. Neue stabile Vorher-/Nachherbilder belegen die abgeschnittene Überschrift/Buttons; beide visuell gelesen, Fundstelle korrigiert. Keine Behauptung eines vollständig verschwindenden Dialogs.

- Restore 320×568: Panel und Buttons tatsächlich abgeschnitten, Mausrad scrollt Dialog nicht (AUD-037). Screenshots beider neuen Größen visuell gelesen. Alle kurzlebigen Headless-Probeprozesse abgeschlossen; nur eigene länger laufende UI-Backend-/Viteprozesse und Auditcontainer bleiben für weitere Prüfung aktiv.
- Neu begonnen: `backend/src/routes/lodging.ts:1–200` gelesen. Weitere Unterkunftsrouten/Services/Schemas überwiegend noch offen.

- Gegenprobe widerlegt einen Tour-Kandidaten: `requireWriteScope` ist methodenabhängig und lässt GET/HEAD/OPTIONS ausdrücklich durch. Echte Read-PAT-Abfragen von `/tours`, Reiserouten, Geometrie und Tracks jeweils 200 wie Cookie. Kein Befund zu diesen GETs. Auch fractional `drivingMinutes` führt nicht zu 500: Prisma speichert 91/60 Minuten als Integer 1; nur Genauigkeits-/Rundungsaspekt, kein gemeldeter schwerer Fehler.
- `frontend/src/pages/AdminPage.tsx` vollständig gelesen. Restore-Dialog bei 390×667 visuell geprüft: passt mit 636 px Höhe vollständig in diesen Viewport. URL-Tippfehler AUD-011 jetzt real reproduziert; Escape schließt nicht, Dialogsemantik fehlt. Kleinerer Viewport 320×568 noch laufend. Erster Layoutprobe-Fehler war ein ungeeigneter Emoji-Selektor im Audit-Script, kein Anwendungsfehler.
- Kontowechsel-Profilverlust AUD-036 real im Browserstore und Serverprofil bestätigt. Neues Konto-Serverprofil wurde korrekt geladen und anschließend vom Scrub-Zweig geleert; keine echten Profile verwendet.

- Alle sieben zuvor erzeugten mobilen Screenshots jetzt visuell gelesen. In diesen Listen-/Leerzuständen keine Überlagerungen; Flugtabelle wird innerhalb ihres Containers beschnitten (horizontale Bedienung noch gesondert prüfen, kein pauschaler Seitenüberlauf-Befund). Instanznamen-`?` im Screenshot stammt vom synthetischen Testnamen, nicht als UI-Encodingfehler werten.
- Settings-Autosave-Race durch echten Bildschirm/Store mit kontrolliert verzögertem ersten PUT bestätigt (AUD-035), keine nachgebildete Implementierung. Routingservices/-Adapter `routeLeg.ts`, `resolveProvider.ts`, `types.ts`, `openRouteService.ts`, `graphHopper.ts`, `customOsrm.ts` vollständig gelesen; keine externen Provideranfragen ausgeführt. Offene Kandidaten: fehlende eigene Netzwerkdeadline; reine Tour-GETs verlangen Write-PAT; Strecken-Neurouting kann manuelle/Trackgeometrie überschreiben.

- Tourrouter `tourLegs.ts`, `tourRouting.ts`, `tourTracks.ts`, `tourIndex.ts` vollständig gelesen; Trackservices `parseGpx.ts`, `ingestTrack.ts`, `adoptTrack.ts`, `pullDawarichTrack.ts` vollständig gelesen. Routingprovider/Adapter noch offen. `tripDetection.test.ts` bislang nur 1–100, weitere Suchtreffer nicht als gelesen werten.
- Neue Laufzeitbelege AUD-032–034: Storno-/Ersatzflug-PNR, GPX-Segmentabflachung, Messwertverlust durch Adoption vereinfachter Trackgeometrie. Letzte zwei zunächst Helferketten, kein HTTP-Upload in diesen Proben. GPX-Segmentbedeutung mit offizieller Schema-Dokumentation geprüft.

- Nachtrag: `tripDetectionService.ts` durch 245–530 und Kontrollreads jetzt vollständig; `frontend/src/components/Trips/TripCleanupModal.tsx` und `backend/src/utils/geo.ts` vollständig. Micro-Cleanup mit Hotel/POI/Album/summary tatsächlich reproduziert (AUD-031). Erkennungsheuristik auf Storno-/Ersatzflug-Auswahl noch gegenprüfen.

- `tripCleanupService.ts` vollständig gegengelesen; `tripDetectionService.ts` 531–Ende zusätzlich gelesen (245–530 noch offen).
- Prisma: Trip/TripPhoto/TripImmichAlbum, TripStop, TripJournalEntry, Lodging/LodgingStay, Place/PlaceVisit vollständig gelesen; übrige Tour-/Immichmodelle noch teilweise.
- Echte isolierte API-/DB-Proben: Zusammenführung aller oben genannten synthetischen Relationstypen, Cover-Upload/Abruf vor und nach Merge; Dry-run und Commit der Reiseerkennung mit flugloser Tagebuch-/Stopreise. AUD-028–030 bestätigt. Keine externen Integrationen aufgerufen.

### Ergänzung Block 6

- Vollständig gelesen: `backend/src/routes/flights.ts` (1.581 Zeilen), `flightsBatch.ts` (423), `backend/src/schemas/flight.ts`, `receiptUrl.ts`, `backend/src/services/flightAirportFacts.ts`, `fx/snapshot.ts`; `frontend/src/App.tsx` und `components/Settings/useSettingsPage.ts` durch Schlussabschnitte vervollständigt; `backend/src/index.ts` durch Nachlesen 480–525 vervollständigt.
- Teilbereich: `backend/prisma/schema.prisma:235–462` (Flightmodell; eine Kommentarzeile im Indexabschnitt gekürzt), `backend/src/services/airportLookup.ts:480–590`.
- Laufzeit: Ortszeit-/UTC-Chronologie, partielles Zeitupdate, kontoübergreifende Belegreferenz, sieben still verworfene Flugfelder, stale Delay und Einzel-/Batchparität (AUD-018–022).
- `ui-cold-cruise-link.png` und `ui-settings-desktop.png` visuell geprüft: saubere Desktop-Grundlayouts im synthetischen Leerkonto, keine Überlagerung in diesen Zuständen. Noch keine Aussage über mobile Formulare, große Datenmengen oder alle Dialoge.

| Dateien/Bereich | Stufe | Bemerkung |
| --- | --- | --- |
| `AGENTS.md` | vollständig | Projektregeln |
| `package.json`, `frontend/package.json`, `backend/package.json` | vollständig | Skripte und Abhängigkeiten |
| `README.md` | Zeilen 1–240 | Produktumfang, Betrieb, bekannte Grenzen |
| `backend/jest.config.js`, `backend/jest.setup.ts` | vollständig | Testumgebung und Nebenwirkungen |
| `frontend/vitest.config.ts`, `playwright.config.ts` | vollständig | Frontend-/Browserprüfung |
| `.github/workflows/ci.yml` | vollständig | Gates und dokumentierte bekannte Probleme |

## Prüfläufe

Die chronologischen Aktualisierungen unten enthalten die ausgeführten Prüfungen. Lokale Werkzeuge: Node `v24.11.0`, npm `11.8.0`. CI verwendet Node 22; Unterschiede bei Laufzeitbefunden berücksichtigen.

### Aktueller Baseline-Endstand (Block 5)

- Backend-Jest: 469 Suites gesamt, 467 bestanden, 1 fehlgeschlagen, 1 übersprungen; 4.101 Tests bestanden, 1 fehlgeschlagen, 10 übersprungen, 705,196 s. Der einzige Fehler war eine Auditvorbedingung (`maxUsers=1` aus eigener Bootstrapprobe), keine bestätigte Produktregression. Nach Rücksetzen ausschließlich dieser synthetischen Konfiguration: betroffene Suite mit allen **17 Tests bestanden**, Exit 0. Original- und Wiederholungsergebnis liegen getrennt als JSON vor.
- Frontend: 426 Suites / 3.661 Tests bestanden.
- Frontend-Produktionsbuild: bestanden, 4.521 Module, 62 s. Größenwarnung u. a. MapLibre-Chunk 1.060,63 kB; noch keine Aussage über tatsächlich initial geladene/komprimierte Gesamtmenge.
- Schema-Driftcheck: mit eigener leerer Shadowdatenbank und expliziter `SHADOW_DATABASE_URL` bestanden; 129 Migrationen passen zum Schema.
- Dateigrößengate: bestanden, 1.135 Quellen, 20 bestehende Baseline-Ausnahmen über 800 Zeilen.
- Npm-Sicherheitsaudit: Root 0, Backend 4 Pakete hoch, Frontend 15 Pakete (10 hoch, 5 mittel). Registry-Rohdaten separat abgelegt. Abhängigkeitspfad und praktische Erreichbarkeit noch prüfen; Anzahl betroffener Pakete ist nicht Anzahl unabhängig ausnutzbarer App-Lücken.

Zusätzlich vollständig gelesen: `backend/src/utils/encryption.ts`, `encryptionKey.ts`, `apiTokens.ts`; `backend/src/services/backupScheduler.ts`, `cloudSyncService.ts`; `backend/src/middleware/upload.ts`; `backend/src/routes/settings/general.ts`, `profile.ts`, `admin/backupSettings.ts`; `frontend/src/store/settingsStore.ts`, `authStore.ts`; `frontend/src/hooks/useEnabledDomains.ts`, `useSessionValidation.ts`; `frontend/src/components/DomainRouteGuard.tsx`, `Settings/FeaturesSection.tsx`, `Admin/BackupManagement.tsx`; `frontend/src/pages/LoginPage.tsx`; `frontend/src/lib/api/backup.ts`, `client.ts`, `logger.ts`; `backend/src/shared/domains.ts`. Backend `index.ts` über ergänzende Teilreads nun weitgehend geprüft, Abschnitte 220–525 in vorheriger Ausgabe am Ende knapp gekürzt, vor Abschluss 480–525 gegenlesen. Frontend `App.tsx` bis 480 gelesen; Rest offen. `Settings/useSettingsPage.ts` bis 420, Rest offen.

### Aktualisierung Block 2

- Typechecks beider Projekte: bestanden (Exit 0).
- Lint beider Projekte: bestanden (Exit 0).
- Frontend-Vitest: läuft; endgültiges Ergebnis noch ausstehend.
- Zusätzlich vollständig gelesen: `backend/jest.globalSetup.ts`, `frontend/src/__tests__/setup.ts`, `frontend/vite.config.ts`, `backend/src/db.ts`, `backend/src/middleware/auth.ts`, `backend/src/middleware/errorHandler.ts`, `backend/src/config/env.ts`, `backend/src/routes/auth.ts`, `backend/src/utils/session.ts`, `backend/src/utils/jwt.ts`, `backend/src/routes/passwordReset.ts`, `backend/src/routes/admin/users.ts`, `backend/src/routes/settings/tokens.ts`, `backend/scripts/seed-test-catalogues.ts`.
- Nur teilweise gelesen: `backend/src/index.ts` (bis ca. 440, Ausgabekürzungen nachzulesen), `backend/src/routes/mounts.ts` (Importbereich teilweise gekürzt), `backend/prisma/schema.prisma:1–140`, `backend/src/seedAirportsFromCSV.ts:1–100`.

## Größeninventar (Quell-/Konfigurationsdateien, ohne JSON/Datenassets)

| Bereich | Dateien | Zeilen |
| --- | ---: | ---: |
| Backend-Routen ohne Tests | 94 | 24.685 |
| Backend-Services ohne Tests | 235 | 50.382 |
| Backend-Utils ohne Tests | 53 | 11.288 |
| Backend-Schemas | 24 | 2.834 |
| Backend-Jobs | 8 | 1.108 |
| Backend-Shared | 29 | 3.482 |
| Frontend-Komponenten ohne Tests | 388 | 77.589 |
| Frontend-Seiten ohne Tests | 32 | 14.644 |
| Frontend-Lib ohne Tests | 132 | 16.966 |
| Frontend-Hooks ohne Tests | 26 | 1.698 |
| Frontend-Stores ohne Tests | 17 | 1.572 |
| Frontend-Shared | 21 | 2.241 |
| Tests/Mocks über alle Bereiche | 918 | 129.295 |

Weitere Konfigurationen, Migrationen, Skripte, Tools und Assets gehören zum Gesamtinventar; diese Tabelle ist noch keine vollständige Prüfabdeckung.

### Aktualisierung Block 3

- Vitest: **426 Dateien / 3.661 Tests bestanden**, Exit 0, 32,16 s.
- Prisma: **129 Migrationen auf leerer isolierter Datenbank erfolgreich**.
- Eigene Laufzeitprüfung: konkurrierende Registrierung, bestehende Cookies nach Passwortwechsel/-reset, 2FA-/Passkeymutation mit Read-PAT, Pflichtpasswortwechsel nach 2FA. Siehe AUD-002 bis AUD-005.
- Zusätzlich vollständig gelesen: `backend/src/routes/auth/twoFactor.ts`, `backend/src/routes/auth/passkeys.ts`, `backend/src/routes/setup.ts`, `backend/src/services/webauthn/challengeStore.ts`, `backend/src/services/webauthn/rpConfig.ts`, `backend/src/services/twoFactor/totpService.ts`, `backend/src/services/twoFactor/recoveryCodeService.ts`, `backend/src/schemas/auth.ts`, `backend/src/utils/password.ts`, `backend/src/routes/admin/index.ts`, `backend/src/routes/settings/index.ts`, `backend/src/config/uploadDirs.ts`, `backend/src/services/backup/__tests__/archiveUploads.test.ts`.
- Weitere Teilprüfung: `instanceSettingsService.ts` (Kernlogik gelesen, einige Abschnitte wegen gekürzter Ausgabe offen), `logger.ts:1–200`, `encryption.ts:1–120`, `jwtSecret.ts:1–95`, `rateLimit.ts:1–140,200–251`, `logoCache.ts:1–85`, `auth.test.ts:1–45`.

### Aktualisierung Block 4

- Vollständig gelesen: `routes/uploads.ts`, `routes/backup.ts`, `routes/airports.ts`, `routes/import.ts`, `routes/photoJourneys.ts`, `routes/training.ts`, `routes/emailParse.ts`, `services/backupService.ts`, `services/backup/backupRestore.ts`, `services/backup/backupFiles.ts`, `services/backup/backupConfig.ts` (alle unter `backend/src/`); `backend/scripts/check-schema-drift.ts`; `e2e/auth.spec.ts`, `e2e/flights.spec.ts`.
- Teilweise: `backend/src/services/backup/backupDatabase.ts:251–372,416–505`, `cloudSyncService.ts` Schlussabschnitt, `frontend/src/App.tsx:1–225`, `scripts/check-file-size.mjs:1–115`.
- Backend-Gesamtsuite läuft; Abdeckung noch nicht bewertet.
- Zusätzliche Laufzeitbelege: tar-Rücksicherungsziel und SQL-Restore auf synthetischer Markertabelle (AUD-006/007).

### Ergänzung Block 16 – Integrationen, Cruise und Gesamttests

- Auf 9678e6cd ausführbaren Code vollständig gelesen (lange Blockkommentare in der zeilennummerierten Auditansicht teilweise ausgelassen): Immich types/client/tester/resolver/assetCache/import, Routen assetProxy/tripCover/tripAlbums und Settings Immich/Dawarich samt Schemas/Index; Dawarich client/resolver/tester/errors/countryDaySweep/countryDays store/reduce/knownAirports und Sweepjob. Relevante Speicher-/Sweepverträge zusätzlich ungekürzt gelesen.
- Cruise: routes/cruises, routeOverride, Schema; Distance index/marnet/river/haversine/polyline/cruiseLegService; shared portSequence/legRouteKey; cruiseBookingParser und cruiseEntityResolver. Vorher gekürzte Parserabschnitte nachgelesen. Distance types noch offen; frontend/lib/api/cruise nur 1–110. AUD-088–090 durch echten Router/Prisma belegt, fremder Cruise-PATCH korrekt 404, keine fremden Detaildaten offengelegt.
- Jobs vollständig im ausführbaren Code: dataQualitySweep/statusSweep/placeAddressBackfill/usageStats/airlineLogoRefresh/historicalEnrichment; flightUpdateScheduler bisher nur 1–110. Services statusSweep/reminderScheduler/emailService/flightEnrichmentService/pendingUpdateService/flightAutoUpdate; routes/pendingUpdates vollständig. Keine Scheduler ausgeführt, keine Nachrichten versendet. Automatisches Nichtändern des Flugstatus ist ausdrücklich dokumentierte Entscheidung, kein neuer Befund.
- AUD-087: echter HTTP-Empfänger bestätigt globale synthetische Credentials an nutzergewählter Test-URL bei Normalnutzer; Auth-Kontrolle 401 ohne ausgehende Anfrage. AUD-091: zwei synchronisierte synthetische Providerantworten, ein Erfolg/ein P2002, ein DB-Datensatz; späterer Lookup erfolgreich. Kein realer Providerzugriff.
- Backend 492 Dateien/4.262 Tests: 4.179 Pass, 72 Fail, 11 Skip ohne vollständigen Katalogseed. Danach Seed Exit 0, alle 14 Fehlerdateien 107/107 Pass, nativer Exit 0. Berichte block15-backend-full-summary.json (Konsole nur teilweise erhalten) und block16-backend-seeded-rerun.json; Identitätsabgleich aus ursprünglicher Fehlerzusammenfassung noch offen. Airport-Race wird durch Seed verdeckt, bleibt eigener Produktbefund.
- Frontend 432 Testdateien, 3.705 Tests vollständig bestanden, JSON success:true. Beschreibungsblöcke (1.150) nicht mit Dateien verwechseln. jsdom-/XHR-/Canvas-/Navigationwarnungen vorhanden; PowerShell-stderr-Wrapper meldete Exit 1, kein separat erfasster nativer Exit. Kein Testfehler laut JSON.
- Haupt-HEAD 47efa271 liegt einen WebDAV-UI-Commit vor der festen Auditbasis. Haupt-Worktree enthält zusätzliche fremde Flughafen-/Upcoming-Arbeit. Beides nicht durch die obigen Läufe abgedeckt.

### Block 17 – Laufzeitvergleich, Browser und aktuelle Grenzen

- Pending-Update-Kette und Frontend PendingUpdatesPage/PendingUpdateEditor/PendingUpdateCard ausführbarer Code gelesen; tatsächliche API-/UI-Gegenproben AUD-092–096, inklusive fremdes Apply 404. Wiederholtes Bearbeiten aus der tatsächlichen UI ergibt 500 und schließt den Editor dennoch. Datumsfeld in Europe/Berlin springt bei Eingabe 10:30 auf 08:30 und speichert 08:30Z. 8 unbenannte Inputs, Fokus außerhalb und Escape ohne Wirkung. Standard-Modal-Fix aus AUD-037 hilft diesem eigenständigen Overlay nicht automatisch.
- Backend-Fehleridentitäten: 72/72 aus ursprünglicher Gesamt-Fehlerzusammenfassung im gesäten Nachlauf wiedergefunden und bestanden. 4.251 verschiedene bestandene Tests/11 Skip aus Gesamt- und Nachlauf, keine Summierung aller 107 Nachlauftests. Vollständige Frontend-Suite 3.705/432. Beide Typechecks, Frontend Build/Lint und Backend-Projektlint bestanden; letzteres 3 ungenutzte Imports als Warnungen. Erster breiterer eigener Backendlint-Aufruf nahm auch JS-Hilfsskripte auf, entspricht nicht dem Gate.
- Maßgebliche Browserartefakte ausschließlich `block17-ui-browser-production.*` und `block17-ui-images-production/`, lokale echte Produktionsbuild-Dateien. 69 Navigationszustände/3 Größen, 17 unterschiedliche erreichte Pfade; Featuregate-Redirects sichtbar protokolliert. Browser-UI mit blockierten externen Assets ist kein visueller Kartennachweis. Frühere `block17-ui-browser.*`-Screenshots mit falschem Tailwind-CWD und erster E2E-Lauf ausdrücklich als fehlerhafter Auditaufbau verworfen; v2-Vite ebenfalls nicht als Ergebnis werten.
- Visuell gelesen bisher: Produktionsbilder 1440-00 (Dashboard, externe Basiskarte blockiert), 390-06 (Flugliste mit horizontalem Tabellencontainer, externe Flaggen blockiert), 1440-17 (Statistik), 320-21 (Settings), Pending-Editor Mobilbild. Weitere Bilder noch zu lesen, Formularaktionen/Featuregate-Flächen noch offen. Cruise-Fixture hatte zunächst irrtümlich `completed` statt zulässigem `flown`; korrigiert ausschließlich an eigener synthetischer Zeile, ältere entsprechende Statustexte nicht als Fehler werten.
- Paketpfade via npm ls erfasst: backend Multer 2.2.0, Nodemailer 9.0.6, Undici 7.28.0 (Cheerio/OpenAI), js-yaml 3.15.0 nur Testwerkzeuge; frontend js-yaml 4.3.0 ESLint, DOMPurify 3.4.12 unter jsPDF, fflate 0.7.4 in Deck.gl-Kompression (jsPDF nutzt separat 0.8.3), image-size unter Texture-Compressor/Deck.gl. Kein unmittelbarer App-Aufruf von js-yaml, DOMPurify IN_PLACE/Hooks, unzipSync, image-size oder Undici-Cache-/Retryinterceptors gefunden; reine Suchbefunde/Pfadprüfung noch keine erschöpfende Unerreichbarkeitsgarantie.
- Multer-Sicherheitsmeldung und offizieller Regressionstest online abgeglichen. Windows Node 24.11.0: echter Uploadrouter 401 ohne Auth, 500 mit RangeError bei Auth; Fehler gelangt an Express. Linux Node 22.23.2 aus lokaler vorhandener Runtime, echte eingefrorene dist: 401 ohne Auth, mit Auth unbehandelte RangeError. Kleine Streaminganfrage 202 Bytes, keine Lastprobe; eigener exception observer verhindert wirklichen Probeabsturz. App-Index beendet sich sonst bei uncaughtException. AUD-097 bestätigt, zweiter Linux-Check Exit 0. Eigene erste Assertversion erwartete irrtümlich Express-RangeError auch unter Linux; korrigierter finaler Beleg separat gespeichert.
- Haupt-HEAD 39715ec5 enthält neue Flughafen-/Upcoming-Änderungen und Frontendsetup gegen aus Tests entkommende HTTP-Anfragen. Keine unserer Appänderungen. Separater neuer Fixstand noch nachzuprüfen.
