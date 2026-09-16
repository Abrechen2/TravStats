# UI-Prüfung

13.09.2026, echte lokale Produktionsassets von **9678e6cd**, isolierte API und ausschließlich erfundene Auditdaten. Chromium für eigene Bedienprüfungen; unveränderte Projekt-E2E zusätzlich mit Chromium, Firefox und WebKit. Der neuere Stand 39715ec5 wurde separat vollständig mit Vitest, TypeScript, Lint und Produktionsbuild geprüft. Seine geänderte WebDAV-Oberfläche wurde quellen- und komponentengeprüft, nicht als neuer vollständiger Browserdurchlauf ausgegeben.

## Erfolgreiche Bedienabläufe

| Ablauf | Nachweis |
| --- | --- |
| Navigation Desktop 1440 px, Mobil 390/320 px | 69 angeforderte Navigationszustände, 17 unterschiedliche tatsächlich erreichte Pfade, keine JavaScript-Seitenfehler. Feature-Redirects nicht als erfolgreich geöffnete Zielseiten zählen. |
| POI/Ortsdetail/Reisepass | Nach Aktivieren der Beta-Funktionen allein in der synthetischen Audit-DB tatsächlich geöffnet; Ortsformular und Reisepass mobil visuell gelesen. |
| POI anlegen | HTTP 201, in gefilterter Liste nach Neuladen vorhanden. Erster eigener Textselektor scheiterte am hervorgehobenen Suchtext; korrigierte Zeilenprüfung bestanden. |
| POI-Besuch ergänzen | Datum, Uhrzeit und Notiz eingegeben, HTTP 201, Notiz nach Neuladen vorhanden. |
| Hotel, Kreuzfahrt, Reise und Flug anlegen | Jeweils über tatsächliche mobile Formulare, HTTP 201, nach Neuladen sichtbar. Flug FRA→LHR verwendet korrekt verschiedene lokale Flughafenzeiten: 12:00→13:00 entspricht 2 Stunden. |
| Hotel-CSV importieren | Datei auswählen → Spaltenzuordnung → Vorschau → vorhandenen Hotel-Match ausdrücklich ablehnen → neu anlegen. HTTP 201, 1 Unterkunft und 1 Aufenthalt, 0 Fehler; Liste zeigt nach Neuladen 2 Übernachtungen. |
| Flug bearbeiten | Gate geändert, PUT 200, nach Neuladen und erneutem Öffnen weiterhin AUD18. |
| Eigenen Testflug löschen | Bestätigungsdialog, DELETE 204, nach Neuladen verschwunden; Detail-GET 404. Ausschließlich den in diesem Prüfblock neu angelegten synthetischen Flug gelöscht. |
| Öffentliche Karten-/Font-/Flaggenassets | 51 Antworten von gezielt erlaubten Asset-Hosts, alle 200. Dashboard Desktop/Mobil und mobile Flugliste visuell geprüft; Karten und Flaggen rendern. |

Maßgebliche Artefakte: `block17-ui-browser-production.json`, `block17-ui-assets.json`, `block18-ui-actions.json`, `block18-ui-place-rerun.json`, `block18-ui-csv-rerun.json`, `block18-ui-edit-delete.json`. Screenshots liegen daneben beziehungsweise in `block17-ui-images-production/`.

## Bestätigte Probleme

- **AUD-092–095:** Alte Flugvorschläge überschreiben spätere manuelle Angaben, unzulässige Zeitfolgen werden übernommen, zweites Bearbeiten schlägt mit 500 fehl, und die echte Editor-Zeiteingabe verschiebt sich um den Browser-Zeitzonenoffset.
- **AUD-096:** Eigenständiger Flugvorschlagseditor ohne korrekte Dialog-/Feldsemantik. Ergänzend fehlt dem Passwort-Overlay die Dialogrolle; Escape schließt es nicht, Abbrechen funktioniert. Im zugänglichen Baum sind drei Auswahlfelder der manuellen Fluganlage und die Kategorieauswahl der Reiseanlage unbenannt. Placeholder-Fallbacknamen anderer Felder wurden dabei berücksichtigt.
- **AUD-103:** Bei 320 px ragt die Abbrechen-Schaltfläche der manuellen Fluganlage links aus dem Dialog. Der sichtbare Rest ist noch bedienbar; kein kompletter Bedienausfall. Kleiner zusätzlicher Headerüberlauf: Kontomenü reicht bis x=329.
- Bereits separat nachgeprüfte Importgrenzen **AUD-056/057** bleiben nur teilweise korrigiert; ein erfolgreicher normaler CSV-Import beseitigt diese Randfälle nicht.

## Projekt-E2E und Grenzen

Unveränderte Projekt-E2E: **102 Fälle, 69 bestanden, 33 fehlgeschlagen**, drei Engines, keine Skips. **42 grüne Fälle** in Flug-/Pending-Gerüsttests können ohne Anmeldung auf der Loginseite bestehen, ohne die behauptete Aktion auszuführen (**AUD-098**). Weitere Fehler betreffen veraltete Selektoren und Konfigurationsannahmen. Der E2E-Bestand ist deshalb keine zuverlässige alleinige Freigabegrundlage.

Unsere ersten Vite-Ansätze hatten einen falschen Tailwind-Arbeitskontext beziehungsweise einen ungeeigneten Cachepfad. Deren Layoutbilder und erster E2E-Lauf wurden verworfen. Beim ersten CSV-Durchgang verlangte die UI korrekt eine Entscheidung über einen möglichen Match; der nächste Probeversuch erwartete fälschlich 200 statt des korrekten 201. Der endgültige Durchlauf mit bewusster Matchentscheidung und passender Statusprüfung ist grün. Keine dieser eigenen Prüfaufbauabweichungen wurde als Produktfehler gezählt.

Die Prüfung deckt konkrete Ansichten und Abläufe ab, nicht jede mögliche Kombination aus Einstellungen, Datensatzmenge, Browserzoom, Touchgesten und assistiver Technik. 69 Navigationen bedeuten nicht 69 vollständig visuell abgenommene Seiten. Tatsächlich visuell gelesene Beispiele: Desktop-Dashboard/-Statistik/-Cruise-/Hotel-/Reisedetail, mobile Listen/Settings/POI/Reisepass sowie Editor-, Mapping- und Vorschauzustände. Ein früher Cruise-Screenshot zeigt den fehlerhaften eigenen Fixturestatus `completed`; dieser wurde auf `flown` korrigiert und nicht als Übersetzungsfehler gewertet. Absichtlich blockierte Karten/Flaggen in übrigen Screenshots sind ebenfalls keine Produktfehler.
