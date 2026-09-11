# Prüfabdeckung

Ausgangscommit: `ef62a8f8ba1817a2df03c96451eb806d95aa4102`.

## Bedeutung der Prüfstufen

- Inventar: Pfad und Rolle erfasst; keine inhaltliche Vollprüfung behauptet.
- Statisch: angegebene Dateien/Abschnitte gelesen und fachlich geprüft.
- Automatisch: genau benannte Prüfläufe ausgeführt; Ergebnis einschließlich Auslassungen erfasst.
- Laufzeit/UI: konkret beschriebene Abläufe tatsächlich ausgeführt bzw. gerendert.

## Bisher gelesen

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
