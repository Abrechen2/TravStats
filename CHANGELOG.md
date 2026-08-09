# Changelog

All notable changes to TravStats are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [2.5.1] - 2026-08-09

Patch release. Three fixes, no database changes.

### Fixed
- **The aeroplane between two airports flew nose-down.** The glyph in the flight
  table's route column was rotated by a further 45 degrees although it already
  points due east, so a page of flights read as a page of crashes. It flies level
  now.
- **An ordinary action wrote to the error log.** Adding a companion you already
  have was implemented as "create the record, and put it right when that fails",
  so normal use filled the error log with entries that described nothing wrong —
  83 of them on a single start. It is one operation now, and the log stays quiet.
- **A mistake in a request is no longer recorded as a fault of the server.** A
  rejected form or an expired session was written at error level, exactly like a
  crash, so the log could not answer whether anything was actually broken — and
  anyone who could reach the port could make it grow without logging in. Genuine
  server faults still log as errors; everything below them is a warning.

### Upgrade notes
- No database migrations in this release.

## [2.5.0] - 2026-08-09

Large minor release. Trips can pull in your Immich photo albums, travel
companions become real records instead of loose text, airlines and aircraft
get a proper catalogue behind the scenes, the flight list is rebuilt as a
departures board, adding and editing a flight finally use the same form, and
status stops being something you set by hand.

### Added
- **Immich photo albums on a trip** (#154). Link an album from your own Immich
  server in one of two modes: *linked*, where the images stream through an
  access-checked proxy and take no storage here at all, or *imported*, where
  the originals are copied in as ordinary trip photos. The gallery groups by
  album, any picture can become the trip's cover, and a re-sync collects
  stragglers. Photos run oldest first and divide into days, so an album reads
  the way the journey did, and the grouping can be switched off. The key field
  names the read-only permissions it needs, so nobody has to hand over a
  full-access key. The album picker has a search filter (#181), and an
  administrator can configure one instance-wide connection (#182).
- **Travel companions are real entries.** Co-passengers used to be free text
  on each record. They are now created once and reused everywhere — flights,
  trips, cruises and special flights all share the same picker. Existing
  entries are migrated on first boot.
- **Airline and aircraft master data** (#189, #191). Both get a catalogue with
  the same admin treatment ships and ports already had, seeded from OpenFlights
  and searchable from the flight form. Airports join the same page.
- **Airline logos as brand tiles.** The flight list shows each airline as a
  logo tile, resolved through a four-tier chain with a keyless default, cached
  on disk and refreshed nightly.
- **The flight list is a departures board.** Departure and arrival share one
  time column, country flags mark the route, actions are icons, and a dot on
  the row says where the data came from.
- **One flight form, with scheduled and actual times** (#199, #200). Adding and
  editing use the same mask. New: scheduled vs. actual times with a derived
  delay — the recorded time sits beside the scheduled one in the flight list,
  red when later and green when earlier — plus boarding group, trip
  assignment, cost and receipt.
- **Status is derived from the dates** — for flights, cruises and trips alike,
  re-derived hourly. Only "cancelled" is still set by hand.
- **Grouped navigation and a central import hub.** The desktop bar gains
  Logbuch/Support/System submenus; every import route now starts in one place.
- **Prices belong to a booking.** A multi-leg booking carries one price instead
  of a repeated per-segment total, editable from the trip page, with
  per-currency totals ("EUR 300 + USD 480") rather than naive summing.
- **The trip timeline rail is coloured by progress** (#184) instead of graying
  out entries.
- Aircraft statistics rank types rather than tail numbers, the airline ranking
  carries its IATA code, and the achievements summary carries a rank.

### Fixed
- **Settings marked "auto-saved" that were not** (#198). Flight defaults now
  actually persist — and clearing a field clears it, in every form.
- **An expired session showed the dashboard and a shower of 401s** instead of
  the login page.
- **A flight more than 30 minutes late lost its arrival permanently.** It now
  keeps chasing it.
- **A half-imported airport catalogue rendered UTC as if it were local time.**
  Re-seeding now leaves a usable catalogue behind rather than just rows, and a
  closed airfield is never picked as the nearest airport.
- **"Countries visited" ignored the selected year** and carried a
  year-over-year comparison that could only ever read zero. It is year-scoped
  now, and a country reached both by air and by sea counts once, not twice.
- **A blank time was silently stored as noon**, producing invented delays; a
  recorded cabin class was priced but never saved.
- **A diary entry's preview printed its own markup** (#231). The timeline card
  showed `**bold**` with the asterisks intact while the same entry rendered
  properly once opened. The preview now renders, with headings and lists
  flattened to fit a two-line card; the headline above it is stripped to plain
  text instead.
- **The uploaded-photos box no longer lingers** once an album is linked (#179).
- Trip aggregates use airport-local times and see manually added flights.
- **A trip's card and its own page disagreed.** The card read "?" countries and
  no total where the trip's page read five countries and a price. The country
  fallback had only been taught to the detail endpoint, and the card's total was
  hidden behind the cost-tracking toggle — which since #192 governs the
  taxes/fees breakdown, not whether a price is shown — while also ignoring
  prices entered on a flight rather than a booking. Both surfaces now answer
  from the same sources, and a trip made only of cruises takes its countries
  from the ports it called at instead of showing "?".
- **The cruise tab counted one country too many.** The port catalogue lists both
  "United States" and "United States of America", so counting names counted the
  same country twice. The tally folds them; the country list below still shows
  the names as recorded.
- **The built-in demo account is now marked as one.** Created through the Docker
  demo-user switch it was not, so its sample flights and cruises counted towards
  the instance-wide statistics as though they were real travel. Existing
  installs are corrected on startup.
- **Aircraft types are written consistently.** A library built up over years
  could hold "Airbus A350-900", "B737-800" and "A320neo" side by side in the
  same column; only newly entered flights were ever normalised. Stored types are
  brought to the catalogue's spelling on startup, and a type the catalogue does
  not know is left exactly as you typed it.
- **Cruise regions are translated, all of them.** Ten regions had German names
  hardcoded while the port catalogue ships fifty-four, so a German page showed
  "Mittelmeer" and "Ostsee" next to "North Sea" and "Iberian Atlantic" — and an
  English page got the German names for those ten. All fifty-four now exist in
  both languages.
- **Two airline rankings on the statistics page disagreed.** One counted only
  the flights actually flown, the other counted every booking including
  cancelled and still-scheduled ones, so the same airline appeared with two
  different totals a few centimetres apart. Both now count flown and historical
  flights, the way every other statistic does — and a cancelled flight no longer
  adds its distance to an aircraft's lifetime total.
- **Cruises counted towards neither the distance nor the cost of a trip.** A
  trip made only of cruises showed no kilometres and no total although the
  prices and the computed sea routes were on file. Cruises now count exactly as
  flights do, on the trip card and on the trip's own page.

### Security
- react-router 6 → 7, closing the open-redirect advisories, plus every other
  open dependency alert in the app and in the Discord tool.
- Secrets shorter than 16 bytes were returned as ciphertext by a length
  heuristic; upload-cleanup paths were hardened; API-key material no longer
  reaches log messages.

### Upgrade notes
- **Seven database migrations** run automatically on first boot of this
  version. Take your usual backup first.
- The Docker image now vendors the airline logo set and the OpenFlights seed
  data; no configuration change is required.
- A one-shot backfill migrates existing companion text and booking prices at
  startup.
- Two further one-off repairs run at startup alongside the migrations: stored
  aircraft types are normalised to the catalogue's spelling, and an existing
  demo account is flagged as a demo account. Both are safe to re-run and skip
  what they do not recognise.

## [2.4.0] - 2026-07-11

Minor release. Six reported bugs, an overhaul of how the map is coloured, and a
switch that keeps unfinished features out of sight until they are ready.

### Added
- **Map colouring is now an explicit choice, for flights and for cruises.**
  Previously the colour picker was quietly overridden by whichever view you were
  in, so picking a colour appeared to do nothing at all. Both domains now offer
  the same three modes: **Status** (two colours — flown/sailed vs. planned),
  **Frequency** for flights (one base colour, deeper the more often you fly a
  route) or **Per cruise** for ships (a distinct colour per voyage), and
  **Solid** (one colour for everything). The legend follows the mode you pick,
  and status mode gives you a separate colour picker per state.
- **Flat route shape for flights** (#183). Flight routes can now be drawn flat on
  the map like cruise routes, instead of as 3D arcs. Arcs look better from a
  distance, but their endpoints drift away from the airports as you zoom in; the
  flat shape stays accurate at any zoom.
- **Beta-features switch.** Features that are not finished yet are now hidden by
  default and can be revealed instance-wide by an administrator. On a fresh
  install this hides the POI dashboard tab, the Devices settings page and the
  trip AI summary.
- **The profile picture can be removed.** A Remove button next to the file
  picker deletes the stored picture; the initial-letter avatar returns.
- **Flight price and currency are always editable** (#192). The fields sat
  behind the cost-tracking toggle while cruises always showed them — an
  imported price was visible in the flight list but not editable. The toggle
  now only gates the taxes/fees breakdown and the business statistics.
- **The map control panel starts collapsed and remembers its state** (#194).
  It no longer springs open on every reload; opening or closing it persists
  across reloads and the 2D/globe switch.
- **The settings domain switch moved into the sidebar.** As a top-right pill
  row it was easy to miss; on desktop it now sits directly above the section
  list it scopes. On phones it stays in the top bar.
- **Booking reference and ticket number when adding a flight manually** (#197).
  Both fields only appeared in the edit dialog after a flight was saved. The
  manual add form now offers them directly, and the booking reference is
  uppercased on entry so manually added flights group into the same booking
  as imported ones.
- **The What's New dialog covers 2.4.0.** A short in-app summary of this
  release's changes (in German and English), shown once after updating.

### Fixed
- **Cruise port names with non-English characters render correctly** (#185).
  Ålesund, Flåm, Málaga and Kuşadası previously drew as empty boxes on the map.
- **Cruise direction arrows no longer sit inside the ports.** They were anchored
  at a fixed position in the route's point list rather than along its actual
  length, which on a short leg put them on top of the harbour. They now sit at
  even intervals along the leg, and very short hops get none.
- **The profile picture and birthday are saved** (#186). Uploading a picture had
  no backend endpoint at all, and typing a birthday never triggered a save —
  while the page still displayed "auto-saved". Both now persist.
- **Airport and port dots are the same size** on the flat map (#187).
- **The statistics "compare with" year survives a page reload** (#188).
- **Airlines are shown by name, not by code** (#178). ICAO codes now resolve to
  full names, from the same catalogue the backend uses.
- **Achievements: continents are resolved by country.** The Arctic was counted as
  Antarctica (which made Svalbard flights unlock an Antarctica badge) and
  Australia as Asia. Badges that no longer qualify are now revoked instead of
  staying unlocked forever.
- **Direction arrows on out-and-back cruise routes no longer stack into an "X".**
  When the same water is sailed in both directions (there and back on one
  route), the two midpoint arrows landed on exactly the same spot. They now
  flank the midpoint, each pointing in its own direction of travel. Arrows also
  render sharp at every size — they were rasterised at their native size and
  went blurry when scaled up on high-DPI screens.
- **The admin instance-settings form no longer resets while you type** (#190).
  Every keystroke re-triggered the form's initial load, which overwrote the
  input with the server's values — editing the public URL was impossible. The
  underlying cause (an unstable translation-function identity re-firing
  effects on every render) is fixed app-wide.
- **Uploading a profile picture no longer ends in "Not found".** The web
  server's static-asset cache rule intercepted API URLs ending in an image
  extension, so the freshly uploaded picture 404'd before the request ever
  reached the backend. Image receipts were affected by the same rule.
- **The year dropdown in the map panel is readable again** (#196). On Windows
  the dropdown popup rendered white-on-white; the options now carry explicit
  dark styling. The globe's performance dropdown had the same flaw.
- **The map panel chevron points the way the panel moves** (#195) — down while
  open, up while collapsed — and is larger.
- **Dark text on amber buttons** (#193). The trip module's primary buttons
  referenced a CSS variable that does not exist, so their text silently
  rendered near-white on the amber accent; several admin and cruise buttons
  hardcoded white. All of them now use the same dark text as the standard
  primary button.
- **Every button in the app follows the same system.** A dozen controls still
  carried hardcoded blues, greens and oranges from before the design system
  existed — the admin API-key and parser saves, the airport-seeding dialog, the
  pending-update card and editor, the flight review submit, the duplicate
  warning and the delete-demo-user button — so on those surfaces the loudest
  control was the off-brand one. They now use the shared primary, secondary and
  danger classes and follow the accent colour. Two were also wrong on the
  merits, not just off-palette: the pending-update card highlighted **Edit**
  while **Apply** — the action the card exists for — sat in green beside it, and
  the duplicate warning painted the risky "add anyway" escape hatch louder than
  the recommended merge. In both, the recommended action is now the primary one.
  Deleting the demo user and rejecting a pending update are destructive, and now
  look it.
- **An update now actually reaches the browser.** The app shell (`index.html`)
  was served without any caching instructions, so browsers were free to reuse
  their copy for hours without asking the server. That stale copy still points
  at the previous build's JavaScript files: either they are still in the
  browser's cache and you keep running the old frontend against the new backend,
  or they have been evicted, the request 404s and the page stays blank. The
  shell is now revalidated on every load, while the versioned assets keep their
  long cache. If you have ever had to hard-refresh TravStats after an update,
  this was why.
- **Cruise direction arrows no longer pile up on shared shipping lanes.**
  Different cruises routed onto the same lane each placed their own arrows,
  stacking into unreadable clusters. Overlapping arrows are now hidden and
  reappear as you zoom in; a selected cruise always keeps its own.

### Changed — please read before updating
- **Flight colouring:** existing settings migrate to **Status** mode. The
  combined view looks unchanged; the flights-only view switches from the
  frequency ramp to the two status colours. Switch back to **Frequency** in the
  map panel if you prefer it.
- **Cruise colouring:** the Cruises tab no longer colours each voyage
  automatically. It starts in **Status** mode — pick **Per cruise** in the map
  panel to get the old look back (one click, and now discoverable).
- **Hidden by default:** POI tab, Devices settings and the trip AI summary now
  require the beta-features switch.

### Removed
- **The "Map settings" section is gone from the flight settings tab.** Base
  map, start zoom, marker style and route colour had no effect anywhere since
  the in-map control panel took over — every control there was a silent no-op.

## [2.3.1] - 2026-07-11

Patch release. Fixes the release-highlights dialog, which never appeared in
2.3.0 — and with it the usage-statistics consent prompt, so nobody was ever
asked.

### Fixed
- **The "What's new" dialog now actually appears.** In 2.3.0 the dialog was
  matched to the running version by an exact string comparison, and its only
  entry was tagged with the version the feature had originally been planned
  for. On a 2.3.0 installation nothing matched, so the dialog stayed hidden —
  taking the anonymous-usage-statistics consent prompt with it, since that
  prompt is shown inside the dialog. Highlights are now matched to any version
  at or above the one they describe, so the dialog also reaches someone who
  skips several releases at once, and dismissing it is remembered across
  later patch updates.
- **Database index name reconciled with the schema.** A hand-written migration
  had created the trip-photos index under a different name than the schema
  expects, so every newly generated migration on every branch carried a
  spurious rename. Renamed once (metadata only — no data is touched).

## [2.3.0] - 2026-07-11

**TravStats 2.3.** Aggregates the entire `dev/v2.3` forward line — a
redesigned map/globe appearance system, per-cruise and status-based map
coloring, a new statistics scorecard, unresolved cruise ports, device
pairing for the companion app — and adds opt-in anonymous usage
statistics with a What's-New dialog.

### Added
- **Anonymous usage statistics (opt-in)** — TravStats can now optionally
  report a small, anonymous usage summary to a public dashboard at
  `travstats.de/stats`, so the community's reach is visible. **Off by
  default** and admin-controlled: a consent choice appears during first-boot
  setup and in the What's-New dialog, with a permanent toggle under
  Admin → Instance. The payload is coarse and anonymous — version, enabled
  domains, rounded distance totals, feature usage — and **never** IP
  addresses, names, travel details, or API keys. Withdrawing consent asks
  the server to erase this installation's record. Self-hosters can disable
  all sending with a single environment variable. Full transparency page at
  `travstats.de/docs/usage-statistics`.
- **What's-New dialog** — after an update, a one-time dialog summarises what
  changed in the new version.
- **Continuous map sliders** — line width and marker size are now
  stepless sliders with a live value (replacing the fixed Thin/Normal/
  Thick and Off/S/M/L presets), on both the 2D map and the globe, plus a
  new **cruise route-arrow size** slider (0 hides the arrows).
- **2D-map hover tooltips match the globe** — airports, ports, flight
  routes and cruise routes now show a country flag, ICAO/IATA code,
  place and count on hover.
- **POI/stop labels on the trip map** — trip stops (POIs, hotels, …)
  show their name on the map instead of a bare coloured dot.
- **Redesigned map & globe experience** — consolidated appearance
  control panel shared between the 2D map and globe, mode-aware
  presets (marker size, route width, basemap parity), readable
  port/airport labels with priority reveal on zoom, flag-based markers
  (flagcdn, not emoji), and an activity histogram with playback
  replacing the old time slider.
- **Per-cruise and status-based map coloring** — cruises can now use a
  distinct color per trip or the default two-tone (sailed/planned)
  status coloring; flights get a warm/cool status split
  (flown/upcoming) in the "All" view, with intensity scaled by route
  frequency.
- **Statistics: KPI scorecard & trend charts** — a new overview
  scorecard (sparklines, time-range control) and a canonical
  flights-per-period chart, backed by a new `GET /stats/timeseries`
  endpoint.
- **Unresolved cruise ports** — an imported stop that can't be matched
  to the port catalog is kept as a port call with its original name
  (🔶 in the timeline) instead of being silently downgraded to a sea
  day; resolvable later from the stops editor.
- **Cruise table improvements** — sortable columns, inline
  duplicate/edit/delete actions, and country-flag chips per cruise.
- **Device pairing for the companion app** — secure claim-code flow
  (start/status/claim/unpair) with a live QR on the new Settings →
  Devices page, plus per-device metadata on API tokens.
- **Cross-device app settings sync** — `GET/PUT /api/v1/app-settings`
  persists mobile-app preferences server-side.
- **Boarding-pass QR from photos** — digital boarding passes can now
  be decoded from an uploaded image, not just a live scan.
- **Trip diary entries** — a read-only diary view with Markdown
  rendering on the journey detail page.
- **Discord community integration** — a community link in the app
  header, plus release/beta/RC announcement tooling.
- A proper 404 page for unknown routes (was a blank page).

### Fixed
- **Admin backup page no longer scroll-jumps** — the backup screen's
  5-second status poll was flipping the full-page loading state on every
  tick, blanking the table and snapping the scroll position back to the
  top every few seconds; the poll now refreshes the list silently (#180).
- **Loading labels showed a raw translation key** — several admin and app
  loading states displayed the literal text `common:loading` instead of
  "Loading…", and two "close" controls (including a screen-reader label) were
  likewise unresolved. All now show the correct text, guarded by a test.
- Cruise stops with an ambiguous name (e.g. "Naples") now resolve to
  the correctly-catalogued port instead of a same-named placeholder in
  another country (#169).
- The map colour legend now sits in a compact bottom-right table, so the
  globe's activity time-histogram no longer overlaps it on the "All" tab.
- Cruise-arc arrows now point in the correct travel direction and have
  a bordered, easier-to-read shape (Discord bug report #160).
- Overlapping airport/port labels in dense map clusters are
  decluttered.
- The stats overlay no longer collides with the map's Add button.
- Time histogram: proportionate collapsed layout, a properly
  positioned year axis, confusing speed selector removed.
- Statistics trend deltas show percent-only and hide cleanly when
  there's no comparison window; all-time charts trim empty leading
  buckets.
- Various cruise-stop edge cases (unresolved-port singular/plural
  copy, sea-day toggle clearing stale names, import-preview wording).
- Boarding-pass duplicate detection is now timezone-aware.
- AI trip-summary generation uses the long parser timeout instead of a
  10s default.

## [2.2.2] - 2026-07-04

### Fixed
- **No phantom vertical scrollbar on horizontal tab bars** — the trip-detail,
  admin, statistics and parser tab bars no longer show a stray vertical scroll
  bar; horizontal scrolling on small screens is unaffected. (#155)
- **Bug reports attach the diagnostic bundle as a file** — "Report a bug" now
  downloads the bundle for you to drag into the GitHub form instead of copying
  it for a paste that GitHub rejects as too large. (#157)
- **Admin panel shows the clean release version** — after switching an RC image
  back to the release tag, the panel no longer looks stuck on the RC version;
  the exact build is shown on hover. (#156)
- **Correct English comparison label in statistics** — the year-over-year delta
  badge showed the German "ggü." in the English UI; it now reads "vs".

## [2.2.1] - 2026-07-04

### Fixed
- **Uploaded photos now survive container updates** — Trip photos, receipts and
  imported files were stored inside the container instead of on the mounted data
  volume, so they disappeared on every image update. Uploads now live on the
  persistent `/app/data` volume automatically, with no extra bind-mount
  required; an existing manual upload mount is detected and left untouched. (#152)
- **Large photo and PDF uploads no longer fail** — The built-in web server
  capped request bodies at 1 MB and rejected larger photo or PDF uploads with a
  "content too large" error. The limit is now 100 MB, in line with the file
  sizes the app already accepts. (#153)
- **Trip timeline dots align on the connector line** — On a journey's timeline
  the event dots sat slightly off the vertical line at an inconsistent height
  and were drawn as hollow rings. They are now filled, centred on each event
  card, and sit exactly on the line, which runs cleanly from the first to the
  last event. (Discord bug report)
- **Correct plurals for trip counts** — Trip counters always showed the
  singular form (e.g. "532 Nacht", "4 Flug"). German and English plurals now
  render correctly ("532 Nächte", "4 Flüge"). (Discord bug report)

## [2.2.0] - 2026-06-14

### Added
- **Cruise itinerary dates** — Each cruise stop now stores its calendar date,
  extracted from booking confirmations on import (even when no arrival or
  departure times are listed) and editable per stop, including sea days. Stop
  dates appear on the cruise detail timeline. (#132)
- **Cruise route name** — Cruises gain an optional route/itinerary name
  (e.g. "Kanaren mit Marokko") as printed on booking confirmations, captured
  on import and shown in the cruise list and detail header. (#133)

### Fixed
- **German and local port names now match on cruise import** — The importer
  resolves German exonyms ("Lissabon", "Singapur", "Venedig") and local
  endonyms ("Lisboa", "Roma", "Napoli") to the correct catalog port instead
  of leaving them unmatched, with a fuzzy fallback for near spellings. Rome
  and Florence map to their actual ports of call (Civitavecchia, Livorno),
  and a short catalog name can no longer be mis-matched to a longer parsed
  name ("Atlantis" no longer matches "Atla").
- **Airport selectors no longer auto-expand on modal open** — Pre-filled
  airport fields (such as the fly & cruise import preview) only open their
  dropdown when focused, instead of all popping open at once when a dialog
  opens.

### Changed
- **Consistent "Add flight" button placement** — The flights page now shows a
  heading with the "Add flight" button right-aligned, matching the cruises and
  trips pages.

## [2.1.0] - 2026-06-13

### Added
- **Worldwide port catalog** — The cruise port catalog grew from ~670 to
  over 12,000 seaports (imported from the public UN/LOCODE dataset), so ports
  like Taranto that were previously missing now resolve directly in manual
  entry and import.
- **Port map-search fallback** — When a port isn't in the catalog, the picker
  looks it up via OpenStreetMap and fills in its coordinates automatically
  instead of forcing manual latitude/longitude entry.

### Fixed
- **Cruise dates were lost or shifted** — Entering only a date in the cruise
  form left it unsaved (so it never appeared in the overview), and entered
  dates could drift to the previous day across timezones. Cruise start/end are
  now date-only and timezone-stable.
- **Accented ports weren't found** — Searching "Malaga", "Warnemunde" or
  "Tromso" returned nothing because the catalog stores accented names; the
  search now ignores diacritics. Added German exonyms (e.g. Tarent → Taranto).
- **Cruise PDF/email import extracted nothing** — Real "Mein Schiff" bookings
  parsed to empty results because the LLM extraction prompt was
  over-constrained; the rewritten prompt reliably extracts ship, dates, cabin,
  price, itinerary ports and bundled fly & cruise flights.
- **Port search failures were hidden** — A network or auth error during port
  search now surfaces an error instead of silently looking like "no results".

### Security
- **API write-scope on cruise endpoints** — Cruise, port and ship write
  endpoints now require a write-scoped Personal Access Token (consistent with
  flights/trips), and the new port-lookup endpoint is rate-limited per user.

## [2.0.1] - 2026-06-13

### Fixed
- **Cruise parsing ignored the configured Ollama server.** The cruise
  booking parser always connected to `localhost:11434` instead of the
  Ollama URL/model set in admin settings, so a correctly configured — and
  successfully tested — remote Ollama was never actually used. Cruise
  PDF/email imports failed with an "LLM unreachable" error even though the
  connection test passed. The parser now resolves its endpoint from admin
  settings, matching the flight parser.
- **Parser failures were logged as an empty object.** Backend error logs
  showed `error:{}` with no message or stack for parser errors (and 16
  other call sites), hiding the root cause. Errors now serialize their
  message and stack, and the Ollama-unreachable error names the endpoint
  and points to Settings.

### Changed
- **LLM parser configuration moved to the General admin tab.** The Ollama /
  parser settings sat under the "Flight" admin tab, where cruise-only users
  never found them; they now live under "General".

## [2.0.0-rc.12] - 2026-06-13 (Release Candidate)

### Fixed
- **Cruise import preview triggered a render-loop.** The editable import
  preview reported its state through an effect whose dependencies changed
  on every render, causing a "Maximum update depth exceeded" loop
  (~193 console errors per import). Saving still worked but the screen
  thrashed; the reporting is now stable and the preview renders cleanly.
- **Imported fly & cruise trip was mislabeled "completed".** A booking with
  bundled flights auto-creates a trip; with no explicit status it fell back
  to the "completed" default, so an upcoming voyage showed as already done.
  The status is now derived from the cruise dates (upcoming → planned,
  past → completed, in range → in progress).

## [2.0.0-rc.11] - 2026-06-13 (Release Candidate)

### Fixed
- **Fly & cruise import failed at the final save step.** Importing a cruise
  with bundled flights created the cruise and the flights, but then errored
  while grouping them into a trip — the flight IDs were sent empty. The trip
  now links the cruise and its flights correctly.

## [2.0.0-rc.10] - 2026-06-13 (Release Candidate)

### Fixed
- **Cruise import failed to save bookings that list only dates, no times.**
  Itinerary stop times extracted as a bare date (e.g. `2026-06-15T00:00`,
  without seconds or offset) were rejected by the cruise validation, so the
  whole import 400'd on save. Partial datetimes are now coerced to full ISO
  on the way in.

## [2.0.0-rc.9] - 2026-06-13 (Release Candidate)

Cruise-import overhaul on top of rc.8. No schema change.

### Fixed
- **Duplicate "Add cruise" button.** The dashboard cruise tab showed two
  "+ Kreuzfahrt hinzufügen" buttons; the correctly-placed toolbar button
  now opens the import chooser, and the stray floating one is gone.

### Added
- **Editable cruise import preview.** After a booking is parsed, every
  field is editable inline before saving — the matched ship and ports now
  show by name, with an expandable itinerary editor, and missing/unmatched
  fields are flagged. (The preview was previously read-only.)
- **Fly & cruise flights.** Cruise bookings that bundle flights now extract
  those flights too: they appear as opt-in cards with airports pre-filled
  (your home airport + the nearest airport to the embarkation/disembarkation
  port, all editable), and the cruise plus its flights can be grouped into
  one trip so the journey map shows fly → cruise → fly.

## [2.0.0-rc.8] - 2026-06-13 (Release Candidate)

Bug fixes and import/UX improvements on top of rc.7. No schema change.

### Fixed
- **Airport popups always showed "0 flights".** Clicking an airport on
  the map opened a card reporting 0 total flights and no routes, even
  though the map clearly drew arcs through it. The popup now aggregates
  the same flight data that draws the routes, so totals, top routes,
  airlines and distances match the map on every tab and honour the
  active year filter.
- **Inconsistent CO₂ figures.** The per-flight CO₂ value, the dashboard
  "elephants" aggregate and the demo data each used a different formula,
  so the numbers disagreed. All three now use one model (distance band ×
  cabin-class factor), and a one-shot backfill fills in CO₂ for older
  flights that never had it computed.

### Changed
- **Trip cover image is now an upload.** The trip editor lets you upload
  an image file for the cover directly — including while creating a new
  trip — instead of pasting an image URL.
- **Cruise add flow matches flights.** Adding a cruise now opens a single
  chooser like the flight form: import a booking (email or PDF, auto-
  detected) or enter it manually — on both the Cruises page and the
  dashboard cruise tab.

## [2.0.0-rc.7] - 2026-06-12 (Release Candidate)

Closes the findings of the V2 function & usability audit. No schema change.

### Fixed
- **Unreadable form fields on dark surfaces.** A Tailwind color named
  `base` shadowed the `text-base` font-size utility and rendered
  datetime inputs and dropdowns (e.g. in the cruise editor) near-black
  on the dark theme.
- **Minimal cruises were invisible.** A cruise entered with only a
  departure and arrival port (no detailed stop list) drew no route on
  any map, listed neither port on its detail page, and reported
  contradictory port counts (4 in the list vs 0 on the detail page).
  Routes, distances, statistics and achievements now all run over the
  full departure → stops → arrival sequence, and changing the
  departure/arrival port recomputes the route.
- **Past cruises stayed "Scheduled" forever.** Scheduled cruises whose
  end date passed more than 48 hours ago now flip to Completed
  automatically — cancelled and historical entries are never touched.
- **"Go to settings" on a disabled dashboard tab led nowhere.** The
  link now lands directly on the Modules section.
- **English leftovers in the German UI.** Loading, not-found and
  save-error messages, picker buttons and screen-reader labels across
  the cruise surfaces are now properly localized (DE/EN), and the logo
  badge reads V2.0 instead of V1.0.
- **Parser failures exposed raw internals.** When the LLM parser
  (Ollama/OpenAI/Claude) is unreachable, the import dialog now shows a
  clear, actionable message instead of a connection stack trace — and
  the cruise statistics endpoint no longer fails entirely when a single
  cruise carries malformed data.

### Added
- **German port names in the port search.** Typing "Lissabon",
  "Kopenhagen" or "Venedig" now finds Lisbon, Copenhagen and Venice —
  about 80 common German exonyms map to the English catalog names,
  matching even while you type.
- **Cruise dashboard tab states.** The cruise map tab now shows a
  loading indicator, an error banner when data can't be fetched, and an
  empty-state card guiding new users to add or import their first
  cruise. The cruise editor labels its departure/arrival port fields,
  and search dropdowns no longer pop open on their own.

## [2.0.0-rc.6] - 2026-06-11 (Release Candidate)

### Added
- **Trips are journeys now, not bookings.** Trip auto-detection only
  proposes real multi-leg journeys (3+ flights) — a plain out-and-back
  booking stays trip-less. A new "Clean up" tool on the Trips page
  dissolves legacy one-booking micro-trips (the flights are kept), and
  a merge mode combines several trips into one real journey.
- **Compact trip filter in the flight list.** The one-chip-per-trip row
  (unusable with many trips) is replaced by quick chips for the newest
  trips plus a searchable, year-grouped "Filter by trip" popover.

### Fixed
- **Disabled domains no longer leak content.** With the cruise domain
  switched off, cruises still appeared on the dashboard "All" map, in
  the cross-domain statistics, on trip detail pages and maps, and behind
  the dimmed cruise tab (including its controls). Disabled domains are
  now fully hidden — their data is not even fetched; trip details show a
  "N cruise segments hidden" hint and disabled dashboard tabs show an
  enable-in-settings stub instead.

## [2.0.0-rc.5] - 2026-06-10 (Release Candidate)

Full V2 feature audit across both domains — closes a batch of usability
gaps, mostly in the new cruise module. No schema change.

### Added
- **Pick which trip the journey map shows.** Journey mode rendered an
  arbitrary first trip with no way to choose another; it now offers a
  trip selector (with a hint when no cross-domain trips exist).
- **Fix unmatched ports during cruise import.** Ports the parser couldn't
  match were downgraded to sea days and could only be corrected after
  saving. The import preview now lets you pick the right port per stop
  before saving.
- **Delete a cruise.** The cruise detail page now has a delete action
  (with confirmation) — previously a mis-imported cruise was stuck.

### Fixed
- **The flight status filter hid historical and duplicated flights.**
  Unchecking any one status (flown/scheduled/cancelled) silently dropped
  every historical/duplicated flight; those two statuses now stay visible.
- **Editing a flight could shift its stored time.** The edit modal showed
  times in the browser's timezone but saved them as airport-local, so
  opening and saving without changing anything drifted the departure /
  arrival when the two timezones differed. Times are now consistently
  airport-local and round-trip losslessly.
- **The cruise stops editor showed blank ports when editing.** The selected
  port is now shown for each existing stop.
- **Your own flight API key was labeled "Shared".** The provider card now
  reads the correct per-provider key status.
- **Cruise import failures were opaque.** The real cause (e.g. Ollama not
  reachable) is now surfaced instead of a generic "parsing failed".
- **Change-password accepted too-short passwords.** The modal now enforces
  the backend's 8-character minimum with specific error messages.
- **English users saw stray German labels** (flight-row tooltips, scanner
  steps) and an unstyled duplicate-flight dialog — both fixed.

### Changed
- **Cruise create opens straight to the form.** Removed the fake
  email-import chooser (a dead-end stub); real email/PDF import stays on
  the cruise list page.
- **Removed the no-op "Require user flight API keys" admin toggle** — it
  had no backend behaviour.
- The in-map visualization control is hidden in the airport-frequency and
  journey modes so it can't contradict the toolbar.

### Tooling
- Dead-code cleanup (retired 3D map-mode layers + their i18n keys),
  corrected stale cruise-routing notes in CLAUDE.md, and routed the map's
  cruise-overlay gate through the domain-gating API.

## [2.0.0-rc.4] - 2026-06-10 (Release Candidate)

### Fixed
- **The map could still drop a flight on very large accounts.** The rc.3
  fix paginates the full flight set, but the backend ordered each page by
  `departureTime` alone — a column that is nullable and not unique. At a
  500-flight page boundary, rows sharing a timestamp (or the cluster of
  flights with no timestamp at all) could be reordered between requests and
  silently skipped or drawn twice. Both the paginated flight list and the
  map's `/geo` feed now sort with a stable `id` tie-breaker, so every
  flight is loaded exactly once regardless of account size.

## [2.0.0-rc.3] - 2026-06-09 (Release Candidate)

### Fixed
- **The dashboard map only showed your 100 most recent flights.** The
  multi-domain refactor replaced V1's paginated map load with a single
  unbounded `/geo` request, which the backend caps at 100 (newest first).
  On accounts with more than 100 flights, every older flight silently
  vanished from **all** map views (overview, heatmap, globe, journey) — a
  one-off trip from years ago simply wasn't there. The map now paginates the
  full set again, so every flight is plotted regardless of age.

### Changed
- **Single-flown routes are easier to spot.** A route flown just once
  rendered at the faintest possible treatment (alpha 114, 1px) and was easy
  to lose in an empty ocean. Raised the visibility floor (alpha ≥ 160,
  minimum 2px width) so a lone long-haul reads clearly.

## [2.0.0-rc.2] - 2026-06-09 (Release Candidate)

Second 2.0 release candidate. Data-integrity hardening uncovered while
verifying real flight data on the rc.1 build, plus a trip-detection UX
improvement. No schema change.

### Added
- **Expandable trip-detection cards.** Each auto-detected trip in the
  "Reisen erkennen" review modal can be expanded to reveal its
  constituent legs (date · flight number · departure → arrival · status).
  The proposal payload now carries a `legs` array.

### Fixed
- **Airport IATA collisions resolved to the wrong airport.** OurAirports
  assigns synthetic ICAO placeholders (e.g. `US-0226`) to minor airfields,
  some of which carry a spurious IATA that collides with a real
  international airport — so a flight to Antananarivo (IATA `TNR`) could be
  stamped with the coordinates of a tiny "Tulsa Downtown Airpark" and drawn
  to Oklahoma. Airport lookup now prefers the authoritative airport
  (active over closed, real 4-letter ICAO over a synthetic placeholder)
  across the cache, batch and create paths.

### Tooling
- **`fixMistaggedDurations` maintenance script.** Detects flights whose
  legacy time-semantics tag inflates/deflates the displayed duration
  (e.g. a Sydney→Dubai leg showing 21 h instead of 14 h) by comparing the
  naïve and timezone-converted durations against the great-circle minimum
  flight time, and retags clearly mis-tagged rows. Genuinely corrupt rows
  (zero/negative duration) are reported for manual review, never silently
  changed.

## [2.0.0-rc.1] - 2026-06-09 (Release Candidate)

First release candidate for **TravStats 2.0** — the multi-domain
release. TravStats is no longer a flight-only logbook: it now tracks
**cruises** as a first-class domain alongside flights, with a shared
dashboard, shared stats, and a unified import pipeline. This RC
aggregates the entire `2.0.0-beta.1` … `2.0.0-beta.28` line; see those
entries below for the granular history.

### Added — Cruise domain
- **Cruise logbook**: full CRUD for cruises, ships, and ports, with
  per-cruise itineraries (port calls + sea days).
- **In-house sea-route renderer**: a vendored Eurostat *marnet*
  shipping-lane graph with an A* pathfinder (`services/marnet/`)
  replaces the abandoned `searoute-ts` package, so cruise legs follow
  real shipping lanes instead of falling back to coarse arcs.
- **Cruise booking parser**: AIDA / TUI / generic-LLM extraction wired
  into the email and PDF import routes, with ship/port entity
  resolution.
- **Cruise stats**: a dedicated cruise stats page plus cross-domain
  KPIs (flights + cruises) on the combined "Alle" view.

### Added — Multi-domain platform
- **Domain-scoped dashboard**: Alle / Flüge / Kreuzfahrten tabs with
  per-domain visualization modes; the URL carries tab + mode and the
  last-used mode persists per domain.
- **Domain registry**: a shared front-/back-end domain registry drives
  gating, parsing targets, and per-domain brand palettes (dark-only).
- **Special flights (Sonderflüge)** as a flight sub-type.
- **Globe modernization**: MapLibre + deck.gl rewrite with GPU-based
  earth occlusion and smoothed map ↔ globe transitions.

### Fixed
- **Flights to IATA-less airports no longer vanish from the map**
  (#120): airfields with only an ICAO code (common for small / pre-1990
  airports) saved fine but were silently dropped by the route render
  gate. Airports are now identified by IATA → ICAO → coordinate key, so
  any leg with valid geometry renders.

## [2.0.0-beta.28] - 2026-05-12 (Beta)

### Fixed
- **Infinite re-render loop on the dashboard fired ~8 GETs/sec at
  `/api/v1/flights`.** `useEnabledDomains()` returned a fresh
  `isEnabled` arrow function on every render; `DashboardPage` listed it
  in a `useEffect` dependency array, so the effect re-ran on every
  render, called `setCounts({...})` with a new object reference,
  triggered another render — and so on. With dev-tools open on the
  Globe view, the network log filled with thousands of 304-cached
  calls; with caching disabled this would hammer the backend.
  `MapContainer3D` already documented this trap and worked around it
  locally; the hook-level fix (memoize `isEnabled` against the
  `enabled` array via `useCallback`) closes the trap once and for all
  so future callers cannot trip into it.

## [2.0.0-beta.27] - 2026-05-10 (Beta)

### Fixed
- **Bulk historical refresh aborted client-side after 10 s** while the
  backend kept running. The default axios timeout is 10 s, but
  `runBulkRefresh` loops sequentially through up to 25 flights, each
  calling AeroDataBox / Aviationstack — easily 30–60 s on a healthy
  link. The UI gave up mid-loop, surfaced a red `timeout of 10000ms
  exceeded` toast, and the user had to re-click before any data
  showed up. Bumped the bulk-refresh request to the parser-class
  180 s timeout so the call stays open for the full server-side
  iteration.
- **Settings → Auffrischen-Buttons used raw `bg-blue-600`** instead of
  the brand-amber `btn-primary`. Side-fix while in the file.

### Performance
- **Globe hover tooltip moved into a leaf component.** Sweeping the
  cursor over airport / port labels triggered React re-renders at
  60–120 Hz of the entire 1600-line `GlobeView` tree (every onHover
  event called `setTooltip`); on lower-end GPUs this read as visible
  jank during the cursor-following tooltip. The new `HoverTooltip`
  exposes an imperative `show / hide` API via `forwardRef`, so only
  the 30-line tooltip subtree re-renders on cursor movement — the
  parent and its `MapboxOverlay` setProps stay put.
- **Aktivität-Panel rows replaced 720 `onMouseEnter` / `onMouseLeave`
  JS handlers** (2 per row × 354 rows + cruises) with a Tailwind
  `hover:bg-white/[0.04]` class. The browser now handles row hover
  purely in CSS — no listeners attached, no inline-style mutation
  during scroll.

## [2.0.0-beta.26] - 2026-05-10 (Beta)

### Fixed
- **Sonder-Flug entry was invisible from the dashboard top-bar add
  button** — `DashboardLayout` mounted `SimplifiedFlightFormV2` without
  the `onPickSpecialFlight` prop, so the special-flight chooser card
  silently dropped out of the lookup step for every user coming through
  this path. The chooser button label was also calling a missing i18n
  key (`specialFlights:chooser.pickAction`); now uses the correct
  `chooser.cta`.
- **NavigationBar missing on Trips pages** — `/trips` and `/trips/:id`
  had no top-bar at all (no logo, no nav links, no user menu) while
  every other top-level page mounted `<NavigationBar />`. Added it to
  both, plus the loading state on `/trips/:id` so the chrome doesn't
  pop in once the trip resolves.
- **Map info pill bled through the dashboard's Aktivität toggle on the
  Alle and Flüge tabs** — `MapContainer3D` rendered a "X Flüge · Y
  Routen" pill at top-left z-10, sitting under the tab-level
  Aktivität button + domain-legend chips at z-30. The "Routen" tail
  peeked out between the two pills. Added a `hideInfoPill` prop and
  set it on AllTab + FlightsTab.
- **Route-Details button on the flight tooltip silently did nothing**
  when the Aktivität sidebar was closed — `<RouteDetailsSidebar>` is
  rendered inside `<FlightPanel>`, which only mounts while the sidebar
  is open. Clicking the button just flipped the store flag and looked
  unresponsive. FlightsTab now auto-opens the sidebar on any non-null
  `detailMode` transition so the details actually appear.

### Visual / brand
- **Cruise-port markers + UN/LOCODE labels on the flat map**: hover
  tooltip ported from globe so airport / port hover bubbles now show
  IATA + name + count + last-visit / last-call across both surfaces.
  Labels also gain the same low-zoom hide threshold the airport IATA
  labels already use.
- **Globe arc + cruise-path widths** realigned to the flat-map
  `sqrt(count)` formula so the visual jump between map ↔ globe
  transitions is smooth instead of jumping in line weight.
- **Three-round brand-violation sweep** against `BRAND.md`:
  - Domain-color leaks fixed across AchievementPopup tier gradients,
    Admin/UserManagement role badge, DataSourceBadges, Stats seat-class
    and zone bars, Training flight-highlighter palette, FlightCalendar
    intensity ramp.
  - Email-import "Beste Option" hero card on the cruise side moved off
    the retired green/teal pattern to the same brand-amber gradient
    the flight side already uses; FlightLookupStep "Sonder-Flug" card
    border moved off Hotel-domain purple to flight-domain amber.
  - Stats progress bars (aircraft / airline / country) and the Setup +
    SetupPage success/error banners moved off light-mode Tailwind
    palette to brand state tokens (`--success` / `--danger` /
    `--warning` / `--accent`).
  - Admin LoggingManager + BackupManagement, Training TemplateReview
    + BoardingPassAnnotation, ParserPage tabs, ReceiptUpload drag-
    state and AirportSeedingBanner all rerouted to brand tokens.
  - Cruise port markers on the map now render in the canonical
    `--domain-cruise` hex (#6fa0d6) instead of sky-400.
- **Shared tooltip labels** moved out of `map.globe.pinned.*` into a
  dedicated top-level `map.tooltip.*` namespace shared by both the
  globe pinned card and the flat-map hover bubble (no functional
  change, just consistent key location).
- **Globe edge-clipping fixed** — `EarthOcclusionExtension` now reads
  the live MapLibre camera distance off the deck.gl viewport instead
  of an empirical zoom heuristic that was off by 3-22× from the real
  camera. Routes no longer disappear at the rim when zoomed out.



### Fixed
- **Alle-tab map legend now reflects domain pills** — The legend stripe
  (sky-blue cruise + orange flight) hard-coded both rows, so toggling
  cruise off in the filter dropdown left the legend lying that cruises
  were still on screen. Each row is now gated on its domain pill state;
  if both pills are off, the legend block is hidden entirely.

## [2.0.0-beta.24] - 2026-05-09 (Beta)

### Added
- **Filter button shows active state** — When the year dropdown picks
  a specific year or any domain pill is off, the dashboard top-bar
  Filter button switches to an accent border + the picked year next to
  the label, and a "n/m" pill displays how many domains are active.
  Without this indicator users can't tell at a glance whether they're
  seeing the full dataset or a filtered slice.
- **"Filter zurücksetzen" link in the dropdown** — Single click to
  clear year + domain selection back to the unfiltered defaults.
  Disabled when no filter is active.

## [2.0.0-beta.23] - 2026-05-09 (Beta)

### Fixed
- **Double tooltip on flat-map airport markers** — Beta.21 added a
  hover bubble via deck.gl's `getTooltip` to surface full place names
  on every marker. On the flat map, airport markers already trigger
  the rich `AirportTooltip` (departures/arrivals/distance/route
  counts) on click, so the new hover bubble layered a second tooltip
  on top of the rich one. The hover bubble now skips flat-map
  airports (`routes-dot` / `routes-label`) and fires only on flat-map
  ports + every globe marker. Globe airports keep the hover bubble
  because they have no rich-tooltip equivalent.
- **Markers clipped where cruise paths cross them** — Globe airport +
  port markers rendered at altitude 0 while cruise paths sit at 5 km;
  the depth buffer let the path's fragments occlude the marker dot at
  shallow camera angles. Lifted both the dot and the label to 8 km
  altitude (`MARKER_ALTITUDE_M`) so the marker is reliably above any
  path that crosses it. On the flat map the symptom was different:
  cruise paths were composed AFTER airport visuals in the layer
  stack, so they drew on top of airport dots at every intersection.
  Reordered the flat-map layer composition: cruise arcs/arrows go
  below flight arcs and airport markers, cruise port halo+dot+label
  go on top of everything (their pixel-radius cap keeps them readable
  at every zoom).

## [2.0.0-beta.22] - 2026-05-09 (Beta)

### Fixed
- **Year + domain filter now actually filters data** — Beta.20 added
  the year dropdown and domain pill row but only updated the store;
  the data layer didn't read either. Wired both into the Alle, Flüge,
  and Kreuzfahrten tabs:
  - Alle tab filters flights by `departureTime` within the year range
    and cruises by interval overlap (start/end), and gates each domain
    on/off via the pill row. Activity panel reflects the same
    filtered set.
  - Flüge / Kreuzfahrten apply the year filter only — domain pills are
    cross-domain and a domain-dedicated tab keeps showing its domain
    regardless of pill state.
  - `MapContainer3D` gained a `cruisesOverride` prop that bypasses its
    internal cruise fetch so the tabs can hand it the pre-filtered set.

## [2.0.0-beta.21] - 2026-05-09 (Beta)

### Changed
- **Flat-map cruise port labels show UN/LOCODE instead of full name**
  — Mirrors how airport markers show 3-letter IATA codes ("HAM",
  "JFK"). Ports now show the 5-letter UN/LOCODE ("DEHAM", "USJFK")
  with a fallback to the full name when the UN/LOCODE column is null.
  The Globe view already did this — flat-map was inconsistent.

### Added
- **Hover tooltip on every airport + port marker** — Shows the full
  place name in a small dark bubble on hover. Wired through
  `getTooltip` on every MapboxOverlay (DeckGLMap, GlobeView,
  CruiseRouteMap, TripMap) using a shared
  `components/map/markerTooltip.ts` helper. Routes / arcs / paths
  are explicitly excluded so the cursor stays clean while panning.

## [2.0.0-beta.20] - 2026-05-09 (Beta)

### Changed
- **Globe mode is now exclusive to the Alle tab** — The 3-D globe is
  cross-domain by design (mixes flights and cruises on one sphere), so
  exposing it on per-domain tabs caused two problems: clicking it on
  Flüge/Kreuzfahrten swapped to a globe view that broke domain scoping,
  and the heatmap legend never matched. The in-map FAB now takes an
  `availableModes` subset — `[routes, heatmap, globe]` on Alle,
  `[routes, heatmap, trips]` on Flüge, and the FAB is hidden entirely
  on Kreuzfahrten (cruise modes don't map 1:1 to the FAB's Map modes).
- **Flat-map cruise port markers re-aligned with airport markers** —
  Ports were a single 4–10 px scatter dot scaled by visit count, while
  airports are a meter-based dot + halo ring stack. On the same map
  they read as two unrelated marker systems. The port layer now mirrors
  the airport stack: 2.2 km solid dot in sky-blue + 6 km halo ring +
  clickable port-name label (TextLayer, billboarded). Same visual
  weight at every zoom.
- **Empty ship-marker toggle removed** — The "Schiffsmarker" checkbox
  in the globe FAB row had no real handler — toggling it left the
  layer state untouched. Removed the toggle and the dormant
  shipMarkers state plumbing in GlobeView and buildGlobeLayers.

### Added
- **Year + domain dropdown filter** — The dashboard filter dropdown
  now offers a single year selector (current year + 14 years back, or
  "Alle Jahre") instead of two from/to date pickers. Per-day
  precision is unnecessary for the use cases TravStats supports, and
  consolidates against the Globe day slider so the two don't fight.
  On the Alle tab a domain pill row toggles flight / cruise / poi
  visibility together. Store extended with `setYear` (mirrors to the
  underlying `time` range so existing range-overlap consumers keep
  working) and `setDomains`.

## [2.0.0-beta.19] - 2026-05-09 (Beta)

### Fixed
- **Cruise paths clipped into the globe** — Cruise sea-route geometry
  comes from the backend as 2-D `[lng, lat]` points, so deck.gl
  rendered the path at exactly altitude 0. That shares depth-buffer
  values with the sphere mesh and produces visible z-fighting /
  clipping where segments dip into the globe. Lifted each path
  point to 5 km altitude in `globe-cruise-paths`'s `getPath` —
  invisible at any user-relevant zoom but well above the depth
  precision noise.

## [2.0.0-beta.18] - 2026-05-09 (Beta)

### Fixed
- **Globe pinned-card "Open last flight" CTA was a no-op** — The CTA
  was wired to a callback named `onFlightClick` that mapped to
  `setSelection([flight])` upstream, which only highlights the row in
  the activity panel. Renamed to `onFlightOpen` and re-wired in
  AllTab + FlightsTab to actually open the flight edit modal — same
  modal the activity-panel "Details" button opens.

### Added
- **Cruise pinned-card now has an "Open cruise" CTA** — Symmetric to
  the flight CTA. New `onCruiseOpen` prop on GlobeView /
  MapContainer3D, wired in AllTab to navigate to `/cruises/:id` —
  same destination the activity-panel cruise "Details" button uses.

## [2.0.0-beta.17] - 2026-05-09 (Beta)

### Fixed
- **Globe canvas still disappeared on click after beta.16** — Removing
  `flyToArc` and adding try/catch wasn't enough. Per Gemini's diagnosis
  (matching upstream issue #512), the actual root cause is MapLibre 5's
  `locationOccludedOpacity` feature: it performs an internal occlusion
  pass that does not restore `gl.SCISSOR_TEST`, leaving the shared GL
  context corrupted on next deck.gl draw. With `interleaved: true` in
  `MapboxOverlay`, deck.gl and MapLibre share the WebGL context, so any
  popup creation triggered a state leak that blanked the canvas.
- **Replaced `maplibregl.Popup` with a custom React overlay** —
  Pinned-card now mounts as an absolutely-positioned `<div>` whose
  `left/top` come from `map.project([lng, lat])`, refreshed on every
  MapLibre `render` event. Back-of-globe culling is replicated in JS
  via the same dot-product math the EarthOcclusionExtension shader
  uses. Same UX (anchored, follows camera, fades when occluded), zero
  GL-state risk.
- **`PinnedCardBoundary` error boundary around the card** — Defense
  in depth: a throw inside the React subtree now logs and renders
  null, instead of bubbling up and unmounting GlobeView.

## [2.0.0-beta.16] - 2026-05-09 (Beta)

### Fixed
- **Globe disappeared completely on flight-route click** — Critical
  regression in beta.12-15: clicking an aggregated arc fired both
  `setPinned()` (mounting the new MapLibre Popup) and a 1.5 s
  `flyTo()` camera animation. The popup mount + camera flyTo +
  globe re-render combo crashed the WebGL canvas in some camera
  states, leaving a black screen instead of the globe. Two-layer
  fix:
  - **Drop the camera flyTo on click.** With the popup now anchored
    to the click coordinate, flying the camera away from where the
    user just tapped is anti-pattern anyway, and removing it
    eliminates the race entirely.
  - **Wrap the popup mount in try/catch + finite-coord guard.** A
    single throw from MapLibre's projection or anchor-flipping math
    used to bubble up and unmount the entire GlobeView. Now caught
    and logged; popup missing is recoverable, canvas going away is
    not.

## [2.0.0-beta.15] - 2026-05-09 (Beta)

### Changed
- **Inactive-tab / section-nav contrast bumped consistently** — The
  TripDetailPage tab fix in beta.10 used a one-off
  `rgba(230,237,243,0.65)` to lift inactive tabs above the borderline
  WCAG-AA contrast `--text-muted` (#8b949e) was hitting against
  `--bg-base`. That fix is now a proper design token, `--text-secondary`
  (#a8b3bf), applied everywhere the same pattern was leaking through:
  AdvancedStatsPage tab strip (Alle / Flug / Kreuzfahrt filter),
  AdminPage tabs + section sidebar, SettingsPage section sidebar, and
  TripModal sub-tabs. `--text-muted` itself is unchanged and stays
  reserved for genuinely de-emphasised content (captions, scrollbars,
  borders).

## [2.0.0-beta.14] - 2026-05-09 (Beta)

### Fixed
- **Globe pinned-card width stretched to viewport on long content** —
  The MapLibre Popup wrapper was created with `maxWidth: "none"`, which
  let the inner card balloon out to the full viewport width as soon as
  the content didn't naturally cap itself. Capped at `320px` so the
  inner card's own min/max widths drive the layout.
- **Cruise card duplicated the port / sea-day count** — Both fields
  used pluralised i18n keys that already include the count
  (`{{count}} Häfen`), and then rendered the count again as the value
  cell, producing rows like `6 HÄFEN  6`. Replaced the pluralised
  keys with plain `Häfen` / `Seetage` labels.
- **Port region rendered lowercase** — The `port.region` column in
  the seed (e.g. `mediterranean`) is the raw enum value. Capitalised
  for display.

## [2.0.0-beta.13] - 2026-05-09 (Beta)

### Added
- **Globe pinned-card content density (Phase B)** — The pinned detail
  card that opens on click now follows a 3-tier hierarchy: heading
  (icon + identifier), hero stat (the one number you want to see),
  and a metadata grid of 3-5 high-value facts. Concrete fields:
  - **Airport**: visit count + name + longest route from here +
    top airline + top aircraft + last visit date.
  - **Port**: visit count + country + region + ships visited
    (truncated to 3) + longest port-call duration + last call.
  - **Flight route**: times flown + total kilometres (sum across all
    aggregated flights on this route) + last flight date + aircraft
    types + top airline + the existing "Open last flight" CTA.
  - **Cruise**: cruise line + date range + port count + sea-day count
    + embark / debark ports.
  All aggregations are pure helpers in `Globe/cardStats.ts` derived
  from the `flights` / `cruises` arrays already passed to GlobeView —
  no extra API roundtrip. Card content extracted into
  `Globe/PinnedCard.tsx` (~330 LoC) so the GlobeView shell stays
  focused on map + popup lifecycle. 21 new i18n keys per locale.

## [2.0.0-beta.12] - 2026-05-09 (Beta)

### Changed
- **Globe pinned-card now anchors to the clicked feature** — The detail
  card that opens when you click an airport, port, route arc, or cruise
  path used to live in a fixed bottom-right slot, disconnected from
  the feature it described. It now mounts inside a MapLibre `Popup`
  bound to the lng/lat where the click landed (`PickingInfo.coordinate`
  for arcs and cruise paths, `position` for airport/port markers), so
  the card visually belongs to the feature with a tail pointing at it.
  MapLibre handles edge-aware anchor flipping near the viewport
  borders, and `locationOccludedOpacity:0` uses the renderer's own
  globe-visibility math to fade the card when the anchor rotates to
  the back of the earth. The card content itself is unchanged in this
  beta — Phase B (denser content per Gemini + Codex review) lands in
  the next bump.

## [2.0.0-beta.11] - 2026-05-09 (Beta)

### Fixed
- **Activity-toggle and legend overlapped on the dashboard `Alle` tab** —
  The `☰ Aktivität` button and the flight/cruise legend were two
  independent absolutely-positioned pills with hand-tuned offsets
  (toggle at `left:12`, legend at `left:128`). Tight gap and variable
  letter widths caused the legend pill to render on top of the toggle's
  right edge. Both pills now share a single absolute flex container
  with `gap:8`, so they auto-flow without offset math; the container as
  a whole shifts to `left:340` when the sidebar opens.

## [2.0.0-beta.10] - 2026-05-09 (Beta)

### Added
- **Trip System V2** — A redesigned Trip surface with a dedicated detail page
  carrying five sub-tabs (Overview / Timeline / Map / Gallery / Logistics).
  Iterations 1-9 land in this beta: list-card redesign, stops + journal
  entries, real Map tab with click-to-fly and Globe/Flat projection toggle,
  per-proposal review flow for trip auto-detection, TripModal split into
  4 sub-tabs with cover preview, photo gallery with lightbox + upload, and
  LLM-generated trip summaries via Ollama (gemma3:12b, 3-paragraph DE
  travel-blog format, persisted to `trip.summary`).
- **Special Flights as a Flight subtype** — Sightseeing, repositioning,
  training, and charter flights can now be logged with type-specific
  metadata (event location, label, lat/lon) without distorting the Flight
  schema or the Trip system. Special-flight overlays render on top of
  routes-mode with their own legend and tooltip variant — they are NOT a
  separate domain or MapMode.
- **Globe modernization** — The 3D Globe is rewritten on MapLibre 5 +
  deck.gl `MapboxOverlay` + `useControl`, replacing the legacy
  `react-globe.gl` + Three.js engine. Earth-occlusion is now GPU
  per-fragment via a custom deck.gl extension reading camera state every
  frame. New helper modules (`buildGlobeLayers`, `arcUtils`,
  `heatmapUtils`, `globeLayerTypes`) replace inline implementations.
- **Merged 1.5.0 trunk** — beta.10 carries the full 1.5 main payload:
  FR24 CSV importer, generic CSV importer with column-mapping wizard,
  shared import preview modal, AeroDataBox extended-field capture,
  dataSource badges, historical-flight Day select, `POST /import/parse`
  API endpoint, and the `route_distance` backfill script.

### Changed
- **Settings → Import promoted to top-level (General tab)** — The
  1.5.0 import section landed nested under Settings → Flug → Import,
  one tab-level deep. With V2 multi-domain ahead (cruise / hotel / POI
  imports) and feedback that the nesting hid the section, Import now
  lives in the General tab right after Backup. The three tiles
  (Flightradar24 CSV, generic CSV with mapping wizard, Round-Trip
  XLSX) and all underlying parsers are unchanged.
- **Globe default basemap** — From `standard` (openfreemap liberty) to
  `dark` (CartoDB dark-matter), matching BRAND.md §1.1's dark-only app
  shell. Users can still pick any style; the choice persists in
  `sessionStorage`.
- **TripDetailPage TabBar inactive contrast** — Inactive tab labels
  brightened from `--text-muted` to white at 65 % opacity with a hover
  transition to `--text-primary`.
- **Globe perf** — Texture sharpness, live-mode smoothness, and removal
  of the night cycle. Frame pacing is now fully GPU-driven.

### Fixed
- **Trip delete-confirmation heading was nearly invisible** — The `<h2>`
  in the delete-confirm modal on the Trip detail page was missing an
  explicit text colour and inherited a muted shade against the dark
  surface. Resolved by adding `style={{ color: "var(--text-primary)" }}`
  in line with the existing TripsTab and FlightPanel patterns.
- **`TEST_LEAK_*` regression-test achievements bled into the user UI** —
  The `achievements.scheduledLeak.test.ts` regression suite seeds nine
  `TEST_LEAK_*` rows into the achievements table to verify
  scheduled-flight isolation, but the seeds remained after the test ran
  and showed up in the live Achievements page (e.g. "Leak: First
  Aircraft Type"). The list / recent / leaderboard endpoints now filter
  `code NOT LIKE 'TEST_%'`, and the dev DB has been cleaned.
- **deck.gl warning `fontSettings.sdf is required to render outline`** —
  The IATA label TextLayer set `outlineWidth: 2` + `outlineColor` but
  never enabled the SDF font flag, so the outline never actually
  rendered and deck.gl logged a warning every frame.
  `fontSettings: { sdf: true }` is now set explicitly.

### Database
- **Four new migrations** — `20260509120000_trip_metadata`,
  `20260509130000_trip_stops_and_journal`, `20260509140000_trip_photos`,
  `20260509150000_special_flights_subtype`. All additive, idempotent,
  zero-downtime safe. Plus the 1.5.0 `_add_aerodatabox_extended_fields`
  migration carried in via the main merge.

## [2.0.0-beta.9] - 2026-05-05 (Beta)

### Added
- **Brand token system wired through the app** — `BRAND.md` per-domain palette (flight `#f0a947`, cruise `#6fa0d6`, hotel `#b072d6`, poi `#5ec2b2`) is now the single source of truth. The shared domain registry (`shared/domains.ts` on both backend and frontend) carries the canonical hexes, so dashboard tab strip, AllTab legend, journey layers, and the legend-driven map controls all read from one place. Stats screen consolidated onto a shared `StatCard` surface — ~30 arbitrary Tailwind gradients replaced with brand tokens.
- **Merged 1.4.0 trunk** — beta.9 carries the full 1.4 main payload: AeroDataBox provider + bulk historical refresh, persisted tail number / Mode-S / codeshare metadata, Aircraft hulls ranking + per-tail profile pages (`/aircraft/:reg`), API tokens for headless ingestion, OpenAPI spec at `/api/v1/openapi.json` + Swagger UI at `/api/v1/docs`, demo account flag (`isDemo`), upgrade-backup hook on container entrypoint.

### Changed
- **Dark-only theme**, light-mode classes retired across components. `themeStore` simplified to `mapTheme` only — no more `isDarkMode` toggle. `<html class="dark">` is set defensively at boot so a stale `localStorage` payload can't strip it.

## [1.5.1] - 2026-05-12

### Fixed
- **`backfillRouteDistance.ts` now actually runs in production** — The v1.5.0 CHANGELOG advertised the script as runnable via `docker exec TravStats npx tsx /app/backend/scripts/backfillRouteDistance.ts`, but the production Dockerfile only copied `backend/dist/` out of the builder stage so `/app/backend/scripts/` did not exist in the shipped image and every operator who followed the documented path got "No such file or directory". The Dockerfile now explicitly copies `backend/scripts/` into the production stage; the documented command resolves as promised.
- **AeroDataBox lookup now persists airport `shortName` and `municipalityName`** — The v1.5.0 release notes claimed AeroDataBox lookups populate these airport-side columns, but the adapter's airport-object interface declared only `{iata, icao, name}` and the fields were filled only by the airport seeder on first boot — provider responses never reached them. New `enrichAirportMetadata()` helper backfills NULL slots from AeroDataBox responses on every lookup, never overwrites a curated value, invalidates the airport cache after a write. Six new lock-in tests cover the contract: happy-path, never-overwrite-curated, both-already-set no-op, empty-payload no-op, unknown-code, and whitespace trimming.

### Tests
- Backend Jest: 657 → 663 (+6 for `enrichAirportMetadata`). Frontend Vitest unchanged at 357/357.

## [1.5.0] - 2026-05-08

### Added
- **`GET /api/v1/diagnostics`** — User-scoped, redacted JSON snapshot of selected flights + trips for bug reports. Filters: `flightIds`, `tripIds`, `airline`, `since`. Reduces the manual hand-glueing maintainers used to need (manual `?airline=…` query + JSON trim + redact). Closes #105. Distinct from the existing `/diagnostic-export` (which returns server log tails). `recentErrors` is reserved as `[]` for now — error-events table is v1.5.x scope. Documented in the OpenAPI spec under the `Diagnostics` tag (rc.5).
- **FR24 CSV importer** — Settings → Import → "From Flightradar24" takes the unmodified `my.flightradar24.com` CSV export. Server-side timezone conversion via the existing airport lookup, hardcoded column map for FR24's known schema (handles the leading blank line and embedded `(IATA/ICAO)` annotations), `Flight reason → category`, `Seat number → seatNumber`, `Note → notes`. Status auto-defaults from `dep_utc` vs. now (past → `flown`, future → `scheduled`). Closes #99.
- **Generic CSV importer with column-mapping wizard** — Drop any flat per-flight CSV; a wizard opens automatically and lets you assign each column to a TravStats field (Departure IATA, Departure Time, Arrival IATA, Status, Airline, Aircraft, …) with auto-suggestions for known field names.
- **Re-import TravStats Excel relocated to Settings → Import** — The round-trip XLSX/CSV/JSON importer (existing rows updated by ID, new rows created) moved off the dashboard into the new dedicated section so all three importers share one place.
- **Shared import preview modal** — Every importer routes through the same preview screen: per-row checkboxes, flag badges (`duplicate`, `duration_mismatch`, `unresolvable_airport`, `date_invalid`), commit dispatched in 20-flight chunks via the existing `/flights/batch` route. Each row tagged with the appropriate `dataSource` (`imported_fr24`, `imported_generic_csv`, `imported_roundtrip`).
- **AeroDataBox extended-field capture** — Lookups now persist `runwayDepartureTime`, `runwayArrivalTime`, `isCargo`, `aerodataboxQualityTags`, `baggageBelt`, `checkInDesk`, plus airport `shortName` and `municipalityName`. Backfill onto existing rows runs through the existing scheduler.
- **DataSource badges for imports** — Flight cards now show `📊 imported_fr24` (orange), `📥 imported_generic_csv`, `↻ imported_roundtrip` so the import provenance is visible at a glance, distinct from `📧 email_import` and `🎫 boarding_pass_scan`.
- **Historical-flight Day select** — The historical-mode date input gained a Day dropdown (Year + Month + Day) so flights with a remembered exact date but no precise time can store as `YYYY-MM-DD` with `depTimeSemantics: 'DATE_ONLY'`. Year-only and Year+Month entry continue to work unchanged.
- **Year-inferred warning badge** — BCBP boarding-pass barcodes carry only a Julian day-of-year (no year ever) and the Tesseract OCR fallback silently substitutes the current year when none is captured. Both paths now mark `departureTime` as inferred so `FlightReviewModal` shows the existing yellow "!" badge with a "Year guessed — please verify" tooltip.
- **Historical flights now feed time-insensitive stats** — Old logbook entries (status `historical`) contribute to airport count, country count, continent count, distance, route counts, seat-class breakdown, and milestone-year — every stat that depends only on date / airport / airline. Time-of-day buckets, layovers, durations, fastest-route km/h, and midnight crossings stay `flown`-only because historical timestamps carry placeholder times that would skew them.
- **`POST /api/v1/import/parse` API endpoint** — External tools and Personal-Access-Token consumers can now run the full FR24 / Generic-CSV import flow over the API: parse → preview → batch-commit. Body is `{source: "fr24", csv}` or `{source: "generic_csv", csv, mapping}`; returns the same `PreviewRowInput[]` shape the browser produces. Read-scope tokens are sufficient (the parser is a pure function, no DB writes). External scripts no longer need to reimplement the RFC-4180 lexer or FR24-specific column mapping.
- **Generic-CSV wizard auto-detection** — Headers matching common aliases (`Flight Date` → date, `Origin`/`dep`/`from` → fromIata, `Destination`/`arr`/`to` → toIata, `Tail`/`reg` → registration, `carrier` → airline, `dpt_local`/`arr_local` → dep/arr-time, …) are pre-mapped on upload, with a green "Auto-erkannt" badge so the user knows what to double-check.
- **Inline CSV sample preview in the wizard** — Each dropdown option shows `header_name (Sample: row-1 value)` plus a muted preview line below selected dropdowns, so cryptic headers like `dpt_local` or `ac_reg` are immediately readable without opening the source file.
- **`backend/scripts/backfillRouteDistance.ts` script** — One-shot Node script that walks all flights with `route_distance NULL` + non-NULL coords, computes Haversine, UPDATEs in batches of 500. Idempotent (`where: { routeDistance: null }`), supports `--dry-run` and `--batch-size` flags. Run via `docker exec TravStats npx tsx /app/backend/scripts/backfillRouteDistance.ts` to backfill legacy NULL distances on any host that imported flight data before v1.5.0-rc.3. Norberts box would populate ~231 NULLs in well under a second.

### Changed
- **Routes-layer rendering** — Maximum line width reduced from 7 px to 4 px so dense maps stay readable. Routes carrying only future scheduled flights render as solid sky-blue arcs (no gradient). Routes with both past and upcoming flights render with a hardcoded two-tier red core (red-400 below median frequency, red-600 at/above) plus blue tips, replacing the heatmap-tinted core. Routes with only flown legs continue to use the frequency-driven heatmap palette.
- **Settings → Import UI** — Redesigned to match the rest of the Settings design system: outer `SectionCard` with title, three sub-cards in a responsive grid (1 / 2 / 3 columns by viewport), `btn-primary` file pickers with 📁 prefix replacing native `<input type="file">` buttons, red-tinted error blocks, green-tinted success blocks.
- **Generic CSV import description** — Reworded so the upload-then-wizard flow is explicit ("Upload a flat per-flight CSV — after upload, a mapping wizard opens so you can match each column to a TravStats field"), avoiding the prior implication that "Wizard" was a button.

### Fixed
- **`durationMinutes` returned 0 / negative numbers on DATE_ONLY rows** — Manually entered round-trips between airports in different timezones (e.g. RAK↔MAD with both sides marked DATE_ONLY) produced -120 / 0 / +120 minute durations because the 12:00 wall-clock placeholder was put through real airport-timezone conversion. The `tzAwareDurationMinutes` type union didn't even include `DATE_ONLY`; a silent cast in the flights list endpoint mapped it to `UNKNOWN` and ran a naive UTC diff. Now returns `null` when either side is `DATE_ONLY`, and the display layer falls back to the great-circle estimate (Iberia RAK→MAD now reads "~1h 35min" instead of "0min" or "-2h"). Closes #106A; closes #103 as a side-effect (PUT was failing on the resulting bad rows).
- **Free-text airline names not resolved to IATA/ICAO** — Manual entries like `"Iberia"` saved with `airlineIata=null` / `airlineIcao=null`, so airline filters, codeshare detection, and stats grouping treated spelling variants as separate carriers. New `resolveAirlineCodes()` does strict-exact lookup (canonical name, IATA code, ICAO code, or explicit alias — no fuzzy substring matching, since "Air India" → "Indian Airlines" is worse than `null`). Wired into `POST /flights`, `PUT /flights/:id`, and `POST /flights/batch` so all importers + manual entry benefit. `airlines.ts` gains an `icao` field on every entry. Closes #106B.
- **Trip auto-assignment skipping the negative-duration leg** — The RAK→MAD return that ended up with `durationMinutes=-120` (cause above) was silently filtered out of trip association on the frontend. Closes #104 as a side-effect of the duration fix.
- **Chronological-order refine now date-granular for DATE_ONLY** — The RC3 `arrivalLocal must not precede departureLocal` check was triggering on same-day DATE_ONLY round-trips because the 12:00 placeholder shifted by airport timezone produced arrUTC < depUTC. Now compares only the date portion when either side is `DATE_ONLY`; cross-day mismatches still rejected.
- **Two-stage-review quality findings on import code** — Several issues caught by the post-implementation review: silent chunk-error swallowing in commit dispatcher (now surfaced), hardcoded English in mapping-wizard labels (now fully i18n'd DE+EN), missing parse-error truncation hint, `useState(initialChecked)` stale-state risk in `PreviewModal`, missing `aria-labelledby` on the modal.
- **`imported_fr24` badge collided with `historical_enrichment` colour** — Both rendered as amber on the same flight card when an FR24-imported flight got enriched. `imported_fr24` now uses orange; the others stay amber.
- **API silently accepted historical flights with `arr_time` before `dep_time`** — The `createFlightSchema` chronological-order refine previously skipped `historical` and `duplicated` statuses, so an overnight flight without day-rollover (Norberts ATL→MUC 1986 case, arrival 8 h before departure) passed through `POST /flights` and `POST /flights/batch` silently. The refine now applies to every status when both times are set; NULL `arrival_time` remains legal for historicals so legitimate date-only bulk imports keep working. Surfaced by Norberts UAT on his Unraid-2 instance.
- **API silently accepted historical / flown flights with future dates** — No year-axis sanity check; future-dated `historical` rows (Norbert had three 2026-dated EI-flight rows from a year-typo at import time) and future-dated `flown` rows were both accepted. Schema now rejects them. `scheduled` with a past date is intentionally NOT a hard reject — the create handlers log `flight_create_scheduled_in_past` for ops review instead, since legitimate edge cases (just-departed manually re-edited rows) exist.
- **`PUT /flights/:id` had no chronological refine at all** — `updateFlightSchema` was missing both the chronological-order and year-axis refines that `createFlightSchema` had since the start. Updates that flipped `arr` before `dep`, or that retroactively re-stamped a historical to the future, all passed silently. The same shared refines now also gate every update payload.
- **`route_distance` was never written by the regular insert paths** — Only Provider lookups (AeroDataBox, AirLabs) populated it; `POST /flights`, `POST /flights/batch`, and `PUT /flights/:id` left it NULL. Result: total km, longest flight, and the distance-tier achievements were blank for every user who hadn't explicitly run a Provider refresh — including all 231 of Norberts flights. Haversine is now computed from the enriched dep/arr coords on every insert and recomputed on `PUT` whenever a coord changes. Same source of truth as `co2Kg`, which had been computing Haversine internally for CO2 but not persisting the distance.
- **Import preview modal redesign** — Flightradar24's CSV exporter uses UTC+4 instead of `Asia/Kolkata` (+5:30) for Bengaluru, so BLR↔non-India flights tripped `duration_mismatch` and got their checkbox disabled by the import preview. The flag is now treated as a soft warning: the row stays selectable and renders the backend-calculated Date/Status normally, with an explicit "Duration mismatch — using calculated arrival from departure + duration" badge. Reported by jay-tau in issue #99 UAT.
- **Import preview modal redesign** — Cancel and Import buttons no longer concatenate as "CancelImport 25 rows"; the modal now uses the same centred-overlay / rounded-card / flex-footer pattern as `DiagnosticExportModal`. After a successful commit it transitions to a "✅ Imported N flights" success state with a link to the flights list, instead of silently closing (which read like the import had failed when the user re-opened it and saw the just-imported rows flagged as `exact_match` duplicates).
- **Generic-CSV wizard UX** — Persistent status footer replaces the silently-disabled Continue button: "Pflichtfelder fehlen: Datum, Von IATA" in red when blocked, "Alle Pflichtfelder zugeordnet · 3 optional übersprungen" in green when ready. Required and Optional fields are grouped into separate sections. Collision detection: the same CSV column mapped to two TravStats fields turns both dropdowns red and blocks Continue until resolved.
- **i18n plural keys for the import preview** — `commit` / `imported` / `failed` migrated from the legacy `_plural` suffix (broken in i18next v23) to `_one` / `_other`, so "Import 2 row" / "✅ 2 Flug importiert" pluralises correctly.
- **FR24 import: arrival time stored 1h30 off on BLR-international (rc.6)** — RC.2 made `duration_mismatch` rows selectable but stored `arr_utc = dep_utc + (broken) Duration`, inheriting FR24's wrong Bengaluru offset (UTC+4 instead of `Asia/Kolkata` +5:30) on the very rows the flag was meant to warn about. RC.6 anchors `arr_utc` on `arr_local + arr_tz` — the authoritative signal — and uses Duration only to disambiguate the calendar day on trans-meridian flights via a best-day-shift search (0/+1/+2/+3 days from dep date). The `duration_mismatch` flag still fires for transparency when even the best day-shifted candidate is more than 30 min off the duration-derived target. Reported by jay-tau in issue #99 RC.2 UAT (BLR→LHR / BA119 / AF191 round-trip showed -1h30 / +1h30 / -1h30 drift). The trans-meridian LAX→SYD test case had hardcoded `delta = 14h55`, which embedded FR24's stored Duration; the real wall-clock flight time is 13h55 (LAX PDT → SYD AEDT, both in DST on 2023-03-22) and the test was updated to match the correct semantics.
- **Sticky preview-table header bled through scrolling rows (rc.6)** — `<thead>` in `PreviewModal` lacked a stacking context, so rows with rgba warning/error backgrounds painted over the column headers when the preview overflowed. Added `z-10` to the sticky thead.
- **Trip auto-detection orphaned DATE_ONLY return legs (rc.7)** — `detectTrips` reads flights ordered by `departureTime asc`. For manually entered DATE_ONLY round-trips, default timestamps don't reflect within-day chain order — Norberts 2009-09-21 return-day stored RAK→MAD with `dep=12:00 UTC` and the connecting MAD→MUC anchor with `dep=10:00 UTC`, so a raw-timestamp sort placed the anchor BEFORE the return leg. The home-loop walker then closed the loop early and orphaned the return (issue #104). The earlier `durationMinutes` fix (#106A, rc.4) cleaned up presentation but didn't change DB sort order, so the RC.4 changelog entry crediting this as a side-effect of #106A was premature. RC.7 adds `chainCoherentSort`: within each calendar date, Kahn's topological sort using arr→dep airport matches as chain edges, with `departureTime` as a stable tiebreak between unrelated same-day chains. Single-flight days and already-timestamp-correct days are unaffected; multi-day order is preserved. The home-loop and continuity heuristics now see Norberts MUC↺RAK return leg in the right place and capture all 4 flights.

### Tests
- **E2E Playwright critical paths for all three importers** — End-to-end coverage for FR24, Generic-CSV (full mapping-wizard flow), and Round-Trip imports against a fresh dev DB. 5 new tests, suite now 90 across 6 files.
- **Regression tests for scheduled-flight leakage** — Locked-in coverage that scheduled flights cannot trigger general achievements (`flights_count`, `airports`, `countries`, `continents`, …) or contaminate `highestAirport` / similar unique stats. The engine architecture filters at the SQL layer; these tests prevent silent regressions.
- **Bug-slot unit tests** — 32 new tests for the historical-date shape discriminator (`useFlightForm.dateShape.test.ts` covering 4 storage shapes), 7 for `bcbpToScanResult`, 4 for Tesseract `extractDateTimes`, plus 10 for historical-flight stats inclusion. Backend 607/607, frontend 348/348.
- **RC2 regression coverage** — 6 new wizard tests (auto-mapping exact + alias, missing-required hint, collision detection, sample rendering, cancel), 3 preview-modal tests (soft-warning row stays importable, success-state transition, error-state recovery), 1 backend lock-in test for the `duration_mismatch` BLR-route contract using jay-tau's exact numbers, and 11 backend tests for the new `/import/parse` route + parsers (parser unit tests + supertest integration: 401 unauth, 200 happy paths for both sources, 400 malformed body, 400 oversized body). Backend 619/619, frontend 357/357.
- **RC3 API-hardening regression coverage** — 5 schema tests (G1 chronological order for historicals, G2/G3 year-axis sanity for historical/flown, G5 same refines on update payloads), 3 backfill-script tests (idempotency, NULL-coord skip, Haversine sanity for short/long-haul/trans-Tasman), plus 5 implicit deltas in pre-existing flight-route tests. Backend 632/632.
- **RC4 data-integrity coverage** — 13 new tests (`dataIntegrity.rc4.test.ts`) covering the `tzAwareDurationMinutes` DATE_ONLY return-null path (5 tests), the strict-exact airline resolver (8 tests including the defensive "Indian Airlines must NOT resolve to AI/Air India" lock-in), and the granularity-aware chronology refine (4 tests). Existing G1 hardening test message pattern generalised for the new "arrival date must not precede departure date" wording. Backend 652/652, frontend 357/357.

### Database
- **One new migration** — `20260508120000_add_aerodatabox_extended_fields`: 9 additive `ALTER TABLE ADD COLUMN` statements for the AeroDataBox extended fields (Flight: `runwayDepartureTime`, `runwayArrivalTime`, `isCargo`, `aerodataboxLastUpdatedUtc`, `aerodataboxQualityTags`, `baggageBelt`, `checkInDesk`; Airport: `shortName`, `municipalityName`). Zero-downtime safe, idempotent.

### Docs
- **Roadmap restructured** — v1.5 (silent field capture) and v1.6 (importers) merged into a single V1 finale; v1.7–v1.9 (social / insights / PWA) moved into V2 as v2.3–v2.5.

## [1.4.0] - 2026-05-04

### Added
- **AeroDataBox as a third flight-lookup provider** — Closes the gap that AirLabs and Aviationstack-Free leave open: historical lookup for any date in the last 365 days, plus terminal / gate / aircraft registration / Mode-S / operating-vs-marketing carrier on codeshares. Wired into the cascade as a tertiary fallback for out-of-live-window queries and historical enrichment. RapidAPI BASIC free tier (600 API-units / month).
- **Bulk historical refresh of existing flights** — Settings → API Keys gains a "Refresh all flights in 365-day range" card under the AeroDataBox key. Backfills tail number, Mode-S, codeshare metadata, distance, airline IATA/ICAO on flights entered before this provider was wired up, never overwriting curated values. A confirmation modal shows how many API calls the run will cost. Disabled on the demo account so shared keys aren't drained by tutorial sessions.
- **Per-provider quota indicators with capability badges** — Each provider's quota is surfaced honestly on the API Keys page: AeroDataBox shows the live `X/600 API units` (primary) plus the secondary HTTP-request counter; AirLabs / Aviationstack-Free are labelled "provider doesn't expose quota — free tier ~1000/month"; OpenSky says "no monthly limit — IP-based rate-limit only". A "365-day lookup" capability badge marks AeroDataBox as the historical-fallback workhorse so it's clear at a glance which provider does what.
- **Persisted tail number, Mode-S code, distance and codeshare metadata** — Flights enriched via lookup now carry the operating registration, the 24-bit Mode-S hex identifier, the operating airline when it differs from the marketing carrier, the great-circle distance in km, and airline IATA/ICAO. Feeds the new aircraft-hulls ranking and per-tail profile pages.
- **Aircraft hulls ranking + per-tail profile pages** — Stats → Advanced gains a leaderboard of the registrations you've flown most often. Each tail number opens its own page (`/aircraft/:reg`) showing type, flights flown, total distance, and the timeline of every flight on that hull. Works against any flight with an `aircraftRegistration` (provider-sourced or manually entered).
- **Currency input accepts any ISO 4217 code** — The currency picker on flight and cost forms is now a styled combobox that takes any three-letter ISO 4217 code, not just the hardcoded shortlist. Filters as you type, falls back to the raw code for exotic currencies, surfaces the symbol when known. Closes #100.
- **Airline logos in flight cards and trip sidebar** — Each carrier now renders its logo next to the airline name, served from the Daisycon free aviation-logo CDN. Falls back to a letter-box monogram (LH, BA, …) for carriers not in the CDN — no broken image icons.
- **Bulk export with `GET /flights?all=true`** — Skips the default 500-row cap so a script or AI agent can pull a full account snapshot in one call. Bounded only by the per-PAT rate-limit bucket; cookie-session callers still default to 100.
- **Round-trip-fair Excel export** — `.xlsx` export now carries every editable field (43 columns), real numeric and date cells (instead of strings), an autoFilter on the header row, and a frozen header. Re-importing the same file is loss-free across all boarding-pass and email-import metadata that the import side already accepts.

### Fixed
- **AeroDataBox quota indicator showed 2400 instead of the actual 600** — RapidAPI sends two independent rate-limit counters: `X-RateLimit-API-Units-*` (the real BASIC tier quota = 600/month) and `X-RateLimit-Requests-*` (a separate HTTP-request counter ~4× larger and irrelevant for plan budgeting). The indicator was reading the latter, so BASIC-tier users saw a misleading "2400 left" headroom. Now reads API-Units as primary and surfaces the HTTP-request count as a secondary detail only.
- **Closed and decommissioned airports missing from the seed** — The seeder filtered out OurAirports rows where `type='closed'`, excluding every decommissioned IATA code (BER's predecessor SXF, TXL, etc.). Older flights re-imported via Excel or boarding-pass scan failed to enrich because the lookup couldn't find the code. Closed airports are now seeded on first install, and a one-shot boot-time backfill (`backfillClosedAirports.ts`) adds them to existing installs without re-running the full seed.
- **API-key test endpoints rejected masked-input retests** — Saving a key, navigating away, returning and clicking "Test" sent the masked display value (`••••abc1`) to the test endpoint instead of the persisted key, so the test always failed with 401 even though the saved key was valid. Test endpoints now fall back to the persisted key when the input is empty or contains the mask placeholder.
- **Past + scheduled flights on the same airport pair drew two overlapping arcs** — Routes carrying both flown and scheduled legs rendered two separately-tinted arcs at the same `arcHeight`, producing a visible Z-fight (Madagascar regression). The route layer now collapses both onto a single canonical arc carrying both flight IDs; the "scheduled" signal lives in a fragment-shader-driven gradient on that same arc rather than a separate midpoint marker.
- **`PUT /flights/:id` silently dropped boarding-pass and email-import fields** — Field-level updates for `seatNumber`, `boardingGroup`, `gate`, `terminal`, `bookingReference`, `ticketNumber`, `baggageAllowance`, `frequentFlyerNumber`, `bookingClassLetter`, `coPassengers`, and `dataSource` were accepted by the Zod schema but discarded by the route handler. Editing any of these in the UI or via API now persists. Clients can also explicitly override `depTimeSemantics` / `arrTimeSemantics` so a `UTC` semantics flag beats the implicit default during boarding-pass re-imports.
- **Health check missing under `/api/v1/health`** — Reverse proxies that pin the `/api/v1/*` prefix could not reach the unprefixed `/health` route. Both paths now respond with the same payload.
- **Display version drifted across env, image, and runtime** — `APP_VERSION` was duplicated across the compose env, the build-arg, and the runtime export and could silently desync — last seen on rc.1 where System-Info showed `1.3.0` on a host whose compose was not bumped. The runtime now reads `backend/VERSION` from disk on boot as the single source of truth, strips RC suffixes (`-rc.N`, `-security-rc.N`, `-beta`, `-alpha`) from the user-facing display version, and exposes both raw `buildVersion` and tidy `appVersion` via `/api/v1/version`. The compose `APP_VERSION` env var is removed.
- **Empty UI after every container restart on Unraid + similar setups (rc.5 boot-race fix)** — supervisord launched nginx and the Express backend in parallel. nginx accepted `/api/*` immediately and proxied to a port where Express wasn't listening yet, so every browser open during the 30-90 s migration + airport-backfill window cached `502 / no live upstreams` and never refetched until the user hard-reloaded. Two-layer fix: (1) supervisord now starts nginx via `scripts/wait-then-nginx.sh`, which polls backend `/health` and only `exec`s nginx when ready (5-minute fallthrough so the container never hangs forever); (2) the frontend Axios clients gained a gateway-retry interceptor that retries idempotent verbs on 502/503/504 / `ERR_NETWORK` with exponential backoff (3 attempts, 0.5/1/2 s) so any future short backend outage heals on its own. Docker `HEALTHCHECK --start-period` bumped 40 s → 180 s to absorb the longest observed first-boot path (closed-airport backfill). Verified end-to-end on a fresh local stack: 0 `no live upstreams` events in `nginx error.log`, port 80 cleanly held closed for the entire boot window, then opened with HTTP 200.

### Changed
- **Routes-mode "scheduled" indicator now lives inside the arc, not as a separate dot** — Earlier 1.4.0 RCs marked routes carrying an upcoming flight with a small cyan-bordered scatter dot at the arc midpoint. The dot read as a foreign visual element on a heatmap-dense map. Replaced by an in-arc symmetric gradient: the same single arc fades from sky-blue at both ends through a heatmap-coloured core. Implemented via an `UpcomingArcLayer` that subclasses `ArcLayer` and injects ~10 lines of fragment-shader code at `fs:DECKGL_FILTER_COLOR`, using the existing `geometry.uv.x` segment ratio. Single line per route, blue-leaning baseline so an upcoming-route arc reads as primarily scheduled with a heatmap-tinted core.
- **Currency picker is a styled combobox** — Replaces the native `<datalist>` with a custom dropdown matching the rest of the form styling. Same accept-any-ISO-4217 behaviour, just visually consistent across browsers (native `<datalist>` rendered very differently in Firefox / Chrome / Safari).
- **Email-import regex warning copy is calmer** — The "automatic import is still limited" warning under email import now leads with a clearer title, separates the explanation from the recommendation with a paragraph break, and points at the Ollama setup more directly.

### Security
- **Per-minute burst limiter stacked on `/airports/search`** — The autocomplete endpoint is unauthenticated by design (signup-flow needs it before credentials exist) and was already capped at 100 / 15 min. A scraper could still fire ~100 requests in seconds before the sustained ceiling tripped; a 30 / min burst limiter now layers on top so abusive enumeration is bounded both per-second and per-window. PAT-authenticated callers retain the 10× multiplier on both buckets.
- **Closed 14 Dependabot alerts on the frontend lockfile** — axios bumped from `1.15.0` to `1.16.0` (declared `^1.15.2`), sweeping up 13 alerts (3 high, 9 medium, 1 low) covering prototype-pollution gadgets, CRLF injection, NO_PROXY bypass, and header injection. Backend was already on the safe range; this fix syncs the frontend. `uuid` is forced to `^14` via an override (transitive via `exceljs@4.4.0` was on `8.3.2`) — our usage only hits `uuid.v4()` so the buffer-bounds-check vuln in `v3/v5/v6` was not actually reachable, but the override is preferable to dismissing.

### Docs
- **OpenAPI spec scope clarified** — The published spec is the curated stable public surface (flights, trips, airports, stats, parsers, batch import, tokens), not 1:1 with the 162-route internal API. The spec description now states this explicitly and invites users to open an issue if they need a route promoted.

### Database
- **Three new migrations** — `20260503080738_add_aerodatabox_api_key` (admin- and user-level `aerodatabox_api_key` columns), `20260503154328_add_aircraft_provenance` (per-flight `aircraft_registration`, `aircraft_mode_s`, `airline_iata`, `airline_icao`, `distance_km`, `is_codeshare`, `operating_airline`, `callsign`, `status_override`), and `20260504180000_user_is_demo` (`users.is_demo` flag). All additive, idempotent (`IF NOT EXISTS`), zero-downtime safe.

## [1.3.0] - 2026-05-01

### Removed
- **Light mode and the in-app theme switcher** — TravStats now boots dark-only across the App, the marketing site, and the wiki. The Settings → Display section no longer offers a theme toggle, and `themeStore.isDarkMode` / `toggleDarkMode` / `setDarkMode` were dropped (only `mapTheme` is persisted now). Rationale: every map, globe, heatmap, and chart was tuned exclusively against the dark token set, so the light variant was always a second-class surface. Collapsing to one mode tightens contrast, removes the toggle CLS, and kills the dark/light branches in 16 components.

### Changed
- **Brand amber rebalanced and per-domain colour tokens introduced** — The primary accent moved from `#e8a045` to `#f0a947` for stronger dark-surface contrast (8.40 : 1 against `#0d1117`). A new `--domain-flight … --domain-ferry` token set covers the nine planned travel domains (flight, cruise, hotel, POI, train, hike, bike, road, ferry) with WCAG-AA contrast on dark, each with `-soft` and `-locked` variants for upcoming-feature gating. App and TravStatsWeb share the same token system; the source of truth lives in `TravStatsWeb/brand/BRAND.md`.

### Added
- **Public REST API with Personal Access Tokens** — External tools (AI agents, scripts, integrations) can now reach every flight, trip, airport and stat the web UI shows. Mint a PAT under *Settings → API Tokens*, then send `Authorization: Bearer ts_pat_…` on any authenticated endpoint. Scopes (`read` / `write` / `admin`) are enforced at middleware level; the plaintext token is shown exactly once on creation and stored only as a bcrypt hash. Per-token rate-limit buckets (`pat:<id>`) keep an aggressive automation script from locking the owning user out of the web UI.
- **OpenAPI 3.0 spec + Swagger UI** — Auto-generated from the existing Zod validation schemas via `zod-to-openapi`. Browse it at `/api/v1/docs` (Swagger UI) or fetch the raw JSON at `/api/v1/openapi.json`. Covers flights CRUD, trips, airports, stats, parsers (email + boarding pass), batch import, and token management.
- **Boarding-pass-aware flight merge** — `POST /flights?merge=true` now fills missing fields on an existing same-day flight from incoming data without ever overwriting curated values. Boarding-pass scans, email-confirmation imports, and re-imports of partially-entered flights enrich the existing row in place instead of producing a duplicate. The dashboard surfaces a *flightMerged* toast that reports how many fields were filled.
- **Excel/CSV round-trip import + export** — Export flights as `.xlsx` with a stable column layout, edit them in Excel, re-import the same file: rows with an `id` column update existing flights, rows without create new ones. The shared CSV parser (`parseImportFile`) now handles JSON, CSV, and XLSX through the same pipeline.
- **DATE_ONLY and UNKNOWN time semantics for historical flights** — Bulk imports of decades-old flights frequently know only the date, not the wall-clock time. The `flights.dep_time_semantics` / `arr_time_semantics` columns introduced in 1.2.0 now accept `'DATE_ONLY'` and `'UNKNOWN'` as first-class values on every write path (`POST /flights`, `POST /flights/batch`, `PUT /flights/:id`). The frontend hides the meaningless `00:00` time on the calendar, in the trip-details sidebar and in CSV exports for `DATE_ONLY` rows; durations fall back to a great-circle estimate (`distance / 800 km/h + 15 min overhead`, formatted as `~3h 20min`) so date-only flights still contribute realistic numbers to the Advanced-Stats aggregates instead of zero. Flight-time UI distinguishes estimated (`~`) vs measured durations.
- **Agent-driven bulk-import API surface** — Three pieces lift the ceiling for AI-agent automations that import on a user's behalf. (1) Per-PAT rate-limit quotas are now 10× the cookie-session quota for airport search, single-flight create, and batch create — a sustained 152-flight import no longer trips the per-user-bucket on the second iteration. (2) `POST /admin/users` lets an admin-scoped PAT provision new accounts programmatically (Zod-validated, bcrypt-hashed password, `MAX_USERS` enforced). (3) `POST /admin/airports/reseed` re-runs the OurAirports seeder against an existing instance (`force: true` bypasses the "already populated" gate) so an agent can fill in closed/historical airports that an older OpenFlights seed missed; `GET /admin/airports/seeding-status` reports progress.
- **Trip auto-detection (`POST /trips/detect`)** — A 3-stage heuristic groups flights into trips without ever overwriting curated data. (1) PNR-cluster auto-link picks up shared booking references, capped at a 30-day span so frequent-flyer IDs like a surname don't merge a year of unrelated travel into one mega-trip. (2) Home-loop proposes trips that depart from and return to the user's home airport (uses `users.home_iata` history so prior home-airport moves are respected), grouped via the multi-PNR pattern that emerged in real test data (e.g. one Hawaii trip whose outbound and inbound legs were booked separately). (3) Continuity sliding-window proposes trips for unanchored flight chains where consecutive legs match IATA hops within 7 days, with a 200 km open-jaw tolerance for "fly into Berlin SXF, take the train, fly out from BER". `dryRun: true` returns proposals without writing, `dryRun: false` commits the auto-link round and removes orphan trips atomically. The `<DetectTripsBanner>` on the Trips tab calls the dry-run on mount and shows a single *Link All* CTA when something is found.
- **Per-leg edit, duplicate, and unlink actions in the trip-details sidebar** — Each leg row now reveals icon actions on hover: edit (✏️), duplicate, and remove-from-trip (minus-circle). The trip header itself gained edit / delete actions next to the title. DE and EN strings added (`trips.removeFromTrip`, `toasts.flightRemoved`, `toasts.flightRemoveError`, `common:buttons.duplicate`).

### Fixed
- **Re-importing a boarding pass for an already-entered flight created a duplicate (issue #84)** — Different scan paths emit the same flight as `LH 123`, `LH123`, `lh123` etc. The duplicate-check on `POST /flights` compared raw strings, so re-importing slipped past as a "different" flight. Flight numbers are now normalised at the schema boundary (uppercase, no whitespace) and the duplicate-check fetches all of the day's candidates and compares normalised in JS, so legacy non-canonical rows in the DB still match.
- **OpenAPI spec drifted from the actual route surface** — Corrected `/airports` → `/airports/search`, `/stats` → `/stats/summary`, swapped `PATCH /flights/{id}` for the actual `PUT`, and added the missing `GET /flights/{id}` endpoint. The Swagger UI now matches what the server serves.
- **API Tokens settings page flickered + threw an i18n error** — `useCallback`'s dependency array contained the i18n `t` function, whose identity is not stable across renders, so the reload effect re-fired every render. Empty-deps + an `eslint-disable` comment that explains why. Also corrected `t("common:loading")` (which returns an object, not a string) to `t("common:loading.title")`.
- **Quick-start `docker compose up` restart-looped on a clean Linux host (issue #85)** — Both `db` and `app` services dropped `cap_drop: [ALL]` without re-adding the capabilities the upstream Postgres / Node entrypoints actually need. `db` now also adds `DAC_OVERRIDE` so the post-chown `find` in the Postgres entrypoint can traverse `$PGDATA`; `app` adds `DAC_OVERRIDE`, `FOWNER`, `SETUID`, `SETGID` so the entrypoint can set up `/app/data/secrets` and drop privileges to non-root before starting Node. Verified with the verbatim README quick-start on a freshly created named volume.
- **File logging silently degraded to console-only on first boot** — Boot-time scripts (airport seed, achievement registration) run with the entrypoint's UID and create `/app/data/logs/app.log` owned `root:root`. The supervised backend then runs as `node` (uid 1000) and could not append to those existing files (`EACCES`), so the Pino file transport disabled itself and only `docker logs` had any record of runtime activity. The entrypoint now does a final `chown -R node:node /app/data` after all root-phase scripts finish, so the long-running backend can persist `app.log` / `error.log` / `http.log` from the very first boot.
- **README quick-start `curl` URL 404'd (issue #85 side note)** — `raw.githubusercontent.com` is case-sensitive and the default branch is `Main`, not `main`. Corrected the example URL.
- **CI lint failed with "rule react-hooks/exhaustive-deps not found"** — Two competing flat-config files (`eslint.config.js` + `eslint.config.mjs`) lived side by side; the `.js` variant takes precedence in ESLint 9 flat-config resolution but did not register `eslint-plugin-react-hooks`, while the `.mjs` (which did) was silently shadowed. Consolidated into a single `eslint.config.js` with the plugin wired and `rules-of-hooks` enforced; removed the dead `.mjs`.
- **Stale "Modus" reference in Settings → Display** — The section description still mentioned "Modus" / "mode" after the dark/light toggle was removed, and the orphan `settings.display.theme.*` i18n sub-tree (Light Mode, Dark Mode, lightDescription, darkDescription, autoSave, active) lingered in both DE and EN translation files. Description tightened to "Sprache, Zeitzone sowie Datums- und Zeitformat zentral steuern" / "Control language, timezone, and date/time formats centrally" and the dead keys removed.
- **Scheduled flights drew the past route's heatmap colour when an airport pair had also been flown before** — `routesLayer` keys routes bidirectionally (`ADD-TNR === TNR-ADD`), so a 2026 trip to Madagascar whose airport pair already carried 2024 flown legs collapsed all four flights into one mixed route, fell through to `getHeatmapColor`, and rendered red instead of cyan. The layer now splits scheduled and past flights into separate aggregations and emits two distinct arcs on the same airport pair when both exist — past flights keep the heatmap colour (so frequent routes still pop), and the scheduled arc stays cyan so the "this is upcoming" signal survives the mix. Pure-scheduled and pure-historical routes are unchanged.
- **Ollama text parser silently invented years for booking PDFs that omitted them** — Some travel agencies (e.g. Berge & Meer) print only "Mo 18 Mai 22:05" with no year. Two consecutive imports of the same PDF produced different years (April → correct 2026, May re-import → ghost 2024 flight) because the system prompt had no current-date anchor and its example date hardcoded `2024-06-10`, priming the model toward the past. The prompt now injects today's date as a year-resolution reference, instructs the model to prefer the next future occurrence when the source omits a year, and uses a current-year placeholder in the schema example. The model also returns an explicit `inferredFields` array per leg listing every field it had to guess; the import-review modal renders a yellow `!` badge next to those fields with a "please verify" tooltip so silent year hallucinations stop landing in the DB unnoticed.
- **Negative and zero durations on historical bulk-imported flights** — Date-only rows previously stored `12:00 local` as a placeholder for both departure and arrival, which converted to different UTC instants for east-bound legs (`MUC → HNL` etc.) and produced negative wall-clock durations of −3 h to −9 h. Importers now write `arrUtc = depUtc` for `DATE_ONLY` rows so `arrival − departure = 0`, and the duration helper (`getFlightDuration`) prefers a great-circle estimate over a zero/negative measured delta. Existing rows with semantics `'DATE_ONLY'` were retroactively normalised by the boot-time backfill.
- **Same-day flight legs sorted out of order on Hawaii-style hops** — Trip-details sidebar showed `HNL → SFO` before `OGG → HNL` on the same calendar day because `HNL → SFO` was tagged `DATE_ONLY` (12:00 UTC placeholder) while `OGG → HNL` had a real 20:58 UTC departure, and pure timestamp sort got it backwards. Replaced the fragile pairwise swap with a topological chain builder over each contiguous same-day window: pick the head leg whose `depIata` is not used as anyone else's `arrIata`, then extend by `prev.arrIata === next.depIata`. Falls back to timestamp order on disconnected windows so disjoint same-day chains stay stable.
- **Round-trip names picked an arbitrary mid-trip airport** — `MUC – OGG · Dec 2025` for a Hawaii return-trip looked nonsensical because the title used the last-arrival IATA. Trip naming now detects round trips (`origin === lastArrival` or `home_loop` source) and uses the great-circle furthest waypoint with a `↺` separator (`MUC ↺ HNL · Dec 2025`); one-ways keep the `MUC – HNL` en-dash form.
- **Trash icon on a trip leg deleted the flight forever** — The icon implied "remove from trip" but called `flightsApi.delete` and wiped the row from the database. Now uses `tripsApi.assignFlights({ action: "remove" })` which only clears the `tripId` association, plus a minus-circle icon to reinforce unlink semantics. The flight stays — it just goes back to the unassigned bucket where the next detection run can re-pick it up.
- **Sidebar didn't refresh after unlinking a leg** — The unlink succeeded on the backend but the sidebar kept showing the removed leg until the user navigated away and back. Selection update now uses `showDetails(remaining, "trip-details")` instead of `setSelection`, which preserves `detailMode` instead of dismissing the sidebar.
- **Trip auto-commit could leak orphan trips on concurrent enrichment** — If a parallel enrichment job moved a flight into a different trip between proposal generation and commit, `commitProposals` could write a trip with one or zero remaining flights. Added a TOCTOU guard: `updateMany` is filtered on `tripId: null` and the result count re-checked; if fewer than 2 flights are still unassigned, the trip + booking inserts are rolled back via `tx.delete`. Also set explicit `{ maxWait: 5_000, timeout: 30_000 }` on the `$transaction` so 50+ trip commits don't trip the default 5-second ceiling.
- **Backend default `display` settings overrode browser locale detection on first login (issue #87)** — Fresh accounts on an English browser were flipped to German UI the moment `loadRemoteSettings()` fired, because the shared `defaultSettings` served when no `UserSettings` row existed yet hardcoded `language: 'de'` / `timezone: 'Europe/Berlin'` / `dateFormat: 'DD.MM.YYYY'`. The frontend's top-level spread merge then replaced the entire `display` object, wiping the locally-detected `en`. Two-part fix: (1) backend seed defaults no longer carry `language`, `timezone`, or `dateFormat` — only `theme` and `timeFormat` (the client knows the user's browser locale, the server doesn't). (2) `loadRemoteSettings()` now does a per-group shallow merge so a remote payload with missing keys preserves the locally-detected values. As a follow-up the frontend Zustand store also derives its initial defaults from `navigator.language` / `Intl.DateTimeFormat().resolvedOptions().timeZone` (en-US → `MM/DD/YYYY`, en-* → `YYYY-MM-DD`, else `DD.MM.YYYY`) instead of hardcoding German.
- **Frontend formatting drift broke CI** — 16 files had Prettier formatting that diverged from `frontend/.prettierrc`. CI's `format:check` step caught it but local edits had bypassed the post-tool-use Prettier hook for those files. Ran `prettier --write` across `src/**/*.{ts,tsx,css}` to converge.

### Security
- **Token mutations are explicitly cookie-only** — `POST/DELETE /settings/tokens` reject Bearer-token requests; a leaked PAT cannot self-renew or mint admin tokens.
- **Admin endpoints require an `admin`-scoped PAT** — Even when the owning user has `isAdmin=true`, an automation script can only reach `/admin` when its token was minted with the `admin` scope. Account-level admin no longer implicitly elevates token scope.
- **PAT write-scope enforcement on every mutation route** — `requireWriteScope` was defined in the auth middleware but never mounted on any router, so a `read`-scoped PAT could create / update / delete flights, trips, settings, parser templates, achievements, analytics events, and uploads. The guard is now method-aware (`GET/HEAD/OPTIONS` pass through unconditionally) and wired into all mutation routers — read tokens are now genuinely read-only. Cookie sessions are unaffected.
- **DoS vector on `POST /admin/airports/reseed` closed** — A single admin-PAT could fire unlimited reseed requests, each kicking off a multi-second IO-bound seed against OurAirports. New `adminReseedLimiter` caps it at 3 reseeds per hour per user/IP (`ADMIN_RESEED_*` constants in `RATE_LIMITS`).
- **Stale `seedingInProgress` flag could permanently lock out reseeding** — The in-memory boolean was set true on start and cleared on completion, but a process crash mid-seed left it stuck and every subsequent reseed call short-circuited with "already running". The flag is now reconciled against `airportSeedingStatus` on each call: if no `running` row exists, the in-memory flag is cleared.
- **Defense-in-depth `requireWriteScope` on the admin router** — Even though `requireAdmin` already blocks any non-admin-scoped PAT, the admin router now also runs `requireWriteScope` at the router level. Future-proofs against an intermediate scope (e.g. `admin-read`) being introduced — admin GETs still pass for read-style tokens, mutations stay gated.

### Tests
- **+38 tests** — 6 for the API-token utility (lookup hash collision-resistance, bcrypt verify, prefix regex, plaintext format), 6 for the OpenAPI spec build (paths, security scheme, BearerAuth, methods on `/flights/{id}`), 2 for flight-number normalisation, 3 for the boarding-pass merge utility, plus 21 for the `requireWriteScope` middleware (cookie passthrough, read-token GET/HEAD/OPTIONS pass, read-token POST/PUT/PATCH/DELETE 403, write/admin-token full passthrough on every method).
- **+14 tests for trip detection and DATE_ONLY duration** — 10 unit tests covering `tripDetectionService` internals (PNR clustering, 30-day span cap, cancelled-duplicate suppression, home-loop with/without history, continuity 7-day window, gap-break, 200 km open-jaw); 4 unit tests covering `getFlightDuration` (real `UTC` time, `DATE_ONLY` estimate, missing time falls back to estimate, negative-delta guard).
- **+5 tests for `sortFlightsByLegOrder`** — chronological pass-through, 2-leg DATE_ONLY/timed reversed pair, 3-leg same-day chain repair, no-swap when current order already chains, and disjoint same-day chains keeping timestamp order.

## [1.2.1] - 2026-04-28

### Fixed
- **Flight number lookup returned today's schedule for past or future dates (issue #82)** — `/api/v1/flight-lookup/:flightNumber` previously went straight to AirLabs `/schedules`, whose free tier silently ignores `dep_date` and returned today's data for any requested date. The route now consumes the full provider cascade and reports three distinct unavailable reasons: `no_provider` (free tier can't serve non-today and no Aviationstack key is configured), `no_match` (live lookup empty — likely a typo), and `no_match_api_gap` (provider returned today's schedule for a non-today request — the issue-#82 symptom). The frontend keeps the user on the input step with a reason-specific error message instead of jumping silently into manual entry. The OpenSky-30-day-historical claim was dropped from the user message and from the in-form tooltip — the underlying `/api/flights/callsign` endpoint does not exist (404), so OpenSky now stays in the live cascade only.

### Tests
- **+9 regression tests for `lookupFlightWithHistorical`** — Cover the three unavailable reasons, the smoking-gun heuristic for "today's schedule for non-today" responses (yesterday / tomorrow / far past), and the live-window happy path.

## [1.2.0] - 2026-04-27

### Fixed
- **Reminder emails for manually-entered flights fired 1–2 h off** — Manual entries, parser results, and CSV imports stored departure/arrival times as wall-clock-as-fake-UTC, while API-imported flights stored real UTC. The reminder scheduler compared `now` (real UTC) to a mixed-convention `departureTime` column, so the 24-hour-before email triggered an hour early in CET, two hours early in CEST, etc. All flight create/update paths now write canonical real UTC built from a `(local datetime, IANA timezone)` pair, and the scheduler normalises legacy rows on the fly via the airport timezone before the ±15-minute window check.
- **Schema drift between `prisma/schema.prisma` and prod migrations reconciled** — The drift file now uses idempotent `IF EXISTS` drops, backfills NULLs before flipping NOT NULL, and guards every foreign-key add. Previously a fresh deploy could fail mid-migration on rows with NULL `has_live_tracking` or `historical_enrichment_*` flags.

### Changed
- **Flight write contract is now `(local, timezone)` pairs** — `POST /flights`, `PUT /flights/:id`, and `POST /flights/batch` no longer accept ISO datetime strings. Clients send `departureLocal` (`YYYY-MM-DDTHH:mm`) plus `depTimezone` (IANA, e.g. `Europe/Berlin`); the server runs `fromZonedTime` to derive the canonical real-UTC `Date` it stores. The update endpoint also rejects raw `departureTime` / `arrivalTime` fields. Frontend submit, edit, review, duplicate, and CSV import flows were updated end-to-end.
- **Time-semantics tagging during the cutover** — Every new write is tagged `dep_time_semantics = 'UTC'`. Existing rows default to `'UNKNOWN'` and are left unchanged by the normaliser until the backfill script reclassifies them as `'UTC'` (API-sourced) or `'LEGACY_FAKE_UTC'` (manual/parser-sourced, converted in place). `tzAwareDurationMinutes` short-circuits when both sides are UTC and only re-interprets when both are explicitly LEGACY.

### Added
- **In-app update banner** — A pulsing yellow `Update` badge appears next to the wordmark in the header whenever a newer stable GitHub release exists. Click it to open a popover with the version number, release date, a 600-character preview of the release notes, a link to the full notes on GitHub, and an `Ignore this version` action that hides the badge until an even newer release ships. Backend caches the GitHub query in process memory for 6 hours, filters out RC and pre-releases, and degrades to "no banner" when the GitHub call fails — so air-gapped or firewalled instances stay quiet rather than throwing errors.

### Removed
- **Floating `?` help icon on the dashboard** — Removed the corner help button and its three orphaned i18n keys (`dashboard:map.help2d/help3d/helpExpanded`). It only said "Switch between 2D and 3D" — information that's already visible from the mode selector.

### Database
- **`flights.dep_time_semantics` / `arr_time_semantics`** — Two new `TEXT NOT NULL DEFAULT 'UNKNOWN'` columns tag the storage convention of each row during the cutover. Migration is additive and idempotent (`IF NOT EXISTS`); zero-downtime safe.

### Migration
- **Backfill runs automatically at container boot** — `docker-entrypoint.sh` invokes `dist/scripts/backfillTimeSemantics.js --apply` once migrations succeed, so existing self-hosted instances pick up the fix on the first start of `1.2.0` without any manual SSH step. The script is idempotent (`WHERE dep_time_semantics='UNKNOWN' OR arr_time_semantics='UNKNOWN'`), so subsequent boots return zero rows and finish in milliseconds. Disable with `TIMESEMANTICS_AUTO_BACKFILL=false` if you prefer to run it by hand. Manual invocation remains available: `node /app/backend/dist/scripts/backfillTimeSemantics.js [--apply]` (defaults to dry-run). On the dev DB the backfill classified 160 flights (37 UTC, 123 LEGACY converted, 0 errors); production numbers will differ per install.

### Tests
- **+37 tests covering the new contract** — 11 covering `legacyFakeUtcToRealUtc`, `normalizeFlightTimeUtc`, and semantics-aware `tzAwareDurationMinutes` (CEST / CET / JST / LAX→JFK transcontinental). 9 covering the new Zod schema (paired contract, half-pair rejection, IANA validation, malformed local, legacy-field rejection, historical exemption, partial updates). 8 reminder-scheduler and flights-route integration updates. 9 covering the update-banner semver comparator (rc/beta stripping, edge cases, malformed inputs).

### Docs
- **Workflow revised** — Branching strategy in `CLAUDE.md` is now scoped to change size (direct `main` / `fix/*` / `feat/*` / `dev/*`); long-running dev branches must merge `main → dev` early and often, never the reverse, and never touch `VERSION` or `CHANGELOG.md` (both owned by `/deploy` on `main`).

## [1.1.0] - 2026-04-18

### Added
- **Birthday Flight achievement** — New `BIRTHDAY_FLIGHT` achievement counts flown flights that depart on the user's birthday (month + day, year irrelevant). Profile settings now include an optional birthdate field used by the check.
- **Kurios calendar easter eggs** — Six hidden achievements tied to aviation and calendar observances: ICAO Day (7 Dec), Wright Day (19 Aug), May the Fourth (4 May), Pi Day (14 Mar), Pi Precision (3 141 km ± 5 % on Pi Day) and Halloween (31 Oct).
- **Branded GlobeLoader** — Monochrome spinning-globe loader replaces the generic spinner at every large-area loading surface (maps, stats, flight pages, admin). Paints in < 16 ms so users see feedback before deck.gl / three.js finish booting, holds for ≥ 2 s to avoid flashing, and keeps spinning regardless of `prefers-reduced-motion`. Reads live CSS tokens so it reacts to dark-mode toggles without remount.
- **New logo system (v1.0)** — Luggage-tag mark with `TS` monogram and a cross-dot `TRAV✛STATS` wordmark ship as `LogoMark`, `LogoMarkFilled`, `LogoWordmark` and `LogoLockup` components. Visible in the nav header (desktop + mobile), all four auth screens and the favicon (SVG with dark background + PNG fallback). The README and Unraid forum / release docs point at `docs/images/logo.svg`.
- **App version vs build version split** — Runtime now exposes the deployed app version (from `backend/VERSION`) and the Docker image build version as distinct fields, so About can show `1.1.0 (built from 1.1.0-rc.3)` during the RC cycle.

### Changed
- **Achievements modules split** — `backend/src/utils/achievements.ts` (1 073 lines) reorganised into three files (orchestrator + stats + checks); `backend/src/data/achievements.ts` (1 306 lines) split into two seed parts plus a thin composition layer. Public API unchanged. Every file now respects the 800-line cap.
- **Achievement stats are immutable** — `checkAndUpdateAchievements` builds a fresh `augmentedStats` via spread rather than mutating the object returned from `calculateUserStats`; `Set`s are cloned, never mutated in place.

### Fixed
- **GlobeLoader no longer freezes for reduced-motion users** — The loader is feedback, not decoration; it now always animates.
- **Favicon visible on light browser chrome** — The new SVG favicon shipped transparent, which made the amber strokes disappear on Safari / iOS tab bars. A dark background is now baked into the SVG.
- **`LogoMarkFilled` survives theme switches** — Inverse colour used to be hardcoded `#0b0d10`; now reads `var(--bg-base)` so the mark stays legible in light mode.
- **Screen-reader announcements for the header logo and mobile drawer** — Home link now announces as "TravStats — Home" once, not the visible text three times. Mobile drawer Donate / Star links carry the `aria-label` attributes their desktop twins already had.
- **`GlobeLoader` canvas no longer churns on parent rerenders** — Derived `buffer` dimension is memoised so the effect dep array is stable.

### Database
- **`users.birthdate`** — New nullable `TIMESTAMP` column backing the Birthday Flight achievement. Additive only; no data transform; safe to deploy with zero downtime.

### Tests
- **Brand/Logo component suite** — 9 new Vitest tests cover the four logo components (a11y attributes, theme-token defaults, layout modes). Total frontend coverage is now 257 tests across 54 files.

## [1.0.1] - 2026-04-17

### Security
- **Base images refreshed and patched** — Builders moved from `node:20-alpine` to `node:22-alpine`; production stage moved from `node:20-slim` to `node:22-bookworm-slim`. The production image now also runs `apt-get upgrade` at build time so every rebuild pulls the latest Debian security feed on top of the base layer. Closes the Critical CVE-2026-6100 and eleven High-severity npm CVEs (tar, minimatch, cross-spawn) that Docker Scout reported against `v1.0.0`. Drop-in replacement — no schema, config, or runtime behaviour changes.
- **CI aligned with runtime** — GitHub Actions now runs backend and frontend checks on Node 22 to match the container image.

## [1.0.0] - 2026-04-16

First stable release. TravStats exits its public beta period after roughly
six months of daily use and a 22-finding black-box pentest (all findings
mitigated). The surface below is what ships out of the box.

### Core tracking
- Manual flight entry with categories, tags, up to 50 travel companions, costs and currency
- Five flight states — `flown`, `scheduled`, `cancelled`, `historical`, `duplicated` — each with dedicated forms and validation
- Timezone-aware durations via `date-fns-tz`
- Duplicate detection (same `flightNumber` × day) with a confirmed "save anyway" escape hatch and a dedicated `duplicated` status that skips time validation

### Boarding-pass scanner
- QR code, PDF417 barcode and OCR fallback (Tesseract) with automatic airport/airline resolution
- Camera capture and image upload, desktop + mobile

### Email and PDF import
- Template-based parsing with annotation-driven template builder for new airlines
- Optional local LLM parsing via Ollama (default model `gemma3:12b`, benchmarked 100% accuracy on the TravStats test corpus)
- Support for plain text, HTML email, Outlook `.msg` and `.eml`
- Parser rate metrics per template and per LLM model in the admin UI

### Automatic flight-data lookup
- AirLabs as primary source, OpenSky OAuth and Aviationstack as fallbacks
- Live gate, terminal, actual-departure, actual-arrival tracking while a flight is in progress
- Pending-update inbox with per-flight statistics-impact preview; approve, edit, reject
- Historical enrichment scheduler backfills gate/terminal/aircraft data for past flights
- Configurable per-user: approval gate on/off, check interval, only-during-flight window

### Maps and visualisation
- Six visualisation modes: Routes (ArcLayer), Heatmap, Hexagon (3D), 3D Columns, animated Trips, 3D Globe
- Deck.gl 9.x + MapLibre GL 5.x using `MapboxOverlay` for a shared WebGL context
- Two-stage route/trip popup → sidebar detail view
- Scheduled flights rendered as cyan arcs and excluded from stats until flown

### Statistics
- Year-over-year comparison, year-filter and all-time totals clearly separated
- Seat distribution (window/middle/aisle/zone/class), distance, flight time, costs, top routes, top airlines
- PDF year report with year auto-selected to the most recent flown year
- Downloadable vintage-passport PNG certificate: hero-km number, equivalences ("N × around the Earth"), deterministic serial, layered radial gradients compatible with `html2canvas`

### Gamification
- 58 Battlefield-style achievements across 5 categories (Sammler, Distanz, Elite, Entdecker, Survivor) + Planner and Special tiers
- Automatic unlock on milestone reach, readable locked cards on the achievement page

### Admin and operations
- Invite-only user management with per-invitation tokens (can't be reused)
- Admin-triggered user deletion with cascade (self-delete and last-admin delete blocked)
- SMTP configuration with test-connection
- Encrypted API-key storage (AirLabs, Aviationstack, OpenSky, SMTP password)
- Automated database backups with retention (`daily`/`weekly`/`monthly`) + optional WebDAV sync (Nextcloud, HiDrive, …)
- Backup restore via `pg_dump` with argument-array `spawn()` (no shell injection)
- Parse-log statistics dashboard (template hit rate, LLM hit rate per model)

### Bug reporting
- "Bug" button in the top navigation generates an anonymised diagnostic JSON bundle in-browser
- Bundle v2 ships: time-windowed log tails (24 h app / 7 d error) from live and rotated `.log.gz` files, per-user flight-state aggregates (byStatus counts + pipeline counters), allow-listed user settings (no credentials)
- Server-side scrubbing of IPs, emails, JWTs and UUIDs; user IDs replaced with short opaque markers
- One-click "Report Bug" copies the bundle to the clipboard and opens a pre-filled GitHub Issue Form

### Export and import
- CSV, GeoJSON, KML (Google Earth) export from the admin panel
- Email notifications: configurable 24 h / 2 h pre-departure reminders (SMTP)

### Internationalisation
- Full German and English UI via react-i18next
- German as primary locale, English as the mirror translation

### Security
- JWT stored in an `HttpOnly`, `SameSite=Strict`, `Secure`-aware cookie; no Bearer fallback
- 15 distinct rate limiters across auth, external-API-backed routes and admin exports
- Zod validation on every input endpoint; Prisma-parameterised queries; Helmet CSP; `server_tokens off`
- 22 pentest findings (2 CRITICAL, 5 HIGH, 8 MEDIUM, 7 LOW) surfaced and mitigated across the beta; see [SECURITY.md](SECURITY.md)
- Patched four moderate-severity transitive CVEs via `npm audit fix` (GHSA-r4q5-vmmm-2653 `follow-redirects`, GHSA-39q2-94rc-95cp `dompurify`, GHSA-j452-xhg8-qg39 `protocol-buffers-schema`). Lockfile-only; no behaviour change.
- Hardcoded LAN IP in the Ollama URL placeholder (admin UI, German + English) replaced with `http://localhost:11434`; the corresponding benchmark note in `backend/OLLAMA_OPTIMIZATION.md` and the default in `scripts/parse-samples.mjs` were scrubbed at the same time.
- JWT secret and AES-GCM encryption key are auto-generated on first boot and persisted to `/app/data/secrets/` (mode 0700, key files 0600), inside the single data volume. Pre-1.0 installs on the dedicated `/app/secrets` mount are migrated once at entrypoint time.

### Zero-config install
- The Docker compose file now requires **one environment variable only** — `DB_PASSWORD`. Everything else (instance name, public URL, user cap, registration mode, API keys, Ollama, backup schedule, WebDAV) is captured by the first-run setup wizard or configured later from the admin UI.
- `AdminSettings` gains nine new columns (`instance_name`, `max_users`, `allow_registration`, `frontend_url`, `webdav_*`). The WebDAV password is AES-GCM-encrypted at rest via the same helper used for the other API keys.
- Setup wizard extended: instance name, public URL (pre-filled from the request origin), user cap and registration toggle are captured alongside the admin username/password.
- New admin section "Instance" for the instance-level fields. WebDAV sync moved into the existing "Backups" admin section with a dedicated password field that is never echoed back to the client.
- Legacy `INSTANCE_NAME` / `MAX_USERS` / `ALLOW_REGISTRATION` / `FRONTEND_URL` / `WEBDAV_*` environment variables are still read as a one-time fallback for pre-1.0 deployments, then superseded as soon as an admin saves from the UI.
- Secrets and data consolidated into a single `/app/data` volume. The `/app/secrets` mount is gone; JWT and encryption keys live at `/app/data/secrets/` inside the same persistent volume. Unraid, compose and Docker Desktop users now manage one mount point instead of two. Pre-1.0 installs with the old split layout are migrated automatically at boot.
- Unraid Community Apps template slimmed down to two configurable knobs — `DATABASE_URL` (required) and `TZ` (advanced). `OLLAMA_URL`, `COOKIE_SECURE` and `CORS_ORIGIN` were dropped from the template: Ollama is wired up from the admin UI, cookie-secure is auto-detected from the reverse-proxy `X-Forwarded-Proto` header, and CORS defaults to same-origin behind a proxy. All three are still honoured as environment overrides for exotic setups.

### Breaking changes from 0.x beta

- Docker image is published to **GHCR** (`ghcr.io/abrechen2/travstats`) as the primary build target. Starting with 1.0.0 final, `X.Y.0` releases are also mirrored bit-identically to **Docker Hub** (`docker.io/abrechen2/travstats`) for discovery. Pre-releases and patches live on GHCR only.
- The default LLM model changed from `qwen2.5:7b` to `gemma3:12b`. Pull the new model with `docker exec travstats-ollama ollama pull gemma3:12b` or set `OLLAMA_MODEL` explicitly.
- Parser-feedback collection and the template-correction table were removed. If you had custom code consuming `analytics_events` parser rows, it no longer populates.
- `.env.prod.example` has been shrunk to five variables (one required). Existing values continue to work, but the example no longer advertises them.

## [0.29.0-beta] - 2026-04-16

### Added
- **One-click Report Bug flow** — The diagnostic-export modal's former "Issue öffnen" link is now a primary "Fehler melden" / "Report Bug" button. Clicking it copies the JSON bundle to the clipboard and opens a new tab at a GitHub Issue Form with the `version` field pre-filled and the `bug` label already applied. A toast confirms the clipboard step so the paste target is obvious. If the clipboard write is blocked (non-secure context, permissions, etc.), the issue URL still opens and the user is directed to the Download button as a fallback.
- **Structured GitHub Issue templates** — New `.github/ISSUE_TEMPLATE/` entries for "Bug Report" (7 fields: summary, actual, expected, reproduction, version, diagnostic bundle, additional context) and "Feature Request" (4 fields). `blank_issues_enabled: false` steers non-maintainer contributors through one of the two templates so every incoming issue arrives pre-structured.

## [0.28.0-beta] - 2026-04-16

### Added
- **Diagnostic Export v2 — self-sufficient bug-report bundle** — The JSON bundle produced by the "Diagnose-Export" admin action now includes two new sections so a GitHub issue rarely needs follow-up questions:
  - `settings` — the reporter's auto-update and historical-enrichment preferences (booleans and integers only, credentials are never projected). Defends against future schema additions via a hand-written allowlist.
  - `flightState` — per-user aggregates (`byStatus` counts + pipeline counters including `withNextApiCheck`, `withPendingUpdates`, `withLiveTracking`, `withActualTimes`, `zombieCandidates`) so the maintainer can see at a glance what the scheduler is looking at.

  Log tails are now time-windowed instead of entry-capped: 24 h for `appTail`, 7 d for `errorTail`. Rotated `.log.gz` files are read transparently; a broken archive is skipped rather than breaking the whole bundle. Pino's duplicate `time`/`timestamp` pair is deduped on read, cutting bundle size by roughly 50 %. Caps (5 000 entries / ~2 MiB) prevent a flooded log from blowing up the download. Each section is collected in isolation — a DB hiccup on one section now returns `{ error: "failed to collect <section>" }` for that slice only, the rest of the bundle still succeeds with HTTP 200.

## [0.27.2-beta] - 2026-04-16

### Fixed
- **Historical enrichment stayed pending forever** — When users had turned off the approval gate (`autoUpdateRequireApproval=false`), newly created historical enrichments were nonetheless left as "pending" and never surfaced on the flight. The scheduler now mirrors the live auto-update path and auto-applies them.
- **Zombie-flip missed flights with corrupted arrival time** — The stale-scheduled safety net only considered `arrivalTime + 6h` and was silent when a bad API lookup pushed `arrivalTime` into the future. Added a second `departureTime + 30h` trigger that flips the flight regardless of arrival-time state (30h comfortably covers ultra-long-haul like SIN→JFK).
- **Gate, terminal and actual departure/arrival never persisted** — `lookupFlightDetails` silently dropped per-flight live fields (gate, terminal) by letting the static airport record shadow them, and `actualDeparture`/`actualArrival` were missing from the snapshot pipeline entirely. Both AirLabs and Aviationstack paths now forward these end-to-end, and `delayMinutes` is recomputed on apply.

## [0.27.1-beta] - 2026-04-15

### Fixed
- **Duplicate flight: airline + flight number nullToUndef** — Older imported flights have these columns NULL in the DB, but the frontend Flight type lies and types them as required strings, so they slipped past the previous nullToUndef fix. All four nullable-typed-as-required fields now go through the helper.
- **Certificate: black vertical bands in exported PNG** — html2canvas does not render the SVG `feTurbulence` filter consistently and produced solid-black stripes from the noise data URI. Replaced with two layered radial gradients that give the parchment depth without the rasteriser hazard. Also removed `mixBlendMode: multiply` on the postmark for the same reason.
- **Stats page: clear separation between year-filter and totals** — Both four-card rows looked identical. Added a labelled separator above each row ("── Jahr 2026 ──" / "── Gesamt (alle Jahre) ──") with a subtle bottom-border so the scope is unambiguous.
- **Diagnostic export "Copy" worked on HTTPS only** — `navigator.clipboard` requires a secure context. Falls back to the legacy `execCommand('copy')` with a temporary off-screen textarea on plain HTTP.
- **Bug-Report button hidden on narrower screens** — Was tucked into the `xl:` breakpoint group with Donate/Star. Lifted out so it shows on all desktop widths.
- **/settings rate limiter removed** — The 1000/15min cap kept tripping during normal use. Real rate-limiting belongs on auth (brute-force), external-API-backed routes (cost) and admin exports (DB-wide reads), not on a user reading their own preferences.
- **Historical-flight month "Unbekannt" snapped back to Januar** — Storing `YYYY-01-01` for both January and "unknown" meant the parser couldn't distinguish them. Now stores year-only (`YYYY`) for the unknown-month case and expands to `YYYY-01-01` only at submit.

### Changed
- **Removed parser-feedback collection** — Same anti-pattern as the already-removed pattern-updater: data was collected into `analytics_events` but no longer consumed automatically. With Ollama as primary parser, the feedback was unused. Removed the `parserFeedback` service + route, the `/admin/parser-feedback/stats` and `/details` endpoints, the `/admin/parse-logs/promote` endpoint, the `FeedbackAnalytics` admin tab and the parser-correction submission from the FlightReviewModal. The `ParseTrainingLog`-based parser hit-rate dashboard (a different system) is unchanged.

## [0.27.0-beta] - 2026-04-15

### Added
- **Anonymous diagnostic export for GitHub bug reports** — A new "Bug" button in the top navigation opens a modal that generates a sanitised JSON bundle of recent app and error log entries plus system info. IP addresses, email addresses, JWT tokens and UUIDs are scrubbed server-side; user IDs are replaced with short opaque markers. Three actions: copy to clipboard, download as file, or open the GitHub issue page.
- **Save + add return flight** — A second submit button on the manual flight form saves the outbound and immediately prepares the form for the return leg. Departure and arrival airports are swapped, airline / category / tags / companions carry over, and leg-specific fields (flight number, aircraft, terminal, gate, seat, times) are cleared so the user fills them in.
- **Redesigned flight certificate** — The shareable PNG certificate has been completely redesigned around a vintage aviation passport aesthetic: parchment paper with grain texture, deep ink-blue typography, burnished bronze accents and a faded vermillion postmark stamp. New typography (Fraunces, Big Shoulders Display, JetBrains Mono), the total kilometres rendered as a dominant hero number, equivalence captions ("X × around the Earth at the equator"), and a deterministic 6-character serial number per certificate.
- **Admin panel: delete user** — Admins can now permanently delete users from the user-management table. Cascade clears the user's flights, trips, achievements, settings and pending updates. Self-deletion and last-admin deletion are blocked.

### Fixed
- **PDF year report button no longer permanently greyed out** — The advanced statistics page now auto-selects the most recent year as soon as flights have loaded, so the "PDF Jahresbericht" button is enabled out of the box instead of waiting for the user to discover the year dropdown.
- **Historical flight year input accepted keystrokes** — Typing a digit into the year field for a historical flight no longer cleared itself. The form re-derived the visible year from a stored YYYY-MM-DD string with a strict 4-digit regex; relaxed to accept partial input so the field echoes each keystroke.
- **Diagnostic export modal no longer trips its own rate limit** — The fetch effect re-ran on every parent re-render due to unstable `t` and `addToast` dependencies, exhausting the 10/hour rate limit within seconds. Now fires once per modal open.
- **Duplicate flight succeeds again** — The "duplicate as same / return flight" action sent `null` for unset optional fields, which Prisma's optional-but-not-nullable Zod schema rejected. Nullable values are now coerced to undefined, and duplicates are created with the dedicated "duplicated" status (no time-fields requirement) so the user fills in dates in the edit modal that opens immediately.

### Changed
- **Admin panel cleanup** — Removed the dead Hardware-info section, dropped the unused TemplateCorrection table, and retired the orphan pattern-updater / pattern-analyzer infrastructure that never actually applied any patterns. Tabs and i18n strings simplified accordingly.
- **Certificate layout** — Footer no longer overlaps the "of note" rows; postmark stamp was repositioned tighter into the corner with a multiply blend so it reads as ink on parchment.

## [0.26.0-beta] - 2026-04-15

### Added
- **Duplicate flight action** — Each row in the flights table now has a "Duplicate" dropdown with two options: "As same flight" (copy route) or "As return flight" (swap departure/arrival). Airline, flight number, aircraft, category, tags, companions and notes carry over; time, seat, gate, terminal, booking references and pricing are cleared so the user fills in the trip-specific details. The edit modal opens automatically on the new flight.

### Fixed
- **Auto-update endless loop** — When "require approval" was disabled the scheduler created a pending update on every check but never applied it, so the same changes were re-detected and re-written every 10-15 minutes. Updates with approval off are now applied immediately while the pending row is still kept for audit.
- **API check cadence** — Each flight used to be polled every 15 minutes while in the air, burning 30-50+ API calls per long-haul. Scheduling now uses exactly three checkpoints: 30 minutes before departure, 60 minutes before scheduled arrival, and 30 minutes after arrival.
- **Zombie-scheduled cutoff** — Flights stuck on "scheduled" past their arrival are now auto-flipped to "flown" after 6 hours (was 48h), so they stop showing up in the API-check queue.
- **Scheduler log output** — The `significant_changes_found` log line now lists real field names (e.g. `gate`, `terminal`, `aircraft`) instead of array indices.

## [0.25.4-beta] - 2026-04-14

### Fixed
- **Settings page no longer trips its own rate limit** — The auto-save effect listed `t` (from useTranslation) in its dependency array, which is unstable across renders, so the debounced save was firing on every keystroke instead of only when units actually changed. Combined with new banner/home-airport fetches this hit the `/settings` rate limit (60→200→1000) within a couple minutes of normal use. Removed the unstable dep and bumped the limit to 1000/15min so background polling has plenty of headroom while still blocking scripted abuse.

## [0.25.3-beta] - 2026-04-14

### Fixed
- **Autocomplete shows both active and closed airport for shared codes** — Searching "MUC" now returns Munich Airport (active) followed by Munich-Riem (closed) instead of only the active one. The exact-match step returns all rows with the same IATA/ICAO ordered by `isClosed ASC` so users can pick the historical predecessor for old flights.

## [0.25.2-beta] - 2026-04-14

### Fixed
- **Closed predecessor IATA assignment** — When a closed airport's keywords list a single 3-letter token, that's almost always its own historical IATA (Munich-Riem `EDDM, MUC, XMUC` → MUC). When multiple are present the first is usually the successor (Tempelhof `BER, EDDI, THF` → BER is Brandenburg, THF is the closed one), so prefer the candidate not used by an active airport. Both cases now resolve correctly.

## [0.25.1-beta] - 2026-04-14

### Fixed
- **Closed predecessors no longer overwrite active airports** — Munich-Riem (closed) shares ICAO EDDM and IATA MUC with the active Munich Airport; the seeder was overwriting the active row with the closed predecessor's data, breaking searches for "MUC". The Airport schema now uses composite uniqueness on `(iata, isClosed)` and `(icao, isClosed)` so both rows can coexist, and the seeder upserts by the composite key. Closed airports are still listed alongside their successors in autocomplete with the "geschlossen" badge.
- **Airport autocomplete prefers active over closed** — Search and lookup now order by `isClosed ASC` so a typed code like "MUC" returns the active airport first, with the closed predecessor below.

## [0.25.0-beta] - 2026-04-14

### Added
- **Home airport with relocation history** — Pick a home airport once during onboarding and change it later under Einstellungen › Heimatflughafen. A move never overwrites the past: every flight keeps the home airport that was active at its date, so old statistics stay truthful.
- **Copy-down date and estimate arrival time buttons** — Two new icon buttons in the Add Flight and Edit Flight forms: a down-arrow that copies the departure date into the arrival date, and a calculator that estimates the arrival time from the great-circle distance using the arrival airport's local timezone. A "+1 Tag" hint appears below the arrival date for overnight flights.
- **Flughäfen statistics section** — New stats card group with distinct airports, countries, continents (5/6), top 5 most-visited airports, top countries, rarest airports (visited only once), new airports this year, farthest airport from home, and a continent breakdown bar chart. Plus a new "Kürzester Layover" companion stat.
- **Closed airports in autocomplete** — Permanently closed airports like Berlin Tegel (TXL) are now seeded too and remain selectable for historical flights, marked with a "geschlossen" badge.

### Fixed
- **Längster Layover no longer counts living at home as a layover** — Capped at 24 hours and arrivals at the home airport active on that date are excluded. Old: "47944.6h in MUC" (5.5 years). New: realistic transit times only.
- **Historical flight year input no longer locks to NaN** — Parsing the stored date with `new Date()` could produce `Invalid Date`, then `getFullYear()` wrote "NaN" back into the input and froze it. Now parsed directly from YYYY-MM-DD with regex.

### Changed
- **Settings rate limit raised** — From 60 to 200 requests per 15 min. The previous limit was tripping on normal navigation now that the settings page has more sub-sections and a new home-airport banner.

## [0.24.4-beta] - 2026-04-14

### Fixed
- **Aviationstack now respects Free-tier budget** — Blocks Aviationstack calls outside the flight's live window (±3h of departure, in-flight, or 2h post-arrival) and caps them at an admin-configurable daily budget (default 3/day, enough to stay inside the Free tier's 100/month). Outside the window — the bulk of daily polls, which are just schedule lookups from T-24h to T-6h — the lookup goes straight to AirLabs, which has a much larger Free quota. An 8-flight test account now consumes about 5–8 Aviationstack calls over a 24h window instead of 240+. Skip reasons (`outside_live_window`, `daily_budget_exceeded`, `cooldown`) are logged at every lookup for debuggability.
- **New admin setting:** `aviationstackDailyBudget` (default 3). Migration adds the column; set to 0 to disable Aviationstack entirely and rely solely on AirLabs + OpenSky.

## [0.24.3-beta] - 2026-04-14

### Fixed
- **Historical flights with unknown date are enrichable again** — `findEnrichmentCandidates` queried `departureTime: { gte: maxAgeDate }`, which in Prisma/Postgres also excludes `NULL`. Historical flights (the primary use case: "I flew this but don't remember when") were therefore never candidates for enrichment, even when a full reference pool existed. Now the query accepts both dated and dateless flights, and `getEnrichmentMode` returns `slim` for null so dateless flights use the conservative ICAO + terminal-only aggregation.

## [0.24.2-beta] - 2026-04-14

### Fixed
- **Enrichment bootstrap deadlock resolved** — The auto-update and historical enrichment pipelines never produced results on fresh accounts because of a chain of five interacting bugs: the significance filter dropped first-fill gate/terminal changes, `hasLiveTracking` never got seeded (gating all future enrichment), scheduled flights past their arrival time became permanent zombies, and Aviationstack times without seconds silently failed to parse. Each is now fixed — first-fill changes count as significant on their own, `hasLiveTracking` flips on any non-empty API response, a new zombie-transition job flips `status=scheduled` → `flown` after arrival + 48h (marked `lastModifiedBy='zombie_auto_flown'`), and the time parser now accepts the space-separator-without-seconds format observed from the live API.
- **Aviationstack 429 retry storm prevented** — The free tier is 100 requests per month. A single 429 previously triggered aviationstack retries on every 5-minute scheduler tick. Now a 1h in-memory cooldown blocks Aviationstack after a 429, falling through to AirLabs.
- **OpenSky credential validation** — If stored credentials decrypt to an unusable pair (neither full OAuth2 client credentials nor full basic auth), the resolver now returns `null` instead of an empty object so downstream logs no longer lie about configuration state.

### Changed
- **Historical-enrichment threshold lowered for slim mode** — Flights aged ≥ 1 year now require only 3 reference flights instead of 5 for aggregation. Full mode (< 1 year) keeps the 5-reference minimum. This unlocks enrichment for niche routes in small deployments where 5 same-flight-number references would be unreachable.

### Docs
- Added three post-V1 roadmap items surfaced by the v0.24.1 critical review: route clustering to replace per-dimension median aggregation, confidence calibration via user-feedback loop, and a cross-user consent model for future multi-tenant deployments.

## [0.24.1-beta] - 2026-04-14

### Security
- **Admin password reset via SMTP (Pentest H4)** — When the target user has a notification email on file and SMTP is enabled, the generated temporary password is now delivered via email instead of being returned in the HTTP response body. Falls back to response body for deployments without a mail server. Remaining deferred pentest items (H5 leaderboard enumeration, M7 TLS, L2/L3 SSH, L4 Dozzle) are now formally documented as accepted — by-design for the family tracker or infrastructure-level outside the repository.

### Fixed
- **Map-only filter hidden on list pages** — The "min times flown" route-frequency slider only affects the deck.gl route layer. It no longer appears on the flight list page, where it was a silent no-op that misled users into thinking their list was filtered.

### Changed
- **Dead canTrainLLM flag dropped** — Removed an unused permission relic of the deleted LLM training pipeline. The field was never set or read by the backend, so the frontend gate always evaluated to false. Parser access is now gated exclusively by `isAdmin`. Prisma migration drops the column; `hasTrainingAccess` renamed to `hasParserAccess`.

### Tests
- **+21 new service tests** — covers email service (password reset, invitation, admin reset), reminder scheduler (dedupe, per-window error isolation, user opt-out), and cloud sync service (WebDAV upload, download, list, with all failure paths).

## [0.24.0-beta] - 2026-04-13

### Security
- **Shell injection in backup service fixed** — Replaced `execAsync` with `spawn` on Unix pg_dump paths to prevent command injection via crafted database URLs (C1).
- **API credentials no longer leaked in PUT response** — Admin API key update endpoint now returns masked values instead of decrypted plaintext secrets (C2).
- **Removed `targetDatabaseUrl` from restore API** — Eliminates SSRF and command injection amplification via admin-supplied database URLs (H3).
- **Rate limiting added to flight lookup and enrichment endpoints** — Prevents external API quota exhaustion and database load abuse (H1, M5).
- **Analytics event types whitelisted** — Only `parser_feedback` and `pattern_suggestion` are accepted, preventing pipeline poisoning (H2).
- **13 additional fixes** — changeToken body fallback removed (M2), backup path containment check (M3), typed editedData preview (M4), SMTP password encrypted at rest (M6), nginx security headers on static assets (M1/M8), dotfile access blocked, `Math.random()` replaced with `crypto.randomBytes()` (L1), setup rate limited (L6), `parseInt` radix (L5), RFC 5987 Content-Disposition encoding (L7).

### Added
- **Parser system marked as beta** — Navigation and parser page show a beta badge and notice explaining that only LLM-based parsing is fully tested.
- **SECURITY.md** — Comprehensive security architecture documentation with verification commands, audit history, and vulnerability reporting via GitHub Private Security Advisories.

### Changed
- **Multi-flight parser roadmap** — V1.8 roadmap updated with two-stage hybrid parser design (block splitting + per-block extraction) and multi-version template scoring.

## [0.23.1-beta] - 2026-04-13

### Fixed
- **Sidebar overflow on small screens** — The navigation menu, flight list, and stats sidebars used fixed pixel widths (w-80/w-72) that overflowed on narrow viewports. All three panels are now capped at calc(100vw - 3rem), leaving a 48px tap area to close the backdrop. Also fixed the mobile menu DOM nesting by moving it outside the header element into a fragment.

## [0.23.0-beta] - 2026-04-13

### Added
- **Smart API check scheduling** — Replaces fixed-interval polling with per-flight scheduling using a geometric midpoint approach. Checks become more frequent as departure nears (min 10 min), run every 15 min in-flight, and stop 2 hours after arrival. Existing scheduled flights are backfilled on startup.

### Fixed
- **Aircraft name normalization** — Aircraft type names are now normalized consistently across statistics, achievements, and the input form. Existing names in the database are cleaned up on startup.

## [0.22.0-beta] - 2026-04-13

### Fixed
- **Timezone-aware statistics** — All airport timezone data is now derived from coordinates via geo-tz and backfilled on startup. Fixes timezoneHopper (was always 0), fastestRoute showing impossible speeds (e.g. 5560 km/h), and incorrect flight durations for cross-timezone flights.
- **Airline name normalization** — Duplicate airline entries caused by different import-source spellings (EgyptAir/Egyptair, AIR CANADA, Vietnam Airline) are now merged in statistics.
- **WebGL2 graceful fallback** — Browsers without WebGL2 support no longer crash deck.gl; the map renders correctly.
- **i18n encoding fixes** — Corrected garbled German umlauts in error messages and added missing translation key.

### Changed
- **Same-day flights stat renamed** — "Same-Day Returns" renamed to "Tagesflüge" / "Same-Day Flights" to accurately reflect the metric (flights landing on the same calendar day, not round trips).

### Added
- **Native MapLibre route fallback** — WebGL1-only browsers now get a native MapLibre GeoJSON route layer instead of no map at all.

## [0.21.0-beta] - 2026-04-13

### Added
- **Historical flights** — Flights can now be recorded as route-only
  entries without departure/arrival times. Includes a form checkbox,
  year/month partial date picker, grey map arcs, and a "HISTORISCH"
  badge in the flight list.
- **Duplicate flight dialog** — One-click duplication of any flight
  as outbound or return, with correct status and time fields.
- **Airport autocomplete in review modal** — The FlightReviewModal
  (used for email/boarding pass imports) now has full airport
  autocomplete with IATA/ICAO priority matching.
- **Airline and aircraft autocomplete** — All flight forms now offer
  suggestions from a merged list of ~150 airlines and ~90 aircraft
  types (static seed data + user's flight history). Custom entries
  are remembered for future sessions.
- **Year/month picker in edit modal** — Historical flights can be
  edited with a year/month-only date picker instead of requiring
  a full date.
- **Three UX improvements for flight forms** — Enhanced form usability
  across add, edit, and review workflows.

### Fixed
- **Achievement leaderboard inflated** — The leaderboard was counting
  all tracked achievements (55) instead of only unlocked ones (34),
  showing 12,595 points instead of the correct 3,630.
- **Recent achievements showed non-unlocked entries** — The /recent
  endpoint now filters to only actually unlocked achievements.
- **deck.gl map crash on load** — Fixed a luma.gl "r is null" race
  condition by deferring the DeckGLOverlay until MapLibre's WebGL
  context is ready (onLoad gate). Updated maplibre-gl 5.19→5.23.
- **FlightEditModal date handling** — Overhauled date fields, feature
  flags, and historical status switching in the edit modal.
- **Duplicate flight payload errors** — Fixed null field coercion,
  missing times, and incorrect status when duplicating flights.
- **Validation errors hidden** — Detailed Zod validation errors are
  now displayed in the flight form instead of a generic error message.
- **Flight schema rejects null** — Callsign and aircraft fields now
  correctly accept null values.
- **Airport search ranking** — Exact IATA/ICAO matches are now
  prioritized over partial name/city matches.

### Docs
- **Post-V1 roadmap** — Added ROADMAP-POST-V1.md with detailed specs
  for V1.1 (Cruises module) through V2.0 (Multi-user platform).

## [0.20.0-beta] - 2026-04-12

### Added
- **Historical flights** — New flight status for route-only entries
  without departure/arrival times. Historical flights count toward
  distance, airport, and geographic achievements but are excluded
  from flight-time statistics. Includes a form checkbox, grey map
  arcs (thinner width), a "HISTORISCH" badge in the flight list,
  and nullable times across the full Prisma schema.

### Fixed
- **Null-safe frontend types** — Made departureTime/arrivalTime
  nullable across 17 frontend components to prevent runtime crashes
  when displaying historical flights without timestamps.

## [0.19.0-beta] - 2026-04-12

### Added
- **Scheduled flight distinction** — Future flights are automatically
  marked as "scheduled", shown with cyan arcs on the map and a
  "GEPLANT" badge in the flight list. Scheduled flights are excluded
  from all statistics.
- **Flight list sort selector** — The sidebar flight list now has
  sort buttons for date (asc/desc), route, airline, and status.
- **Planner & Survivor achievements** — Five new achievements for
  planned flights (Wanderlust, Globetrotter Planner, Year Ahead)
  and cancelled flights (Survivor, Turbulence Veteran).
- **Improved airport labels** — IATA labels on the map are slightly
  larger with a more visible dark background for better readability.

### Fixed
- **Achievements page readability** — Locked achievements are no
  longer blurred; they show at reduced opacity with a lock icon
  centered-right in the card. All text and progress bars remain
  clearly readable.
- **Achievements page scroll** — The survivor/planner categories
  at the bottom of the page are no longer cut off.

## [0.18.1-beta] - 2026-04-12

### Fixed
- **Achievement seeding on every server start** — Achievement
  definitions are now ensured on every backend startup (idempotent),
  not only during the Docker entrypoint init script. Fixes empty
  achievements after fresh deploys or database resets.
- **Round-trip route popup** — Route popup now correctly shows
  both airports (e.g. "Munich Airport → Helsinki Vantaa") instead
  of showing the departure airport twice for round-trip routes.

## [0.18.0-beta] - 2026-04-12

### Added
- **Two-stage route/trip info popup** — Clicking a route arc on
  the map now shows a redesigned popup with full airport names,
  distance, average duration, airlines, and seat class. A
  "Route Details" / "Trip Details" button opens a rich sidebar
  view with route statistics and a chronological flight list
  (or numbered trip legs for trip-routes mode).

## [0.17.0-beta] - 2026-04-12

### Added
- **Ollama model selector** — The admin parser settings page now
  shows a dropdown of all models available on the Ollama server
  instead of a free-text field. A "Pull model" section lets admins
  download new models directly from the UI.
- **Cost tracking feature gate** — The cost breakdown section
  (price, currency, taxes, fees) in the flight review modal is now
  hidden unless the enableCostTracking feature flag is active.

### Fixed
- **Timezone-aware flight durations** — Flight duration calculations
  now account for timezone differences between departure and arrival
  airports using IANA timezone data. Fixes inflated durations for
  international flights (e.g. LAX→MUC showed 20h instead of ~11h).
- **Achievement checks for all flights** — Achievement progress is
  now evaluated after every flight creation, not only for flights
  with status "flown".

## [0.16.1-beta] - 2026-04-12

### Fixed
- **Setup page simplified** — Removed privacy info box, tips section, and
  instance name field. Only the essential username + password form remains.
- **Profile shows account username** — The settings profile now displays the
  actual account username instead of the default "Traveler".
- **Language auto-detected from browser** — On first use, the UI language is
  auto-detected from `navigator.language` (de/en) instead of defaulting to
  English.
- **Route click selects all flights** — Clicking a route arc on the map now
  highlights all flights on that route instead of only the last one.
- **Flight list refreshes after batch import** — The map and sidebar now
  update automatically after importing multiple flights via email.
- **Batch import errors shown as toast** — Import errors (e.g. rate limit)
  are now displayed as a visible toast notification instead of silently
  failing behind a closed modal.
- **Batch rate limit increased** — Raised from 10 to 50 requests per hour
  to support bulk email import workflows without hitting 429 errors.
- **Achievement notifications on batch import** — The batch endpoint now
  returns newly unlocked achievements, and the popup is shown after bulk
  imports (previously only worked for single-flight additions).

### Changed
- **Cost tracking defaults to off** — Cost input fields are now opt-in via
  Settings > Features instead of being visible by default.

## [0.16.0-beta] - 2026-04-12

### Security
- **Full pentest with 32 findings resolved** — Comprehensive code review
  uncovered 4 critical, 10 high, 12 medium, and 6 low severity issues.
  All 32 have been fixed: admin data export no longer leaks password
  hashes or decrypted API keys; shell injection in backup restore
  replaced with safe `spawn()` calls; Bearer header fallback removed
  (JWT only via HttpOnly cookie); force-change-password token now
  delivered via HttpOnly cookie instead of response body; login timing
  oracle eliminated (constant-time bcrypt for unknown users); MAX_USERS
  hard limit enforced even with ALLOW_REGISTRATION=true; SSRF
  protection on Ollama URL; invitation registration wrapped in
  serializable transaction; SameSite upgraded to Strict; CORS dev
  bypass removed; DB password default removed from prod compose; rate
  limiters keyed by userId on authenticated endpoints; nginx security
  headers on static routes. Zero npm audit vulnerabilities in both
  backend and frontend.

### Added
- **Default Ollama model switched to gemma3:12b** — Benchmarked at 100%
  accuracy across all test email samples, replacing qwen2.5:7b.

### Changed
- **Dead LLM training system removed** — Deleted modelManager,
  trainingAuth middleware, training settings route, 6 Python scripts,
  and ~2 GB of PyTorch dependencies from the Docker image. Dead Prisma
  schema fields dropped via migration.
- **Oversized files split** — regexParser.ts (824 to 338 lines + 4
  modules), backupService.ts (1129 to 378 + 4 modules), statsCalculator.ts
  (886 to 17 barrel + 4 modules). All files now under the 800-line limit.

### Tests
- **Backend test isolation improved** — 7 test suites refactored to seed
  users via Prisma instead of the register endpoint, run serially via
  `maxWorkers=1`, and wipe state before each test.

## [0.15.2-beta] - 2026-04-11

### Fixed
- **Password min length aligned with the backend on the invited
  register page** — The client-side check rejected passwords below 6
  characters while the backend Zod schema already required at least 8,
  so 6- or 7-character passwords slipped past the client and hit the
  generic "Validation error" envelope from the backend error handler.
  The invited user saw a red box with no explanation. Fix: the client
  check is now 8 characters to match, the `register.passwordTooShort`
  string in both DE and EN says "mindestens 8" / "at least 8", and the
  error handler now prefers `details[0].message` (the actual Zod
  per-field message) over the generic envelope when the backend does
  return one. Verified locally against a fresh invitation: a 7-char
  password now surfaces the exact "at least 8" message client-side,
  a valid 10-char password completes the flow.

## [0.15.1-beta] - 2026-04-11

### Fixed
- **Copy-to-clipboard on insecure HTTP origins** — Every "Copy link"
  button in the admin area silently did nothing when TravStats was
  accessed over plain HTTP on a LAN IP (the typical deployment), because
  `navigator.clipboard.writeText` is only available in a secure context
  (HTTPS or `localhost`). A new shared `copyToClipboard` utility tries
  the modern API first and falls back to a hidden-textarea plus
  `document.execCommand("copy")` path when the modern API is
  unavailable or rejects. The fix is wired into the invitation success
  modal, the row-level copy action in the invitation list, and the
  admin temporary-password reveal. Verified locally by running the dev
  server on a LAN IP (`window.isSecureContext === false`,
  `navigator.clipboard === undefined`) — both copy buttons now surface
  the success toast and actually write to the clipboard.

## [0.15.0-beta] - 2026-04-11

### Added
- **Invitation system v2** — The admin invitation surface is rebuilt
  end-to-end. Two distinct entry points replace the browser `prompt()`:
  a "Create link" modal that generates a shareable URL with an
  expiration radio (24h / 7d / 30d), and a "Create by email" modal
  that additionally sends the invitation through SMTP to a given
  recipient. The success modal keeps the link visible with a copy
  button until the admin dismisses it, so the URL is never "lost in
  a toast" again. On SMTP failure the invitation is still created
  and the modal shows an amber warning with the concrete error and
  the fallback link.
- **Row-level invitation management** — Every invitation row in the
  admin list now has context-aware actions: re-copy the link on any
  active invitation, resend the email (only for rows with an email
  attached and a null/failed send status), and revoke (hard-delete)
  any non-used invitation. A filter chip row above the table
  (`Alle` / `Aktiv` / `Verwendet` / `Abgelaufen`) narrows the view,
  and a new "Verwendet von" column shows which user consumed each
  used invitation.
- **`MAX_USERS` enforcement at invitation create time** — Both
  create endpoints now run a serializable transaction that counts
  `users + active invitations` and rejects with `409 User limit
  reached` before any row is inserted. `MAX_USERS` was previously
  only a warning log that never actually blocked anything.
- **Auto-populated `notificationEmail` on invited registrations** —
  When a user registers through an invitation that carried an email
  address, that address is copied into the new user's
  `notificationEmail` field during the same insert. Password reset
  works for invited users out of the box without a manual visit to
  the settings page.
- **Email delivery tracking per invitation** — The `invitations`
  table gets three new columns (`email_status`, `email_error`,
  `email_sent_at`) so the list row can show the last send outcome
  and the resend action can target failed deliveries specifically.
  The `used_by` foreign key is tightened to `ON DELETE SET NULL`
  so deleting a user no longer cascades to historical invitation
  rows.
- **Dedicated `sendInvitationEmail` helper** — A new function in
  `emailService.ts` mirrors the existing `sendPasswordResetEmail`
  pattern but throws on SMTP misconfiguration instead of silently
  returning. The route handler catches the throw, marks the
  invitation `email_status='failed'` with the underlying error
  text, and still returns 200 — the *invitation* create succeeded
  even when the *email send* did not.

## [0.14.1-beta] - 2026-04-11

### Fixed
- **Invitation system wired end-to-end** — The register flow never
  forwarded the invitation token to the backend, so invited users
  silently registered as normal uninvited users and the invitation
  record stayed forever "active" in the admin list. `authApi.register`
  now accepts a third `invitationToken` argument, `RegisterPage` reads
  the `?token=` query parameter via `useSearchParams`, and a green
  "you are registering with an invitation" banner confirms that the
  link was picked up. Companion prod-config change: `FRONTEND_URL` and
  `ALLOW_REGISTRATION=false` should be set in the production
  docker-compose.yml so invite URLs no longer point to
  localhost and public registration is actually gated on a valid
  invite. Verified end-to-end against a local dev instance: registration
  without a token is blocked, an admin-created invite flows through
  the register page, the `invitedBy` column is populated, and a second
  use of the same token is rejected by the database unique constraint.

## [0.14.0-beta] - 2026-04-11

### Added
- **Help texts on every settings and admin surface** — 10 components
  (SmtpManager, ParserSettings, ApiKeys, Backup, Defaults, Features, Map,
  Notifications, Profile, Units) now ship expandable InlineHelp blocks with
  DE + EN explanations covering scope, dependencies and gotchas. Coverage
  is now 27 components with 198 checked i18n keys.
- **Help audit script** — `scripts/audit-inline-help.mjs` walks every
  InlineHelp and HelpIcon element and verifies each `t()` key against DE
  and EN. Exits non-zero on missing translations; usable as a CI gate.

### Fixed
- **Backup creation via the UI** — The route handler passed pre-computed
  paths to the service through `existingRecord`, but the service generated
  a fresh timestamp internally and therefore ran `mkdirSync` on a different
  directory than it tried to write to. Result: `pg_dump >
  .../temp/database.sql: Directory nonexistent`. The service now takes
  `backupDir`/`tempDir` directly from `existingRecord`.
- **"Date unknown" in the backup table** — `serializeBigInt()` fell into
  the `typeof === 'object'` branch for Date objects and turned them into
  `{}` because `Object.entries(date) === []`. Fix: non-plain objects are
  passed through unchanged so Express can call `Date.toJSON()` for wire
  serialization. +7 regression tests.
- **Consistent airline column** — Some flights showed "Lufthansa", others
  just "LH". A new `resolveAirlineDisplay()` helper expands 2-char IATA
  codes to the full airline name; applied everywhere (FlightsTablePage,
  FlightList, FlightCalendar, FlightSelectStep, YearHeatmap).
- **Trip filter chips** — The buttons rendered the raw i18n keys
  `filter.with` / `filter.without` because the JSON held `withTrip` /
  `withoutTrip`. Keys renamed in both DE and EN to match the code.
- **Missing lib files committed** — `airlineUtils.ts` and
  `filterEmailText.ts` were imported by `FlightReviewModal` and
  `EmailAnnotation` but only existed locally (untracked). A clean clone
  would have failed to build.
- **White input fields on auth pages** — LoginPage, ForceChangePasswordPage,
  ResetPasswordPage and AdminPasswordResetModal referenced a CSS class
  `.input-field` that does not exist anywhere, so the inputs fell back to
  the browser default (white). Switched to the existing `.input` class.
- **"Note" label in developer mode help** — The key
  `settings:developer.help.noteLabel` was missing in both languages, so
  the UI rendered the raw i18n key when the help was expanded. Added in
  DE + EN.

## [0.13.0-beta] - 2026-04-06

### Added
- **Email-based password reset** — Users can request a reset link from
  the login page via "Forgot password?". The link is delivered by email
  (only when SMTP is configured).
- **Admin password reset** — Admins can reset a user's password from
  user management: either generate a random temporary password (shown
  once, with a copy button) or set a password directly. Optionally, a
  "Must change password on next login" flag can be enabled.
- **Forced password change** — When the admin sets the flag, the user
  must choose a new password on the next login before they can access
  the app.
- **Rate limiting on reset endpoints** — Password reset requests are
  limited to 5 requests per 15 minutes to prevent abuse.

### Fixed
- **Force-change-password route** — After login the frontend incorrectly
  called `/force-change-password` instead of `/change-password`; fixed.
- **Unique constraint on token fields** — Reset and change tokens now
  have a database unique index that enforces single-use semantics at
  the DB level.

## [0.12.2-beta] - 2026-04-06

### Security
- **nginx version leak fixed** — `server_tokens off` in the nginx config
  prevents exposure of the nginx version in response headers.
- **Duplicate security headers removed** — nginx no longer sets security
  headers; Helmet owns them completely, avoiding conflicts on
  X-XSS-Protection, Referrer-Policy and HSTS.
- **XSS sanitization in flight notes** — HTML tags are stripped from the
  backend `notes` field before being stored.

### Fixed
- **Express 404 pages** — Missing routes now return `{"error":"Not
  found"}` instead of the internal Express HTML page.
- **JSON parse errors anonymized** — Invalid JSON bodies now return a
  generic error message instead of the internal parser error text.

## [0.12.1-beta] - 2026-04-06

### Security
- **CORS tightened** — The CORS wildcard now only applies in development
  mode (`NODE_ENV === development`), not in all non-production
  environments.
- **Additional rate limiting** — Upload endpoint (30/hr) and every
  settings route (60/15min) now have rate limits guarding against disk
  exhaustion and enumeration.
- **Minimum password length raised** — Minimum length raised from 6 to
  8 characters.

### Fixed
- **Database start failures surfaced immediately** — Missing DB
  configuration now aborts server startup instead of just warning.
- **Global error handlers** — Unhandled promise rejections and uncaught
  exceptions from schedulers are now logged instead of silently crashing
  the server.
- **Parser settings endpoint corrected** — PUT `/api/v1/settings/parser`
  incorrectly returned 200 OK without saving anything; now correctly
  returns 501 Not Implemented.
- **Query parameter validation** — `parseInt()` in admin parse-log
  routes replaced with Zod schemas (prevents NaN reaching DB queries).
- **Trip list query bounded** — GET `/trips` now loads at most 500 trips
  + 200 flights per trip (was: unbounded).
- **ErrorBoundary logging** — `console.error` in ErrorBoundary is now
  scoped to development mode.
- **package.json versioned** — `backend/package.json` and
  `frontend/package.json` synchronized to `0.12.1-beta`.

## [0.12.0-beta] - 2026-04-06

### Added
- **Empty map view** — New users now see a hint card with a direct
  "Add flight" button instead of an empty globe.
- **ICAO code in the airport tooltip** — Clicking an airport label now
  additionally shows the ICAO code as a badge next to the IATA code.
- **Gate, terminal, boarding group and companions in the edit modal**
  — These four fields are now fully editable in the flight edit dialog.

### Fixed
- **Language support** — Hardcoded German strings in the map tooltip,
  trips tab and flight counter replaced with i18n keys; dead
  ContextualHint reference removed. All text now reacts correctly to
  the language setting.
- **Umlaut bug** — `¨e` (a Prettier artifact) in the plural "Flüge"
  fixed.
- **Exit highlight mode** — Clicking on empty map space now reliably
  ends trip or flight highlight.

### Changed
- **Tooltip performance** — `onMove` handler throttled via
  requestAnimationFrame; tooltip recalculation runs at most once per
  frame instead of up to 60 times per second.
- **Code quality** — Plane and pulse animations extracted from
  DeckGLMap into dedicated hooks (DeckGLMap: 582 → 430 lines);
  TooltipContainer and formatDuration provided as shared primitives.

## [0.11.0-beta] - 2026-04-06

### Added
- **Trips tab in the sidebar** — Quick selection of all saved trips
  directly from the flight panel, including flight count, year and
  total kilometers.
- **TripTooltip on the map** — Selecting a trip now shows an info card
  with the route chain, travel dates, total duration, distance,
  airlines and aircraft types.
- **Airport statistics tooltip** — Clicking an IATA code or airport
  point opens a stats card with departures/arrivals, most common
  routes, total kilometers and operating airlines for that airport.
- **Auto-highlight when using "Show on map"** — All flights of a trip
  are automatically selected as soon as the user switches into the
  trip route view via "Show on map".
- **Airport markers on the trip route layer** — Pulsed rings and
  labels for all departure and destination airports of the active
  trip.
- **5 demo trips** — Seed data for new users now includes five
  predefined trips (Barcelona, Dubai & Singapore, Japan, Scandinavia,
  USA West Coast).

### Fixed
- **Tooltips follow the map** — All info windows (flight, trip,
  airport) update their position while scrolling and zooming through
  geo-anchored projection.
- **Trip info card above the arcs** — Tooltip is positioned above the
  bounding box of all airports so it does not sit on top of the route
  lines.
- **Sidebar stays open** — Selecting a trip from the sidebar panel no
  longer auto-closes the panel.
- **Back to the normal view** — Closing the trip tooltip resets
  `visMode` to "routes" and clears the trip selection.
- **Arc click tolerance** — `pickingRadius: 5` on the MapboxOverlay
  fixes the issue where clicks on thin arcs were not registered.
- **deck.gl layer re-rendering** — Colors are pre-computed in the data
  so deck.gl reliably repaints on selection.

Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

---

## [0.10.0-beta] - 2026-04-05 (Update 2)

### Added
- **`operatingAirline` field**: New optional DB field `operating_airline`
  (migration `20260405000000_add_operating_airline`). Stores the
  operating carrier for codeshare flights as well as rail/bus tickets.
- **"Operated by" form field**: Added to `FlightEditModal` and
  `FlightCompleteStep` with `<datalist>` autocomplete.
- **Airline autocomplete**: All airline fields now have browser-native
  `<datalist>` autocomplete with ~75 airlines including rail/bus
  operators (DB, FlixTrain, Flixbus, ÖBB, SBB, TGV, Eurostar).
- **`cleanEmailBody()` utility**: Cleans up plain-text email bodies
  before parsing — strips HTML tags, URLs, normalizes whitespace.
  Mirrors the `filterEmailText` function used in the annotation view.

### Changed
- **Parser runs against cleaned text**: `parseEmail()` applies
  `cleanEmailBody()` before handing text to any parser — parser and
  annotation view now see identical text.
- **`EmailAnnotation` stores filtered text**: `fullText` on annotations
  is stored as `filterEmailText(raw)` instead of raw — annotation
  positions and pattern derivation are consistent.
- **Airline auto-derived**: Post-processing derives the airline name
  from the flight number prefix (`LH2316` → `LH` → `"Lufthansa"`) when
  `airline` is empty.
- **Parser recognizes "operated by"**: Patterns like `"operated by X"`
  / `"durchgeführt von X"` are automatically captured as
  `operatingAirline`.
- **`AIRLINE_IATA_MAP`** expanded from 15 to ~75 airlines.

### Fixed
- **400 error when adding a flight**: The Zod schema threw when
  `airline: ""` (empty string) was submitted. Fix:
  `emptyStringToUndefined` transform on `airline` and `flightNumber` in
  `baseFlightSchema`.
- **LH-old template**: `flightNumber` pattern changed to
  `^([A-Z]{2}\s+\d{3,4})$` — works after `cleanEmailBody()` because
  `<img.png>\tLH 2316\t` becomes `LH 2316` on its own line. Template
  version bumped to `2025-04b` and pushed to the GitHub templates
  repository.

---

## [0.10.0-beta] - 2026-04-04

### Added
- **Enrichment two-mode system**: flights < 1 year → full enrichment
  (aircraft, ICAO codes, route, terminal, gate); flights ≥ 1 year →
  slim enrichment (ICAO codes + terminal only).
- **`getEnrichmentMode()`**: Exported helper that determines enrichment
  mode from flight age.
- **Route median interpolation**: `aggregateRoutes` now resamples all
  reference routes to 20 points and computes per-position median
  lat/lon — replaces the "take newest route" approach.
- **Enrichment badge in PendingUpdateCard**: Full (green) / slim
  (amber) badge plus an "estimated · not verified" disclaimer with
  reference flight count and confidence score.
- **Two-mode explanation panel** in Settings → Enrichment tab.

### Changed
- **`findEnrichmentCandidates`**: Now excludes flights with `pending`
  or `rejected` pending updates (previously only `applied` was excluded
  — caused infinite nightly re-processing).
- **Settings simplified**: `requireApproval` and `autoProcess` removed
  — enrichments always create a pending update requiring manual
  confirmation. Settings reduced from 6 to 3 fields (`enabled`,
  `minConfidence`, `maxPerDay`).
- **Scheduler**: Runs for all users with
  `historicalEnrichmentEnabled=true` (no longer gated on
  `autoProcess`).

### Removed
- **`historicalEnrichmentMaxAgeYears`**,
  **`historicalEnrichmentAutoProcess`**,
  **`historicalEnrichmentRequireApproval`** from the `UserSettings`
  schema and DB.

---

## [0.9.6-beta] - 2026-04-03

### Added
- **Ollama config in admin UI**: `ollamaUrl`, `ollamaModel`,
  `ollamaVisionModel` stored in the `AdminSettings` DB table; editable
  in Admin → Parser Settings.
- **Backup schedule in admin UI**: `backupEnabled`, `backupInterval`,
  `backupRetentionDays` stored in `AdminSettings`; editable in Admin →
  Backup Management.
- **`dateUtils.ts`**: Timezone-aware date/time formatting with
  `Intl.DateTimeFormat`; graceful UTC fallback for invalid timezone
  strings.
- **Timezone-aware flights table**: `FlightsTablePage` now formats
  dates using the user's configured timezone from the settings store.

### Changed
- **`getParserConfig()`**: Reads `ollamaUrl/Model/VisionModel` from the
  `adminSettings` parameter with ENV fallback.
- **`backupScheduler.ts`**: `getBackupSettings()` reads backup config
  from the DB instead of ENV; runtime validation via `VALID_INTERVALS`
  / `toBackupInterval()`.
- **`BackupSection`** (Settings): Now a read-only status view; backup
  schedule configuration moved to Admin → Backup Management.
- **`NotificationsSection`** (Settings): Removed dead toggles; now
  renders only `NotificationPreferences`.

### Removed
- **`debugLoggingEnabled`** + **`requireUserApiKeys`** from
  `AdminSettings` schema — log level from ENV, API keys always
  required.
- **`trainingSeparateModels`** from the `UserSettings` schema.
- **`SystemSettings`** model dropped entirely.
- **Ghost backup/notification fields** from `settingsStore`,
  `useSettingsPage`, API types.

---

## [0.9.5-beta] - 2026-04-03

### Removed
- **LLM training dead code**: Deleted orphaned `TrainingDashboard`,
  `TrainingDataFilters`, `TrainingDataPreview` components (never
  imported after the TrainingPage → ParserPage refactor).
- **Save + Train button**: Removed the LoRA fine-tuning trigger from
  `EmailAnnotation` and `BoardingPassAnnotation` — annotation now
  always derives templates via the `annotate` endpoint only.
- **Dead `trainingApi` methods**: `saveAndTrain`, `trainOnly`,
  `getData`, `getJobs`, `getJobLogs`, `triggerTraining`,
  `cancelTraining`, `deleteTrainingData` removed from the frontend API
  client.
- **Dead TypeScript types**: `TrainingJob`, `TrainingJobLog`,
  `TrainingJobLogsResponse` removed from `types/index.ts`.
- **LLM-only backend endpoints**: `POST /:id/save-and-train`, `POST
  /:id/train-only`, `GET /data`, `GET /jobs`, `GET /jobs/:id/logs`,
  `DELETE /:id`, `POST /trigger`, `POST /jobs/:id/cancel`, `GET
  /data/analysis` removed from the training route.

---

## [0.9.3-beta] - 2026-04-03

### Added
- **Annotation-driven template parser**: Users can annotate parsed
  email fields to derive regex-based templates. Annotated patterns are
  stored as `ParserTemplate` records and applied as step 0 in the
  parser factory for future emails from the same airline.
- **TemplateDeriver**: Derives multi-flight regex templates from user
  annotations (`textSelections`) with field source tracking
  (`fieldSources`).
- **FingerprintMatcher**: Matches incoming emails to existing user
  templates by airline/subject fingerprint.
- **UserTemplateEngine**: Executes derived templates against email
  bodies with multi-flight extraction.
- **Parser templates CRUD API**: `GET/POST/DELETE
  /api/v1/parser-templates` — list, activate, disable, delete
  user-derived templates.
- **TemplateReviewCard**: UI card shown after annotation save to
  display the newly derived template with confidence score.
- **Colour-coded confidence borders** in `FlightReviewModal`: green
  (template match), yellow (LLM fallback).
- **`fieldSources`** on `ParsedBooking` — tracks which field was
  extracted by which method.

### Fixed
- Regex PNR `matchAll` missing `g` flag — caused 500 errors during
  email parsing.
- `GET /api/v1/parser-templates/:id` endpoint added (was missing).
- Body length guard against ReDoS attacks in parser template routes.
- `TemplateReviewCard` async error handling and loading states.

---

## [0.9.2-beta] - 2026-04-02

### Changed
- **Map amber redesign**: The glassmorphism theme now uses TravStats
  brand colors (amber → orange → red) throughout all visualization
  modes. Replaces the previous indigo/cyan color scheme.
- **Filter as FAB**: Filter button moved from the bottom-center bar to
  a bottom-right FAB stack (frosted-glass style, opens upward). The
  mode FAB is stacked above the filter.
- **CSS tokens**: `--map-accent`, `--map-fab-gradient`, `--map-active-*`,
  `--map-badge-*` all updated to amber. Sepia CSS filter on the map
  canvas removed. Dark-matter map style restored unconditionally.

### Added
- **Globe night earth**: Night-earth texture (`earth-night.jpg`) with
  amber atmosphere glow + starfield background (`night-sky.png`) in
  globe mode.
- **Globe legend stacking**: Auto-rotation toggle and route-frequency
  legend share the bottom-left column (no overlap).

### Fixed
- Airport labels (`TextLayer`) now always render above arc lines
  (`depthCompare: "always"`).

---

## [0.9.1-beta] - 2026-03-31

### Added
- **Email import as the primary tab**: Email import promoted to the
  main "Import" tab in the UI. `EmailImportTab` component with drag &
  drop, airline notice and text fallback.
- **Template status view**: Settings page shows GitHub-linked template
  status. New `TemplateStatusView` component + `/api/v1/templates/status`
  endpoint.
- **Duplicate flight detection**: POST `/api/v1/flights` returns 409
  with `existingFlight` details when a duplicate is detected. The
  frontend shows a confirmation dialog with an "Add anyway" option
  (`?force=true` bypass).
- **Year-over-year statistics**:
  `/api/v1/stats/summary?year=YYYY&compareYear=YYYY` with delta badges
  (↑↓ % change).
- **Travel companions**: `companions` field on the Flight model.
  Tag-style input in `SimplifiedFlightFormV2`.
- **Seat statistics**: `GET /api/v1/stats/seats` — distribution by
  position, zone and cabin class.
- **Flight certificate**: `FlightCertificate.tsx` generates a
  downloadable PNG stats card via html2canvas.
- **Email notifications**: SMTP config, per-user notification
  preferences, node-cron reminder scheduler.
- `statsLimiter` (30 req/min) and `adminExportLimiter` (5/hr) rate
  limiters.

### Changed
- **deck.gl visualization**: 6 map modes — routes, heatmap, hexagon
  (3D), 3D columns, trips (animated), globe (react-globe.gl).
- `VisModeSelector`, `TimeSlider`, layer factories for all
  visualization modes.
- Map integration refactored from Leaflet to deck.gl 9.x + MapLibre GL
  5.x.
- `flightNumber` now included in `calculateChanges` comparison fields
  (was silently ignored before).

### Fixed
- Fresh-DB migration ordering: early migrations (`202501xx`) wrapped in
  `IF EXISTS` guards; catch-up migration (`20251221`) recovers all
  columns.
- Backend CI: ESLint added as an explicit dependency, ESLint 9 rule
  violations resolved.
- All 156 backend tests now pass (assertions aligned with actual
  service/route return types).
- GeoJSON layer factories now read from `geometry.coordinates`, not
  unpopulated airport `lat`/`lon` fields.

---

## [0.9.0-beta] - 2026-02-24

First public beta release. Re-versioned from 1.0.x to 0.9.0-beta to
reflect that not all planned features are complete yet.

### Added
- Version badge in About tab (reads from package.json).
- Rate limiting on backup-restore (3/hr) and training-trigger (2/hr)
  endpoints.
- Zod validation for stats route query parameters.
- PayPal donation and GitHub Star buttons in Settings → About.
- i18n translations for all hardcoded strings in
  `SimplifiedFlightForm`.
- Missing `unknownDate` i18n key in dashboard translations.
- i18n translations for hardcoded strings in `DashboardPage` (PDF
  export, map/stats fallbacks).

### Changed
- Package versions bumped to `0.9.0-beta` (frontend + backend).
- Admin page refactored to sidebar layout.
- All plain browser checkboxes replaced with the styled `.checkbox`
  class.

### Fixed
- `alert()` calls in AchievementsPage replaced with toast
  notifications.
- `console.debug()` calls in `barcodeExtractor.ts` replaced with
  `logger.debug()`.
- Dark mode issues across all pages (hardcoded Tailwind colors → CSS
  variables).

---

## [1.0.1] - 2026-02-23

### Added
- Prettier formatter for frontend TypeScript/TSX/CSS (`format` and
  `format:check` scripts).
- ts-prune dead code detection scripts in frontend and backend
  (`dead-code` script).
- Vitest coverage reporting with v8 provider and regression thresholds
  (`test:coverage` script).
- ruff.toml Python linter config; auto-fixed 220 issues in training
  scripts.
- bandit security config (`.bandit.yml`) for Python script scanning.
- License whitelist (`LICENSE_WHITELIST.txt`) covering all project
  dependencies.
- Pre-commit hooks: trailing whitespace, YAML/JSON validation, secret
  detection, ruff, Prettier.
- GitHub Actions CI workflow: backend (typecheck + lint + test with
  Postgres), frontend (typecheck + lint + format + coverage), Python
  (ruff + bandit).
- Dev setup scripts (`scripts/setup-dev.sh` and
  `scripts/setup-dev.ps1`) for onboarding.
- Smoke test script (`scripts/smoke-test.sh`) for post-deploy
  verification.

### Changed
- Docker security hardening: `cap_drop: ALL` + minimal `cap_add`,
  `no-new-privileges`, log rotation, and resource limits on `app`,
  `db`, and `ollama` services.

### Fixed
- Removed unnecessary `CAP_SETUID`/`CAP_SETGID` from the app container
  (root can setuid without them).
- Corrected the pre-commit prettier hook entry to properly forward
  filenames (`npx --prefix frontend prettier --write`).
- Removed dead coverage config block from `vite.config.ts` (shadowed
  by `vitest.config.ts`).

## [1.0.0] - 2026-02-23

### Added
- Initial stable release.
- Flight tracking with map visualization (Leaflet, 3D globe).
- Statistics dashboard (distance, time, routes, heatmaps).
- Achievements & gamification system (20+ badges).
- Boarding pass scanner (QR/barcode + OCR via Tesseract.js).
- Email booking import (manual upload + IMAP polling).
- Flight data lookup (AirLabs API integration).
- OpenFlights airport database (~14,000 airports).
- Export: CSV, GeoJSON, KML.
- Tags & categories (business/private).
- Cost tracking per flight.
- Dark/light mode.
- Multi-language support (DE/EN).
- LLM-powered parsing (Ollama integration).
- LoRA fine-tuning pipeline for email/boarding-pass models.
- Pre-training data quality analysis (`checkTrainingData.py`).
- Post-training model evaluation (`evalModel.py`).
- Training metrics parsing (loss, steps, epochs).
- Docker deployment with nginx + supervisor.
- JWT authentication with secure cookie handling.
