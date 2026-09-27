# Auftrag — Dashboard-Domänen-Filter statt Tabs (27.09.2026)

Die Web-App baut den Dashboard-Wechsler von acht Domänen-Tabs auf **eine
Karte + Filter** um. Owner, 27.09., mit Alex zusammen entschieden — das
hebt Entscheidung Nr. 1 aus `2026-09-05-web-redesign-rueckmeldung.md` §9
auf („Dashboard-Tabs bleiben"; die Statistik-Seite behält ihre Tabs,
dort geht es nicht um eine Karte, das bleibt unverändert).

Dieses Dokument ist der Auftrag an eine Design-Sitzung, das Interaktions-
und Bildmuster festzulegen, bevor Web baut.

## Fix — nicht mehr offen (Owner-Vorgabe, wörtlich)

> „Wir müssen ordentlich planen wie wir das Dashboard Design machen mit
> Filter statt Buttons, es muss also immer alles gezeigt werden dann mit
> dropdown mit checkboxen die Domains abwählbar. Das ist dann persistent."

Daraus bindend:
1. **Standard ist immer „alles sichtbar"** — kein Tab-Wechsel, eine
   Karte mit Abwahlmöglichkeit.
2. **Ein Dropdown, keine Chips/Buttons** auf der Karte selbst. Öffnet
   eine Liste mit **Checkboxen**, eine Zeile je Domäne.
3. **Persistent** — die Auswahl bleibt erhalten (Reichweite: offene
   Frage 2 unten).
4. Statistik-Seite unverändert, eigene Domänen-Tabs bleiben dort.

## Was schon gilt — bitte nicht neu erfinden

Das Companion-Designsystem (`design/tokens.json`, Spiegel von
`TravStatsCompanion/ClaudeDesign/handoff/tokens.json`) kennt bereits einen
passenden Sheet-Typ, definiert dort in `sammelauftrag-0209.md` §C:

| Sorte | Kopf | Inhalt | Fuß |
|---|---|---|---|
| Filter | nur Titel, `Fertig` | Chips/Schalter | **keiner** (wirkt sofort) |

Regel: „Filter wirkt sofort." Kein Bestätigen-Knopf. Der Web-Dropdown
sollte dieselbe Regel erben — jedes Häkchen wirkt beim Klick, nicht erst
beim Schließen. Bitte bestätigen oder begründen, warum Web hier abweicht.

Ebenfalls von dort, §G1 (Behälterzeilen-Regel): „eine Behälterzeile nennt
immer Anzahl und Zustandsmaß in Mono" — `6 Einträge · 3 Etappen`. Der
Dropdown-Knopf „Domänen · 4/6" folgt demselben Muster.

**Das ist Referenzmaterial aus dem Companion-Repo, kein Companion-Feature
selbst.** Das Dashboard existiert nur im Web; dieser Auftrag bleibt hier,
im Web-Repo — anders als die geteilten Farb-/Typo-Tokens, die dort
gepflegt und hierher gespiegelt werden.

## Web-Kontext, damit die Antwort baubar ist

- Domänen und ihre Farben (`design/tokens.json` `domainColor.*`): `flight`
  `#f0a947`, `cruise` `#4aa6b0`, `hotel` `#5ec2b2`, `poi` `#e7e3dc`,
  `tour`/`roadtrip` `#a9c46a` (eine Farbe, Runde 29 — Touren sind eine
  Domäne, das Verkehrsmittel unterscheidet nur das Icon), `rail`
  `#a597e8`.
- Sichtbarkeit einer Domäne im Dropdown folgt der bestehenden
  Tab-Sichtbarkeit: `useEnabledDomains()` (Nutzer hat den Bereich
  eingeschaltet) und der Beta-Schalter der Instanz — kein Geister-Eintrag
  für eine Domäne, die der Nutzer gar nicht sieht.
- Web-Referenzentwurf (Engineering-Mockup, **nicht** die Design-Antwort):
  https://claude.ai/artifact/6Z8G64RYwTRFFmHEuTd49Y — zeigt Knopf +
  Dropdown-Panel, Checkbox-Zeilen mit Farbpunkt/Name/Anzahl/Beta-Badge,
  „Alle"/„Keine", ein Beispiel-Zustand für Domänen-Optionen in einer
  Seitenspalte. Nur zur Orientierung; Design entscheidet Bildsprache,
  Typografie, Abstände, Zustände neu.

## Offene Fragen — bitte entscheiden

1. **Domänen-spezifische Optionen** (Flug „Farbe nach …", Kreuzfahrt
   „Häfen nach Häufigkeit", Unterkunft „Farbe nach Kette"): bleiben sie
   in einer Seitenspalte (das Dropdown regelt dann nur Sichtbarkeit), oder
   wandern sie ins Dropdown, je Zeile ein Untermenü?
2. **Persistenz-Reichweite:** rein lokal je Browser/Gerät (Vorschlag
   Engineering, analog zur bestehenden „letzter Modus je Domäne"-Regel),
   oder eine Server-Einstellung fürs ganze Konto?
3. **Geteilter Link:** überschreibt er die gespeicherte Auswahl des
   Empfängers, oder bleibt jede Auswahl immer rein lokal (dann verliert
   ein Link die Info, welche Domänen der Absender gerade sah)?
4. **Eine einzelne Domäne isoliert ansehen:** reicht „im Dropdown alles
   bis auf eine abwählen" (2–3 Klicks), oder braucht es eine Geste dafür
   (z. B. „Nur diese" pro Zeile)?
5. **Reihenfolge der Zeilen:** feste Reihenfolge wie die heutigen Tabs,
   oder nach Menge/Häufigkeit sortiert?
6. **Leerer Zustand** (keine Domäne angehakt): eigener Hinweis auf der
   Karte mit Rückweg ins Dropdown — welche Form?

## Was als Ergebnis gebraucht wird

- Der geschlossene Knopf-Zustand (Label, Vorschau-Punkt/e für „alle an").
- Das offene Dropdown-Panel: Kopf mit „Alle"/„Keine", Zeile je Domäne
  (Checkbox, Farbpunkt, Name, Anzahl, Beta-Badge wo nötig), Fußzeile mit
  dem Persistenz-Hinweis.
- Mobil: vermutlich ein Sheet vom Typ „Filter", angepasst an die
  Web-Maße (390 px, gemischt Maus/Touch) — eigenes Muster oder Dropdown
  bleibt auch mobil?
- DE-Text zuerst + EN-Spiegel für: Knopf-Label, Panel-Kopfzeile,
  Persistenz-Hinweis, Leerzustand.
- Falls neue Tokens nötig sind: in `design/tokens.json`, mit
  Versionssprung wie bei Runde 29 — und danach im Companion-Repo
  nachgezogen, falls von dort gepflegt.

## Rückmeldung

Bitte als eigene Datei in `ClaudeDesign/handoff/`, im Format der
bisherigen Rückmeldungen dieses Ordners. Web baut erst, wenn diese
Antwort vorliegt — der Owner hat das Filter-Design ausdrücklich noch
nicht freigegeben.
