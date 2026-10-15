# Automatische Marktbesuche aus Dawarich

Implementiert im Branch `feat/dawarich-place-detection`. Kein Deployment oder
Aktivieren auf bestehenden Instanzen durch diese Implementierung.
Der [Datei-Prototyp](2026-10-15-market-area-prototype.md) bleibt als unabhängiges
Werkzeug erhalten; die App verwendet jetzt denselben Detektor mit automatischem
Kartenkatalog und dem vorhandenen Bestätigungsablauf.

## Verhalten

- Eigene Dawarich-Verbindung, aktiviertes Orte-Modul und Aufenthaltserkennung
  sind Voraussetzungen. Ein zusätzlicher Schalter erlaubt die Marktflächenabfrage.
  Neue und bestehende Accounts haben dafür standardmäßig keine Freigabe.
- Immich, Reisen, Flüge und Hotels sind keine Voraussetzung. Ohne Reisen bleibt
  die Reisezuordnung leer. Überlappende oder unvollständig abgedeckte Reisen
  werden nicht geraten. Immich-Besuche können bestehende Besuche belegen.
- Der vorhandene Sechs-Stunden-Scan berücksichtigt die letzten sieben Tage.
  Manuell sind in der Oberfläche 7/14/30 Tage auswählbar; die API erlaubt 1–30.
  Lange oder gekürzte Dawarich-Antworten werden tageweise nachgeladen, insgesamt
  höchstens 250.000 Originalpunkte. Übrige Lücken bleiben als Teilresultat sichtbar.
- Nur Vorschläge werden erzeugt. Bestätigen legt höchstens einen Ort/Besuch an;
  wiederholtes Bestätigen ist idempotent. Ablehnungen bleiben bei erneuten Scans
  wirksam. Bestehende passende Marktbesuche erzeugen keinen neuen Vorschlag.
- Ein Marktbesuch unterdrückt stationäre Teilaufenthalte desselben Besuchs.
  Ältere offene Teilvorschläge werden atomar `superseded`, sobald der neue
  Marktvorschlag gespeichert wird. Ihre Quellenfelder und Nachweise bleiben
  unverändert; die neue Evidenz enthält ihre IDs. Gleichzeitiges Bestätigen
  verhindert die Ablösung. Akzeptierte/abgelehnte Quellen werden nicht ersetzt.

## Automatische Flächenbeschaffung

Die Originalspur wird lokal in ein weltweites 0,05°-Raster eingeordnet. Nur
Regionen mit mindestens fünf unterschiedlichen Zeitpunkten über fünf Minuten
und ohne Lücke über zehn Minuten kommen in Betracht. Es gibt keine Liste von
Städten oder Marktnamen. Abfragen übertragen Rastergrenzen mit kleinem Rand,
keine ursprünglichen Koordinatenfolgen, Uhrzeiten, Punkt- oder Nutzer-IDs.
Ungefähre Aufenthaltsregionen werden dem öffentlichen Kartendienst dadurch
bekannt; dafür ist die getrennte Einwilligung vorgesehen.

Overpass liefert `amenity=marketplace` unabhängig von Sprache und Land. Zusätzlich
werden benannte Marktgebäude/-gelände mit englischem `name:en` berücksichtigt;
gewöhnliche Geschäfte, Straßen und Supermärkte nicht. Datenqualität und
Tagging entscheiden über die Abdeckung. Ein beliebiger Markt in Antananarivo
funktioniert bei vorhandener geeigneter Fläche genauso wie in Jeju; fehlende
Flächen oder ungetaggte Märkte werden nicht erfunden. Kein KI-Dienst notwendig.

Geschlossene Ways und vollständige Multipolygon-Relationen werden übernommen,
inklusive Löchern. Einzelne Marktpunkte sind keine Flächen. Unvollständige
Geometrien werden verworfen und gezählt. Teilflächen mit derselben Wikidata-ID
werden zu einem Veranstaltungsort zusammengefasst. Nähe oder ähnliche Namen
allein verbinden keine unterschiedlichen Märkte.

## Cache und Ausfälle

- Öffentliche Flächendaten liegen ohne Personenbezug in `market_catalog_tiles`.
  Frisch für 14 Tage, markierter Rückfall auf höchstens 90 Tage alte Daten.
  Maximal 2.048 gespeicherte Regionen. Quellen-URLs und OSM-Datenstand bleiben
  im Katalog erhalten. Bei Anbieterwechsel wird der Cache getrennt.
- Höchstens 48 ausgewählte Regionen und 24 neue Abfragen pro Scan; zusätzliche
  Regionen oder nicht verfügbare Antworten ergeben sichtbare Teilresultate.
  Wiederholung nutzt den Cache und ergänzt fehlende Regionen. Sehr große
  Zeiträume können mit kürzerem Rückblick aufgeteilt werden.
- Eine Datenbank-Lease serialisiert Abrufe über Accounts und Prozesse hinweg.
  Gemeinsames Tageslimit: 80 Anfragen; ab 4 MB empfangener Nutzdaten wird keine
  neue Anfrage zugelassen. Eine letzte Antwort ist auf 4 MB begrenzt.
- Ein Abruf hat 16 Sekunden Zeitbudget. Nach Fehlern endet der Netzabruf für
  diesen Scan; vorhandene Cache-Daten werden trotzdem ausgewertet. Mindestens
  30 Sekunden gemeinsame Rückoffzeit, bei 406/429 längeres `Retry-After` bis 1 h.
  Keine parallelen Abrufe und kein automatisches Ausweichen auf andere Server.
- Ohne Flächen stehen die normalen Aufenthaltssuggestions weiterhin bereit.
  Kartenausfall bedeutet nicht „kein Marktbesuch“. Bei Entzug der Einwilligung
  werden verspätete Antworten weder gecacht noch als Vorschlag gespeichert.

`MARKET_OVERPASS_URL` kann serverseitig einen anderen Overpass-Endpunkt setzen.
Das ist keine nutzerseitig beschreibbare URL. Standard:
`https://overpass-api.de/api/interpreter`.

## Nachweise und Übernahme

Die Vorschläge enthalten originale Dawarich-Punkt-IDs und Zeitfenster,
Flächen-IDs, öffentliche Quellen, innere Trefferanzahl und Unsicherheiten.
Grenzfälle bleiben zur manuellen Prüfung. Ein vollständig erkannter Markt wird
als `shopping`, `dataSource=dawarich` mit OSM-/Wikidata-Referenz übernommen.
Ändert der Nutzer Name oder Position wesentlich, werden diese Referenzen nicht
an den korrigierten neuen Ort geheftet. Bestehende eigene Orte dürfen durch
Name oder öffentliche Identität wiedererkannt werden; ein Laden innerhalb des
Marktes gilt nicht als bereits erfasster Markt.

## Migration und Validierung

Migration `20261015020000_market_area_catalog` ergänzt zwei optionale
Scan-Felder und zwei Katalogtabellen. Sie verändert keine Reise-/Besuchsdaten.
Vor Aktivierung auf einer Instanz müssen Migration und Anwendung zusammen
bereitgestellt werden. Deployment/Containerwechsel benötigen die bestehende
Freigabe; insbesondere wurde Prod nicht verändert.

Tests decken Geometrien, langsame Durchfahrt, Randtoleranz, Pausen,
Punktduplikate, weltweite Raster, Cache, Antwortlimits, Budget-Leases,
Einwilligungsentzug, Altdatenablösung, vorhandene Besuche und mehrfaches
Bestätigen ab. Reale Korea-Positionsdaten wurden ausschließlich in einer
isolierten lokalen Kopie geprüft. Private Ergebnisse gehören nicht ins Repo.

Quellen: [OSM marketplace](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dmarketplace),
[Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API),
[Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL).
