# Settings reduction — fewer settings, more defaults (2026-11-08)

Owner, 2026-11-08: „Wir müssen mal festlegen welche Settings wir wirklich brauchen, werden wirklich
alle benötigt? Muss der Admin so viel entscheiden, wir sollten mehr Standards haben, weniger
Settings." Then: „Dann schreibe mal einen Spec, dass v0 Vercel daraus mal was bauen kann."

Status: draft for the owner; the UI prototype comes from v0 (Part B is the paste-ready brief).
Implementation in TravStats follows after the owner has seen the prototype, as its own package.

Measured on `forgejo/main` 2026-11-08: 252 settings rows (190 visible to an admin in the standard
view, 62 expert), ~90 env vars (51 duplicate an admin field), 17 stored settings without UI.
Second opinions: Codex, Gemini, Copilot (2026-11-08; Grok unavailable).

## Part A — decisions

### A.1 Principles

1. A setting exists only if two reasonable people want different values **and** no default or
   auto-detection serves both.
2. One thing, one place. Env vars only for what is needed before the database is up (infra,
   secrets); a declarative env path for service credentials stays as an expert option, and the UI
   value wins after the first boot.
3. A service is on when its key/URL is entered — no separate "enabled" switch. A **pause** switch
   keeps the key while stopping calls. Consent stays per service: an admin's key is not the users'
   consent to send their data there; each account can opt out.
4. Derive instead of asking: addresses, passkey domain, federation origin, SMTP port/TLS, sender
   name, time zone. Derived values are shown ("automatisch: …") and can be overridden in expert view.
5. Standard view = what a normal admin or user touches in the first week. Everything else is expert.

### A.2 Fixed defaults (the setting disappears)

- Backups on, weekly, 30 days (interval, retention and WebDAV pruning become expert).
- Log switches (HTTP, DB, parser), log file size/count → fixed, with a total size cap; one button
  "Ausführliches Protokoll für 24 h" in maintenance.
- Live flight updates poll from 24 h before departure until landing, every 15 min; "live tracking"
  and "auto update" are one switch.
- FX CDN fallback, both rail timetable sources, operator logos, open data and the update check run
  under ONE new switch "Server darf externe Dienste abfragen" (default on; off = offline install).
- adsb.lol and every other keyed service: on when the key is entered (pause instead of a switch).

### A.3 Removed (dead or duplicate)

- Env `MAX_USERS`, `ALLOW_REGISTRATION` (can never win), `AUTO_BACKUP_ENABLED`, `BACKUP_INTERVAL`
  (read nowhere). Bug: backup retention reads env `BACKUP_RETENTION_DAYS`, not the admin column.
- User parser choice and fallback chains (4 columns) and `boardingPassParserStrategy`: never read.
- `data.map.zoomLevel/markerStyle`, `data.notifications.*`, `users.notifyBefore24h/2h` (legacy).
- Two admin keys per AI vendor (`global*ApiKey` vs `llm*ApiKey`) → one per vendor.
- Theme/map look stored three times → device + synced web prefs only.
- `DB_HOST/PORT/NAME/USER/PASSWORD` → `DATABASE_URL` only.
- OpenSky username/password login → only if OpenSky no longer accepts it (verify first).

Kept on purpose (council): dated home place AND dated home airports (not merged); base currency
(normalised totals) and display currency; separate Photon / Nominatim / routing / rail routing URLs;
`allowUserApiKeys` (expert, default allowed); SMTP sender name (expert, default = instance name).

### A.4 Missing today, added

User "Für andere Server auffindbar" (`federationFindable`, no UI today); reminder address
("= Profil-E-Mail" by default); phone pairing and revoke, push on/consent in the standard view.

### A.5 Open

The two admin address fields "Öffentliche Adresse" (`frontendUrl`) and "Adresse für Telefone"
(`publicUrl`): the column names read crossed against their labels; Codex doubts it is a defect.
Settle while implementing, with a test, not in the prototype.

---

## Part B — brief for v0 (paste everything below this line)

Build a clickable **settings prototype** for TravStats, a self-hosted travel logbook (flights,
cruises, hotels, rail, places). No backend: hold all state in memory, seed it from a mock JSON
object in the code. Stack: Next.js (App Router), TypeScript, Tailwind, shadcn/ui, lucide icons.
One route `/settings/[page]`. All UI copy in **German** exactly as given below.

### Goal of the design

Today the product has 252 settings. This prototype shows the reduced set: few decisions, good
defaults, everything advanced behind an **Experte** view. A first-time admin should be able to set
up the server from the standard view in five minutes.

### Look

- Dark only. Tokens: background `#0d1117`, surface `#161b22`, elevated `#1c2128`, muted `#21262d`,
  border `#30363d`, text `#e6edf3`, secondary text `#a8b3bf`, muted text `#8b949e`, accent (amber)
  `#f0a947`, accent dim `#c8842a`, accent soft `rgba(240,169,71,0.1)`, success `#3fb950`,
  danger `#f85149`. Font: "Hanken Grotesk", system-ui fallback.
- Calm and dense like a pro tool, not a marketing page. No gradients, no shadows heavier than 1px.
- **iPad first**: primary sizes 1366×1024 and 820×1180 (portrait). Touch targets ≥ 44 px. At
  820 px the sidebar collapses into a page list that slides over; on phone width it still works.
- Help text never in tooltips (`title`) — it sits under the label, max two lines, or in an
  expandable "Mehr erfahren" line.

### Layout

- Left sidebar: search field "Einstellungen durchsuchen" (filters rows across all pages, shows
  page name per hit), then two groups — **Mein Konto** and **Server** (Server only when the mock
  user is admin; add a dev toggle "Als Admin ansehen" in the corner). Bottom of the sidebar: a
  segmented control **Standard | Experte** (persists in memory).
- Page header: title, one-line description, and on server pages a small "Gilt für alle Konten" tag.
- Rows grouped in cards with a group title. Row: label + help on the left, control on the right
  (on 820 px the control goes under the label). Expert rows only in Experte view, marked with a
  small outlined "Experte" tag. A page with only expert rows is hidden in Standard view.
- Saving: every change saves immediately; show a small inline "Gespeichert" check next to the row
  for 2 s; a failed save (simulate with a 10 % chance on any row whose id starts with `smtp`)
  shows the reason inline in red and keeps the old value.
- Derived values: rows of type `derived` show "automatisch: <value>" in muted text and, in Experte
  view only, a link "Überschreiben" that turns it into a text field with "Zurücksetzen".

### Controls

`switch`, `select`, `segmented`, `text`, `secret` (masked, "Anzeigen" eye, "Ändern" replaces it),
`number` (with unit suffix), `derived`, `link` (navigates elsewhere, chevron), `action` (button;
destructive ones ask for confirmation in a dialog), `list` (small editable list, e.g. dated home
airports: from-date + airport code, add/remove).

### Service cards (Server → Dienste, and Mein Konto → Verbundene Dienste)

Services render as a grid of cards, not rows. Card: name, one-line purpose, status chip —
"Nicht eingerichtet" (muted), "Aktiv" (success), "Pausiert" (accent), "Fehler: <reason>"
(danger). Opening a card shows: key/URL fields (entering a key = service on), a "Pausieren"
switch, a "Verbindung testen" button (mock: succeeds unless the key contains `x`), and for
services that receive users' data a one-time notice before the first save: "Buchungstexte werden
an <Anbieter> gesendet. Jedes Konto kann das für sich abschalten." with "Verstanden" — store that
it was acknowledged. Account side: the same card shows "Server-Schlüssel wird genutzt" when the
admin set one, a switch "Für mein Konto nicht nutzen", and an optional own key field.

Server services (group: name — fields): Flugdaten: AirLabs (key), Aviationstack (key; expert:
Tagesbudget, number, default 3), AeroDataBox (key), FlightAware AeroAPI (key; expert: Tarif
select Personal/Standard/Premium, Monatslimit USD), OpenSky (Client-ID, Secret), ADS-B Exchange
(key), adsb.lol (key), AISstream (key) · KI: OpenAI (key, Modell), Anthropic (key, Modell),
Google Gemini (key, Modell), Ollama (expert: URL, Textmodell, Bildmodell, switch "Läuft außerhalb
meines Netzes"), Eigener Endpunkt (expert: URL, Modell, key) · Fotos & Standort: Immich (URL,
key), Dawarich (URL, key), Strava (Client-ID, Secret) · Karten & Orte: Google Places (key),
OpenRouteService (key), GraphHopper (key), Logos Premium (key) · Sicherung: WebDAV (URL,
Benutzer, Passwort; expert: Ordner, default `/TravStats/backups/`).

### Pages and rows

Format: `id` · label · control · default · level (S = standard, E = expert) · help.

**Mein Konto**

1. *Profil & Anmeldung* — `name` · Anzeigename · text · "Alex" · S · Wie dich Freunde sehen ·
   `email` · E-Mail · text · S · `password` · Passwort ändern · action · S · `twofa` ·
   Zwei-Faktor-Anmeldung · switch · aus · S · Code aus einer Authenticator-App zusätzlich zum
   Passwort · `passkeys` · Passkeys · link · S · `tokens` · API-Schlüssel · link · E ·
   `findable` · Für andere Server auffindbar · switch · aus · S · Menschen auf verbundenen Servern
   dürfen dir eine Freundschaftsanfrage schicken · `delete` · Konto löschen · action (destructive)
   · S.
2. *Anzeige* — `lang` · Sprache · segmented Deutsch/English · Deutsch · S · `tz` · Zeitzone ·
   derived "Europe/Berlin (vom Gerät)" · S · `datefmt` · Datumsformat · select 08.11.2026 /
   2026-11-08 / 11/08/2026 · first · S · `timefmt` · Uhrzeit · segmented 24 h / 12 h · 24 h · S ·
   `dist` · Entfernungen · segmented km / mi · km · S · `cur` · Anzeigewährung · select EUR/USD/GBP/CHF
   · EUR · S · Wie Beträge angezeigt werden · `basecur` · Basiswährung für Summen · select · EUR ·
   E · Alle Kosten werden für Summen in diese Währung umgerechnet.
3. *Reisearten* — one switch row per kind, each with its domain colour dot: Flüge `#f0a947` (an),
   Kreuzfahrten `#4aa6b0` (an), Unterkünfte `#5ec2b2` (an), Bahn `#a597e8` (aus), Orte (aus),
   Touren (aus), Roadtrips (aus) · S · then `country` · Wann zählt ein Land? · select "Bei
   Aufenthalt" / "Auch beim Umsteigen" · "Auch beim Umsteigen" (Server-Standard) · S ·
   `home` · Heimatort · list (ab Datum + Ort) · S · `homeair` · Heimatflughäfen · list (ab Datum +
   IATA, mehrere erlaubt) · S.
4. *Reisen & Vorschläge* — `autotrip` · Reisen automatisch anlegen · switch · an · S · Flüge und
   Unterkünfte, die zusammengehören, werden zu einer Reise · `tripsug` · Reisevorschläge · switch ·
   an · S · `staysug` · Unterkunftsvorschläge · switch · an · S · `photoev` · Fotos als Beleg
   nutzen · switch · an · S · nur wenn Immich verbunden ist · `aiplace` · Ortsart per KI erkennen
   · switch · aus · E · `color` · Farbe neuer Reisen · select (6 swatches) · Bernstein · E ·
   `ics` · Kalender-Abo · action "Link erstellen" · S.
5. *Flüge* — `live` · Live-Updates · switch · an · S · Ab 24 h vor Abflug bis zur Landung alle
   15 Minuten: Verspätung, Gate, Annullierung · `approve` · Änderungen erst bestätigen · switch · an
   · S · `expiry` · Offene Änderungen verfallen nach · number h · 24 · E · `enrich` · Ältere Flüge
   ergänzen · switch · aus · E · plus `enrichconf` (number %, 60, E) and `enrichmax` (number/Nacht,
   50, E) shown only when `enrich` is on · `fdefaults` · Voreinstellungen für neue Flüge · link · E ·
   `costs` · Kosten erfassen · switch · an · S.
6. *Erinnerungen* — `remaddr` · Erinnerungen an · derived "= Profil-E-Mail" · S · then one row per
   enabled travel kind: Erinnerung vor Abreise · select Aus / 2 h / 24 h / 2 Tage · 24 h · S.
7. *Freunde & Teilen* — `friends` · Freunde · link "Freunde verwalten" · S · Vergleich,
   geteilte Reisen und Pläne laufen über eine Verbindung pro Freund.
8. *Telefone* — list of paired phones (name, last seen, "Entfernen" destructive) · S ·
   `pair` · Telefon koppeln · action (shows a mock QR in a dialog) · S.
9. *TravTrack* (only when the server offers TravTrack) — `rec` · Reisen aufzeichnen · switch · an
   · S · `source` · Standortquelle · select Companion-App / Dawarich / Keine · Companion-App · S ·
   `cities` · Städte benennen · switch · aus · E.
10. *Verbundene Dienste* — the account-side service cards.
11. *Daten* — `export` · Alles herunterladen · action · S · `import` · Importieren · link · S ·
    `railtransit` · U-Bahn/Tram beim Bahn-Import · segmented Überspringen / Importieren ·
    Überspringen · E · `railbus` · Busse beim Bahn-Import · same · E.

**Server** (admin only, tag "Gilt für alle Konten")

1. *Allgemein* — `instname` · Servername · text · "TravStats" · S · In Mails und Sicherungen ·
   `puburl` · Öffentliche Adresse · text · "https://trav.example.org" · S · Daraus werden alle
   anderen Adressen abgeleitet · `reg` · Registrierung · segmented Nur mit Einladung / Offen ·
   Nur mit Einladung · S · `maxusers` · Höchstzahl Konten · number · 10 · S · `loginimg` ·
   Bilder der Anmeldeseite · action "Ändern" · E.
2. *Funktionen* — `internet` · Server darf externe Dienste abfragen · switch · an · S · Wechselkurse,
   Bahnfahrpläne, Logos, Offene Kartendaten und die Suche nach Updates. Aus = Betrieb ohne Internet
   · `offer_plan` · Reisen planen anbieten · switch · an · S · `offer_tt` · TravTrack anbieten ·
   switch · an · S · `links` · Öffentliche Links erlauben · switch · aus · S · `fed` · Mit anderen
   Servern verbinden · switch · aus · S · Freunde auf anderen TravStats-Servern; jeder neue Server
   braucht deine Freigabe · `beta` · Beta-Funktionen zeigen · switch · aus · E · `plimits` ·
   Planungsanfragen pro Konto und Tag · number · 20 · E · `countrydef` · Standard: wann zählt ein
   Land · select · "Auch beim Umsteigen" · E.
3. *E-Mail* — `smtphost` · Mailserver · text · S · `smtpuser` · Benutzer · text · S · `smtppw` ·
   Passwort · secret · S · `smtpfrom` · Absenderadresse · text · S · `smtptest` · Testmail senden ·
   action · S · `smtpport` · Port und Verschlüsselung · derived "587, STARTTLS (erkannt)" · E ·
   `smtpname` · Absendername · derived "= Servername" · E.
4. *Buchungen lesen* — `ai` · KI zum Lesen von Buchungen · switch · an · S · Ohne KI werden nur
   bekannte Vorlagen erkannt · `order` · Reihenfolge · segmented Vorlagen zuerst / KI zuerst ·
   Vorlagen zuerst · E · `cloudorder` · Reihenfolge der KI-Anbieter · sortable list OpenAI,
   Anthropic, Google, Eigener · E · `userkeys` · Konten dürfen eigene Schlüssel nutzen · switch · an
   · E.
5. *Dienste* — the server service cards.
6. *Sicherungen* — status line "Automatisch: wöchentlich, 30 Tage aufbewahrt · letzte Sicherung
   heute 02:00" · `backupnow` · Jetzt sichern · action · S · `restore` · Wiederherstellen · link ·
   S · `interval` · Intervall · select täglich / wöchentlich / monatlich · wöchentlich · E ·
   `retention` · Aufbewahren · number Tage · 30 · E · `cloudprune` · Alte Sicherungen auch auf
   WebDAV löschen · switch · aus · E · `zone` · Zeitzone für 02:00 · derived "Europe/Berlin" · E.
7. *Server-Verbindungen* (only when `fed` is on) — list "Anfragen" (incoming server with name,
   address, fingerprint; buttons Zulassen / Ablehnen), list "Verbundene Server" (name, address,
   since; "Trennen" destructive) · S · `fedorigin` · Adresse dieses Servers · derived "= Öffentliche
   Adresse" · E · `fedkey` · Server-Schlüssel · action "Neu erzeugen" (destructive) · E.
8. *Datenschutz* — `stats` · Anonyme Nutzungsstatistik senden · segmented Ja / Nein / Noch nicht
   entschieden · Noch nicht entschieden · S · with link "Was genau wird gesendet?" ·
   `push` · Benachrichtigungen aufs Telefon · switch · aus · S · Über den Push-Dienst von TravStats
   (Einwilligung beim Einschalten) · `pushrelay` · Push-Dienst-Adresse · text ·
   "https://push.travstats.de" · E.
9. *Adressen & Passkeys* (expert page) — `phoneurl` · Adresse für Telefone · derived "=
   Öffentliche Adresse" · E · `lanurl` · Adresse im eigenen Netz · text · E · `rpid` · Passkey-Domain
   · derived "trav.example.org" · E · `origins` · Erlaubte Passkey-Adressen · list · E.
10. *Eigene Server* (expert page) — `geo` · Eigener Geo-Server · text · E · `photon` · Photon · text
    · E · `nominatim` · Nominatim · text · E · `routing` · Routing · select Kein / OSRM / Valhalla ·
    Kein · E · `rail` · OpenRailRouting · text · E · `overpass` · Overpass · text · E ·
    `tplrepo` · Vorlagen-Quelle · text · E · `fx` · Wechselkurs-Quellen · select · Frankfurter · E.
11. *Wartung* (expert page) — `loglevel` · Protokoll-Stufe · select info / debug / warn · info · E ·
    `debug24` · Ausführliches Protokoll für 24 h · action · E · `logdays` · Protokolle aufbewahren ·
    number Tage · 7 · E · actions: Daten neu anreichern, Stammdaten neu laden, Zeitmodell prüfen
    (each with a confirmation dialog) · E.
12. *Stammdaten* (expert page) — six links: Fluggesellschaften, Flugzeugtypen, Flughäfen, Schiffe,
    Häfen, Hotelketten · E.
13. *Über* (both scopes, last item) — version "2.8.0", links Changelog / Dokumentation, and the
    credit line "Ein Projekt von <abrechen2 />" linking to https://www.abrechen2.de/ (render the
    wordmark as text in the monospace font: `<` and `/>` in `#FF7A1A`, the name in white).

### What to deliver

- The full page set above, clickable, with the Standard/Experte switch working everywhere and the
  admin dev toggle.
- A small counter in the sidebar footer: "Standard: N Einstellungen · Experte: M" computed from the
  mock data, so the reduction is visible.
- Empty and error states: a service card in "Fehler", a failed save, a page reached by search.
- Keep components small (one file per control type, one per page) so the result can be ported.
