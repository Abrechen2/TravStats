# Befunde

## AUD-060 – CSV-Import verwirft gültige Halb-Stern-Bewertungen ohne Warnung

- Priorität: P2. Kategorie: Import/Vertragsparität/Datenverlust einzelner Felder. Status: tatsächlicher CSV-Candidatebuilder und Previewschema am Fix-Stand `c824ea3b` reproduziert.
- Fundstellen: `frontend/src/lib/importers/lodgingCsv.ts:305`, `:309`; Gegenvertrag `backend/src/schemas/lodging.ts:47` und `schemas/lodgingImport.ts:44`.
- Beleg: CSV-Zellen mit `0.5` in Zimmer-, Frühstücks-, Service- und Gesamtbewertung werden sämtlich zu null, `rowErrors:[]`. Kontrollwerte 1 und 4.5 bleiben erhalten. Das Backend-Kandidatenschema akzeptiert dieselben vier Felder ausdrücklich mit 0.5, ebenso das normale Unterkunftsschema.
- Ursache: CSV-Helfer verwendet die alte Untergrenze 1 statt 0,5 und stuft außerhalb liegende, aber numerisch lesbare Werte nicht als Fehler ein. Die Vorschau bietet für diese Felder keine Korrektureingabe. Sehr schlechte Bewertungen verschwinden damit als „unbewertet“.
- Verbesserung: eine gemeinsame Ratinggrenze/Validierung für Editor, API und Import; gültige 0,5 erhalten und ungültige Werte explizit melden. Tests für alle vier Bewertungsspalten, 0,5, 1, 5 und außerhalb liegende Werte.

## AUD-057 – In der Importvorschau nachgetragener Preis geht ohne auswählbare Währung verloren

- Priorität: P2. Kategorie: UI/API-Vertrag/stiller Eingabeverlust. Status: echte React-Komponente in Headless-Chromium; **deren tatsächliches Commitpayload** anschließend gegen echtes Schema und Commitservice am Fix-Stand `c824ea3b` ausgeführt.
- Fundstellen: `frontend/src/components/lodging/LodgingImportPreviewModal.tsx:269`, `:434`; `backend/src/services/lodging/lodgingImportCommit.ts:268`, `:302`.
- Beleg: Importzeile mit vollständigen Aufenthaltsdaten, aber unbekanntem Preis und `currency:null`. Nutzer tippt 100 ins Preisfeld und bestätigt. Payload enthält `totalPrice:100,currency:null`; die Oberfläche besitzt kein Währungsfeld und zeigt auch eine vorhandene Einheit nicht neben dem Preis. Service meldet 1 Hotel/1 Aufenthalt, `failed:[]`; DB enthält danach **totalPrice:null**, EUR-Default und keinen Basisbetrag.
- Ursache: Backend verwirft zu Recht Beträge mit unbekannter Einheit, aber die zur Nachbearbeitung vorgesehene Vorschau bietet keine Möglichkeit, diese Einheit anzugeben, keine passende Validierung und keinen Hinweis auf das verworfene Feld. Betrag-only-Editor und Importvertrag passen nicht zusammen.
- Verbesserung: Einheit anzeigen und editierbar machen; bei vorhandenen Geldbeträgen ohne Währung die Bestätigung blockieren bzw. eine explizite Entscheidung verlangen. Feldverluste im Ergebnis nicht als vollständigen Erfolg ausgeben. Nicht durch pauschale Erfindung von EUR lösen (vgl. AUD-048).
- Prüfgrenze: isolierte echte Komponente, keine vollständige Seiten-/CSS-Prüfung. Kein HTTP-Commit/Geocodingjob; derselbe vom Browser erzeugte Payload wurde direkt mit dem echten Service persistiert.

## AUD-058 – Buchungsparser hält seine Timeoutgrenze nicht ein und bleibt nach Antwortabbruch hängen

- Priorität: P2. Kategorie: Netzwerkrobustheit/Fallback. Status: öffentlicher Parser mit lokalem synthetischem HTTP-Server am Fix-Stand `c824ea3b` reproduziert.
- Fundstellen: `backend/src/services/lodging/lodgingBookingParser.ts:96` (`postJson`), `:127` (`getText`), `:436`, `:466`.
- Beleg 1: Testbudget `LODGING_OLLAMA_TIMEOUT_MS=80`; Server sendet alle 25 ms ein Leerzeichen und erst nach zwölf Intervallen eine vollständige gültige Antwort. Parser akzeptiert diese nach gemessenen 412 ms. Der Timer begrenzt Socket-Inaktivität, nicht die gesamte Laufzeit.
- Beleg 2: Nach erfolgreicher `/api/tags`-Abfrage sendet der Generate-Endpunkt nur einen JSON-Anfang und bricht dann die Antwortverbindung ab. Nach 355 ms ist der Parser-Promise bei 80-ms-Konfiguration noch immer unerledigt; der versprochene manuelle Fallback wurde nicht erreicht. Probe durch eigenen äußeren Watchdog beendet, keine unbegrenzt laufende Testanfrage hinterlassen.
- Ursache: Es fehlt eine unabhängige Gesamtlaufzeitgrenze sowie vollständige Behandlung von Response-`error`/`aborted`/vorzeitigem `close`. `req.on('error')` und `res.on('end')` decken den abgebrochenen Antwortstream nicht ab. Der benachbarte Mappingparser besitzt bereits eine echte Deadline und Antwortgrößenbegrenzung; der Bookingparser nicht.
- Verbesserung: einheitlicher begrenzter HTTP-Client mit Gesamtdeadline, begrenzten Antwortbytes, Statusprüfung und garantierter Auflösung/Ablehnung bei allen Streamenden. Tests für tröpfelnde und abgeschnittene Antworten ergänzen. Der Zeitmaßstab der Probe ist verkleinert; kein realer externer Ollama-Ausfall behauptet.

## AUD-059 – CSV-Zahlenheuristik liest Koordinaten mit drei Nachkommastellen als Tausenderzahlen

- Priorität: P2. Kategorie: CSV/Geodaten/fehlerhafte Zahlennormalisierung. Status: tatsächlicher Frontend-Candidatebuilder und Backend-Previewschema am Fix-Stand `c824ea3b` reproduziert.
- Fundstellen: `frontend/src/lib/importers/lodgingCsv.ts:274`, `:289`, `:457`, `:460`; `backend/src/schemas/lodgingImport.ts:65`.
- Beleg: Gültige Koordinatenstrings `52.520` / `13.405` ergeben **52520 / 13405**, ohne `rowErrors`. Der daraus erzeugte Previewrequest wird wegen zu großer Koordinaten abgelehnt. Dieselben Koordinaten als `52.5200` / `13.4050` oder mit sechs Nachkommastellen werden korrekt gelesen und akzeptiert. Ein fehlerhafter Kandidat kann so die Vorschau des gesamten Requests verhindern.
- Ursache: Derselbe generische Geld-/Zahlenhelfer wird für Koordinaten verwendet; exakt drei Ziffern hinter einem Trennzeichen gelten immer als Tausendergruppierung. Geografische Dezimalpräzision darf diese Annahme nicht übernehmen.
- Weiterer belegter Anwendungsfall dieser Heuristik: Preis `1.234` mit expliziter `KWD`-Währung wird als 1234 ausgegeben. Die im Projekt unterstützte dreistellige Währungspräzision wird nicht zur Unterscheidung benutzt; für einen als 1,234 gemeinten Betrag ist dies Faktor 1000. Mehrdeutige Geldschreibweisen müssen geprüft werden, nicht als eindeutig behauptet werden.
- Verbesserung: feldspezifische Parser für Koordinaten, Geldbeträge und Bewertungen; erlaubten Wertebereich und Währungspräzision berücksichtigen. Fehler bereits pro Quellzelle verständlich melden. Tests mit variierender, numerisch gleichwertiger Nachkommastellenzahl.

## AUD-056 – Falscher Hotel-Match kann in der Importvorschau nicht abgelehnt und als neues Hotel importiert werden

- Priorität: P2. Kategorie: UI/fehlende Entscheidungsoption/Fehlzuordnung. Status: echte React-Komponente in Headless-Chromium plus separate echte Preview-/Commit-/DB-Gegenprobe am Fix-Stand `c824ea3b`.
- Fundstellen: `frontend/src/components/lodging/LodgingImportPreviewModal.tsx:180`, `:333`, `:344`, `:381`, `:488`; `backend/src/services/lodging/lodgingImportCommit.ts:375`, `:397`.
- Beleg: Bestand `Synthetic Annex One`, Import `Synthetic Other Building` mit anderer externer Kennung. Vorschau bietet einen heuristischen Namensmatch als `needs_input` an und setzt `matchedLodgingId`. Im real gerenderten Dialog sind Name/Stadt DIVs statt Eingabefelder; Auswahl nur leer/`create`/`skip`. Es gibt keinen „anderes/neues Hotel“-Weg. Klick auf `create` überträgt **unverändert die vorgeschlagene Bestands-ID**. Der echte Commit legt entsprechend 0 Hotels und 1 Aufenthalt am bestehenden Hotel an.
- Auswirkung: „Rückfrage statt automatischer Zusammenlegung“ ist unvollständig umgesetzt: Der Nutzer kann nur den Vorschlag übernehmen oder den gesamten Datensatz überspringen/Import abbrechen, aber den Match nicht zurückweisen und die richtige neue Unterkunft anlegen. Angezeigt wird dabei der **Importname**, nicht der Name des verknüpften Bestandshotels, was die Entscheidung zusätzlich erschwert.
- Verbesserung: explizite getrennte Aktionen „bestehendem Hotel zuordnen“, „neues Hotel erstellen“, „überspringen“; Vergleich mit Name/Ort/Identität des vorgeschlagenen Bestandsobjekts. Beim Ablehnen die Match-ID löschen und Eingaben wieder freigeben. Tests für falschen Namens-/Nähevorschlag und tatsächlich übermitteltes Commitpayload.
- Prüfgrenze: isolierte echte Komponente mit ersetzter Übersetzungs-/Logginganbindung und gesperrtem Browsernetzwerk; kein vollständiger Seiten-/CSS- oder Screenshotnachweis behauptet. Der nachgelagerte DB-Nachweis nutzte dieselbe ID/Entscheidung auf rein synthetischen Daten.

## AUD-052 – Booking-Template vervielfacht Dezimalpunktpreise stillschweigend

- Priorität: P1. Kategorie: deterministischer Parser/falsche Geldbeträge. Status: echter `parseBookingComEmail` am Fix-Stand `c824ea3b` mit synthetischer gültiger deutsch beschrifteter Bestätigung reproduziert.
- Fundstelle: `backend/src/services/lodging/bookingComTemplate.ts:276`, besonders `:285`.
- Beleg: Alle übrigen Felder gleich und vollständig: `Gesamtpreis` gefolgt von `US$ 135.87` ergibt **13587 USD**; Kontrollfall `US$ 135,87` ergibt korrekt 135,87 USD. `EUR 1,234.50` ergibt **1,2345 EUR** statt 1234,50 EUR. Die fehlerhaften Ergebnisse haben `missing:[]` und werden als erfolgreicher Templatehit übernommen; kein LLM-Fallback.
- Ursache: Jeder Punkt wird als Tausendertrenner entfernt und danach nur das erste Komma als Dezimalzeichen behandelt. Ein erkanntes Währungsformat belegt jedoch nicht die verwendete Zahlenschreibweise.
- Grenze: Nachgewiesen für vom Template akzeptierte deutsch beschriftete Dokumente mit solchen Betragsformaten; keine Häufigkeit in echten Buchungsmails behauptet. Die erste Probe hatte durch die PowerShell-Pipe beschädigte Umlaute und keinen Templatehit; oben stehen die mit Unicode-Escapes korrekt wiederholten Ergebnisse.
- Verbesserung: Zahl und Währung gemeinsam, locale-/präzisionsbewusst normalisieren; mehrdeutige Schreibweisen nicht still umdeuten. Geldnormalisierung nicht in mehreren auseinanderlaufenden Parserhelfern duplizieren. Tests mit Dezimalkomma/-punkt und beiden Gruppierungsformen.

## AUD-053 – „Frühstück nicht enthalten“ wird als gebuchtes Frühstück normalisiert

- Priorität: P2. Kategorie: Parser/Verpflegungslogik. Status: tatsächlicher Normalisierungshelfer am Fix-Stand `c824ea3b` reproduziert; Aufruf aus `normalizeBooking` bestätigt.
- Fundstellen: `backend/src/services/lodging/lodgingFieldNormalization.ts:82`, `:86`, `:98`; `backend/src/services/lodging/lodgingBookingParser.ts:319`.
- Beleg: `No breakfast included`, `Breakfast not included` und `Ohne Frühstück` liefern jeweils `breakfast`. Kontrollfälle `Room only` → `none`, `breakfast` → `breakfast`. Der Parserprompt fordert die Verpflegung als gedruckten Text; solche verneinten Werte sind daher keine entgegen dem Vertrag erfundenen Enumwerte.
- Auswirkung: Ausschluss von Frühstück wird in sein Gegenteil umgewandelt; Aufenthaltsdaten und nach Verpflegungsart gruppierte Kosten werden falsch. Eine bloße Erwähnung ist kein Nachweis einer eingeschlossenen Leistung.
- Verbesserung: Verneinung/Ausschluss vor positiven Schlagwörtern auswerten; bei mehrdeutigem Text null/Prüfhinweis statt positiver Buchungsbehauptung. Tests mit „nicht enthalten“, „gegen Aufpreis“, „optional“ und positiven Formulierungen.

## AUD-054 – Unterschiedliche nichtlateinische Hotelnamen werden automatisch demselben Hotel zugeordnet

- Priorität: P2. Kategorie: Internationalisierung/Identitätsverlust. Status: echtes Preview-Schema, Previewservice, Commitschema und Prisma-Commit am Fix-Stand `c824ea3b` reproduziert.
- Fundstellen: `backend/src/services/lodging/lodgingImportPreview.ts:15`, `:177`, `:281`; derselbe Normalisierer wird auch vom Commit verwendet.
- Beleg: Bestehendes Hotel `桜旅館`; neuer stays-only-Kandidat nennt `海の宿`. Beide Normalisierungsschlüssel sind der leere String. Vorschau: `action:'create'`, `flags:[]`, `dedupeHint:'none'`, bereits die ID von `桜旅館` gesetzt. Commit erfolgreich: 0 neue Hotels, 1 Aufenthalt am falschen bestehenden Hotel.
- Ursache: `[^a-z0-9]` entfernt sämtliche nichtlateinischen Buchstaben. Der stays-only-Zweig hält einen einzigen Treffer auf dem leeren Schlüssel für eine eindeutige Identität und verlangt keine Bestätigung. Mit mehreren solchen Bestandsnamen entsteht stattdessen Mehrdeutigkeit, nicht dieselbe stille Einzelzuordnung.
- Verbesserung: Unicodefähige Normalisierung; niemals leere/zu informationsarme Schlüssel als Identität akzeptieren. Tests mit japanischen, chinesischen, kyrillischen und arabischen Namen sowie getrennten Städten. Von AUD-044 unterscheiden: hier sind schon die **Originalnamen verschieden**, nicht nur deren Städte.

## AUD-055 – Als importierbar freigegebene Aufenthaltszeile scheitert allein an der Zeilenreihenfolge

- Priorität: P2. Kategorie: Preview→Commit-Vertrag/Teilimport. Status: echte Schemas, Preview und Commit auf getrennten synthetischen Konten am Fix-Stand `c824ea3b` reproduziert; UI-Payloadkette vollständig gelesen.
- Fundstellen: `backend/src/services/lodging/lodgingImportPreview.ts:299`, `:320`; `backend/src/services/lodging/lodgingImportCommit.ts:368`, `:425`; `frontend/src/components/lodging/LodgingImportPreviewModal.tsx:174`.
- Beleg: Kandidat 0 enthält nur Aufenthalt plus Hotelname, Kandidat 1 legt genau dieses Hotel an. Vorschau gibt beide als `create` aus. Commit in dieser Vorschau-Reihenfolge erstellt das Hotel, aber **keinen Aufenthalt**, Fehler Zeile 0 `missing_lodging_reference`. Dieselben Zeilen auf einem frischen Konto mit umgekehrter Commit-Reihenfolge: 1 Hotel, 1 Aufenthalt, keine Fehler.
- Ursache: Preview prüft Namen gegen **alle** Kandidaten, Commit dagegen nur gegen bereits verarbeitete Zeilen. Das UI behält die Vorschau-Reihenfolge bei, bietet keine Umsortierung und sendet den joinenden Datensatz absichtlich ohne eigenes Hotelobjekt. Die zusätzliche Sortierung „needs_input zuerst“ kann ebenfalls Abhängigkeiten umdrehen.
- Verbesserung: echte Abhängigkeitsauflösung, zweiphasige Hotel-/Aufenthaltsanlage oder stabile Referenzen auf andere Kandidaten. Preview und Commit müssen für dieselben Entscheidungen übereinstimmen. Nicht lediglich den Nutzer auffordern, die Eingabedatei zufällig passend zu sortieren.
- Reichweite: Reproduziert mit den im öffentlichen Kandidatenvertrag erlaubten gemischten Formen. Der aktuelle CSV-Builder wählt pro Datei eine Form; nicht behauptet, dass jede normale CSV diesen konkreten gemischten Payload erzeugt. Die UI-Komponente und öffentliche API unterstützen ihn jedoch ausdrücklich.

## AUD-050 – Dokument-Gesamtpreis überschreibt andere Buchungen und verliert seine Währung

- Priorität: P1. Kategorie: Parser/Kostenverfälschung. Status: öffentlicher Parser am Fix-Stand `c824ea3b` mit lokalem synthetischem Ollama-HTTP-Stub reproduziert; kein echtes Dokument und kein externer KI-Dienst verwendet.
- Fundstellen: `backend/src/services/lodging/lodgingBookingParser.ts:284`, `:400`; `backend/src/services/lodging/documentTotal.ts:112`, `:170`.
- Beleg 1: Dokument mit Hotel Alpha / `Total price: EUR 100.00` und Hotel Beta / `Total price: EUR 500.00`; Modellantwort enthält die richtigen getrennten Preise 100 und 500. Der echte Parser liefert **500 und 500**, ohne fehlenden Preis zu melden. Jede Buchung wird gegen denselben kompletten Dokumentausschnitt abgeglichen; dessen globaler Gewinner überschreibt den buchungsbezogenen Wert.
- Beleg 2: Eine Buchung mit lokaler Gebühr 400 AED und angezeigter Umrechnung `Total price: EUR 100.00`; richtige Modellantwort 400 AED. Ergebnis **100 AED**. Die Dokumenterkennung verwendet Währungszeichen zur Erkennung, verwirft die Einheit aber und belässt die andere Modellwährung unverändert.
- Auswirkung: Bereits vor Import/FX entstehen falsche Ausgangspreise. Dies ist unabhängig von den separaten Snapshot-Cachefehlern AUD-043/049.
- Verbesserung: Preisbeleg als Betrag **plus Währung und zugehörigen Buchungsabschnitt** behandeln. Keine globale Übersteuerung mehrerer Buchungen; bei unklarer Zuordnung oder unterschiedlichen Einheiten eine prüfbare Unsicherheit anzeigen. Tests mit zwei Buchungen, Original-/Anzeigewährung und widersprüchlichen Summen ergänzen.

## AUD-051 – Numerische Leerwerte des Buchungsmodells werden als kostenlose Übernachtung ausgegeben

- Priorität: P2. Kategorie: Parser/Null-Semantik. Status: öffentlicher Parser mit lokalem HTTP-Stub am Fix-Stand `c824ea3b` reproduziert.
- Fundstellen: `backend/src/services/lodging/lodgingBookingParser.ts:186` (`asNumber`), `:275`, `:297`, `:302`.
- Beleg: Synthetisches Dokument ohne Preis, ansonsten vollständige Modellantwort mit gültiger EUR-Währung, `totalPrice:'null'` und `pricePerNight:'n/a'`. Ergebnis: beide Beträge **0**, `missing:[]`. Nach Entfernen aller Nicht-Zahlzeichen wird `Number('')` zu 0; textuelle Nullwerte werden anders als bei `cleanText` nicht verworfen.
- Zusätzliche belegte Formatlücke desselben Helfers: `totalPrice:'1,234.50'` wird ohne erkannten Dokument-Gesamtpreis zu null statt 1234,50. Der deutsche Separatorersatz kann englische Gruppierung nicht lesen.
- Verbesserung: zuerst explizite Leer-/Nullmarker und fehlende Ziffern ablehnen; echte numerische 0 erhalten. Einheitliche geprüfte Zahlennormalisierung für unterstützte Gruppierungskonventionen verwenden. Tests für JSON-null, String-null, n/a, leere Werte, echte 0 und beide Dezimalformate.

**Aktueller Fixstatus:** siehe `FIX_REVIEW.md`. AUD-046–060 wurden erstmals am Fix-Stand `c824ea3beff13121a387e0e55f1584f8c6dfdb28` (2.6.3) tatsächlich reproduziert. AUD-043–045 sind dort ebenfalls weiterhin reproduzierbar. Die übrigen historischen Bestätigungen dürfen nicht pauschal als heute noch offen gelesen werden.

## AUD-049 – Neuer Flugbatch-FX-Cache überschreibt Beträge bei fehlender Importreferenz

- Priorität: P1. Kategorie: Regression/falsche gespeicherte Geldbeträge. Status: echte Batch-API und Prisma am Fix-Stand `c824ea3b` bestätigt; neu durch FX-Ergänzung aus der AUD-022-Fix-Runde.
- Fundstellen: `backend/src/routes/flightsBatch.ts:96`, `:170`, `:173`, `:316`; `backend/src/services/importProvenance.ts:39`, `:73`.
- Beleg: Zwei gültige Flugzeilen mit unterschiedlichen Flugnummern, `dataSource:'manual'`, gleichem Datum, EUR-Preisen 100 und 500. Batch liefert 201; beide `externalRef` sind wie vorgesehen null. DB speichert `price:100 / priceBase:500` und `price:500 / priceBase:500`, jeweils Kurs 1. Damit stehen 1.000 EUR Basisbetrag gegen 600 EUR tatsächlich eingegebene Preise. Kein externer Wechselkursdienst nötig (EUR→EUR).
- Ursache: Der neue `fxByRef` ist nach `externalRef` indiziert, die der Kommentar als pro Zeile eindeutig bezeichnet. Für manuelle/API-Flüge und unzureichend identifizierbare Importzeilen ist sie jedoch absichtlich null. Mehrere asynchrone Berechnungen überschreiben denselben Map-Eintrag; jede dieser Zeilen erhält später den zuletzt dort abgelegten vollständigen Snapshot. Die neuen Paritätstests verwenden jeweils nur einen identifizierbaren Importflug und decken diese Kollision nicht ab.
- Verbesserung: Snapshot unmittelbar bei der angereicherten Zeile halten oder nach stabiler Batch-Zeilenidentität indizieren, nicht nach optionaler Provenienz. Tests mit mehreren null-Referenzen, verschiedenen Beträgen/Währungen/Stichtagen und einer preislosen Zeile. Kurscache und betragsabhängigen Snapshot strikt trennen.
- Prüfhinweis: Erster eigener Versuch stoppte vor der Flugerstellung mit 409, weil der leere Auditkatalog denselben Flughafen parallel nachladen/anlegen wollte. Nach Bereitstellung beider Katalogeinträge oben genannten Fehler sauber reproduziert. Der erste 409 ist nicht der FX-Beleg und wird hier nicht als weitere neue Regression behauptet.

## AUD-046 – Unterkunfts-Importprotokoll übernimmt und löscht auch Flugimport-Batches

- Priorität: P2. Kategorie: Domänentrennung/Undo-Verlust. Status: tatsächlicher GET und DELETE am Fix-Stand `c824ea3b` bestätigt.
- Fundstellen: `backend/src/services/lodging/lodgingImportBatches.ts:23`, `:88`, `:115`; `backend/src/routes/lodgingImport.ts:124`, `:133`.
- Beleg: Synthetischer Batch mit `domain:'flight'` und einem real gespeicherten Flug (`importBatchId` gesetzt). `GET /api/v1/lodging-import/batches` führt ihn als Unterkunftsimport auf. DELETE über denselben Unterkunftsrouter liefert 200 mit allen Löschzählern 0. Der Batch ist anschließend gelöscht, der Flug existiert weiterhin, aber mit `importBatchId:null`.
- Ursache/Auswirkung: Liste und Eigentümerlookup filtern nur nach `userId`, nicht nach `domain:'lodging'`; die Rücknahme kennt nur Unterkünfte/Aufenthalte und löscht dennoch den generischen Batch. Damit geht der Flugimport-Eintrag samt späterer batchbezogener Rücknahmemöglichkeit verloren. Kein kontoübergreifender Zugriff und keine Löschung des Fluges behauptet.
- Verbesserung: Unterkunftsliste und Rücknahme auf die eigene Domäne begrenzen; generische Rücknahme zentral nach Domäne dispatchen. Regression mit Flug-/Schiff-/POI-Batch im Unterkunftsrouter: nicht auflisten, DELETE 404, Batch und Referenzen unverändert.

## AUD-047 – Import-Rücknahme löscht nachträglich hinzugefügte Hotelfotos

- Priorität: P1. Kategorie: Datenverlust/zu weit reichende Rücknahme. Status: echter Foto-Upload und Rücknahme am Fix-Stand `c824ea3b` bestätigt.
- Fundstellen: `backend/src/services/lodging/lodgingImportBatches.ts:47`, `:93`, `:97`, `:102`, `:138`; `backend/src/services/lodging/deleteLodgingPhotoFiles.ts:27`.
- Beleg: Hotel und Aufenthalt durch synthetischen CSV-Batch angelegt. **Danach** über den normalen Fotoendpunkt eigenes PNG hochgeladen (201), Fotozeile und physische Datei als vorhanden geprüft. Rücknahme des ursprünglichen Batches liefert 200 (`deletedStays:1`, `deletedLodgings:1`, `detachedLodgings:0`); anschließend sind auch die nachträgliche Fotozeile und die Datei gelöscht.
- Ursache: Der dokumentierte Vertrag „Deletes ONLY what this batch created“ schützt zwar nachträgliche Aufenthalte, bewertet ein Hotel aber ausschließlich anhand verbleibender Aufenthalte als leer. Fotos werden nicht als nachträglich kuratierter Inhalt berücksichtigt. Der Foto-Dateicleanup aus AUD-042 beseitigt nun zusätzlich die zuvor verwaisten Bytes; er behebt nicht den zu weiten Löschumfang der Rücknahme.
- Verbesserung: Hotel bei nachträglichen Fotos/weiteren kuratierten Inhalten erhalten und vom Batch lösen oder die abweichende Löschwirkung mit einer konkreten Inhaltsvorschau ausdrücklich bestätigen lassen. Undo-Tests müssen nachträgliche Inhalte einschließen, nicht nur Aufenthalte.

## AUD-048 – Nachtpreis ohne Währung wird beim Import als EUR gespeichert

- Priorität: P2. Kategorie: erfundene Preiseinheit/Importvalidierung. Status: echtes Commit-Schema und unveränderter Commit-Service mit Prisma am Fix-Stand `c824ea3b` bestätigt; kein HTTP-Commit, um keine Geocodingjobs zu starten.
- Fundstellen: `backend/src/services/lodging/lodgingImportCommit.ts:268`, `:302`, `:307`; `backend/src/schemas/lodgingImport.ts:98`, `:99`.
- Beleg: Gültige Importzeile mit 01.–04.05.2026, `pricePerNight:50`, **ohne** Gesamtpreis und **ohne** Währung. Commit erfolgreich, gespeichert: `pricePerNight:50`, `currency:'EUR'`, `totalPrice:null`, `totalPriceBase:null`. Vergleichszeile mit ausdrücklich angegebenem EUR ist in diesen Feldern identisch.
- Ursache: Der Schutz gegen unbekannte Währungen prüft ausschließlich `totalPrice != null && !currency`. Ein alleiniger Nachtpreis umgeht ihn; das DB-Default gibt ihm EUR als scheinbar bekannte Einheit. Damit widerspricht der Code dem direkt daneben erklärten Schutz, keinen Geldbetrag mit erfundener Währung zu versehen.
- Verbesserung: Gesamt- **und** Nachtpreis auf bekannte Währung prüfen; unbekannte Einheit nicht durch ein DB-Default zur Geldangabe machen. Preisableitung/FX der Import- und CRUD-Pfade gemeinsam prüfen; ein Nachtpreis mit bekannter Einheit darf dabei nicht versehentlich verworfen werden.

Laufende Befundsammlung. Hinweise aus vorhandener Dokumentation werden erst nach Gegenprüfung übernommen. Keine Korrekturen implementiert.

Alle Fundstellen beziehen sich auf Auditbasis `ef62a8f8ba1817a2df03c96451eb806d95aa4102`. Claude korrigiert parallel im Hauptarbeitsverzeichnis. Die nachstehende Bestätigung bezeichnet den Nachweis am Ausgangsstand und ist keine Aussage darüber, ob seine laufenden Änderungen den Fehler bereits beheben.

## AUD-043 – Import-FX-Cache übernimmt den Geldbetrag der ersten Zeile für andere Aufenthalte

- Priorität: P1. Kategorie: Import/Kostenverfälschung. Status: echte Commit-Schemas und tatsächlicher Importservice mit Prisma reproduziert; kein HTTP-Geocoding-Backfill gestartet.
- Fundstellen: `backend/src/services/lodging/lodgingImportCommit.ts:165`, `:183`, `:237`, `:298`.
- Beleg: Zwei unterschiedliche Hotels mit demselben Check-in-Tag und Preisen 100 EUR bzw. 500 EUR importiert. Beide Zeilen erfolgreich, keine Fehler. Die gespeicherten Rohpreise sind korrekt 100/500, aber beide `totalPriceBase` sind **100** bei `fxRate=1`, `fxBaseCurrency=EUR`. Der zweite Aufenthalt verliert also 400 EUR im aggregierten Basisbetrag.
- Ursache: Der Cache ist nur nach Währung und Tag indiziert, enthält aber das komplette `FxSnapshotOutcome` einschließlich bereits umgerechneten **Betrags** der ersten Zeile. Folgezeilen übernehmen dieses Ergebnis unverändert, statt ihren eigenen Preis mit dem gecachten Kurs zu multiplizieren.
- Verbesserung: nur den Kurs samt Herkunft/Stichtag cachen; jeden Betrag je Zeile separat berechnen/runden. Alternativ muss ein Cache vollständiger Konvertierungsergebnisse auch den Betrag berücksichtigen. Bestehende importierte Snapshots dieser Konstellation nachprüfen; Tests mit gleicher Währung/Tag, unterschiedlichen Preisen und mehreren Basiswährungen.

## AUD-044 – Import legt gleichnamige Hotels verschiedener Städte unbemerkt zusammen

- Priorität: P2. Kategorie: Import/Identitätsabgleich. Status: tatsächlicher Commitservice mit validierten Zeilen und Datenbank reproduziert.
- Fundstelle: `backend/src/services/lodging/lodgingImportCommit.ts:393` (`createdByName`).
- Beleg: Zwei neue Hotels namens `Synthetic Hotel Central`, eines in Berlin und eines in Paris, mit ausdrücklich verschiedenen `externalRef` und jeweils einem Aufenthalt importiert. Ergebnis: ein Hotel, zwei Aufenthalte, kein Fehler/kein Skip. Gespeichert wird nur Berlin und dessen externe Kennung; der Pariser Aufenthalt hängt ebenfalls daran.
- Ursache: Innerhalb eines Imports reicht der normalisierte Name allein als Identität, noch bevor die zweite externe Kennung oder Stadt geprüft wird. Damit ist diese Zusammenlegung gröber als die äußere Vorschau-/Bestands-Deduplizierung.
- Verbesserung: stabile externe Kennung bevorzugen, sonst Namen mit Ort/Koordinaten und Mehrdeutigkeitsprüfung verwenden. Explizit verschiedene Quellidentitäten nicht allein wegen Namensgleichheit zusammenführen; Vorschau und Commit müssen identische Regeln haben.

## AUD-045 – Import-Commit akzeptiert Check-out vor Check-in

- Priorität: P2. Kategorie: API-Validierung/Importdatenqualität. Status: tatsächliches HTTP-Eingabeschema plus echter Commitservice reproduziert.
- Fundstellen: `backend/src/schemas/lodgingImport.ts:85`, `:198`; `backend/src/services/lodging/lodgingImportCommit.ts:272`.
- Beleg: Commitpayload mit Check-in 10.05.2020 und Check-out 01.05.2020 besteht `lodgingImportCommitRequestSchema`; Service erstellt Hotel und Aufenthalt ohne Fehler und speichert die vertauschte Reihenfolge. Die normale Aufenthaltsanlage verbietet diese Kombination. Vorschauwarnungen reichen nicht, da der Commitpayload clientseitig veränderbar ist.
- Verbesserung: fachliche Datumsvalidierung auch an der Commitgrenze anwenden; Vorschau nicht als Sicherheits-/Konsistenzgarantie ansehen. Preis/Nächte und Status dürfen nicht aus einem unmöglichen Zeitraum entstehen.

## AUD-042 – Löschen eines Hotels lässt dessen hochgeladene Bilddateien zurück

- Priorität: P2. Kategorie: Speicher-/Dateilebenszyklus. Status: tatsächlicher Upload und Hotel-DELETE mit synthetischem PNG reproduziert.
- Fundstellen: `backend/src/routes/lodging.ts:483`, `:490`; zum Vergleich `backend/src/routes/lodging/photos.ts:240`; `backend/src/config/uploadDirs.ts:30`.
- Beleg: 1×1-PNG über normalen Hotel-Fotoendpunkt hochgeladen (201); Hotel anschließend gelöscht (204). Hotel-/Fotozeile verschwinden per Cascade, die 68-Byte-Testdatei bleibt in `uploads/lodging-photos` bestehen. Das direkte Löschen eines einzelnen Fotos ruft dagegen nach der DB-Löschung `deleteLodgingPhotoFile` auf. Der Parent-Delete tut dies nicht, und für dieses Verzeichnis ist keine anderweitige Aufräumfunktion gefunden worden.
- Auswirkung: wiederholtes Löschen bebilderter Hotels lässt nicht mehr zuordenbare Dateien anwachsen. Sie liegen weiter im für vollständige Dateibackups vorgesehenen Verzeichnis, obwohl sie im Logbuch gelöscht erscheinen. Keine Aussage über einen unberechtigten HTTP-Zugriff: der Bildendpunkt prüft weiterhin die nun fehlende Hotel-/Fotozeile.
- Verbesserung: DB-Löschung und Dateiaufräumauftrag zuverlässig koordinieren, z. B. transaktional vorgemerkte Löschjobs mit Wiederholungen. Auch Import-Rücknahme, Konto- und andere Parent-Löschungen anhand ihrer Medienrelationen prüfen; keine unkontrollierte rekursive Verzeichnislöschung.

## AUD-038 – Aufenthalte lassen sich fremden Reisen, Buchungen und Mitgliedschaften zuordnen

- Priorität: P1. Kategorie: Kontentrennung/unerlaubte Datenverknüpfung. Status: echte API mit zwei synthetischen Konten reproduziert.
- Fundstellen: `backend/src/schemas/lodging.ts:104`, `:135`; `backend/src/routes/lodging.ts:498`, `:531`, `:728`; `backend/src/routes/trips.ts:470`.
- Beleg: Konto A besitzt das Hotel; Konto B besitzt Reise, Buchung und Mitgliedschaft. A sendet deren bekannte UUIDs als `tripId`, `bookingId`, `membershipId` bei Aufenthaltserstellung. HTTP 201, alle drei fremden Referenzen gespeichert. Bs normaler Reise-GET liefert anschließend As Aufenthalt einschließlich Hoteldaten in `lodgingStays`. Die Probe verwendet absichtlich bekannte synthetische IDs; keine ID-Ermittelbarkeit behauptet.
- Ursache/Auswirkung: Lediglich Hotel und bestehender Aufenthalt werden auf Eigentümerschaft geprüft; die drei neuen Verknüpfungen werden ungeprüft durchgereicht. Gleiches Muster beim PATCH (statisch). Damit kann A Inhalt in Bs Reise einschleusen und die Eigentümerinvariante der Relationen verletzen. Kein Nachweis, dass A dadurch Bs vorhandene private Reiseinhalte auslesen kann; der bestätigte Schaden ist kontoübergreifende Schreib-/Zuordnungsintegrität.
- Verbesserung: sämtliche referenzierten nutzereigenen Entitäten auf denselben `userId` prüfen, bei Fremdobjekten 404/403. Gleiches für Create, PATCH und Import; passende kombinierte DB-Constraints als zusätzliche Absicherung erwägen. Negativtests je Referenz und Schreibpfad.

## AUD-039 – Löschen von Aufenthaltsdaten verwendet für Status, Uhrzeiten und FX weiterhin die alten Daten

- Priorität: P2. Kategorie: PATCH-Semantik/inkonsistenter Datensatz. Status: echte Aufenthalts-API reproduziert.
- Fundstellen: `backend/src/routes/lodging.ts:596`, `:624`, `:696`, `:743`.
- Beleg: Aufenthalt Januar 2020–Januar 2030 mit Uhrzeiten 15:00/11:00, 100 EUR angelegt. PATCH `{checkIn:null,checkOut:null,status:'completed'}` liefert HTTP 200 und speichert beide Dates als null. Gleichwohl bleiben beide Uhrzeiten bestehen, Status ist `in_progress` statt des für die nun undatierte Reise gesendeten `completed`, und der FX-Stichtag ist weiter 01.01.2020.
- Ursache: `input.checkIn ? new Date(...) : stay.checkIn` behandelt explizites null wie „nicht gesendet“. Im FX-Aufruf wiederholt `input.checkIn ?? stay.checkIn` denselben Fehler. Die Datenbank übernimmt über `...input` null, alle abgeleiteten Felder rechnen jedoch mit dem alten Datum.
- Verbesserung: bei sämtlichen Nullable-Feldern `undefined` und `null` unterscheiden; zunächst einen einzigen effektiven Datensatz bilden, dann Datumskonsistenz, Zeitbereinigung, Status und FX daraus ableiten. Tests für einseitiges/beidseitiges Löschen sowie Datum+Uhrzeit-/Statuskombinationen.

## AUD-040 – Aufenthaltskosten ignorieren Datumsgenauigkeit und ausdrücklich bekannte Nächte

- Priorität: P2. Kategorie: Kosten-/Nächtelogik. Status: zwei echte Create-API-Proben reproduziert.
- Fundstellen: `backend/src/shared/stayPricing.ts:13`, `:24`, `:37`; `backend/src/routes/lodging.ts:511`, `:657`; Vergleich `backend/src/shared/lodgingTiming.ts:90`.
- Beleg: Undatierter Aufenthalt (`NONE`) mit drei Nächten und 50 EUR/Nacht wird mit `totalPrice=null` gespeichert statt 150. Ein Aufenthalt mit `MONTH`, Platzhalterdaten 01.07.–01.08.2020, ebenfalls drei expliziten Nächten und 50 EUR/Nacht, wird mit **1.550 EUR** gespeichert und umgerechnet statt 150. In beiden Fällen liefert der eigens dafür vorhandene `resolveStayTiming` korrekt drei Nächte.
- Ursache/Auswirkung: Der Preishelfer kennt weder `datePrecision` noch `nights`, sondern differenziert immer die Datumswerte. Dadurch werden unbekannte Daten als fehlende Nächte und Monats-/Jahresplatzhalter als echte Tagesabstände behandelt; die korrekt vorhandene zentrale Nächteableitung wird umgangen. Betroffen sind alle Aufrufer dieses gespiegelten Shared-Helfers, nicht nur die UI-Anzeige.
- Verbesserung: Preisableitung auf dieselbe präzisionsbewusste Nächtefunktion wie Statistik und Anzeige stützen. Unbekannte Nächte von bekannten 0 Nächten trennen; Create/PATCH/Import und die Frontendspiegelung gemeinsam prüfen.

## AUD-041 – Gesamtpreis 0 wird beim Anlegen eines Aufenthalts durch den Nachtpreis überschrieben

- Priorität: P2. Kategorie: API-Vertrag/Kostenkorrektheit. Status: echte Create-API reproduziert.
- Fundstellen: `backend/src/shared/stayPricing.ts:36`; `backend/src/routes/lodging.ts:511`; `backend/src/schemas/lodging.ts:130`.
- Beleg: Drei Nächte, `totalPrice:0`, `pricePerNight:50`, `currency:'EUR'` werden mit HTTP 201 als Gesamtpreis und Basisbetrag **150** gespeichert. Das Schema erlaubt ausdrücklich 0; der Preishelfer akzeptiert den autoritativen Gesamtbetrag aber erst bei `>0` und fällt sonst auf den Nachtpreis zurück. Ohne positiven Nachtpreis wird ein expliziter Gesamtpreis 0 zu null, sodass gratis und unbekannt ebenfalls zusammenfallen.
- Verbesserung: einen ausdrücklich vorhandenen Gesamtpreis einschließlich 0 unverändert übernehmen; Fallback nur für tatsächlich fehlenden Betrag nach klar definierter Null-Semantik. Gratis-/Award-Aufenthalte, Null, fehlende Felder und Create/PATCH-Parität testen.

## AUD-037 – Restore-Dialog wird auf kleinen Bildschirmen abgeschnitten und ist nicht modal fokussiert

- Priorität: P2. Kategorie: Responsive UI/Barrierefreiheit. Status: tatsächlicher Dialog bei 390×667 und 320×568 gerendert, DOM/Mausrad/Escape geprüft und Screenshots visuell gelesen.
- Fundstelle: `frontend/src/components/Admin/BackupManagement.tsx:64` (`RestoreModal`).
- Beleg: Bei 320×568 ist das zentrierte Panel 676 px hoch, beginnt bei y=-54 und endet bei y=622. Beide Aktionsbuttons reichen von y=556 bis 598; Text/Bedienfläche sind überwiegend unterhalb des Viewports. Mausrad verändert diese Positionen nicht, Panel und Overlay haben weder Höhenlimit noch vertikalen Scrollbereich. Verifizierte Screenshots `ui-restore-mobile-320x568-before-scroll.png` und `ui-restore-mobile-320x568-after-scroll.png`. Die Hintergrundseite scrollt von y=708 auf 1284, das Dialogpanel bleibt unverändert abgeschnitten. Erste Datei `ui-restore-mobile-320x568.png` war ein leerer Screenshot unmittelbar am Scrollübergang und ist KEIN verlässlicher visueller Beleg. Bei 390×667 passt der Dialog dagegen hinein; kein pauschaler Fehler für alle Mobilgrößen.
- Zusätzlich: Der Fokus bleibt beim Öffnen außerhalb des Panels, `role=dialog`/`aria-modal`/Titelzuordnung fehlen, Escape schließt den Dialog nicht. Der normale Tastatur-/Hilfsmittelkontext bleibt somit auf der überdeckten Seite. Keine echte Wiederherstellung ausgelöst; synthetische Listenantwort und explizit blockierte Backup-Schreibrequests.
- Verbesserung: gemeinsames zugängliches Dialogelement mit begrenzter dynamischer Viewporthöhe, internem Scrollbereich und erreichbarer Aktionsleiste; Initialfokus, Fokusbegrenzung/-rückgabe, Dialogname und konsistentes Schließen. Mit kleiner Höhe, Bildschirmtastatur, Zoom und reiner Tastatur testen.

## AUD-036 – Kontowechsel verwirft auch korrekt geladene E-Mail des neuen Kontos

- Priorität: P2. Kategorie: Profilhydration/Datenverlust. Status: echter Browserstore mit echter eigener Test-API reproduziert.
- Fundstellen: `frontend/src/store/settingsStore.ts:513`, `:523`; `backend/src/routes/settings/general.ts:40`, `:339`.
- Beleg: Serverprofil des aktuellen synthetischen Kontos enthält `current-audit@example.com`. Im Browserstore liegt noch ein anderer synthetischer Benutzername. `loadRemoteSettings` liest die korrekte Serverantwort, setzt deren E-Mail wegen `userChanged` anschließend dennoch auf leer. Nach einer normalen Settingsspeicherung fehlt die E-Mail auch in der Serverantwort vollständig. Probe benutzt denselben Persistenzpfad wie eine beliebige folgende Auto-Save-Änderung.
- Ursache: Der Schutz vor Profilresten des vorherigen Kontos wird **nach** Zusammenführen der neuen Serverwerte angewandt und entfernt damit auch die Daten des richtigen Kontos. `profilePicture` wird im selben Zweig entfernt (statisch, nicht separat hochgeladen/getestet).
- Verbesserung: kontofremden lokalen Zustand vor Hydration verwerfen bzw. pro Konto speichern; danach die erfolgreich geladenen Profilwerte des neuen Kontos übernehmen. Nicht neue Remote-Daten zusammen mit alten lokalen Resten löschen. Login A → Logout → Login B mit unterschiedlichen vollständigen Profilen samt anschließender harmloser Settingsänderung testen.

## AUD-035 – Änderung während laufendem Settings-Autosave wird irrtümlich als gespeichert markiert

- Priorität: P2. Kategorie: Frontend-Zustand/Datenverlust bei langsamer Verbindung. Status: echter Settingsbildschirm mit produktivem Store/Autosave-Effekt und eigener Test-API in Headless-Chromium reproduziert.
- Fundstellen: `frontend/src/store/settingsStore.ts:577`, `:625`; `frontend/src/components/Settings/useSettingsPage.ts:195`.
- Beleg: Lieblingsairline auf `AUDIT_SAVE_A` geändert; dessen Autosave-Request kontrolliert angehalten. Währenddessen auf `AUDIT_SAVE_B` geändert, dann erste Antwort freigegeben. Nach Ablauf der 500-ms-Entprellung und weiterer 1,2 s gab es insgesamt nur **einen** PUT. Browserstore enthält B und `hasPendingChanges()=false`, tatsächlicher GET vom Server weiterhin A.
- Ursache: Nach erfolgreichem PUT wird `remoteSnapshot` aus dem **jetzigen** Store gebildet, nicht aus dem tatsächlich versendeten Zustand. Damit bestätigt eine alte Antwort auch die erst während der Anfrage vorgenommene Änderung; der zweite Timer überspringt das Speichern wegen vermeintlich fehlender Änderungen.
- Verbesserung: exakt den abgesendeten Snapshot bestätigen; neuere lokale Änderungen als ausstehend erhalten. Save-Reihenfolge/Versionierung oder eine serialisierte Save-Warteschlange festlegen. Tests mit verzögerten und vertauschten Antworten sowie Bearbeitung während eines PUT.

## AUD-032 – Reiseerkennung übernimmt stornierten Flug statt tatsächlich geflogener Umbuchung

- Priorität: P2. Kategorie: Erkennungslogik/Duplikate. Status: tatsächlicher `detectTrips`-Service mit synthetischen DB-Flügen reproduziert.
- Fundstellen: `backend/src/services/tripDetectionService.ts:185`, `:260`; `backend/src/__tests__/tripDetection.test.ts:79`.
- Beleg: Gleiche Buchungsreferenz, MUC–FRA um 08:00 storniert und Ersatz um 10:00 geflogen; dazu zwei weitere geflogene Anschluss-/Rücksegmente. Dry-run schlägt die Reise mit Statusfolge `cancelled, flown, flown` vor. Die Ersatzflug-ID fehlt, die Storno-ID ist enthalten. `dropCancelledDuplicates` betrachtet den Status überhaupt nicht, sondern behält den ersten Datensatz je Abflugort/Tag. Der gleichnamige Unit-Test benutzt nicht einmal Statuswerte und bestätigt lediglich dieses Weglassen der zweiten Zeile.
- Auswirkung: Bestätigte Reisevorschläge können einen nicht durchgeführten Flug enthalten und die tatsächliche Umbuchung unzugeordnet lassen. Zusätzlich können mehrere legitime Abflüge desselben Flughafens am selben Tag fälschlich als Duplikate gelten (statische Konsequenz des Schlüssels, nicht separat reproduziert).
- Verbesserung: Storno und Ersatz anhand Status und fachlicher Flugidentität unterscheiden; bei Unsicherheit beide zur Prüfung zeigen. Tests mit Storno vor/nach Ersatz sowie mehreren echten Tagesflügen.

## AUD-033 – GPX-Import erfindet Strecke zwischen getrennten Aufzeichnungsabschnitten

- Priorität: P2. Kategorie: Import/Karten-/Distanzkorrektheit. Status: echter Parser und Ingestion-Helfer mit gültigem synthetischem GPX reproduziert.
- Fundstellen: `backend/src/services/tour/tracks/parseGpx.ts:101`, `:113`, `:178`; `backend/src/services/tour/tracks/ingestTrack.ts:100`.
- Beleg: Zwei getrennte `<trkseg>` am Äquator, jeweils 0,01 Längengrad lang, zusammen ca. 2,224 km; einer bei 0°, der andere bei 10°. Parser flacht sie zu einer durchgehenden Punktliste ab; Ingestion meldet 1.113,063 km, einschließlich der nicht aufgezeichneten Verbindung zwischen den Segmenten. Dieselbe Abflachung betrifft mehrere `<trk>`/`<rte>`.
- Einordnung: GPX-Segmente trennen zusammenhängende Aufzeichnungsabschnitte ausdrücklich, etwa bei ausgeschaltetem Empfänger oder Empfangsverlust. Die künstliche Verbindung ist keine gemessene Strecke. [Primärquelle: GPX 1.1, trksegType](https://www.topografix.com/GPX/1/1/#type_trksegType).
- Verbesserung: Segmentgrenzen durch Parsing, Distanzmessung, Vereinfachung, Speicherung und Darstellung erhalten, z. B. mit MultiLineString oder getrennten Tracks. Lücken nicht still als gefahren/gelaufen zählen; ihre Übernahme in eine Etappe explizit behandeln.

## AUD-034 – Trackübernahme verliert die zuvor korrekt gemessene Rohdistanz

- Priorität: P2. Kategorie: Geometrievereinfachung/Distanzkonsistenz. Status: reale Ingestion-/Adoption-Helfer reproduziert; HTTP-Verdrahtung gegengelesen.
- Fundstellen: `backend/src/services/tour/tracks/ingestTrack.ts:100`; `backend/src/routes/trips/tourLegs.ts:118`; `backend/src/services/tour/tracks/adoptTrack.ts:108`.
- Beleg: 101 synthetische Punkte auf einer kleinen Zickzackstrecke ergeben vor Vereinfachung 1,197608 km. Die gespeicherte Anzeigegeometrie hat danach zwei Punkte. Übernimmt man exakt den gesamten Track zwischen seinen beiden Enden als Etappe, liefert `adoptSegment` nur 1,111951 km (7,15 % weniger), weil es die vereinfachte Linie erneut vermisst. Der HTTP-Handler reicht genau `track.geometry` hinein und markiert das Ergebnis als `source=track, confidence=high`.
- Auswirkung: Trackübersicht und vollständig daraus übernommene Etappe können verschiedene Kilometerwerte besitzen; Teilstrecken haben dieselbe systematische Verkürzung. Der sorgfältig vor Vereinfachung ermittelte Rohwert kann aus den zwei verbleibenden Punkten nicht wiederhergestellt werden.
- Verbesserung: Geometrie für Anzeige von Messdaten trennen. Kumulative Rohdistanz/Segmentzuordnung zu erhaltenen Stützpunkten oder eine geeignete Messrepräsentation speichern; Übernahme daraus berechnen und Genauigkeitsverlust kenntlich machen. Regressionstest: vollständige Adoption muss den Rohdistanzwert innerhalb definierter Toleranz erhalten.

## AUD-031 – „Aufräumen“ bietet gepflegte Hotel-/POI-/Albumreisen als inhaltslose Kleinreisen an

- Priorität: P2. Kategorie: Datenverlustschutz/irreführende Auswahl. Status: Kandidaten- und Dissolve-Endpunkt reproduziert, UI-Aufrufkette gelesen.
- Fundstellen: `backend/src/services/tripCleanupService.ts:45`, `:75`, `:118`; `frontend/src/components/Trips/TripCleanupModal.tsx:40`.
- Beleg: Reise mit Aufenthalt, Ortsbesuch, verknüpftem Immich-Album und eigener `summary`, ohne Flug angelegt. `GET /trips/cleanup/micro` bietet sie als Kandidat an. `POST /trips/cleanup/dissolve` akzeptiert sie (HTTP 200, `dissolved=1`), löscht Reise und Albumverknüpfung, setzt Aufenthalt-/Besuch-`tripId` auf null. Alle Daten synthetisch. Kein importiertes Foto in dieser Probe: Fotos würden das vorhandene Kandidatenkriterium korrekt ausschließen.
- Ursache/Auswirkung: Schutzfilter berücksichtigt nur ältere Inhaltstypen und weder Aufenthalte, Ortsbesuche, Albumlinks noch Zusammenfassung. Das UI wählt alle zurückgelieferten Kandidaten vorab aus. Eine bewusst bestätigte Bereinigung kann somit kuratierte Nicht-Flugreisen entfernen, obwohl die Funktion ausschließlich alte Kleinreise-Artefakte ohne weiteren Inhalt anbieten soll. Anders als AUD-028 braucht es hier die ausdrückliche Bestätigung der Bereinigung.
- Verbesserung: vollständige Domänen-/Metadatenprüfung; Kriterien und UI-Vorschau fachlich zusammenführen. Löschberechtigung und Inhaltslosigkeit atomar prüfen, damit auch zwischen Kandidatenprüfung und Löschung neu hinzugefügte Inhalte geschützt sind. Den Concurrent-Write-Fall noch gesondert testen.

## AUD-028 – Automatische Reiseerkennung löscht kuratierte Reisen ohne Flug mitsamt Tagebuch/Stopps

- Priorität: P1. Kategorie: Datenverlust/Reisebereinigung. Status: echter Express-Endpunkt und Datenbank, reproduziert am 10.09.2026 auf Auditbasis.
- Fundstellen: `backend/src/services/tripDetectionService.ts:144`, `:179`, `:612` (`finalizeWithCleanup`); `backend/src/routes/trips.ts:80`; `backend/prisma/schema.prisma:1366`, `:1494`.
- Beleg: Synthetische Reise mit eigenen Notizen, Stopp und Tagebucheintrag, aber ohne Flug angelegt. Dry-run erhält sie. `POST /api/v1/trips/detect` mit `{dryRun:false,selectedProposals:[]}` liefert HTTP 200 und entfernt sie samt Stopp und Tagebucheintrag. Es wurden keine neuen Reisen angelegt. Die Bereinigung sucht sämtliche Reisen des Kontos mit `flights: {none:{}}`, nicht nur im aktuellen Lauf erzeugte Platzhalter. `orphansRemoved=2` im Versuch: auch die zuvor als Zusammenführungsziel angelegte zweite fluglose Testreise wurde gelöscht.
- Auswirkung: Bestätigung der Flug-Reiseerkennung kann unabhängig davon gepflegte Bahn-/Auto-/Unterkunfts-/Kreuzfahrtreisen löschen. Reiseeigene Stopps, Routen, Fotos, Albumverknüpfungen und Tagebuchzeilen werden per Cascade gelöscht; lose gekoppelte Logbucheinträge bleiben ohne Reisezuordnung bestehen. Stopps/Tagebuch tatsächlich geprüft, weitere Relationen aus dem Schema. Nicht gegen Nutzerdaten ausgeführt.
- Verbesserung: Fehlerhafte/abgebrochene Vorschläge innerhalb ihrer eigenen Transaktion bereinigen und ausschließlich im aktuellen Vorgang erzeugte IDs berücksichtigen. Bestehende Reisen ohne Flug sind keine Waisen. Regressionstests mit allen unterstützten Domänen und handgepflegtem Inhalt; getrennte explizite Löschfunktion statt globaler Nebenwirkung.

## AUD-029 – Zusammenführung verliert Hotel-/POI-Zuordnungen und löscht importierte Immich-Fotos

- Priorität: P1. Kategorie: Datenverlust/unvollständige Domänenintegration. Status: echter Merge-Endpunkt und Datenbank reproduziert.
- Fundstellen: `backend/src/services/tripCleanupService.ts:185`, `:240`; `backend/prisma/schema.prisma:1292`, `:1313`, `:1867`, `:2076`.
- Beleg: Quellreise mit Aufenthalt, Ortsbesuch, Immich-Albumverknüpfung und damit verknüpfter Fotometadatenzeile in eine Zielreise zusammengeführt; HTTP 200. Danach haben Aufenthalt und Ortsbesuch jeweils `tripId=null`. Album und importierte Fotozeile existieren nicht mehr. Es wurde kein externes Immich kontaktiert: ausschließlich synthetische Relationen; keine Aussage über externe Originaldateien.
- Ursache: Merge verschiebt Flüge/Schiffe/Buchungen/Stopps/Routen/Tagebuch/Fotos, aber weder `lodgingStay`, `placeVisit` noch `tripImmichAlbum`. Das folgende Löschen der Quellen entkoppelt erstere per SetNull und löscht das Album per Cascade. Dessen Cascade löscht sogar bereits auf das Ziel verschobene Fotos über `immichAlbumLinkId`.
- Verbesserung: vollständige Relationsmatrix des Tripmodells als Merge-Vertrag behandeln; alle Domänen und Album-/Importjobbeziehungen transaktional übernehmen. Konfliktregeln für auf beiden Seiten vorhandene Album-/Asset-IDs festlegen. Testen, dass sämtliche Inhalte und Zuordnungen nach erfolgreichem Merge erhalten sind.

## AUD-030 – Übernommenes Reise-Titelbild zeigt nach Zusammenführung auf die gelöschte Quellreise

- Priorität: P2. Kategorie: UI/Medienreferenzen. Status: tatsächlicher PNG-Upload und anschließende HTTP-Dateiabfragen reproduziert.
- Fundstellen: `backend/src/services/tripCleanupService.ts:217`; `backend/src/routes/trips.ts:1165`, `:1282`.
- Beleg: Ziel ohne Titelbild, Quelle mit über den normalen Cover-Endpunkt hochgeladenem 1×1-PNG. Vor Merge Bildabruf HTTP 200; danach behält `target.coverImageUrl` unverändert `/api/v1/trips/<gelöschte-Quelle>/photos/<Foto>/file` und liefert 404. Dieselbe Foto-ID unter der Zielreise liefert 200. Die Datei und manuelle Fotozeile sind also vorhanden, lediglich die übernommene URL ist ungültig.
- Verbesserung: interne Medienreferenz als Foto-ID modellieren bzw. beim Verschieben auch gespeicherte URLs auf die neue Reise umstellen; Cover-Vererbung separat von Galerieübernahme testen. Externe Cover-URLs dabei nicht blind umschreiben.

## AUD-027 – Verschobener Routenstopp behält die alte Etappendistanz und Geometrie

- Priorität: P2. Kategorie: Touren/Karten-/Distanzkonsistenz. Status: tatsächliche Stop-/Route-API reproduziert.
- Fundstellen: `backend/src/routes/trips.ts:836` (`PATCH stop`); `backend/src/services/tour/legRecompute.ts:35`; `backend/src/routes/trips/tourRoutes.ts:277`, `:390`.
- Beleg: Zwei Stopps (0,0) und (1,0) erzeugen eine gerade Etappe mit 111,195 km. PATCH des zweiten Stopps auf (10,0) liefert HTTP 200, Route liefert weiterhin 111,195 statt 1.111,951 km. Selbst erneutes Senden derselben Stoppreihenfolge heilt den Wert nicht: `recomputeLegs` bewahrt bestehende Paare anhand ihrer IDs und berechnet nur neu entstandene Paare.
- Auswirkung: Karte/Stoppposition und gespeicherte Routen-/Fahrkilometer können auseinanderlaufen. Bereits gezeichnete, geroutete oder übernommene Linien werden ebenfalls nicht invalidiert und können ihre Anker verlieren; dieser Zusatz ist statisch, die Laufzeitprobe nutzte `straight`.
- Verbesserung: Koordinatenänderung und Aktualisierung betroffener Etappen konsistent behandeln; gerade Entfernungen neu berechnen, externe/manuelle Linien als veraltet markieren und kontrolliert neu verankern/berechnen. Manuelle Daten nicht still löschen. Gleiche Validierung bei konkurrierender Stopzuordnung berücksichtigen.

## AUD-024 – Eigene Reisedaten ändern den Status einer Reise ohne Flug/Schiff nicht

- Priorität: P2. Kategorie: Reise-Zeitachse/Statuskonvergenz. Status: API und tatsächlicher Recomputation-Service reproduziert.
- Fundstellen: `backend/src/routes/trips.ts:622`, `:675`, `:700`; `backend/src/services/tripStatusService.ts:47`; `backend/src/services/statusSweep.ts:137`.
- Beleg: Reise ohne Segmente mit Datum Januar 2020 wird korrekt als `completed` angelegt. PATCH der beiden Grenzen auf Januar 2030 liefert HTTP 200, Status bleibt `completed`. Expliziter `recomputeTripStatus` belässt ihn ebenfalls dort. Edit, Recomputation und Sweep verwenden die eigenen Datumsgrenzen nicht; die letzten beiden laden ausschließlich Flüge/Kreuzfahrten. Beim Create wurden die eigenen Grenzen hingegen ausgewertet.
- Auswirkung: Manuelle Reisen ohne diese beiden Segmentarten können trotz Verschiebung in die Zukunft dauerhaft „abgeschlossen“ bleiben; auch reine Unterkunfts-/Stopreisen werden durch die gemeinsame Ableitung nicht erfasst (dieser Zusatz ist statisch, nicht separat reproduziert).
- Verbesserung: einheitliche Herkunfts-/Fallbackregel für Reisedaten festlegen und auf Create, Edit sowie Sweep anwenden; alle unterstützten Reisebestandteile und ausdrücklich gesetzte Planungsdaten berücksichtigen, ohne Plan und tatsächliche Durchführung unbeabsichtigt zu vermischen.

## AUD-025 – Editierbarer Profil-Benutzername ändert den echten Benutzernamen nicht

- Priorität: P2. Kategorie: UI/Scheinpersistenz. Status: tatsächliche API-Rundreise und vollständige UI-Kette bestätigt.
- Fundstellen: `frontend/src/components/Settings/ProfileSection.tsx:150`; `frontend/src/components/Settings/useSettingsPage.ts:330`; `backend/src/routes/settings/general.ts:40`, `:339`; `frontend/src/store/settingsStore.ts:513`.
- Beleg: Profilfeld ist editierbar und „Profil speichern“ sendet seinen Inhalt. PUT von `profile.username='audit-ui-renamed'` liefert HTTP 200 und spiegelt diesen JSON-Wert zurück. `/auth/me` gibt weiterhin `audit-ui` zurück; die User-Spalte wurde nie geändert. `loadRemoteSettings` ersetzt den JSON-Namen ausdrücklich wieder durch den Auth-Namen.
- Auswirkung: Scheinbar erfolgreiche Namensänderung verschwindet beim erneuten Laden; Anmeldung und Identität bleiben unverändert.
- Verbesserung: Feld sichtbar als unveränderliche Kennung darstellen oder eine echte, validierte Umbenennungsfunktion mit Eindeutigkeits-/Sessionprüfung und klarer Auswirkung auf den Login anbieten. Nicht bloß einen zweiten Namen im Settingsblob speichern.

## AUD-026 – Profilformular hat sichtbare, aber nicht zugeordnete Feldbeschriftungen

- Priorität: P2. Kategorie: Barrierefreiheit/Formularbedienung. Status: DOM und Quelltext bestätigt, Desktop/mobile Darstellung geprüft.
- Fundstelle: `frontend/src/components/Settings/ProfileSection.tsx:149` bis `:198`.
- Beleg: Benutzername, Vorname, Nachname, E-Mail und Geburtstag haben jeweils ein benachbartes `<label>`, aber weder `htmlFor`/passende Input-ID noch umschließende Labels oder `aria-label`/`aria-labelledby`. Die DOM-Prüfung fand für diese fünf sichtbaren Inputs keine zugeordnete Beschriftung.
- Auswirkung: Assistive Bedienung kann die Felder nicht über ihren sichtbaren Namen zuverlässig identifizieren; Klick auf den Labeltext fokussiert das zugehörige Feld nicht. Visuelles Vorhandensein des Textes allein reicht nicht für die programmgesteuerte Zuordnung.
- Verbesserung: eindeutige IDs und `htmlFor` oder korrekt verschachtelte Labels; Hinweistext des Geburtstags mit `aria-describedby` verbinden; Tests über `getByRole`/`getByLabelText` statt rein positionalen Selektoren.

## AUD-023 – Nicht umrechenbare Buchungen drücken Kosten je Stunde/Kilometer

- Priorität: P2. Kategorie: Statistik/Nennerkonsistenz. Status: tatsächliche Statistikfunktion mit synthetischen Datensätzen reproduziert.
- Fundstellen: `backend/src/utils/stats/businessStats.ts:86`, `:109`, `:132`, `:145`.
- Beleg: `baseCost` liefert für eine Fremdwährungsbuchung ohne passenden FX-Snapshot korrekt null. Die Schleife setzt die Booking-ID trotzdem auf „gesehen“ und addiert danach ihre Entfernung/Stunden über den Booking-Fallback zum Nenner. Probe: 100-EUR-Flug allein ergibt 100 EUR/h und 0,90 EUR/km; Hinzufügen einer 500-USD-Buchung ohne Umrechnung verändert die Quoten auf 9,09 und 0,08, während der berücksichtigte Gesamtpreis 100 EUR bleibt.
- Auswirkung: Ein unbekannter/nicht umrechenbarer Preis wird indirekt wie kostenloser zusätzlicher Reiseumfang behandelt; Raten wirken wesentlich günstiger. Ohne Fremdwährungsbuchung bzw. mit gültigen Snapshots ist dieser spezifische Fall nicht gegeben. AUD-022 macht fehlende Snapshots beim Import wahrscheinlicher.
- Verbesserung: separate Menge von Buchungen mit tatsächlich berücksichtigtem konvertiertem Betrag führen; nur deren Kilometer/Stunden mitzählen. Tests für gemischte konvertierte/unbekannte Buchungen einschließlich mehrerer Segmente.

## AUD-022 – Batchimport verliert zusätzliche Flugdaten und erzeugt keine FX-Snapshots

- Priorität: P2. Kategorie: Importparität/Datenverlust/Kostenlogik. Status: gleiche Payload über Einzel- und Batch-API reproduziert.
- Fundstellen: `backend/src/routes/flightsBatch.ts:196`, `:247`, `:353`; Gegenstück `backend/src/routes/flights.ts:471`, `:554`; `backend/src/services/fx/snapshot.ts:147`.
- Beleg: Einzelflug mit First Class, `D-AUDT`, Mode-S `123abc`, `specialType:training`, Musterkoordinaten und 123 EUR bewahrt die Eingaben und schreibt `priceBase=123, fxRate=1, fxBaseCurrency=EUR`. Dieselbe Payload in `/flights/batch` liefert HTTP 201, lässt Sitzklasse, Kennung, Mode-S und Sonderflugwerte aber auf null. Auch FX-Spalten bleiben sämtlich null. Aircraft-Normalisierung und angereicherte Antwortfelder weichen zusätzlich ab (statisch); die weitergehenden AeroDataBox-Felder fehlen schon auf beiden Pfaden, siehe AUD-020.
- Auswirkung: Importierte Flüge verlieren Klassifizierung/Details; berechnetes CO₂ kann bereits die First-Class-Multiplikation enthalten, während die gespeicherte Sitzklasse fehlt. Fremdwährungsbeträge besitzen ohne FX-Snapshot keine Grundlage für den vorgesehenen umgerechneten Gesamtbetrag. Bereits in Basiswährung notierte Beträge können die Statistik über ihren Fallback weiterhin korrekt erfassen; nicht pauschal jeden Batchpreis als fehlend werten. Automatisch erzeugte Buchungen erhalten ebenfalls keinen FX-Snapshot.
- Verbesserung: gemeinsame normalisierte Create-Datenabbildung für Einzel- und Batchpfad; FX-Auflösung außerhalb langer DB-Transaktionen, aber konsistente persistierte Snapshots für Flüge und gebündelte Buchungskosten. Paritätstest mit denselben vollständigen Eingaben in beiden APIs.

## AUD-019 – Selbst angelegte Belegreferenz verleiht Zugriff auf fremde Uploads

- Priorität: P1. Kategorie: objektbezogene Autorisierung/Privatsphäre. Status: zwei echte synthetische Konten, tatsächlicher Upload und echte Flug-/Dateirouten reproduziert.
- Fundstellen: `backend/src/routes/uploads.ts:21`, `:72`, `:126`, `:159`; `backend/src/schemas/receiptUrl.ts:26`; `backend/src/routes/flights.ts:568`, `:1208`.
- Auslöser/Voraussetzung: Konto B kennt die vollständige URL eines von Konto A hochgeladenen Belegs. Keine Enumeration oder praktische Erratbarkeit der zufälligen Dateinamen behauptet.
- Beleg: Upload unter A HTTP 201, anschließender Abruf durch B HTTP 404. B erstellt dann einen eigenen Flug mit genau dieser `receiptUrl` (HTTP 201). Derselbe Dateiabruf durch B liefert nun HTTP 200 und die 68 Bytes der synthetischen PNG-Datei. Uploads haben keine separate unveränderliche Eigentümerzuordnung; der Leseguard vertraut allein einer Referenz, die der Anfragende selbst beliebig setzen darf.
- Auswirkung: Kenntnis eines Dateilinks wird entgegen der zugesagten Benutzerisolation in eine Zugriffsberechtigung umgewandelt. DELETE verwendet dieselbe ableitbare Eigentumsprüfung und könnte die fremde Datei entfernen; Löschung wurde für diesen Befund nicht ausgeführt.
- Verbesserung: Uploadressource mit echtem Eigentümer/ID persistieren, Referenzänderungen gegen diese Ressource autorisieren; Lesen/Löschen nicht allein über frei schreibbare Fremdschlüssel-Strings erlauben. Mehrkontotest für Upload, fremde Zuordnung, Lesen, Löschen und Belegfreigabe ergänzen.

## AUD-020 – Flug-API akzeptiert sieben Felder und speichert keines davon

- Priorität: P2. Kategorie: API-Vertrag/Importdatenverlust. Status: Create und Update reproduziert.
- Fundstellen: `backend/src/schemas/flight.ts:249`; `backend/src/routes/flights.ts:483`, `:1239`; `backend/prisma/schema.prisma:377`.
- Betroffene Felder: `runwayDepartureTime`, `runwayArrivalTime`, `isCargo`, `aerodataboxLastUpdatedUtc`, `aerodataboxQualityTags`, `baggageBelt`, `checkInDesk`.
- Beleg: Zod akzeptiert die Felder; Prisma besitzt passende Spalten. Die expliziten Create-/Update-Mappings lassen sie aus. Echter POST mit befüllten Werten liefert HTTP 201, anschließender PUT derselben Werte HTTP 200; die Werte bleiben sämtlich `null` bzw. `[]`. Auch im Batchmapping fehlen entsprechende Referenzen, dieser Pfad noch nicht separat ausgeführt.
- Auswirkung: Importer/API-Verbraucher verlieren Daten trotz Erfolgsmeldung. Bestehende Daten, die andere direkte Schreibpfade eingetragen haben, sind davon zu unterscheiden.
- Verbesserung: bewusst unterstützte Felder durchgängig abbilden oder ausdrücklich als nicht schreibbar ablehnen; Roundtrip-Test jedes öffentlichen Eingabefelds statt allein Statuscodes/Schemavalidierung.

## AUD-021 – Änderung der geplanten Abflugzeit lässt die Verspätung veraltet

- Priorität: P2. Kategorie: abgeleitete Werte/Statistik. Status: reproduziert.
- Fundstelle: `backend/src/routes/flights.ts:1317` (Delayberechnung nur beim Vorhandensein von `actualDepartureLocal`).
- Beleg: Flug mit geplantem Abflug 10:00Z, tatsächlichem Abflug 10:15Z speichert 15 Minuten Verspätung. PUT verschiebt nur den geplanten Abflug auf 10:10Z. Zeitwerte werden korrekt geändert, `delayMinutes` bleibt 15 statt 5. Kein zweiter Faktor oder externer Provider beteiligt.
- Auswirkung: Anzeige/Statistik, die den gespeicherten Delay verwenden, können nach Korrekturen widersprüchlich werden. Das genaue Ausmaß in einzelnen Statistikverbrauchern ist noch nachzuverfolgen.
- Verbesserung: Ableitung bei Änderungen beider Eingangszeiten gegen deren endgültige Werte aktualisieren; Null-/Clearfälle und Updates durch alle Import-/Providerpfade mitprüfen.

## AUD-018 – Flugchronologie vergleicht fremde Ortsuhren statt UTC-Zeitpunkte

- Priorität: P1. Kategorie: Kernlogik/Zeitzonen/Datenintegrität. Status: Schematests und echte API mit PostgreSQL reproduziert.
- Fundstellen: `backend/src/schemas/flight.ts:331`, `:371`, `:389`, `:407`; `backend/src/routes/flights.ts:313`, `:1090`, `:1268`.
- Beleg: Chronologie vergleicht ausschließlich die lexikografischen `departureLocal`-/`arrivalLocal`-Strings und ignoriert ihre IANA-Zonen. Gültiger westwärts gerichteter Flug Mitteleuropa 10:00 → London 09:45 (45 Minuten UTC-Dauer) und Tokio 20:00 → Honolulu 08:00 (7 Stunden UTC-Dauer) werden abgewiesen. Umgekehrt akzeptiert echter POST London 10:00 → Berlin 10:30; gespeichert werden 10:00Z und 09:30Z, also **minus 30 Minuten**.
- Zweite Validierungslücke: Teilupdate vergleicht nicht mit der stehenbleibenden Gegenseite. PUT nur des Abflugs auf den Folgetag liefert HTTP 200 und lässt die Ankunft am Vortag stehen. Ein bloßer Austausch des Stringvergleichs durch UTC ohne Prüfung des zusammengeführten Endzustands würde dies nicht lösen.
- Zusätzlich: `requireStatusTimeAxisSanity` vergleicht lokale Uhrzeit mit aktueller UTC-Uhrzeit und kann dadurch vor Kurzem geflogene Zeitzonen-Ostflüge als zukünftig ablehnen. Dieser Teil ist statisch, noch nicht mit eingefrorener Uhr reproduziert.
- Verbesserung: für präzise Zeitangaben zunächst beide Seiten auf echte Instants normalisieren, beim Update vollständigen Endzustand prüfen; DATE_ONLY separat mit ausdrücklich festgelegter Datumsgrenzenregel behandeln. Regressionsfälle für westwärts, Datumsgrenze, Sommerzeit, tatsächliche Zeiten und einseitige Änderungen.

## AUD-015 – Detail-Lesezeichen werden vor dem Laden der Domänen umgeleitet

- Priorität: P2. Kategorie: UI/Navigation/Zustandsreihenfolge. Status: Kreuzfahrtpfad im echten Browser reproduziert, übrige gleichartige Detailguards statisch bestätigt.
- Fundstellen: `frontend/src/App.tsx:293`, `:320`, `:409`, `:419`; `frontend/src/components/DomainRouteGuard.tsx`; `frontend/src/store/settingsStore.ts:383` (initiale Domänen).
- Auslöser: Gültige Sitzung, Domäne serverseitig aktiviert, aber frischer bzw. veralteter lokaler Settingsspeicher; direkter Aufruf eines Kreuzfahrt-/Unterkunft-Detail-Links.
- Beleg: Listen verwenden den dreistufigen `DomainRouteGuard`, Detailrouten weiterhin unmittelbar `isEnabled(...)`. Vor dem Settings-GET ist lokal nur `flight` aktiv. Browser mit echter Audit-Sitzung und leerem Settingsspeicher navigierte von `/cruises/<synthetische UUID>` über `/` nach `/dashboard`; nach beendetem Settingsladen waren `flight,cruise,lodging,poi` aktiv. Die Detail-UUID existierte nicht: der belegte Fehler ist die domänenbedingte Umleitung vor einer normalen Detail-/404-Behandlung, nicht der Verlust eines konkret vorhandenen Reisedatensatzes.
- Verbesserung: dieselben geladen/aktiv/deaktiviert-Guards auf alle Detail- und Kettenrouten anwenden; Tests mit langsamem Settings-GET und kaltem Store, aktivierten/nicht aktivierten Domänen und gültigen/ungültigen IDs.

## AUD-016 – Kreuzfahrt-Einstellungen werden gespeichert, aber nie aus der Serverantwort geladen

- Priorität: P2. Kategorie: UI/Persistenz/Datenverlust beim erneuten Speichern. Status: echte API und Browserstore reproduziert.
- Fundstellen: `frontend/src/store/settingsStore.ts:495` (`newState` in `loadRemoteSettings`), `:598` (`saveRemoteSettings`); `frontend/src/components/Settings/useSettingsPage.ts:195`.
- Beleg: PUT von `cruise: {defaultLine:'AUDIT LINE', defaultCabinType:'balcony', showCruiseArcs:false}` wird serverseitig korrekt gespeichert und per GET zurückgegeben. `loadRemoteSettings` mergt profile/display/units/defaults/notifications/features, aber nicht `cruise`. Expliziter Aufruf der echten Browserstore-Ladefunktion lässt deshalb `{defaultLine:'', defaultCabinType:null, showCruiseArcs:true}` stehen.
- Auswirkung: Auf einem anderen/frischen Browser fehlen die gespeicherten Vorgaben und die deaktivierten Kartenbögen werden wieder eingeschaltet. Da spätere allgemeine Saves den lokalen Cruise-Block mitsenden, können sie die richtigen Serverwerte mit Defaults überschreiben. Bestehendes passendes localStorage kann den Fehler verdecken.
- Verbesserung: Cruise-Slice wie andere Gruppen laden; Rundreisetest über zwei unabhängige Browser-/Storeinstanzen und anschließendes Speichern einer fachfremden Einstellung.

## AUD-017 – Zwei sichtbare Feature-Schalter werden vom Backend beim Speichern verworfen

- Priorität: P2. Kategorie: UI/API-Vertrag/Präferenzen. Status: API-Rundreise reproduziert; UI-Aufrufkette vollständig geprüft.
- Fundstellen: `frontend/src/components/Settings/FeaturesSection.tsx:28`, `:56`; `frontend/src/store/settingsStore.ts:605`; `backend/src/routes/settings/general.ts:37` (Schema ohne `features`), `:321` (parse).
- Auslöser: Kostenerfassung aktivieren oder Speicherung der Flugzeugkennung deaktivieren, anschließend anderer Browser bzw. gelöschter lokaler Speicher.
- Beleg: Frontend zeigt beide Schalter, nimmt sie in den Autosave auf und speichert `features` lokal. Das Backend-Schema enthält diesen Block überhaupt nicht; Zod entfernt ihn still. Tatsächlicher PUT mit `{enableCostTracking:true, trackAircraftRegistration:false}` liefert HTTP 200, anschließender GET enthält keinen Featuresblock. Frischer Browser hat wieder `false/true`.
- Auswirkung: Die UI kann „gespeichert“ melden, obwohl keine serverseitige Persistenz stattgefunden hat. Auch die bewusst deaktivierte Flugzeugkennungs-Erfassung gilt auf einem neuen Client wieder als aktiviert.
- Verbesserung: gemeinsamen Vertrag für Features, validierte serverseitige Persistenz und serverbestätigte UI-Zustände; Test, dass alle sichtbaren Settingsblöcke einen vollständigen Save→GET→frischer Store-Zyklus überstehen.

## AUD-012 – Read-PAT schreibt Katalog-, Trainings- und Fotoreisedaten

- Priorität: P2. Kategorie: Autorisierung. Status: echte Gesamtrouten, nichtadministrativer Benutzer, Read-PAT und separate Auditdatenbank reproduziert.
- Fundstellen: `backend/src/routes/airports.ts:190`; `backend/src/routes/training.ts:22`, `:66`, `:147`; `backend/src/routes/photoJourneys.ts:11`, `:143`; Mounts in `routes/mounts.ts`.
- Beleg: Die mutierenden Handler verwenden nur `authenticate`, ohne Write-Scopeprüfung in Route oder übergeordnetem Mount. Laufzeit: Flughafenanlage HTTP 201, Trainingdatei-Upload HTTP 200, Fotoreise-PATCH HTTP 200; Datenbankstatus des Vorschlags tatsächlich `dismissed`. Es war kein Admin-Token und kein Sitzungscookie beteiligt.
- Auswirkung: Entgegen der Lese-Freigabe können Daten angelegt/verändert werden; Flughäfen sind sogar instanzweiter Katalog. Training-Annotation verwendet denselben fehlenden Guard, wurde aber nicht bis zur Templateableitung ausgeführt.
- Verbesserung: systematischer Schutz mutierender Routen durch `requireWriteScope` und explizite Negativtests. Reine Preview-/Parse-POSTs nicht allein wegen der HTTP-Methode sperren, sondern anhand der tatsächlichen Nebenwirkungen entscheiden. Kontosicherheitsfolgen separat in AUD-002.

## AUD-013 – Ungültige E-Mail-Domain lässt hochgeladene Dateien zurück

- Priorität: P2. Kategorie: Upload/Ressourcenverwaltung. Status: reproduziert.
- Fundstellen: `backend/src/routes/emailParse.ts:114`, `:120`, `:135`, `:141`, `:160`; `backend/src/middleware/upload.ts:220`.
- Auslöser: gültiger multipart-Dateiupload mit ungültigem `domain`-Feld.
- Beleg: Multer schreibt die Datei vor der Bodyvalidierung. Der Fehlerpfad versucht über `filePath` aufzuräumen, diese Variable wird aber erst nach der erfolgreichen Domainprüfung gesetzt. Synthetische Probe lieferte HTTP 400 und hinterließ genau eine neue Markerdatei in `uploads/emails`.
- Auswirkung: Abgelehnte Uploads verbrauchen dauerhaft Dateispeicher. Anders als `/parse-email` besitzt `/parse-email-file` auch keinen spezifischen Email-Parse-/Upload-Limiter; der allgemeine API-Limiter ist nicht gleichwertig und wird für LAN-Adressen übersprungen. Die Datei pro Request bleibt durch Multer größenbegrenzt; kein unbeschränkt großer Einzelupload behauptet.
- Verbesserung: sicheren Dateipfad sofort nach Multer bestimmen und Bereinigung in `finally` für alle Enden; spezifisches Rate-Limit vor Multer. Negativtests für Domain-, MIME-, Parser- und Datenbankfehler sowie periodische, sichere Tempdateibereinigung.

## AUD-014 – Lange Klartext-Zugangsdaten werden fälschlich als verschlüsselt erkannt

- Priorität: P2. Kategorie: Verschlüsselungsformat/Integrationen. Status: mit tatsächlichen Encryption-Helfern reproduziert.
- Fundstellen: `backend/src/utils/encryption.ts:143` (`isEncrypted`), `:177` (`encryptApiKey`), `:194` (`decryptApiKey`).
- Beleg: `isEncrypted` prüft nur Text-/Base64-Dekodierlänge, kein Formatkennzeichen oder gültiges Authentifizierungstag. Ein synthetischer 200 Zeichen langer Hex-Klartextschlüssel wird als verschlüsselt erkannt; `encryptApiKey` gibt ihn unverändert zurück, `decryptApiKey` liefert anschließend `null` statt des Schlüssels.
- Auswirkung: Lange reale API-Token bzw. Passwörter können sich scheinbar speichern lassen, werden aber nicht verschlüsselt abgelegt und beim Gebrauch als defekt verworfen. Nicht jedes Zugangsdatenformat ist betroffen; kurze getestete Schlüssel funktionieren.
- Verbesserung: versioniertes, eindeutig gekennzeichnetes Ciphertextformat; Input- und Persistenztypen unterscheiden; Migration für bestehende unmarkierte Werte und Tests mit langen Hex-/Base64-/JWT-artigen Klartextwerten.

## AUD-008 – Gewählte Restore-Zieldatenbank wird ignoriert

- Priorität: P1. Kategorie: Datenintegrität/API-Vertrag. Status: vollständige Quellkette bestätigt; keine Rücksicherung gegen Nutzerdaten ausgeführt.
- Fundstellen: `frontend/src/components/Admin/BackupManagement.tsx:107`, `:282`; `frontend/src/lib/api/backup.ts:66`; `backend/src/routes/backup.ts:39`, `:294`, `:316`; `backend/src/services/backup/backupRestore.ts:77`.
- Auslöser: Administrator fügt im Restore-Dialog eine alternative PostgreSQL-Zieladresse ein und startet einen Datenbank-/Vollrestore.
- Beleg: Frontend überträgt `targetDatabaseUrl`. Das Zod-Schema kennt dieses Feld nicht und entfernt es; der Route-Serviceaufruf übergibt ausdrücklich nur `scope` und `createBackupBefore`. Der Service fällt deshalb auf die aktive `DATABASE_URL` zurück.
- Auswirkung: Der Nutzer wählt vermeintlich eine andere Datenbank, tatsächlich wird die aktive Instanz beschrieben. Zusammen mit AUD-007 sind gemischte Daten bzw. ein scheinbar erfolgreicher Restore möglich.
- Verbesserung: Ziel explizit validieren und durchreichen oder das nicht unterstützte Feld entfernen; vor dem Schreiben den tatsächlich aufgelösten Zielhost/-datenbanknamen zur Bestätigung anzeigen. Vertragstest vom Dialog bis zur Servicegrenze ergänzen.

## AUD-009 – Vollbackups sichern den notwendigen Verschlüsselungsschlüssel nicht

- Priorität: P1. Kategorie: Disaster Recovery. Status: Archivaufbau und Schlüsselverwendung statisch bestätigt; betrifft Wiederaufbau ohne separat erhaltene Secrets.
- Fundstellen: `backend/src/services/backupService.ts:204`; `backend/src/utils/encryptionKey.ts:10`, `:138`; `backend/src/utils/encryption.ts:105`; `docs/release/v1.0.0-release-notes.md:41`.
- Auslöser: Nach Verlust des ursprünglichen Datenvolumens wird eine frische Instanz mit einem automatischen Vollbackup wiederhergestellt; der alte `ENCRYPTION_KEY` ist nicht separat gesichert.
- Beleg: Archiv enthält ausschließlich `database.sql`, `uploads.tar.gz`, `metadata.json`. Der standardmäßig automatisch erzeugte Schlüssel liegt außerhalb davon in `/app/data/secrets/encryption.key` (bzw. Legacy-/konfiguriertem Secretsverzeichnis). Bei fehlendem Schlüssel erzeugt der Start einen neuen. AES-GCM-Daten aus SQL lassen sich damit nicht entschlüsseln.
- Auswirkung: Verschlüsselte 2FA-Secrets und Integrations-/SMTP-Zugangsdaten sind nicht aus diesem Backup wiederherstellbar. Vorhandene separat gesicherte Umgebungs-/Volumenschlüssel vermeiden das Problem; ein Backup des ganzen Docker-Datenvolumens ist etwas anderes als das eingebaute Archiv.
- Verbesserung: vollständiges, sicheres Wiederherstellungskonzept einschließlich Schlüsseltransport bzw. zwingender separater Schlüsselsicherung und klarer UI-Warnung; Recoverytest auf leerer Instanz mit aktivierter 2FA und synthetischen Integrationsdaten.

## AUD-010 – Automatische Backups führen weder Aufbewahrungsbereinigung noch WebDAV-Sync aus

- Priorität: P2 (bei vollem Datenträger bzw. Verlust des Hosts höhere Betriebsfolgen). Kategorie: fehlende Betriebsfunktion. Status: vollständige Aufrufkette und projektweite Referenzen bestätigt.
- Fundstellen: `backend/src/services/backupScheduler.ts:53`, `:86`; `backend/src/services/backupService.ts:341`; `backend/src/routes/backup.ts:157`, `:354`; `README.md:49`.
- Beleg: Scheduler liest `retentionDays`, verwirft es im Ausführungspfad und ruft nur `createBackup` auf. Dieser Service enthält ebenfalls weder Cleanup noch Cloud-Sync. `cleanupOldBackups` und `syncToCloud` werden nur durch separate manuelle API-Routen aufgerufen. README bewirbt automatische Backups mit Aufbewahrung und optionalem WebDAV-Sync.
- Auswirkung: Allein das Aktivieren des Zeitplans und Konfigurieren von Aufbewahrung/WebDAV gewährleistet weder automatische Löschung alter Archive noch eine Offsite-Kopie. Speicher kann unbegrenzt wachsen; die erwartete externe Sicherung fehlt.
- Verbesserung: explizite, getestete Jobkette aus lokaler Sicherung, optionalem Offsite-Transfer und sicherer Retention; Status/Fehler und letzte erfolgreiche Offsite-Sicherung im UI sichtbar machen. Externe vom Betreiber eingerichtete Cronjobs wurden nicht untersucht und können dies separat leisten.

## AUD-011 – Restore-Zieladresse lässt sich nicht normal eintippen

- Priorität: P2. Kategorie: UI/Formular. Status: echter Restore-Dialog in Headless-Chromium reproduziert und visuell geprüft (10.09.2026).
- Fundstelle: `frontend/src/components/Admin/BackupManagement.tsx:110`.
- Laufzeitnachtrag: `pressSequentially('postgresql://audit@localhost/test')` lässt das Feld leer; Einfügen derselben vollständigen URL per `fill` funktioniert. Screenshot `ui-restore-mobile-390x667.png`. Nur die Backup-Liste wurde als synthetische UI-Fixture bereitgestellt; sämtliche Backup-Schreibanfragen waren zusätzlich blockiert. Keine Wiederherstellung ausgelöst.
- Auslöser: Im leeren Feld die Zieladresse zeichenweise tippen.
- Beleg: `value` ist an State gebunden, aber `onChange` aktualisiert den State nur, wenn `new URL(...)` bereits erfolgreich ist. Das erste Zeichen `p` ist noch keine vollständige URL, wird abgelehnt und kann deshalb nie zu `postgresql://…` ergänzt werden. Einfügen einer vollständigen URL kann funktionieren, behebt AUD-008 aber nicht.
- Verbesserung: Rohtext bei jeder Eingabe übernehmen; Vollständigkeit erst bei Blur/Submit validieren und verständliche Fehlermeldung anzeigen.

## Befundformat

Jeder Eintrag erhält eine stabile ID (`AUD-001` aufsteigend), Priorität, Kategorie und Belegstatus. Dazu kommen konkrete Fundstellen, Auslöser/Auswirkung, nachvollziehbare Belege, empfohlene Verbesserung und Grenzen der Verifikation. Es werden keine Änderungen implementiert.

## Ursprüngliche Hypothesen (historisch; Befundstatus unten ist maßgeblich)

- H-001: Backend-Testharness könnte bei falsch gewählter `DATABASE_URL` Nutzerdaten löschen. Konfiguration zeigt globale Tabellenbereinigungen in Tests; Schutzmechanismen und betroffene Testdateien noch prüfen.
- H-002: Im CI-Kommentar beschriebene Backend-Testprobleme (Hintergrund-Achievements/Teardown-Race, private Fixture, fehlender Ketten-Seed) gegen aktuellen Code und isolierte Tests prüfen.
- H-003: Registrierung prüft `userCount`, `isFirstUser` und `maxUsers` vor der Transaktion (`routes/auth.ts`), also schützt Serializable diese Leseentscheidungen nicht. Konkurrenzprüfung ausstehend.
- H-004: JWT enthält ausschließlich `userId`; Passwortreset/-wechsel verändert keine Sessionversion. Bereits ausgestellte JWTs bleiben gültig. Laufzeitbeleg auf isolierter Datenbank ausstehend.

H-001, H-003 und H-004 sind inzwischen durch AUD-001, AUD-004 und AUD-003 bestätigt. H-002 bleibt bis zum bereinigten Backend-Testlauf offen.

## AUD-001 – Backendtests können die konfigurierte Nutzerdatenbank leeren

- Priorität: P1. Kategorie: Datenverlust/Testinfrastruktur. Status: durch vollständige Quellkette bestätigt; Löschung an Nutzerdaten absichtlich nicht ausgeführt.
- Fundstellen: `backend/jest.globalSetup.ts:16`, `backend/jest.setup.ts:21`, `backend/src/__tests__/auth.test.ts:9`, `backend/src/__tests__/auth.test.ts:10`, `backend/package.json` (test-Skript).
- Auslöser: `npm test` mit einer erreichbaren `DATABASE_URL`, die auf eine Entwicklungs- oder Nutzerdatenbank zeigt.
- Beleg: globalSetup prüft lediglich Existenz der Variable und `SELECT 1`. setupFiles ergänzt ausschließlich die Poolgröße. Die Auth-Suite ruft vor/nach Tests `invitation.deleteMany()` und `user.deleteMany()` ohne Filter auf. User-Fremdschlüssel haben zahlreiche `onDelete: Cascade`-Beziehungen. Es gibt in dieser Startkette weder Namens-/Markerprüfung einer Testdatenbank noch eine Trennung in eine verpflichtende `TEST_DATABASE_URL`. Der Fehlerhinweis des globalSetup empfiehlt sogar den vorhandenen Dev-Container.
- Auswirkung: Verlust aller Benutzer und ihrer kaskadierenden Reisedaten beim versehentlichen Testlauf gegen die falsche Datenbank.
- Verbesserung: eigener Testdatenbankzugang mit eingeschränkten Rechten, verpflichtende eindeutige Testdatenbankkennung/Markerprüfung vor jeder Suite, fehlertoleranzfreie Ablehnung sonstiger Ziele; Entwickleranleitung und Startmeldung anpassen.
- Verifikation: vorhandene Testdatenbank wurde nicht verändert. Für dieses Audit wird ein separater Container angelegt.

## AUD-002 – Lese-PAT darf 2FA und Passkeys verändern

- Priorität: P1. Kategorie: Autorisierung/Kontosicherheit. Status: mit echten Routen und isolierter PostgreSQL-Datenbank reproduziert.
- Fundstellen: `backend/src/routes/auth/twoFactor.ts:59` (`/setup`) und `:95` (`/activate`); `backend/src/routes/auth/passkeys.ts:66`, `:108`, `:283`, `:298`; Mounts in `backend/src/routes/mounts.ts`; Scopeprüfung in `backend/src/middleware/auth.ts:245`.
- Auslöser: gültiger PAT mit `scope: read` ruft die Kontosicherheitsendpunkte auf.
- Beleg: beide Auth-Unterrouter verwenden `authenticate`, jedoch weder `requireWriteScope` noch eine Beschränkung auf Browsersitzungen. Die Mounttabelle fügt keinen weiteren Scopeguard hinzu. Auf einer synthetischen Identität lieferten 2FA-Setup, Aktivierung mit dem so erhaltenen Secret, Passkey-Registrierungsoptionen, Umbenennen und Löschen eines synthetischen Passkeys jeweils HTTP 200. Datenbank bestätigte aktivierte 2FA.
- Auswirkung: Ein lediglich zum Lesen freigegebener oder abgeflossener PAT kann den Kontoschutz verändern und den Besitzer von Anmeldewegen ausschließen. Die vollständige kryptografische Registrierung eines neuen Passkeys wurde nicht ausgeführt; deren Handler besitzt denselben fehlenden Berechtigungsschutz.
- Verbesserung: Verwaltung von Anmeldeverfahren wie PAT-Verwaltung auf nachgewiesene Browsersitzungen beschränken; sensible Änderungen ggf. erneute Authentifizierung verlangen. Für sämtliche mutierenden Routen eine zentrale, explizite Berechtigungspolitik und negative Tests mit `read`/`write`/`admin`-PATs ergänzen. [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) empfiehlt Rechteprüfungen für jede Anfrage und standardmäßige Ablehnung nicht eingeräumter Rechte.
- Zusätzlicher Prüfpunkt: `/auth/change-password` hat ebenfalls keinen Scopeguard, verlangt allerdings das bisherige Passwort; deshalb nicht mit dem passwortlosen 2FA-Setup gleichsetzen.

## AUD-003 – Passwortreset beendet bestehende Sitzungen nicht

- Priorität: P1. Kategorie: Kontowiederherstellung/Sitzungswiderruf. Status: reproduziert.
- Fundstellen: `backend/src/utils/jwt.ts:6`; `backend/src/middleware/auth.ts:74`; `backend/src/routes/passwordReset.ts:139`; `backend/src/routes/auth.ts:361`; `backend/src/routes/admin/users.ts` (Passwortreset).
- Auslöser: Passwortwechsel oder Passwortreset, während ein Dritter noch ein zuvor gültiges Sitzungscookie besitzt.
- Beleg: JWT enthält `userId`, aber keine gegen den Benutzerzustand geprüfte Sessionversion. `authenticate` prüft Signatur/Ablauf sowie Existenz/Aktivität des Benutzers. Passwortänderungen verändern ausschließlich Passwort-/Resetfelder. Auf der Auditdatenbank: Passwortwechsel HTTP 200, danach `/auth/me` mit dem alten Cookie HTTP 200; Passwortreset HTTP 200, dasselbe alte Cookie erneut HTTP 200.
- Auswirkung: Kontowiederherstellung entfernt einen bereits angemeldeten Angreifer nicht. Die Sitzung bleibt bis zum konfigurierten JWT-Ablauf (standardmäßig sieben Tage) verwendbar; administrativ erzwungener Passwortwechsel wird bei bestehenden Sessions ebenfalls nicht geprüft.
- Verbesserung: Sessionversion oder serverseitig widerrufbare Sessions bei Passwortreset erhöhen/widerrufen; bei normalem Passwortwechsel bewusstes Abmelden anderer Sitzungen anbieten. PAT-Widerruf als separate ausdrückliche Kontowiederherstellungsentscheidung behandeln. [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html#user-resets-password) empfiehlt automatische Invalidierung bestehender Sitzungen oder eine entsprechende Nutzerauswahl.

## AUD-004 – Gleichzeitige Erstanmeldungen erzeugen mehrere Administratoren

- Priorität: P1. Kategorie: Konkurrenz/Fachlogik/Kontosicherheit. Status: Registrierung reproduziert; analoger Setup-Pfad statisch bestätigt, eigener Laufzeitbeleg offen.
- Fundstellen: `backend/src/routes/auth.ts:42` bis `:46`, `:61`, `:97`; `backend/src/routes/setup.ts:75` bis `:91`; `backend/src/routes/admin/users.ts:29`.
- Auslöser: mehrere gleichzeitige Registrierungsanfragen auf leerer Instanz beziehungsweise Anfragen nahe der Benutzerobergrenze.
- Beleg: `userCount`, `isFirstUser` und `maxUsers` werden vor der Serializable-Transaktion gelesen; die Transaktion wiederholt den Count nicht. Mit einer leeren isolierten Benutzertabelle, `maxUsers=1`, `allowRegistration=false` und vier parallelen Anfragen kamen zwei HTTP 201 mit `isAdmin=true` zurück, zwei weitere HTTP 500 wegen Schreibkonflikten. Datenbank danach: zwei Benutzer, beide Administratoren, Limit weiterhin 1.
- Auswirkung: Die vermeintlich einmalige Bootstrapberechtigung kann mehrmals vergeben und die konfigurierte Obergrenze überschritten werden. Die Serializable-Isolation sichert keine Entscheidung ab, deren Lesevorgang außerhalb der Transaktion liegt.
- Verbesserung: Bootstrap und Benutzerlimit innerhalb einer gemeinsamen atomaren Entscheidungs-/Schreiboperation absichern (z. B. feste Sperrzeile bzw. konsistente transaktionale Countprüfung mit begrenztem Retry bei Serialisierungskonflikten); dieselbe Regel in Setup, Einladung und Admin-Benutzeranlage verwenden.

## AUD-005 – Erfolgreiche 2FA umgeht erzwungenen Passwortwechsel

- Priorität: P1. Kategorie: Authentifizierungslogik. Status: reproduziert.
- Fundstellen: `backend/src/routes/auth.ts:174` (2FA-Zweig vor Passwortwechsel), `backend/src/routes/auth/twoFactor.ts:209` (direkte Sessionausgabe); zum Gegenvergleich `backend/src/routes/auth/passkeys.ts:198`.
- Auslöser: Benutzer hat aktive 2FA und `mustChangePassword=true`, etwa nach einem administrativen Reset.
- Beleg: Login gibt zunächst `requiresTwoFactor: true` zurück. Nach erfolgreichem TOTP prüft `/2fa/verify` das weiterhin gesetzte Passwortwechselflag nicht und schreibt direkt `auth_token`. Auditlauf: Verify HTTP 200, volle Sitzung ausgestellt, `requiresPasswordChange=false`, Datenbankflag bleibt `true`. Passkeylogin lehnt dieses Flag dagegen ausdrücklich ab.
- Auswirkung: Der administrative Zwang, ein temporäres Passwort zu ersetzen, greift bei 2FA-Konten nicht; die Anmeldewege verhalten sich widersprüchlich.
- Verbesserung: Nach erfolgreicher 2FA bei gesetztem Flag ausschließlich das beschränkte Passwortwechselverfahren ausgeben; die Reihenfolge „zweiter Faktor vor Passwortwechsel“ beibehalten. End-to-End-Tests für alle Kombinationen aus Passwortreset, 2FA, Passkey und Deaktivierung.

## AUD-006 – Datei-Restore entpackt Uploads eine Verzeichnisebene zu tief

- Priorität: P1. Kategorie: Backup/Wiederherstellung. Status: mit tatsächlicher Archivfunktion und tar reproduziert.
- Fundstellen: `backend/src/services/backup/backupFiles.ts:43` (`archive.directory(dirPath, uploads/...)`); `backend/src/services/backup/backupRestore.ts:131` und `:135` (Entpacken in `uploadsDir`).
- Auslöser: Dateien aus einem von der Anwendung erzeugten Backup wiederherstellen.
- Beleg: Das innere Archiv speichert `uploads/receipts/...` usw.; Restore entpackt mit `tar -xzf ... -C <backend>/uploads`. Markerprobe mit `archiveUploads` und exakt derselben Entpacklogik: erwartete Datei `restored-uploads/receipts/audit-restore-marker.txt` fehlt, Datei unter `restored-uploads/uploads/receipts/audit-restore-marker.txt` vorhanden.
- Auswirkung: Bilder und Belege werden als erfolgreich wiederhergestellt gemeldet, liegen jedoch unter `uploads/uploads/` und sind für die gespeicherten URLs/Dateinamen nicht erreichbar. Bestehende Dateien werden am richtigen Ort nicht durch den Sicherungsstand ersetzt.
- Verbesserung: Archivwurzel und Ziel konsistent festlegen und kompatibel zu bestehenden Archiven handhaben. Einen tatsächlichen Backup→Restore→Dateiabruf-Test für alle registrierten Uploadverzeichnisse ergänzen; der vorhandene Archivtest prüft nur den Inhalt des tarballs.

## AUD-007 – Datenbank-Restore meldet Erfolg trotz SQL-Fehlern und stellt vorhandene Daten nicht zurück

- Priorität: P1. Kategorie: Backup/Datenintegrität. Status: mit denselben pg_dump-/psql-Optionen auf eigener Wegwerfdatenbank reproduziert.
- Fundstellen: `backend/src/services/backup/backupDatabase.ts:259`, `:347`, `:429`, `:487` (Plain-SQL-Dump ohne Clean); `backend/src/services/backup/backupRestore.ts:112` bis `:122` (psql ohne `ON_ERROR_STOP`/Transaktionsstrategie).
- Auslöser: Backup in die bereits existierende, inzwischen veränderte Datenbank zurückspielen – der normale Restore aus der Adminoberfläche.
- Beleg: `pg_dump -F p` erzeugt CREATE/COPY ohne vorheriges Entfernen bestehender Objekte. Restore liest diesen Dump mit `psql` und wertet allein dessen Prozesscode aus. Isolierter Versuch: Tabelle mit Wert `before-backup` sichern, auf `after-backup` ändern, Dump zurückspielen. psql meldet SQL-Fehler für existierende Tabelle/doppelten Primärschlüssel, beendet sich trotzdem mit Code 0; gespeicherter Wert bleibt `after-backup`.
- Auswirkung: Angeblich erfolgreicher Restore kann Daten unverändert lassen oder nur Teile ergänzen. Der Benutzer erhält eine falsche Erfolgsmeldung gerade im Wiederherstellungsfall.
- Verbesserung: definierte Wiederherstellungsstrategie in eine leere/ersetzte Zieldatenbank bzw. explizites Clean mit abgesicherter Rückfallmöglichkeit, SQL-Fehler zwingend zum Fehlschlag machen, Ergebnis vor Umschalten prüfen. Schema-, Daten- und Uploadkonsistenz in einem Restoretest kontrollieren.
