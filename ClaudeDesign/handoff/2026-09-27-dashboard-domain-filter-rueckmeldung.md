# Rückmeldung — Dashboard-Domänen-Filter (27.09.2026)

Antwort auf `2026-09-27-dashboard-domain-filter-auftrag.md`. Quelle:
Claude-Design-Export „Dashboard Filter.dc.html" (Teil eines größeren
Runde-4-Pakets vom 27.09., das auch „Dashboard v2.dc.html" und eine
separate Roadtrip-Abgleichsdatei enthält — **hier nur der Filter-Teil
übernommen**, siehe „Bewusst nicht übernommen" unten).

## Die sechs Entscheidungen

1. **Domänen-Optionen bleiben, wo sie sind** (Farbe nach …, Häfen nach
   Häufigkeit …). Das Dropdown regelt nur Sichtbarkeit, keine Untermenüs
   — das würde aus einem Zwei-Sekunden-Filter ein Ebenen-Menü machen,
   und Untermenüs in einer Checkbox-Liste sind auf Touch nicht bedienbar.
2. **Persistenz: lokal je Browser/Gerät.** Passt zur bestehenden Regel
   „letzter Modus je Domäne". Eine Konto-Einstellung wäre ein zweiter Ort
   für dieselbe Frage.
3. **Geteilter Link zeigt die Auswahl des Absenders, überschreibt die
   eigene nicht.** Der Knopf trägt dann ein „Link"-Badge, wirkt sofort,
   speichert aber nicht. Im Panel: „Als meine merken" / „Meine Auswahl".
   Ohne Parameter gilt immer die eigene Auswahl.
4. **Eine Domäne isoliert ansehen: „Nur" je Zeile, ein Klick.** Kein
   versteckter Alt-Klick — den findet niemand.
5. **Reihenfolge fest**, wie die heutigen Tabs: Flüge, Kreuzfahrten,
   Unterkünfte, Orte, Touren, Roadtrips. Nach Menge sortiert würde
   springen, sobald ein Eintrag dazukommt.
6. **Leerer Zustand:** Karte zentriert „Keine Domäne ausgewählt", darunter
   „Alle einblenden" / „Auswahl öffnen". Der Knopf zeigt dabei einen
   hohlen Punkt und „0/6" — auch das ist ein normaler, gespeicherter
   Zustand.

Bestätigt, keine Abweichung: **„Filter wirkt sofort"** gilt auch hier —
kein Bestätigen-Knopf, jedes Häkchen zeichnet die Karte sofort neu.

## Bau-Vorgaben

- **Sechs Domänen, sechs eigene Zeilen** — `tour` und `roadtrip` sind
  zwei Zeilen, nicht eine gemeinsame „Roadtrips & Touren"-Zeile
  (Korrektur zum Engineering-Mockup). Beide tragen die Runde-29-Farbe
  `#a9c46a` (in `design/tokens.json` bereits so gesetzt, kein
  Versionssprung nötig — die Design-Antwort hatte hier noch den alten
  Stand 0.8.0 vor Augen).
- **Gespeichert wird die Liste der ABGEWÄHLTEN Domänen**, nicht der
  sichtbaren: `localStorage["travstats.dashboard.hiddenDomains.v1"]`.
  Eine neu freigeschaltete Domäne (Beta an, Bereich eingeschaltet)
  erscheint dadurch automatisch — Standard bleibt „alles sichtbar".
- **Zeilen = `useEnabledDomains()` ∩ Beta-Schalter.** Eine gespeicherte,
  aber inzwischen unsichtbare Domäne wird ignoriert, nicht mitgezählt
  (Nenner in „4/6" = sichtbare Zeilen).
- **URL:** `/dashboard?domains=flight,cruise` (sichtbare Schlüssel).
  Ohne Parameter gilt die eigene Auswahl. `/dashboard/:tab` leitet auf
  `?domains=:tab` um — alte Lesezeichen bleiben gültig.
- **Eine Zeile mit Anzahl 0 bleibt wählbar** (zeigt „0"), keine
  Sonderlogik.
- **Tastatur:** Knopf öffnet mit Enter/Leertaste, Fokus auf erste Zeile,
  ↑↓ wandern, Leertaste hakt an, Esc schließt und fokussiert den Knopf
  zurück. Rollen: `role="checkbox"` je Zeile, Panel `role="dialog"`.
- **Mobil (< 640 px):** eigenes Sheet „Filter" statt Dropdown — ein
  340-px-Panel oben links würde bei 390 px die halbe Karte verdecken und
  bräuchte Touch-Ziele unter 44 px. Kopf nur Titel + „Fertig", kein Fuß;
  „Alle/Keine" als erste Zeile statt im Kopf; Zeilen 52 px; „Nur" als
  eigener 44-px-Knopf; Persistenz-Hinweis als letzte Inhaltszeile.
- **Keine neuen Tokens.** Genutzt: `surface2`, `border`, Domänenfarben,
  `warn` (Beta-Badge), `info` (Link-Badge), Motion „menu 200 ms" /
  „sheet 260 ms".

## Texte (DE zuerst, EN-Spiegel — vollständig aus der Design-Antwort)

| Schlüssel | DE | EN |
|---|---|---|
| `button.label` | Domänen · 4/6 | Domains · 4/6 |
| `panel.title` | Auf der Karte | On the map |
| `panel.all / none` | Alle · Keine | All · None |
| `row.only` (+Tooltip) | Nur (Nur diese Domäne zeigen) | Only (Show only this domain) |
| `panel.persist` | Wirkt sofort · auf diesem Gerät gemerkt | Applies instantly · remembered on this device |
| `link.badge` | Link | Link |
| `link.note` | Auswahl aus einem geteilten Link — nicht gespeichert. Deine eigene Auswahl bleibt unverändert. | Selection from a shared link — not saved. Your own selection is unchanged. |
| `link.adopt / mine` | Als meine merken · Meine Auswahl | Keep as mine · My selection |
| `empty.title` | Keine Domäne ausgewählt | No domain selected |
| `empty.body` | Die Karte ist leer, weil alle Domänen abgewählt sind. | The map is empty because every domain is unticked. |
| `empty.actions` | Alle einblenden · Auswahl öffnen | Show all · Open selection |
| `sheet.title / done` | Domänen · Fertig | Domains · Done |
| `mapPanel.hidden` | Ausgeblendet, Optionen ruhen: {Liste} | Hidden, options parked: {list} |

Beta-Badge-Tooltip: „Beta-Funktion dieser Instanz" / „Beta feature of
this instance".

## Bewusst nicht übernommen (Owner-Vorgabe)

- **Das „Karte"-Optionen-Panel** aus derselben Datei (rechte Seitenleiste
  mit Zusammenfassungen der Domänen-Optionen) — das sind bestehende
  Kartendarstellungs-Einstellungen je Domäne. Owner: „nicht die Map
  settings verändern." Wo diese Optionen heute leben, bleibt unverändert;
  hier wird nichts verlagert oder zusammengefasst.
- **Die Zeitachse oben** (Monats-Histogramm, „wie `GlobeTimeHistogram.tsx`")
  aus „Dashboard v2.dc.html" — eigene, separate Änderung am Dashboard,
  nicht Teil dieses Auftrags.
- **Lade-/Fehler-/Leer-Zustände des gesamten Dashboards** aus
  „Dashboard v2.dc.html" — allgemeine Überarbeitung, nicht der Filter.
- Der Rest des Runde-4-Pakets (52 Screens, Einstellungen v3, Admin v2,
  Roadtrip-Abgleich `ABGLEICH.md` usw.) — eigenständige, viel größere
  Entscheidung, hier nicht angefasst.

## Umsetzung

Zweig `feat/dashboard-domain-filter` (von `dev/time-model`).
