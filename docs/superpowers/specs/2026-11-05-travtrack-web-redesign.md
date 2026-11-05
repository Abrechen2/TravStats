# TravTrack web redesign — map page and settings page

Owner, 2026-11-05: map over the full width, time controls directly under the
app header, controls in floating side cards (as Dawarich does); the page title,
intro text and "Live verfolgen" go; export and deleting a range move to the
settings; TravTrack becomes its own settings page with every TravTrack setting.
The server-wide "offer TravTrack" switch stays under Settings → Server.

Mock-ups (static HTML, TravStats tokens): `2026-11-05-travtrack-web-redesign/`
— `Main.dc.html` (desktop / iPad landscape, 1440), `Ipad.dc.html` (iPad
portrait, 820), `Settings.dc.html` (the settings page). They show layout and
copy, not code to copy: build with the existing components, tokens
(`theme/tokens.css`) and i18n, DE first and EN mirrored.

## Map page `/track` and `/track/:date`

- Under `NavigationBar`: one time bar — previous/next, the date button
  (picker), range chips Tag · Gestern · 7 Tage · Monat · Jahr · Eigener (custom
  range in a popover with Apply), the day's coverage strip, "Zuletzt gesehen",
  and a gear linking to the TravTrack settings page (carrying the shown range
  for export/delete).
- The map fills the rest of the viewport (no `max-w-7xl` box, no page padding).
- Floating cards over the map:
  - left top: **Ebenen** (every current layer toggle, speed/plain colouring with
    the real speed legend, opacity, pause split, accuracy) — collapsible;
  - left below: **Tag in Zahlen** — three figures, "Alle Werte" expands the
    rest of today's totals panel;
  - right: **Tagesverlauf** with tabs "Etappen & Stopps" (the leg/stop list)
    and "Logbuch" (the timeline: entries, trips, inbox suggestions). Selecting
    a leg or stop highlights and frames it on the map and swaps the card to a
    detail view (leg: figures, mode override, "Etappe abspielen", show points,
    entry link; stop: name choices, accept, "Als festen Ort anlegen"); "Ganzer
    Tag" returns. A tap on the map selects the matching row. Point inspector,
    flight panel (altitude profile) and photo view use the same detail slot;
  - bottom centre: **Wiedergabe** collapsed to "Tag abspielen"; expanded it is
    the current replay bar (play, scrub with gaps, rate, skip gaps).
- Notices (loading, errors with retry/resume, range limits, privacy note)
  become compact overlays; keep the map attribution visible.
- Removed from the page: title + intro (`TrackHeader`), live follow, export
  and delete buttons. Contextual point deletion in the point inspector stays.
- iPad portrait (≤ 820 or one side only): layers collapse to a pill button,
  totals to a chip, the Tagesverlauf becomes a bottom sheet. Touch targets
  follow `useCoarsePointer` (≥ 44 px).
- Empty state (no data yet) keeps `TrackGettingStarted`.

## Settings page "TravTrack" (replaces "Standort")

`areaModel.ts`: page id stays reachable under its old id/anchors and search
terms (redirect `location` → the new page), label "TravTrack". Sections in
this order; Standard unless marked Expert:

1. **Aufzeichnung** — stored points / since / last seen; "Standort kommt von"
   (TravTrack | Dawarich); "Reisen aufzeichnen" (tripRecording); device status
   cards with a link to pairing in Profil & Anmeldung.
2. **Feste Orte** — map with circles + list; add/edit inline (name, kind
   Zuhause/Arbeit/Anderer Ort, radius, optional weekdays + from/until);
   Zuhause comes from the residence (link "Wohnort ändern"), only radius/window
   editable; switch "Unterkunft während der Buchung" + radius, with the count
   of skipped bookings. Contract: `2026-11-05-travtrack-fixed-places.md`.
3. **Schutzzonen** — list, add, edit (PATCH exists), the difference to fixed
   places explained.
4. **Erkennung & Vorschläge** — Stopps benennen (staySuggestions switch),
   Städte benennen, Aufenthalte automatisch suchen; Zeitraum + Jetzt suchen
   (Expert); link to the inbox.
5. **Quellen & Importe** — Dawarich copy (status/report/again), file import,
   import history with per-import removal; Weitere Apps / ingest tokens
   (Expert); link to the Dawarich connection in Dienste.
6. **Export** — range, format, count, time zone.
7. **Zeitraum löschen** — range, affected count, type-to-confirm.
8. **Diagnose** (Expert).

Still reachable when TravTrack is switched off on the server: stored data,
export, delete, token revocation.

## Acceptance

- Every control of today's `/track` page is reachable on the new one or in
  settings (checklist in the report).
- Tests: page renders without title/live/export/delete; side cards
  collapse/expand; selecting a row opens the detail and "Ganzer Tag" returns;
  settings page sections render, `location` redirects, Expert rows hidden at
  Standard; export/delete flows still drive their API with the failure path.
- Browser look at 1440×900, 1366×1024 and 820×1180 (screenshots in the report).
