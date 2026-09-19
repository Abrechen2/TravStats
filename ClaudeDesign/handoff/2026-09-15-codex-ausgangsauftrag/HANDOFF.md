# Handoff an Claude Design: TravStats vollständig zu einem stimmigen Gesamtbild vereinheitlichen

**Datum:** 15.09.2026
**Auftraggeber:** Dennis
**Erstellt von:** Codex, aus Projektentscheidungen, Implementierungsberichten, visueller Prüfung der beigefügten Beta-Referenzen und einer ergänzenden Live-Sichtung in Chrome am 15.09.2026.

## 1. Auftrag und meine Einschätzung

**Owner-Klarstellung vom 15.09.2026: „der Plan war alles anzugleichen für stimmiges gesamt bild“.**

Vereinheitliche die gesamte TravStats-Webanwendung auf dem gemeinsamen Designsystem von Web und Companion. Der Auftrag umfasst alle vorhandenen Seiten, Unterseiten, Formulare, Dialoge, Sheets, Tabellen, Kartensteuerungen und Rückmeldungen. Jeder Bereich soll erkennbar zur selben Anwendung gehören. Die vier später beschriebenen Abläufe sind Prüfbeispiele für dieses Gesamtsystem und begrenzen den Umfang nicht.

Die vorhandene Funktionalität bleibt erhalten. Vereinheitliche ihre Darstellung und Bedienmuster; zusätzliche Produktfunktionen werden nur dort vorgesehen, wo sie bereits beschlossen sind. Fehlende oder noch nicht umgesetzte Teile werden in einer vollständigen Abdeckungsmatrix sichtbar gehalten.

**Meine Einschätzung als Reviewer:** Die Richtung ist gut. Die dunklen Flächen, die warme Akzentfarbe, Hanken Grotesk und die zurückhaltenden Statuspillen passen zu einem persönlichen Reiselogbuch. Der helle Reisepass gibt dem Produkt einen wiedererkennbaren Moment. Ich würde diese Richtung weiterführen.

Die bisherige Beta zeigt gleichzeitig einen unvollständigen Umbau: Viele Farben und Grundbausteine sind vereinheitlicht, während Navigation, breite Tabellen und einzelne Bedienabläufe noch aus dem bisherigen Produkt stammen. Besonders am Handy steht häufig die Verwaltung der Ansicht vor dem eigentlichen Reiseinhalt. Eine gemeinsame Farbpalette allein löst diese Probleme nicht.

**Ziel dieser Runde:** ein vollständiges, konsistentes Gesamtbild über alle Bereiche und Ansichtsgrößen. Dazu gehören schneller Zugriff auf eigene Einträge, verständliche Zahlen, konsistente Aktionen und eine bewusst gestaltete mobile Oberfläche. Die Vorschläge in diesem Handoff sind Review-Empfehlungen; bereits getroffene Owner-Entscheidungen stehen separat in Abschnitt 3.

## 2. Was tatsächlich vorliegt

| Grundlage | Stand und Aussagegrenze |
|---|---|
| Laufende interne Design-Beta | Am 15.09. über Versionsendpunkt als `2.7.0-design.3` festgestellt. |
| Designbranch | `dev/design-system`, Referenzcommit `51ea054925efc5add4d77fd7192915aac48ad3f5` vom 06.09.; am 15.09. mit dem GitHub-Branch abgeglichen. |
| Acht Bilder unter `referenzen/` | Bereits vorhandene Aufnahmen aus `ClaudeDesign/screenshots/design-system/beta-ct106/`. Historische Beta-Aufnahmen vom Implementierungsstand 06.09., keine neu aufgenommenen Screenshots vom 15.09. |
| Tokens und Systembeschreibung | Unveränderte Kopien aus `design/` dieses Referenzcommits. Die Systembeschreibung enthält ältere Aussagen; Korrekturen dazu stehen unten. |
| Umsetzung laut damaligem Bericht | Sieben Blöcke: drei fertig, vier teilweise. Offene Bereiche betreffen unter anderem Kopfzeile, Detailseiten, mobile Kartenbedienung, Reisen/Werkzeuge und Jahresrückblick. Das ist ein Implementierungsbericht, keine vollständige heutige Funktionsabnahme. |
| Neuere Fehlerkorrekturen | Auf `main`, `fix/audit-round-2` und weiteren Branches vorhanden. Sie sind nicht automatisch im älteren Design-Build enthalten. Screenshots dieses Builds dürfen korrigierte fachliche Fehler nicht zum neuen Sollzustand machen. |
| Live-Sichtung 15.09. | Angemeldete Beta in Chrome: Dashboard, Fluglogbuch bei 1440 × 900 und 390 × 844, Kreuzfahrtliste und -detail sowie Kontoeinstellungen. Die Einzelbeobachtungen stehen in Abschnitt 4. Das ist eine gezielte Sichtung, keine vollständige UI-/Funktionsabnahme. Die beigefügten PNGs bleiben die älteren Referenzen. |

Für diese Übergabe ist kein Serverzugang erforderlich. Verwende im Entwurf ausschließlich synthetische Reisedaten. Das Paket enthält keine Zugangsdaten. Die Bilder zeigen einen historischen Testbestand und sind visuelle Referenzen, kein verbindlicher Datensatz für neue Screens.

### Hinweise zu den beigefügten Regeln

Die Datei `referenzen/DESIGN_SYSTEM.md` ist eine historische Baseline. Für diese Runde gilt:

- Hanken Grotesk ist die UI-Schrift. IBM Plex Mono bleibt auf Codes, Messwerte und geeignete Metadaten begrenzt; Newsreader kursiv bleibt eine gezielte Ausnahme des Systems.
- Schriften werden selbst gehostet; die ältere Google-Fonts-Anweisung ist überholt.
- Alle Touren haben eine gemeinsame Domänenfarbe. Die ältere Passage über fünf getrennte Tourfarben ist überholt.
- Eine Diagrammserie, die eine Domäne darstellt, verwendet deren Domänenfarbe. Die allgemeine Diagrammpalette dient beispielsweise Airlines, Jahren und Ländern.
- Kleine lesbare Texte dürfen nicht allein wegen ihrer Nebenrolle sehr schwach dargestellt werden. Den Kontrast der tatsächlichen Kombination prüfen; eine Token-Verwendung ist noch kein Lesbarkeitsnachweis.
- Die Existenz und Kennzeichnung einer Beta-Funktion richten sich nach dem Register des jeweils vorgesehenen Produktstands. Ältere Screens und alte Gate-Listen sind dafür keine verlässliche Quelle.

## 3. Bestehende Owner-Entscheidungen

Quelle: `ClaudeDesign/handoff/2026-09-05-web-redesign-rueckmeldung.md`, Abschnitt 9. Diese Entscheidungen werden hier nicht neu zur Abstimmung gestellt.

| Thema | Vorgabe |
|---|---|
| Gemeinsamer Auftritt | Web, Companion und Website verwenden Hanken Grotesk und das gemeinsame Designsystem. |
| Dashboard | Domänen-Tabs bleiben. Der Darstellungsmodus gehört zum jeweiligen Tab. |
| Einstellungen | Eigene Routen pro Gruppe, beispielsweise `/settings/account` und `/settings/display`. |
| Touren | Eine Farbe für die Domäne; das Verkehrsmittel unterscheidet das Icon. |
| Nutzerfarben | Domänen-Overrides mit Farbwähler bleiben. Ein Override betrifft eine Domäne, keine beliebige einzelne Kreuzfahrt. Gate-Status am Zielbranch abgleichen. |
| Parser | Das Template-/Parser-Werkzeug soll im Beta-Register stehen. Die Erfassung per Buchungs-E-Mail/PDF bleibt als normaler Einstieg erreichbar. |
| Tags und Mitreisende | Für Flüge, Kreuzfahrten, Unterkünfte und Orte vorgesehen, einschließlich Verwaltung. Bei noch fehlendem Backend ausdrücklich als Implementierungsbedarf kennzeichnen. |
| Ortslisten und Admin | Eigene Seiten; Listenfortschritt wird aus besuchten Orten abgeleitet. |
| Entwicklerwerkzeuge | Developer Mode und LoRA-Training nur im Adminbereich; Nutzer dürfen Parser-Feedback senden. |
| Öffentliches Profil | Für diese Runde nicht vorgesehen. |
| Releasebezug | Designarbeit für 2.7 auf `dev/design-system`. Ein Designexport ist keine Freigabe zum Merge oder Deployment. |
| Umsetzung | Die ratifizierte 800-Zeilen-Grenze gilt später auch für die Implementierung. Komponenten und Zustände sollen deshalb sauber getrennt übergeben werden. |

Die frühere Designrückmeldung hat als Zielbild eine Kopfzeile mit vier Primärzielen angenommen: **Dashboard · Logbuch · Reisen · Statistik**. Ergänzende Ziele werden unter „Mehr“ beziehungsweise im Kontomenü gebündelt. Der Posteingang bleibt sichtbar erreichbar. Baue auf diesem Zielbild auf und erfinde keine weitere Navigationsfamilie.

## 4. Konkrete visuelle Befunde und Designauftrag

Die folgenden Beobachtungen stammen aus den beigefügten Bildern; Ergänzungen aus der Live-Sichtung sind ausdrücklich bezeichnet. Eine abgeschnittene Spalte in einem Screenshot beweist beispielsweise nicht, dass horizontales Scrollen technisch unmöglich ist. Der Designauftrag ist, die wichtigen Informationen ohne solche Umwege verständlich zu machen.

| ID | Beobachtung | Auftrag |
|---|---|---|
| D-01 | Die Kopfzeile verteilt Navigation auf viele Ziele sowie Support, System und Konto. Die gewünschte neue Shell ist noch nicht vollständig sichtbar. | Das angenommene Navigationsmodell konsequent gestalten. Pro Seite eindeutiger Standort und eindeutiger Haupteinstieg; seltene Ziele bleiben auffindbar. |
| D-02 | Im mobilen Fluglogbuch stehen zuerst mehrere Filterzeilen, Überschrift/Aktionen, Kennzahlen und Importhinweis. Im sichtbaren Tabellenausschnitt dominieren Airline und Flugnummer; Route und weitere Kerndaten liegen rechts. | Mobile Einträge nach Reiseinhalt ordnen: Route/Ziel, Datum, Status zuerst. Zusatzdaten aufklappbar oder im Detail. Suche und Filter kompakter anbieten, ohne aktive Filter zu verstecken. |
| D-03 | Auf der mobilen Karte konkurrieren „Aktivität“, „Hinzufügen“, Legende, Kartenpanel und Attribution um Fläche. Unten überlagern sich die Flächen im Referenzbild. | Eine abgestimmte Kartensteuerung entwerfen. Aktivität und Detailinformation erhalten klar definierte Sheet-Zustände. Attribution bleibt lesbar und erreichbar. |
| D-04 | Der Reisepass besitzt eine überzeugende helle Dokumentfläche. Mobile Innenabstände, mehrere verschachtelte Rahmen und lange Erklärungen lassen dem eigentlichen Inhalt wenig Breite. Die breite Ländertabelle zeigt zunächst nur einen Teil der Informationen. | Papiercharakter bewahren. Mobile Länderzeilen und eine kurze Zusammenfassung entwerfen; ausführliche Zählregeln und Nachweise gezielt öffnen. |
| D-05 | Die Einstellungen sind bereits sinnvoll nach Gruppen erreichbar. Innerhalb „Konto“ stehen Profil, Sicherheit, Tokens und Geräte weiterhin als lange Kartenfolge. | Alltagseinstellungen und seltene technische Aufgaben klar priorisieren. Jede Sektion erhält passende Rückmeldungen und einen verständlichen Umfang. Keine unnötige Wiederholung langer Hilfetexte. |
| D-06 | Kleine Sekundärtexte wirken teils sehr zurückgenommen; im hellen Reisepass erscheinen Akzentlabels und Links relativ blass. | Lesbarkeit für die konkreten Hintergründe prüfen. Wichtige Metadaten bleiben gut lesbar; Status erhält immer Text oder Symbol zusätzlich zur Farbe. Keine pauschalen neuen Farbwerte einführen. |
| D-07 | Live am 15.09.: Flugliste verwendet unter anderem `SCHEDULED`, Kreuzfahrtliste `Scheduled`. Datumsdarstellung wechselt von formatiertem Wochentag/Datum im Fluglogbuch zu `YYYY-MM-DD` in der Kreuzfahrtliste und `DD.MM.YYYY` im Kreuzfahrtdetail – innerhalb derselben englischen Sitzung. | Gemeinsame Regeln für Statusbeschriftung, Datums-/Zeitdarstellung, Einheiten und Lokalisierung festlegen und an allen Domänen nachweisen. Fachlich notwendige Unterschiede wie Ortszeiten bleiben erklärt. |
| D-08 | Live am 15.09.: Die Kreuzfahrtliste wirkt eng mit dem Fluglogbuch verwandt; der Wechsel zum Detail bringt jedoch einen anderen Kopfaufbau, zusätzliche Metadaten-Kästchen und mehrere verschieden gewichtete Abschnittstitel. | Eine durchgängige Familie für Listen, Detailköpfe, Metadaten, Karten und Aktionen definieren. Unterschiede müssen durch den Inhalt begründet sein. |

**Live-Abgleich:** D-01 und D-02 sind am 15.09. auch mit dem angemeldeten größeren Demobestand sichtbar: Die alte Kopfstruktur bleibt; bei 390 px liegt ein großer Steuerbereich vor dem Fluglogbuch, und in den sichtbaren Tabellenzeilen fehlen rechts wesentliche Informationen. Auf der Desktopkarte beansprucht das geöffnete Einstellungs-Panel eine lange linke Spalte. Diese aktuelle Sichtung bestätigt den Bedarf an einer gemeinsamen Hierarchie, nicht die Vollständigkeit aller historischen Einzelbefunde.

### Meine Empfehlung zu Farben auf der Karte

Die Vereinheitlichung ist sinnvoll. Laut Implementierungsbericht werden geplante Flüge und geplante Kreuzfahrten in den neuen **Voreinstellungen** beide blau; laufende und abgeschlossene Reisen teilen sich teilweise ebenfalls einen Farbton. Gespeicherte Nutzerfarben können davon abweichen. In der live betrachteten Sitzung am 15.09. war die geplante Flugroute beispielsweise weiterhin korallfarben. Aus einem gespeicherten Override darf kein allgemeiner Standard abgeleitet werden.

Liefere dafür eine **begründete Empfehlung** mit zwei kleinen Vergleichsausschnitten:

1. Bestehende Statusfarbe beibehalten und Domäne/Zustand mit Symbolen, verständlicher Legende und Auswahlzuständen unterscheiden.
2. Domänenfarbe erhalten und den Planungsstatus über ein zusätzliches visuelles Merkmal anzeigen.

Die Entscheidung zwischen beiden Varianten ist noch offen. Ein abweichendes Farbmodell darf nicht stillschweigend zum neuen Standard werden. Geplante Bögen sind im derzeit dokumentierten Renderer nicht gestrichelt; ein Mockup darf eine solche Linienart nur als technische Anforderung zeigen, nicht als bereits vorhandene Fähigkeit.

## 5. Vollständiger Umfang und gemeinsame Seitenfamilien

Erstelle zuerst ein Inventar aller vorhandenen Routen, Unteransichten und Overlay-Flows. `ROUTENMATRIX.csv` enthält die aus dem Referenzbranch extrahierten Routen als Startpunkt. Ergänze alle nicht als Route geführten Formulare, Dialoge und Sheets. Eine Route zählt erst als gestaltet, wenn die zugehörigen sichtbaren Unterzustände berücksichtigt sind.

| Familie | Vollständig zu vereinheitlichender Umfang |
|---|---|
| Globaler Rahmen | Desktop-/Mobilnavigation, Seitenbreiten, Seitenköpfe, Zurück-Navigation, Breadcrumbs wo sinnvoll, Suche, Hinzufügen, Konto, Posteingang, Support und Systemzugänge |
| Dashboard und Karten | Alle Domänen-Tabs, ihre Modi, Globus, Heatmap, Sichtbarkeit/Filter, Legende, Aktivität, Auswahlzustände, Karten-/Routen-Details und mobile Sheets |
| Logbuch | Flüge, Kreuzfahrten, Unterkünfte und Orte: Listen, Filter, Sortierung, Kennzahlen, Spaltenwahl, Zeilenaktionen und mobile Darstellung |
| Eintragsdetails | Flug, Kreuzfahrt, Unterkunft, Aufenthalt und Ort; zugehörige Flugzeug-/Kettenansichten; Belege, Fotos, Preise, Quellen, Tags, Mitreisende und Reisezuordnung |
| Reisen und Touren | Reiseübersicht, Reise-Detail mit allen Reitern, Journal, Galerie, Karten, Gruppierung, Zusammenführen, Routen-/Toureneditor und ihre Dialoge |
| Sammlungen | Ortslisten, Listendetails, kuratierte Checklisten, Fortschritt und zugehörige Verwaltungsaktionen |
| Statistik und Rückblick | Gesamtsicht und Domänenstatistiken, Diagramme, Zeiträume, Rekorde/Bestenlisten gemäß Zielumfang, Erfolge und Erfolgsdetails, Reisepass und Ländernachweise, beschlossener Jahresrückblick |
| Erfassen und Importieren | Manuelle Anlage und Bearbeitung aller Domänen, Dokument-/E-Mail-Erfassung, Importübersicht, Preview, Zuordnung, Konflikte, Rückfragen und Ergebnis |
| Posteingang | Datenqualitätsfragen, Flugupdates, Vorschau, Bearbeiten, Annehmen/Ablehnen und Lade-/Fehler-/Leerzustände |
| Einstellungen | Sämtliche allgemeinen und domänenspezifischen Gruppen, Profil, Darstellung, Daten, Export, Verbindungen, Sicherheit, Geräte und Speicherrückmeldungen |
| Administration und Werkzeuge | Alle vorhandenen Adminsektionen, Benutzer/Rollen, Kataloge, Integrationen, Backups/Restore, Updates, Parser-/Template- und Entwicklerwerkzeuge – im Web mit passendem Rollen-/Gate-Status |
| Zugang und Sonderseiten | Login, 2FA, Passkey-Zustände, Registrierung, Setup, Passwortreset, erzwungener Passwortwechsel, Zugriff verweigert, nicht gefunden und Druckansichten |

**Gemeinsame Regeln müssen über alle Familien reichen:** gleiche Begriffe für gleiche Dinge; gleiche Primär-/Sekundäraktionen; gleiche Eingabehöhen, Radien und Abstände; gleiches Muster für Speichern/Abbrechen; gleiche Statusbedeutung; gleiche Datum-/Zahl-/Währungsformatierung; gleiche Navigationstiefe; gleiche Leer-/Fehler-/Ladezustände.

Zusätzlich eine gemeinsame Icon-Familie, feste Icongrößen, gleiche Karten-/Rahmenhierarchie und eine nachvollziehbare Typografieskala anwenden. Ein verstreuter Wechsel zwischen Emoji, Outline-Icons und unterschiedlich großen Symbolkacheln soll nicht zufällig die Domäne bestimmen. Begründete Eigenheiten bleiben möglich: Eine Karte braucht andere Flächen als eine Tabelle, und der Reisepass behält bewusst seine helle Dokumentfläche.

Für Web, Companion und Website werden Schrift, Farbsemantik, Icons und wiederverwendbare Muster als gemeinsame Produktfamilie abgeglichen. Der Webauftrag umfasst alle oben genannten Bereiche. Der Companion bleibt eine Nutzer-App: Administration und tabellarische Massenimporte werden dadurch nicht zu mobilen Pflichtfunktionen. Die Website erhält die passenden Marken-/Typografieregeln; ihr Seiteninhalt wird nicht zu einer Kopie der Webanwendung.

### Vier Ablaufproben für die Gesamtgestaltung

Gestalte die folgenden Beispiele interaktiv durch. Zusätzlich ist jede andere Familie aus der Tabelle im Gesamtentwurf und in der Abdeckungsmatrix zu liefern. Priorisierung legt die Bearbeitungsreihenfolge fest; sie streicht keine Seiten aus dem Auftrag.

#### A. Einen Eintrag finden und korrigieren

**Logbuch → Suche/Filter → Flugdetail → Bearbeiten → Speichern → aktualisierter Eintrag.**

- Desktop: gut vergleichbare Tabelle, sinnvolle Spaltenpriorität, erkennbare Sortierung und Zeilenaktionen.
- Handy: kompakte, vollständig verständliche Einträge; Route, Datum und Status passen ohne horizontales Scrollen.
- Filter: sichtbar aktiv, einzeln entfernbar, „Zurücksetzen“, verständlicher Zustand „keine Treffer“.
- Detail: Hauptdaten zuerst; Plan-/Istzeit eindeutig benennen, Ortszeit/Zeitzone nachvollziehbar, fehlende Uhrzeit nicht als echte Mittagszeit darstellen.
- Bearbeiten: geänderte Felder, Pflichtangaben und Fehlermeldungen eindeutig; lange Namen und mehrzeilige Fehlermeldungen mitgestalten.
- Erfolg und Fehler zeigen. Ein fehlgeschlagener Speicherversuch erhält Eingaben; eine rote Kennzeichnung erklärt die konkrete Ursache.

#### B. Eine Buchung erfassen und eine Rückfrage lösen

**Hinzufügen → Dokument/E-Mail auswählen → Auswertung → Vorschlag prüfen → bestätigen → Posteingang/Rückfrage.**

- Automatisch gelesene Werte, unsichere Angaben und eigene Korrekturen unterscheidbar darstellen.
- Mehrere Buchungen desselben Hotels im selben Dokument als echte Gestaltungssituation verwenden. Preise und Währungen bleiben pro Buchung eindeutig.
- Bei vermuteter Hotelzuordnung beide Wege zeigen: „Diesem Hotel zuordnen“ und „Anderes/neues Hotel“.
- Eine ausgewählte beziehungsweise fehlende Währung muss verständlich korrigierbar sein, auch bei AED/KWD.
- Unterschied zwischen Scan-/Erfassungseinstieg und dem fortgeschrittenen Template-Werkzeug sichtbar halten.
- Eine Vorschau auf Statistikänderungen nur mit belegbaren Angaben gestalten. Solange keine Serverauskunft vorliegt, Unsicherheit zeigen und benötigten API-Vertrag dokumentieren.
- Posteingang: „wird geladen“, „nichts zu prüfen“, „Daten konnten nicht geladen werden“ und eine konkrete Rückfrage sind eigene Zustände.

#### C. Reise und Karte verstehen

**Dashboard-Tab → Darstellungsmodus → Route/Ort auswählen → Detail-Sheet → Reise öffnen → zurück zur Karte.**

- Domäne, Modus und Filter getrennt verständlich halten. Die Bedienelemente dürfen einander nicht unbemerkt umschalten.
- Desktop mit Karte und ergänzendem Panel, Handy mit bewusst gestalteten Sheet-Höhen.
- Zustände: Sheet geschlossen, Vorschau, erweitert; lange Inhalte, Tastatur und Zurück-Navigation berücksichtigen.
- Geteilte Links und wiederhergestellte Ansichten müssen dieselbe Darstellung eindeutig beschreiben. Das derzeit dokumentierte Auseinanderlaufen von gemerktem Modus und URL als offenen Vertrag aufführen.
- Reise-Detail berücksichtigt Übersicht, Timeline, Karte, Galerie, Logistik und Journal; Touren nach vorgesehenem Funktionsumfang.
- Beim Löschen einer Reise bleibt die Unterscheidung zwischen Reise als Klammer und ihren Einträgen deutlich. Bestätigungstexte müssen der tatsächlichen Serverwirkung entsprechen.

#### D. Eigene Reisegeschichte nachlesen

**Statistik → Reisepass → Land → Nachweis → ursprünglicher Eintrag.**

- Reisepass mit kurzer, verständlicher Aussage beginnen, beispielsweise „8 Länder nach deiner Zählregel“; Definition und Nachweise erreichbar lassen.
- „Nicht bekannt“, „nicht anwendbar“ und der echte Wert null/0 werden sprachlich unterschieden.
- Die vier fachlichen Nachweisstufen – nur umgestiegen, durchgereist, besucht, übernachtet – bleiben unterscheidbar. Ob eine Stufe zur Kopfzahl zählt, richtet sich nach der gewählten Zählregel.
- Auf kleinen Screens sind Länder, Nachweis und wichtigste Kennzahl direkt verständlich; weitere Werte werden gezielt geöffnet.
- Große Reisehistorie gestalten: lange Ländernamen, 20 Jahre, viele Einträge und fehlende Datumspräzision.
- Jahresrückblick im Gesamtentwurf ausarbeiten und als noch zu implementierende Seite kennzeichnen. Dafür zuerst eine belastbare Daten-/Kennzahlenliste liefern.

## 6. Regeln für alle gelieferten Screens

### Informationshierarchie

- Pro Ansicht eine erkennbare Hauptaktion. Sekundäre Aktionen treten zurück, bleiben aber erreichbar.
- Bestehende Daten haben Vorrang vor allgemeinen Importhinweisen und umfangreichen Statistikblöcken.
- Die Oberfläche soll ein persönliches Reiselogbuch vermitteln: Orte, Routen, Zeit und Erinnerungen tragen den Inhalt. Technische IDs und Datenquellen werden an passenden Stellen erklärt.
- Schriftgröße und Kontrast lösen keine Layoutprobleme durch Verkleinerung. Verdichten bedeutet priorisieren, gruppieren und Details gezielt öffnen.

### Mobil und Tastatur

- Hauptentwürfe für 1440 × 900 und 390 × 844; schmale Gegenprobe bei 320 × 568, außerdem ein nachvollziehbarer Tablet-Übergang bei 768 px.
- Keine horizontal überlaufende Gesamtseite. Optional breite Spezialtabellen erhalten einen ausdrücklich erkennbaren lokalen Scrollbereich; Kerninformationen bleiben sichtbar.
- Bedienelemente mit ausreichend Abstand und **44 × 44 CSS-px als vorgeschlagenem Projektziel für Touch-Flächen**. Das ist eine Designvorgabe für diese Runde, keine Behauptung über eine externe Norm.
- Bei Formularen die geöffnete Bildschirmtastatur mitdenken: aktive Eingabe und relevante Aktion bleiben erreichbar.
- Fokus, Tastaturreihenfolge, Escape/Zurück, Dialogtitel und Rückkehr zum Auslöser dokumentieren.
- Desktop-Hover darf keine Information enthalten, die am Handy unerreichbar ist.

### Zustände und Sprache

Pro relevanter Komponentenfamilie: Standard, ausgewählt, fokussiert, deaktiviert mit Grund, Laden, leer, Fehler, Erfolg; bei Synchronisierung außerdem ausstehend und wieder verbunden.

- „Keine Einträge“, „keine Treffer“ und „Laden fehlgeschlagen“ sind verschiedene Aussagen.
- Lokale ausstehende Änderungen dürfen nicht wie bereits serverseitig gespeicherte Daten aussehen. Offline-Bearbeitung nur dort versprechen, wo das Zielprodukt sie unterstützt.
- Deutsch als Hauptsprache; Fluglogbuch, Formular und Einstellungen zusätzlich mit längeren deutschen Texten und einer englischen Variante prüfen.
- Speichern sichtbar erklären: explizites Speichern und automatisches Speichern dürfen sich nicht widersprechen. Zustände „Änderungen vorhanden“, „wird gespeichert“, „gespeichert“ und „Speichern fehlgeschlagen“ gestalten.
- Bei Beta-Funktionen knapp erklären, was vorläufig ist. Das Label wird aus dem Zielregister abgeleitet; „Beta“ rechtfertigt keine unklare Fehlermeldung.

## 7. Erwartete Lieferung

1. **Ein vollständiger Gesamtentwurf** für alle Familien aus Abschnitt 5 mit Desktop- und Handyansichten. Dazu ein zusammenhängender klickbarer Prototyp, der alle Familien erreichbar macht und die vier Ablaufproben einschließlich Zuständen durchführt. Alte und neue Gestaltung dürfen nicht unkommentiert nebeneinander stehen bleiben.
2. **Eine kompakte Komponentenübersicht:** Navigation, Domänenleiste, Filter, Tabellenzeile/mobile Eintragszeile, Statuspille, Detailkopf, Formular, Bestätigungsdialog, Sheet, Empty/Error State, Speicherrückmeldung.
3. **Vergleichstafeln für das Gesamtbild:** alle vier Logbuchlisten nebeneinander, alle Eintragsdetailköpfe nebeneinander, Formular-/Dialogfamilien nebeneinander, einheitliche Einstellungen/Adminsektionen. Daran müssen gleiche Regeln und begründete Unterschiede sofort sichtbar sein.
4. **Eine vollständige Zustands- und Routenmatrix** mit „gestaltet“, „im Prototyp bedienbar“, „bestehendes Produktverhalten“ und „neue Implementierung nötig“ als getrennten Spalten. Jede Route aus dem Inventar und jedes Overlay bekommt eine Zeile. Offene Seiten bleiben benannt; ein Musterbeispiel ersetzt ihre Gestaltung nicht.
5. **Ein Entscheidungsprotokoll:** Was wurde gegenüber der Beta verändert, welches konkrete Problem löst es, welche Alternative wurde verworfen und warum?
6. **Eine kurze Umsetzungsliste:** vorhandene Komponenten weiterverwenden, neue UI-Komponenten, benötigte Backend-Verträge und noch offene Produktentscheidungen getrennt benennen.
7. **Token-Abgleich:** vorhandene Token-Namen verwenden. Notwendige Ergänzungen separat mit Begründung und Auswirkungen auf den Companion vorschlagen; keine stillen Änderungen an der gemeinsamen Baseline.

Die empfohlenen zusätzlichen Gestaltungsmuster in diesem Handoff sind keine bereits umgesetzten Produktfunktionen. Zusätzliche API-Abfragen, neue Statistiken oder neue Bearbeitungsmöglichkeiten gehören ausdrücklich in die Umsetzungsliste.

## 8. Abnahmefragen

- Ist im mobilen Logbuch ohne seitliches Scrollen erkennbar, wohin und wann gereist wurde und welcher Status gilt?
- Kann man im Prototyp einen konkreten Eintrag finden, korrigieren und das gespeicherte Ergebnis wiederfinden?
- Bleiben auf der mobilen Karte Attribution, Hauptaktion und geöffnetes Sheet gleichzeitig sinnvoll nutzbar?
- Kann ein Nutzer bei einer unsicheren Importzuordnung verständlich zustimmen oder widersprechen?
- Ist erklärt, weshalb ein Land gezählt wird, und führt der Weg zum zugrunde liegenden Eintrag?
- Sind 0, unbekannt, fehlend und ausstehend unterscheidbar?
- Bleiben Dialoge und Formulare bei 320 px, langen Texten und Tastaturbedienung nutzbar?
- Stimmen Kartenlegende, Diagramme, Statuspillen und Domänenfarben in ihrer Bedeutung überein?
- Ist jede neue Produktannahme sichtbar dokumentiert, statt als fertige Fähigkeit präsentiert?
- Ist jede vorhandene Seite beziehungsweise jeder Overlay-Flow einer gemeinsamen Gestaltungsfamilie zugeordnet und tatsächlich im Export abgedeckt?
- Wirken Flug, Kreuzfahrt, Unterkunft und Ort bei direktem Wechsel wie Teile derselben Anwendung – einschließlich Listen, Details, Bearbeiten und Rückmeldungen?
- Stimmen Web und Companion bei Schrift, Farbsemantik und gemeinsamen Bedienmustern überein, während ihre unterschiedlichen Aufgaben erhalten bleiben?

## 9. Referenzindex

Die Dateinamen nennen die damalige Viewportgröße; einige PNGs sind vollständige Seitenaufnahmen und daher höher als dieser Viewport.

| Dateien unter `referenzen/` | Zweck |
|---|---|
| `dashboard-1440x900.png`, `dashboard-390x844.png` | Kartenbedienung, Navigation, Legende, Flächenkonkurrenz |
| `logbuch-1440x900.png`, `logbuch-390x844.png` | Filterreihenfolge, Tabellendichte, mobile Informationspriorität |
| `einstellungen-1440x900.png`, `einstellungen-390x844.png` | Gruppenstruktur, Formulare, Hilfetexte, Speichermuster |
| `reisepass-1440x900.png`, `reisepass-390x844.png` | Papierfläche, Zählregeln, Länderzeilen, mobile Verdichtung |
| `tokens.json` | Unveränderte Token-Baseline des Referenzbranches |
| `DESIGN_SYSTEM.md` | Historische Systembeschreibung; Klarstellungen aus Abschnitt 2 beachten |

Im Paketroot liegt außerdem `ROUTENMATRIX.csv` als Inventar der vorhandenen Routen des Referenzbranches. Sie ist eine Arbeitsgrundlage für die vollständige Designabdeckung, kein bereits ausgefüllter Abnahmenachweis.

### Zusätzliche Projektquellen für die spätere Umsetzung

- `ClaudeDesign/handoff/2026-09-05-web-redesign-rueckmeldung.md`, insbesondere Abschnitt 9: Owner-Entscheidungen.
- `ClaudeDesign/export/2026-09-05-runde-3/`: früherer Zielentwurf; die vier Abläufe dieser Runde daran abgleichen, nicht alle Screens ungeprüft übernehmen.
- Implementierungsberichte `ClaudeDesign/handoff/2026-09-06-design-system-block-*-bericht.md` auf dem Designbranch.
- `docs/audit-2026-09-09/FIX_REVIEW.md` und `CAMPAIGN.md` auf dem neueren Fixbranch: fachliche Restfälle und spätere Korrekturen. Ältere Statuszahlen dort immer mit dem Commitstand abgleichen.

Dieses Handoff umfasst die Designarbeit und den Export zur Review. Betrieb, Zugangsdaten und Serveraktionen sind kein Teil der Übergabe.
