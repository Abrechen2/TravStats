# Runde 2 — Antworten auf Runde 1 (01.11.2026)

Danke für Runde 1. Gliederung, Bausteine, Texte und Zuordnung tragen. Diese Datei
sagt, was der Owner entschieden hat, was der Code auf deine Rückfragen antwortet
(`Antworten-Rueckfragen.md`) und was eine Zweitprüfung (Codex) gefunden hat.
Bitte liefere eine überarbeitete Fassung derselben Dateien.

## Entscheidungen des Owners

| Deine Frage | Entscheidung |
|---|---|
| 1 Wohnort = Heimatort | **Ja, dasselbe.** Es bleibt ein Wohnort mit Zeiträumen, weil alte Reisen gegen den Wohnort ihres Tages zählen (Umzüge). Der Heimatort ist der Wohnort des laufenden Zeitraums. Server und App werden gerade darauf umgestellt. Ein Umzug ist ein neuer Zeitraum, kein Überschreiben. |
| 2 Zuhause ins Profil | Ja, wie empfohlen. |
| 3, 4, 5, 6 Mail/Push/Föderation/GitHub/Ollama in Dienste, WebDAV aufteilen, Admin-Seiten auflösen, öffentliche Links nur unter Teilen | **Angenommen.** |
| 7, 8 „Routen auf der Karte“ und „Sitzplatz-Statistik“ streichen | **Angenommen.** |
| 10 Stufen neu verteilt | **Angenommen**, mit einer Korrektur unten (Schlüssel). |
| 13 Hell/Dunkel | Nicht anbieten. |
| 14 Konto löschen | **Ja, wird gebaut.** Zeichne es fertig: Gefahr-Aktion, Tippwort, Zustand „Löschung läuft bis {Datum}“, Abbrechen. |
| 15 Felder ohne Bedienung | `timezoneFollowsDevice` **nicht** anbieten; alle vier streichen. |
| 17 Rollen ändern | **Nicht** in dieser Runde. Nichts zeichnen. |
| 22 Adressen | **Englisch, die heutigen behalten.** `/settings/account`, `/settings/location` usw. Neue Seiten bekommen englische Namen (z. B. `/settings/sharing`, `/settings/server`, `/settings/maintenance`). Die deutsche Oberfläche bleibt. Bitte Abschnitt 6 und alle Adressen im Konzept umstellen. |
| 26 Speichern | **Deine Auswahl bleibt stehen** (wie im Auftrag). Achtung: Das ist eine Änderung gegenüber heute (R1), der Bau zieht nach. Zeichne es so wie in Runde 1. |
| übrige (11, 12, 16, 18–21, 23–25) | Deine Empfehlung gilt, solange der Owner nichts anderes sagt. |

## Was der Code auf deine Rückfragen sagt — und was sich dadurch ändert

Die vollständigen Antworten mit Belegen stehen in `Antworten-Rueckfragen.md`. Für den Entwurf zählt:

- **R7 Katalog:** 31 Dienste, nicht 36. Baue die Dienste-Seite aus dieser Tabelle neu auf. Für jede Karte gilt: nur die Fähigkeiten, die die Tabelle nennt (Schalter, Test, Budget/Kontingent, „immer an“). Fass Dienste nur dort zu einer Karte zusammen, wo die Tabelle das trägt, und begründe jede Zusammenlegung.
- **R8 Dawarich:** Standortquelle, Aufenthaltssuche und Ländertage brauchen die **eigene** Verbindung des Kontos. Die Server-Verbindung dient nur für Tracks von Touren und Kreuzfahrten und einen Hintergrundjob. Ein Konto, das nur die Server-Verbindung hat, kann Dawarich nicht als Quelle wählen. Das muss die Abhängigkeit sagen.
- **R19 Adressen:** Ist die öffentliche Adresse leer, gilt `localhost`. Sie ist also kein „optional“, sondern eine Pflichtangabe mit Warnung, solange sie fehlt. Die LAN-Adresse wirkt nur beim Strava-Rücksprung.
- **R1 Speichern:** siehe Entscheidung 26.
- **R2, R13, R22** und der Rest: bitte übernehmen, wo sie eine Annahme von dir bestätigen oder widerlegen. Jede **[Annahme]** aus Runde 1 wird entweder belegt oder bleibt markiert.

## Was die Zweitprüfung gefunden hat

1. **Zugangsdaten nicht verkürzen.** OpenSky braucht Client-ID und Secret, und zwar je Konto und je Instanz. Die Instanz-Verbindungen zu Immich und Dawarich haben Adresse und Schlüssel. Ein generisches Schlüsselfeld reicht dort nicht.
2. **Schlüssel sind Standard.** Die Schlüssel und Verbindungen für Immich und Dawarich auf Server-Ebene, und „echte Flugtracks abrufen“, stehen in Runde 1 unter Experte. Nach dem Auftrag gehören An/Aus und Schlüssel zu Standard; nur Adressen, Modelle, Ports und Takte sind Experte.
3. **Gesperrt heißt gesperrt.** Im Prototyp lassen sich gesperrte und Demo-Zeilen per Tastatur noch bedienen (`pointer-events: none`). Beschreib gesperrt als nicht fokussierbar beziehungsweise `aria-disabled` mit Begründung.
4. **Dialoge:** Fokus im Dialog halten, Escape schließt, das Tippwort wird wirklich geprüft.
5. **Suche:** Bricht sie nach acht Treffern ab, sagt sie das („8 von 23, weiter tippen“).
6. **Texte vollständig:** Es fehlen Dialogtexte (Verweise auf `DLG`), generische Bestätigungen mit „—“ und Formmeldungen, die nicht in der ersten Person stehen. Jeder Dialog, jede Aktion, jeder Status und jeder Fehler braucht einen Text auf Deutsch und Englisch.
7. **Tokens:** Zusätzliche Radien und Abstände außerhalb von `tokens.json` gehören zurück auf Token-Werte. Ein Formfehler ist `bad`, ein gescheitertes Speichern ist `warn` (so wie in Runde 1).
8. **Gruppen mit ungespeicherten Änderungen** warnen vor dem Verlassen. Das fehlte im Prototyp.

## Rückgabe

Dieselben Dateien wie in Runde 1, überarbeitet. Dazu oben im Konzept eine kurze
Liste, was sich gegenüber Runde 1 geändert hat.
