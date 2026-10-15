# Marktbesuche aus Positionsdaten – Vorschau-Prototyp

> Der Datei-Prototyp bleibt separat verwendbar. Die inzwischen implementierte
> App-Anbindung steht in [Automatische Marktbesuche](2026-10-15-automatic-market-visits.md).

## Umfang

Regelbasierte Erkennung eines Besuchs im gesamten Marktgelände, auch wenn sich
jemand zwischen Ständen und mehreren Marktgebäuden bewegt. Kein KI-Aufruf.
Dieser Prototyp läuft ausschließlich auf explizit übergebenen Dateien. Er ist
noch nicht mit Scan-API, Scheduler, Vorschlagsliste oder Bestätigungs-Workflow
verbunden. Keine Datenbank, keine Zugangsdaten, keine Netzwerkabfrage und keine
Änderung an Prod. Die bestehende Aufenthaltserkennung bleibt unverändert.

## Aufruf

Im Backend-Arbeitsverzeichnis:

```sh
node_modules/.bin/tsx scripts/preview-market-visits.ts \
  /private/input.json /private/markets.geojson /private/new-preview.json
```

Die Eingabe enthält `points` im vorhandenen `DawarichPoint`-Format. Optional:
`places`, `visits`, `trips`, jeweils aus einem eigenen lesenden Auszug. Ohne
Trips, Immich, Hotels oder Flüge funktioniert die Erkennung weiterhin; ohne
bestehende Besuche ist nur deren Wiedererkennung nicht möglich.

Der Markt-Katalog ist eine GeoJSON-FeatureCollection. Ein Feature benötigt
`properties.kind = "market"`, `id`, `name`, `sourceUrl` und eine Polygon- oder
MultiPolygon-Geometrie. Die Reihenfolge der Koordinaten ist `[lon, lat]`.
Optionale `entityRef` (`wikidata:Q…`) verbindet mehrere Flächen desselben Ortes;
`parentId` fasst explizit zugehörige Teilflächen unter einem übergeordneten Markt
zusammen. Ähnliche Namen oder räumliche Nähe reichen dafür nicht.

Eine Punkt-Geometrie wird als `areaMissing` gemeldet. Es wird kein Kreis als
vermeintliche Marktfläche erfunden. Ein Geschäft mit `kind = "shop"` wird nicht
als Markt verarbeitet. Mehrdeutige überlappende Märkte bleiben getrennt und
werden mit `overlappingMarkets` markiert.

Die Ausgabedatei wird mit 0600 und exklusivem Neuanlegen geschrieben. Vorhandene
Dateien, insbesondere Eingabedateien, werden nicht überschrieben. Gekürzte
Tracks werden für diese Reise-Vorschau abgelehnt.

## Konservative Regeln

- Mindestens fünf Minuten, fünf unterschiedliche Zeitpunkte und drei Punkte
  tatsächlich innerhalb der Fläche. Innere Treffer müssen mindestens zwei
  Minuten überspannen; bloßes Stehen am Rand reicht nicht.
- Maximal 20 m Randtoleranz; sie wächst nicht mit schlechter GPS-Genauigkeit.
- Gemeldete Ungenauigkeit über 100 m sowie ungültige Koordinaten,
  Geschwindigkeiten und Zeitstempel werden ausgeschlossen.
- Maximal 3 m/s. Fehlende Geschwindigkeit kann über kurze Messintervalle aus
  der Bewegung abgeleitet werden. Auch eine gemeldete Nullgeschwindigkeit
  überstimmt keine klare schnelle Bewegung; bei der Ableitung wird die
  gemeldete Messungenauigkeit beider Punkte berücksichtigt.
- Bis zu zehn Minuten zwischen passenden Punkten; beobachtete Abwesenheit
  von mindestens zwei Minuten trennt Besuche. Kurze Unterbrechungen und
  Messlücken bleiben als Unsicherheiten sichtbar.
- Polygon-Löcher bleiben ausgeschlossen. Verschiedene Gebäude eines
  MultiPolygons zählen zum selben Markt; dieselbe öffentliche Ortskennung
  verbindet z. B. Halle und umliegendes Marktgelände.
- Original-Punkt-IDs, verwendete Flächen-IDs, Quellen und Unsicherheiten
  bleiben am Ergebnis erhalten. Eingabereihenfolge verändert es nicht.
- Bestehende Besuche werden nur bei passendem Marktnamen UND passender
  Lage/Zeit erkannt. Ein einzelner Laden innerhalb des Markts ersetzt keinen
  Marktbesuch. Präzise Zeiten haben zehn Minuten Zuordnungstoleranz;
  Tagesangaben werden am örtlichen Kalendertag verglichen. Unklare alte
  Minutenangaben werden nicht still als UTC interpretiert.
- Reisezuordnung nur bei einer eindeutig passenden Reise, deren Tage den
  gesamten Besuch abdecken. Keine Reise wird erzeugt.

## Ergebnis der privaten Echtdaten-Prüfung

Auf dem bereits lesend gewonnenen Korea-Auszug mit 62.902 originalen
Positionspunkten liefert der finale Prototyp vier Marktbesuche. Zwei passen zu
bestehenden Einträgen; zwei bleiben neue Vorschläge zur Prüfung. Insbesondere
werden mehrere Flächen desselben Marktes zu einem Besuch zusammengefasst.
Die genauen Orte, Zeiten, Punkt-IDs und Eingabedaten liegen ausschließlich in
der privaten Arbeitsmappe, nicht im öffentlichen Repository.

Ein zuerst beobachtetes Doppel-Ergebnis für Halle und Gelände wurde durch
Zusammenfassung anhand derselben öffentlichen Ortskennung behoben. Die
Zuordnung zu einem schon erfassten Besuch berücksichtigt anschließend die
kombinierten Flächen. Fehlende Flächen werden als Datenlücke gemeldet, nicht
als Nachweis dafür, dass kein Besuch stattgefunden hat.

Geprüft: Wiederholung und umgekehrte Eingabereihenfolge, ausschließlich originale
Punkt-IDs, unveränderte Quellen, bestehende Besuche, eigenständige Nutzung ohne
andere Reisefunktionen, Vorbeifahrt-Gegenbeispiele und Übereinstimmung von CLI
und Bibliotheksausgabe. Keine automatischen Übernahmen oder Prod-Schreibzugriffe.

## Offene Schritte für eine reguläre Funktion

1. Begrenzter, gecachter Flächenkatalog mit sauberer Herkunft und Aktualisierung.
   Der Prototyp liest einen bereits vorbereiteten Katalog; weltweite
   automatische Marktsuche ist damit noch nicht umgesetzt.
2. Datenlücken und Punkt-Orte im UI verständlich anzeigen; eine verifizierte
   Fläche bei Bedarf nachtragen. Keine ungeprüften Händlerpunkte als Markt.
3. An die bestehende Einwilligung, Modul-Pause und Scan-Reservierung anbinden.
4. Vorschläge dauerhaft mit Quellen speichern, inklusive Wiedererkennung bei
   wachsenden Zeitfenstern und bereits verworfenen Vorschlägen. Der derzeitige
   Fingerprint ist nur für Wiederholungen desselben Datenauszugs stabil.
5. Gemeinsame Prüfung/Bestätigung mit bestehenden Aufenthalts- und
   Immich-Vorschlägen sowie Abgleich gegen inzwischen hinzugefügte Besuche.

Diese Arbeiten und ein Deployment wurden hier nicht durchgeführt. Auch ein
belastbarer Marktaufenthalt bleibt zunächst ein Vorschlag, kein automatisch
bestätigter Besuch und kein Beleg für einen Einkauf.

## Technische Prüfungen

- 46 gezielte Tests bestanden (neuer Erkennungskern, Datei-CLI und bisherige
  stationäre Erkennung); die neuen Tests benötigen weder Datenbank noch Netz.
- Backend-Typprüfung bestanden; zusätzlich 1.193 Backend-Testdateien ohne
  Typfehler geprüft.
- CLI separat mit `tsc -p tsconfig.market-preview.json` typgeprüft. Bei lokal
  verknüpften Abhängigkeiten kann `--preserveSymlinks` nötig sein.
- Lint der neuen Backend-Module, Formatierung und Dateigrößenprüfung bestanden.
- Elf zusätzliche Kontrollbedingungen auf den privaten Echtdaten bestanden;
  Vergleich mit der vorherigen unabhängigen geografischen Auswertung.
