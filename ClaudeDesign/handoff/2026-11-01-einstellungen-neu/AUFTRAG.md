# Auftrag — Einstellungen komplett neu (01.11.2026)

Die Web-App von TravStats bekommt einen neuen Einstellungsbereich. Dieser
Auftrag beschreibt, **was** der Bereich können muss. **Wie** er aussieht, wie er
gegliedert ist und wie er spricht, entscheidest du.

Owner, 01.11.2026, wörtlich:

> „das gefällt mir immer noch nicht … den kompletten Settings-Bereich neu zu
> designen und zu denken, alle Texte und so weiter … vllt wäre es besser, die
> Admin-Settings mit in die normalen zu packen für den Admin … Expert und
> Standard bleibt auch als Idee, und eine Seite für Dienste bleibt auch. Der
> Rest muss alles neu gedacht werden."

Und vom selben Tag: „überall zu viel Text".

Mit Absicht gibt es keine Bildschirmfotos und keine heutigen Texte. Der heutige
Stand soll dich nicht festlegen.

## Fest — nicht mehr offen

1. **Ein Bereich für alle.** Ein Admin findet seine Instanz-Einstellungen im
   selben Bereich wie seine Konto-Einstellungen, nicht in einem zweiten Menü.
   Wer kein Admin ist, sieht keine Instanz-Bedienung. Wo ihn eine
   Instanz-Entscheidung betrifft (ein Dienst ist nicht freigegeben, das
   Backup-Ziel fehlt), sieht er an seiner eigenen Einstellung eine Statuszeile,
   aber keinen Regler.
2. **Zwei Stufen: Standard und Experte.**
   - Standard zeigt alles, was ein normaler Nutzer entscheiden muss: an/aus,
     Schlüssel, Budgets, Einwilligungen, wohin Daten gehen.
   - Experte zeigt zusätzlich die Feinarbeit: Adressen, Modelle, Ports,
     Reihenfolgen, Takte, Grenzen.
   - Die Stufe ist pro Konto gespeichert. Neue Konten starten auf Standard,
     bestehende stehen auf Experte.
   - Wie man die Stufe wechselt und wie sichtbar sie ist, entscheidest du.
3. **Eine eigene Seite für Dienste.** Gemeint sind alle externen Anbieter: Flugdaten, Karten,
   KI, Fotos (Immich), Standort (Dawarich), Mail, Backup-Ziel, Push und
   Föderation. Was ein Dienst kann, steht im Inventar (A13, C3): Nicht jeder
   hat einen Schalter, ein Budget oder einen Test, und einige sind immer an.
   Erfinde keine Funktion dazu.
   Diese Seite gibt es heute schon, und sie gilt als das Beste am heutigen
   Bereich. Sie darf neu aussehen, bleibt aber eine Seite.
4. **Alles andere ist neu zu denken:** Gliederung, Menü, Seitenaufteilung,
   Bausteine, Texte. Dabei gilt:
   - Jede Einstellung aus den Teilen A und C des Inventars, die heute eine
     Bedienung hat, braucht ein Zuhause. Entweder im Bereich selbst, oder als
     auffindbarer Eintrag, der an die Stelle springt, an der sie wirklich
     bedient wird. Was dort bleibt, steht in Teil B (zum Beispiel
     Kartenpanel, Import-Assistent, einzelne Reise).
   - Teil E (Felder ohne Bedienung, nicht eingebaute Bausteine) ist **nicht**
     im Umfang. Du darfst daraus etwas vorschlagen, aber nur als Vorschlag in
     den offenen Fragen.
   - Zusammenlegen, Weglassen und Verlegen sind Vorschläge mit Begründung. Der
     Owner entscheidet sie.
   - Die Spalten des Inventars zum heutigen Bedienelement und zur heutigen
     Stufe beschreiben den Ist-Stand. Sie sind keine Vorgabe.
5. **Wenig Text.**
   - Eine Einstellung erklärt sich durch ihren Namen.
   - Höchstens eine kurze Zeile darunter, wenn der Name allein nicht reicht.
   - Alles Weitere steht hinter einer Hilfe, die man öffnet.
   - Keine Einleitungsabsätze.

## Was der Bereich können muss (Funktionsanforderungen)

Die vollständige Liste aller Einstellungen und Aktionen steht in `INVENTAR.md`. Für jeden Eintrag nennt sie, was er
steuert, welche Werte möglich sind, den Standardwert, wofür er gilt (Konto,
Instanz oder Gerät), die heutige Stufe, wann er sichtbar ist, Abhängigkeiten,
wie gespeichert wird und welche Fehler der Nutzer sehen muss. Die heutige Stufe
ist ein Vorschlag, keine Vorgabe.

Was über alle Einstellungen hinweg gelten muss:

- **Geltungsbereich erkennbar.** Man sieht jeder Einstellung an, ob sie für
  das eigene Konto, die ganze Instanz (nur Admin) oder nur dieses Gerät gilt.
- **Speichern — so verhält es sich heute schon, und so bleibt es:**
  - Ein einzelner Wert (Schalter, Auswahl, Zahl) speichert sofort.
  - Jede Einstellung hat drei sichtbare Zustände: wird gespeichert,
    gespeichert, und gescheitert mit Grund und „Erneut versuchen“.
  - Scheitert das Speichern, bleibt die Auswahl des Nutzers stehen, und die
    Zeile zeigt den Fehler. Ein Schalter springt erst zurück, wenn der Nutzer
    verwirft.
  - Wer die Seite verlässt, während noch gespeichert wird, verliert nichts:
    Der laufende Schreibvorgang wird noch abgeschickt.
  - Ausnahme sind Gruppen, die nur zusammen Sinn ergeben: Zugangsdaten,
    ein Mailserver, Passwort ändern, 2FA einrichten. Dort gibt es einen
    ausdrücklichen Speichern- oder Testen-Knopf, und eine Gruppe mit
    ungespeicherten Änderungen sagt das, bevor man sie verlässt.
- **Gefährliche Aktionen** wie Löschen, Zurücksetzen oder Neu einlesen
  brauchen einen Bestätigungsschritt. Darin stehen drei Dinge: was
  betroffen ist, wie viel, und was danach anders ist.
- **Lange Aufgaben** wie ein Export, ein Scan oder ein Import laufen im
  Hintergrund. Die Seite zeigt den Fortschritt, das Ergebnis und einen
  Fehler mit Grund.
- **Abhängigkeiten sagen, was fehlt.** Kann eine Einstellung gerade nicht
  wirken, weil der Bereich aus ist, kein Dienst verbunden ist oder der Admin
  es nicht erlaubt hat, dann sagt sie genau das und führt dorthin, wo man es
  ändert. Sie verschwindet nicht still.
- **Bereiche (Domänen).**
  - Ein Nutzer schaltet seine Bereiche ein und aus: Flug, Kreuzfahrt,
    Unterkunft, Orte, Bahn, Bus, Fähre, Mietwagen, Touren.
  - Einstellungen eines ausgeschalteten Bereichs stören nicht, sind aber
    erreichbar, damit man den Bereich wieder einschalten kann.
  - Jeder Bereich hat seine Farbe aus `design/tokens.json`.
- **Suche.**
  - Die Suche findet jede Einstellung, auch eine Experten-Einstellung, ohne
    dafür die gespeicherte Stufe des Kontos umzustellen.
  - Ein Treffer springt an die Einstellung und markiert sie.
- **Alte Links funktionieren weiter.** Heutige Adressen der Form
  `/settings/<seite>#<abschnitt>` und `/admin/...` müssen auf die neue Stelle
  führen. Das löst der Bau; vom Entwurf brauche ich nur eine Tabelle, die
  jeden alten Ort einem neuen zuordnet.
- **Sprache.**
  - Deutsch zuerst, Englisch als Spiegel.
  - Ein Fehler spricht in der ersten Person, ein Warten in der Zukunft.
  - „fehlgeschlagen“, „Fehler“ und „ungültig“ kommen nicht vor; die Regel
    steht in `design/DESIGN_SYSTEM.md` §8.
  - Die Namen beschreiben, was der Nutzer kennt, nicht wie es gebaut ist.
- **Gerät.**
  - Die Web-App ist für das iPad gezeichnet, quer 1366×1024 und hoch
    820×1180. Ein Desktop ist breiter; das Telefon ist Sache der
    Companion-App.
  - Trefferflächen richten sich nach dem Eingabegerät: Mit dem Finger sind
    es mindestens 44 px, auch auf einem breiten iPad.
  - Alles ist mit der Tastatur bedienbar, mit sichtbarem Fokus und echten
    Schaltern (`role="switch"`).
- **Marke.** Wo du Version und „Über TravStats“ hinlegst, steht der fertige
  Baustein „Ein Projekt von `<abrechen2 />`“. Er existiert schon (Wortmarke
  als SVG, Link auf https://www.abrechen2.de/). Du platzierst ihn nur und
  zeichnest ihn als Kasten mit dieser Beschriftung. Das Logo wird nie in einer
  Schrift nachgebaut.

## Design-Vorgaben

- `design/DESIGN_SYSTEM.md` beschreibt das Web-Designsystem: Farben, Schrift,
  Abstände, Bausteine, Zustände und die Regeln aus der Companion-App.
- `design/tokens.json` enthält die Tokens. Ein Wert, der dort nicht steht, ist
  keine Design-Entscheidung.
- **Vorrang:** Die Tokens kommen aus der Telefon-App. Wo
  `DESIGN_SYSTEM.md` für das Web etwas anderes sagt, gilt
  `DESIGN_SYSTEM.md`. Das betrifft vor allem Breiten (§4.2), Hover, Fokus und
  Tastatur (§5) und Dialoge statt Bottom-Sheets (§9).
- Für Bahn, Bus, Fähre, Mietwagen und Touren fehlen teilweise eigene
  Domänenfarben (§11). Nimm, was `tokens.json` hat. Wo nichts steht, schlag
  eine Farbe vor und führ sie als offene Frage.

Du darfst neue Bausteine vorschlagen, wenn der Bereich sie braucht, zum Beispiel
eine Einstellungszeile oder eine Stufen-Umschaltung. Sie müssen dann aus den
Tokens gebaut sein und als Baustein beschrieben werden, nicht als
Einzelanfertigung.

## Was ich zurück brauche

1. **Gliederung.** Das Menü mit allen Seiten und die Abschnitte jeder Seite.
   Für jede Seite: wer sie sieht (alle oder nur Admin) und welche
   Inventar-Einträge dort wohnen. Kein Inventar-Eintrag darf fehlen; was
   wegfällt oder umzieht, steht in einer eigenen Liste mit Begründung.
2. **Bausteine.** Die Einstellungszeile und ihre Varianten (Schalter, Auswahl,
   Eingabe, Aktion, Status), die Stufen-Umschaltung, den Geltungsbereich, den
   Speicherzustand, den Bestätigungsschritt, die Hintergrundaufgabe und die
   Abhängigkeit. Jeweils mit allen Zuständen.
3. **Bildschirme** für das iPad quer, jeweils in Standard und Experte. Sie
   zeigen diese Abläufe:
   - Ein neuer Nutzer kommt zum ersten Mal in die Einstellungen.
   - Ein Nutzer ändert eine einfache Kontoeinstellung, und das Speichern
     scheitert.
   - Ein Nutzer richtet ein, woher seine Standortdaten kommen, und lässt
     Aufenthalte suchen. Das ist die dichteste Gruppe im Inventar (A8).
   - Ein Nutzer verbindet einen externen Dienst und testet ihn.
   - Ein Admin ändert eine Instanz-Einstellung.
   - Eine Suche findet eine Experten-Einstellung, während das Konto auf
     Standard steht.
   - Eine gefährliche Aktion wird bestätigt, und danach läuft eine lange
     Hintergrundaufgabe.

   Dazu einen dieser Abläufe im iPad hoch.
4. **Zuordnung jedes Inventar-Eintrags.** Eine Tabelle mit einer Zeile pro
   Eintrag aus A und C: Gruppe und Name wie im Inventar, neue Seite, neuer
   Abschnitt, Baustein, Stufe und wer ihn sieht.
5. **Alle Texte** auf Deutsch und Englisch, als Tabelle mit diesen Spalten:
   Inventar-Eintrag, Name, Kurzzeile, Hilfetext. Dazu die Texte von Dialogen,
   Aktionen, Statusmeldungen, Fehlern und leeren Zuständen.
6. **Zuordnungstabelle** alter Ort → neuer Ort. Jede Adresse aus dem Anhang
   unten bekommt ein Ziel.
7. **Offene Fragen**, die nur der Owner entscheiden kann, jeweils mit deiner
   Empfehlung.

Abgabe als Design-Canvas oder als HTML-Seiten, dazu eine Markdown-Datei mit
den Punkten 1, 4, 5, 6 und 7. In Entwürfen stehen nur erfundene Daten: keine
echten Adressen, Schlüssel oder Namen.

## Anhang — heutige Adressen

Einstellungen (`/settings/<seite>#<abschnitt>`):

| Seite | Abschnitte |
|---|---|
| account | profile, security, devices, notifications, apitokens |
| display | display, units, domains, countryCounting |
| views | mapAppearance, dashboardAppearance, listAppearance |
| trips | trips, suggestions, sharing, calendarFeed |
| companions | companions |
| location | locationProvider, travTrack, dawarich, tripRecording, stayScan |
| loyalty | loyalty |
| privacy | shareLinks, comparisonConsent, encryptedGrants |
| flight | homeAirport, autoupdate, features, defaults, enrichment |
| cruise | cruisePreferences |
| data | backup, import |
| services | externalServices |

Administration (`/admin/<seite>`): instance (Abschnitte instance, travTrack,
travPlan, shareLinks, importMode, usageStats, about, federation, push), users,
invitations, externalServices, parsers (parsers, templateRepo), smtp, backups
(backups, webdav), timeModel, logging, system, airlinesMasterData,
aircraftMasterData, airportsMasterData, shipsMasterData, portsMasterData,
lodgingChainsMasterData.
