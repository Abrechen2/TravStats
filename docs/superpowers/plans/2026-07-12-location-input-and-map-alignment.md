# LocationInput & Lodging Map Alignment — Plan

Spec: `docs/superpowers/specs/2026-07-11-lodging-import-and-location-design.md` §4 (the
Discord promise) + owner directives 2026-07-12: "Koordinaten muss einfacher gehen mit
vielen Möglichkeiten", "Map-Funktionen entsprechend der Neuerungen in der neuesten RC
anpassen — genau ansehen", "denke auch an die Unterkunft-eigene Settings-Seite".

Branch: `dev/hotels` (worktree `.claude/worktrees/hotels`). 12 tasks.

## Global constraints (binding for every task)

- **CSP `connect-src 'self'`** (`backend/src/index.ts:91`): the browser may NEVER fetch
  Photon/Nominatim directly. All geocoder traffic goes through same-origin backend
  proxies (precedent: `GET /lodging/fx-preview`, `backend/src/routes/lodging.ts:307-329`,
  and `GET /ports/geocode`). `frontend/src/lib/nominatim.ts`'s direct fetch is a
  PRE-EXISTING violation that Task 6 removes.
- **Photon (komoot) for search-as-you-type** — Nominatim's policy forbids per-keystroke
  queries. **Nominatim only for one-shot geocode** (existing `services/geo/nominatim.ts`,
  1 req/s queue). Debounce ≥ 300 ms, min 2 chars (mirror `EventLocationPicker`'s 400 ms).
- **Configurable URLs**: `AdminSettings` columns (the `ollamaUrl` pattern), defaults =
  public instances (`https://photon.komoot.io`, `https://nominatim.openstreetmap.org`).
  Resolution: DB value → ENV (`PHOTON_URL` / `NOMINATIM_URL`) → default. Owner decision:
  instance-level (self-hosting a geocoder is an operator concern), surfaced admin-gated
  on the LODGING settings tab (Task 11).
- **Geocoding never blocks a save; a failed geocoder leaves the form usable** (spec §5).
  Services never throw; UI shows a translated string, real error to the frontend logger
  (`PortPicker`'s bare `catch` blocks are the ANTI-pattern; `LodgingFormModal.tsx:76` is
  the precedent).
- Rate limiting: new `photonSearchLimiter` mirrors `portGeocodeLimiter`
  (`backend/src/middleware/rateLimit.ts:87-94`): 30/min, `userOrIpKey`, PAT ×10.
- Map pins/markers: sizes ONLY via `markerDotStyle.ts` (`markerDotRadiusProps`); colours
  and legend rows ONLY via a resolver both layer and legend call (CLAUDE.md invariant);
  every `TextLayer` sets `characterSet: "auto"`.
- Editable map pin = plain `react-map-gl/maplibre` `<Marker draggable>` (the
  `EventLocationPicker.tsx:326-358` pattern). deck.gl is NOT used for the picker map.
- `any` forbidden; Zod at every boundary; DE first + EN mirror in the same change;
  `useTranslation` from the project wrapper; Prettier check on every touched file;
  files ≤400 lines ideal / 800 max.
- Cruise stop 3-state invariant (portId / isAtSea / unresolvedPortName) must survive
  Task 7 untouched.

## Coordinate paste — "viele Möglichkeiten" (Task 3's parser contract)

`parseCoordinateInput(text): {lat: number, lon: number} | null` accepts at least:
- `47.3769, 8.5417` (comma), `47.3769 8.5417` (space), `47.3769; 8.5417` (semicolon)
- with parentheses/brackets stripped: `(47.3769, 8.5417)`
- Google-Maps URL forms: `.../@47.3769,8.5417,12z...` and `?q=47.3769,8.5417`
- hemisphere letters: `47.3769 N, 8.5417 E` / `N 47.3769 E 8.5417` (S/W negate)
- rejects: out-of-range pairs, single numbers, DMS (`47°22'37"`) — DMS and Plus Codes
  are the documented follow-up (spec §4 note), return null so the text stays put.
Range check lat ∈ [-90,90], lon ∈ [-180,180]; a pair like `8.5417, 47.3769` with
lat>90 impossible is NOT auto-swapped (ambiguous — never guess silently).

---

## Task 1: Geocoder configuration (backend)

Files: `backend/prisma/schema.prisma` (+ hand-written migration per the documented
`prisma migrate dev` drift/TTY constraints — use `migrate diff --script` + `migrate
deploy`, precedent Task 2b of Phase A), `backend/src/services/instanceSettingsService.ts`,
`backend/src/routes/admin/instanceSettings.ts`, `backend/src/services/geo/nominatim.ts`.

- `AdminSettings` gains `photonUrl String? @map("photon_url")` and
  `nominatimUrl String? @map("nominatim_url")`.
- `getInstanceSettings()` returns both, with the ENV→default fallback chain; add a
  `resolveGeocoderUrls()` helper (single source for Task 2 + nominatim.ts).
- `instancePatchSchema` accepts both (same `https?://` refine as existing URLs; empty
  string clears back to default).
- `services/geo/nominatim.ts` stops hardcoding `BASE_URL`: reads the resolved URL per
  request (keep queue + cache; cache key must include the URL so switching instances
  doesn't serve stale cross-instance results).
- Tests: resolution order (DB > ENV > default), clearing, nominatim uses the configured
  URL (mock fetch).

## Task 2: Photon search service + same-origin proxy route

Files: create `backend/src/services/geo/photon.ts`,
`backend/src/routes/geo.ts` (mount at `/api/v1/geo` in `index.ts`),
`backend/src/middleware/rateLimit.ts` (+ `photonSearchLimiter`).

- `searchPlaces(query, {limit=6, lang})` → normalized
  `{ name, address?, city?, country?, countryCode?, lat, lon, type }[]`; never throws
  (returns `[]`, logs a stage tag — NOT the raw body); hard deadline via
  AbortController (the Task-10 lesson: a REAL deadline, not an idle timer), response
  size cap.
- `GET /api/v1/geo/search?q=&lang=` — `authenticate` + `photonSearchLimiter`; Zod query
  (q min 2 max 200); returns the envelope. Read-only → passes `requireWriteScope`'s GET
  passthrough naturally.
- HTTP tests incl.: 401 unauth, 200 shape, limiter present (route-level), Photon-down →
  200 `[]` (never 5xx to the client for a geocoder hiccup).

## Task 3: `LocationInput` component + coordinate parser + i18n namespace

Files: create `frontend/src/components/location/LocationInput.tsx`,
`frontend/src/lib/coordinateParse.ts`, `frontend/src/lib/api/geo.ts`,
`frontend/src/i18n/resources/{de,en}/location.json` (+ register ns in `i18n/config.ts`),
tests for parser + component.

- Decision: NEW shared namespace `location` (three+ consumers across domains — the
  per-domain duplication precedent doesn't scale; explorer flagged this as open, decided).
- Component contract:
  `<LocationInput value={{lat,lon}|null} onChange(sel: LocationSelection) …>` where
  `LocationSelection = { lat, lon, name?, address?, city?, country?, countryCode? }`.
  One text field that BOTH searches (debounced ≥300 ms via `GET /geo/search`) AND
  detects a pasted/typed coordinate pair (`parseCoordinateInput` on change/paste —
  when it parses, skip the search, set the pin, show a "Koordinaten erkannt" hint).
  Suggestion dropdown (keyboard navigable, ARIA combobox like `ChainPicker`).
  Collapsible map (`react-map-gl` `<Marker draggable>` + click-to-move) and an
  "Erweitert" raw lat/lon panel — both mirroring `EventLocationPicker`'s UX.
- Failed search → translated inline error + `logger.error`; the form stays usable
  (spec §6 test case, verbatim).
- Tests: every parser form from the contract above (RED first), search mock → select
  fills all fields, paste `47.3769, 8.5417` splits (THE spec assertion), failed
  geocoder leaves the form usable, no direct external fetch anywhere (assert the api
  module is called, not global fetch to komoot).

## Task 4: Wire into the hotel form

Files: `frontend/src/components/lodging/LodgingFormModal.tsx` + its test.

- Replace the free-standing address/city/country text inputs' TOP with `LocationInput`:
  a selection fills `name` (only when name is still empty — never overwrite user text),
  `address`, `city`, `country`, and NEW `lat`/`lon` in the payload (schema already
  accepts them; "caller's pin wins" is already implemented server-side —
  `geo.resolveCoordinates` short-circuits).
  The individual fields stay editable below (progressive enhancement, not replacement).
- Editing an existing lodging seeds the pin from stored coords.
- Tests: selection fills payload incl. lat/lon; manual-only flow still saves with no
  coords (geocode-on-save unchanged); LocationInput mocked out per the established
  `vi.mock` child-picker technique where the suite focuses on form logic.

## Task 5: Wire into the trip POI editor (Alex's original ask)

Files: `frontend/src/components/Trips/StopModal.tsx` + tests.

- Replace the two raw lat/lon inputs (`StopModal.tsx:170-191`) with `LocationInput`
  (advanced panel keeps raw entry). A search selection may also prefill `title` when
  empty. Payload/API/Zod unchanged (`createStopSchema` already takes lat/lon).
- This closes the verbatim Discord ask: pasting a Google-Maps coordinate pair into a
  timeline POI entry fills both fields automatically.
- Tests: paste-split reaches the payload; existing StopModal tests stay green.

## Task 6: Retire the client-side Nominatim fetch (CSP fix)

Files: `frontend/src/lib/nominatim.ts`, `frontend/src/components/specialFlights/EventLocationPicker.tsx`.

- `lib/nominatim.ts`'s `searchPlaces` currently fetches
  `https://nominatim.openstreetmap.org` from the BROWSER — blocked by our own CSP in
  prod. Point it at `GET /api/v1/geo/search` (one function body swap; keep its result
  shape or migrate EventLocationPicker to `lib/api/geo.ts` and delete the file).
- Do NOT redesign EventLocationPicker (out of scope) — same UX, compliant transport.
- Test: EventLocationPicker search path hits the api module (it currently has zero
  tests — add this one seam test).

## Task 7: Cruise custom-port entry + PortPicker error hygiene

Files: `frontend/src/components/Cruise/PortPicker.tsx` + tests.

- The "add custom port" sub-form (raw `newLat`/`newLon`, `PortPicker.tsx:247-315`) gets
  `LocationInput` (compact variant — no name/address fill, just coords + map).
- Fix the two bare `catch` blocks (`handleSelectGeocoded`, `save`) to
  `logger.error(...)` + translated message (the explorer-flagged swallowed errors).
- 3-state invariant untouched; existing PortPicker tests stay green.

## Task 8: Lodging appearance — size slider + shared dot model

Files: `frontend/src/components/map/controlPanelKit.tsx`,
`frontend/src/components/layers/lodgingPinsLayer.ts`,
`frontend/src/components/DeckGLMap.tsx`, `frontend/src/components/map/mapAppearance.ts`,
`frontend/src/components/Dashboard/tabs/LodgingTab.tsx`,
`frontend/src/components/layers/dotSizeParity.test.ts`.

- `AppearanceDomain` gains `"lodging"`; new `LodgingAppearanceSection` = ONE marker-size
  slider ("Größe", min 0 = aus, max 1.6 — exactly the flight/cruise slider spec).
  Persisted via `mapAppearance.ts` like the others.
- `buildLodgingPins(lodgings, sizeScale)` drops its hand-copied constants and calls
  `markerDotRadiusProps(sizeScale)`; delete the local `hexToRgb` (import the exported
  one).
- `LodgingTab` passes `appearanceDomains={["lodging"]}`.
- Extend `dotSizeParity.test.ts`: lodging pins match airports/ports at equal scale.

## Task 9: Lodging pins — tooltip, click, labels

Files: `frontend/src/components/map/markerTooltip.ts`,
`frontend/src/components/layers/lodgingPinsLayer.ts`, `frontend/src/components/DeckGLMap.tsx`,
`frontend/src/components/Dashboard/tabs/LodgingTab.tsx`.

- `LODGING_LAYER_IDS` + `renderLodgingHtml` (name, city+flag, stay/night count — reuse
  `flagImgHtml`/`countryName` like ports).
- `onClick` on the pin surfaces `lodgingId`; `LodgingTab` navigates to the detail page
  (one call site, matching airport/port click semantics). A pin click must NOT fall
  through to the background-click clear.
- Name labels: `TextLayer` mirroring `cruisePortsLayer`'s label layer — truncation,
  `characterSet: "auto"` (#185!), gated by the panel's labels-mode.
- Tests: tooltip renderer branch, click handler wiring, characterSet assertion
  (mirror `cruisePortsLayer.test.ts:107-127`).

## Task 10: Legend, colour source, CSS var, Alle-Tab wiring

Files: `frontend/src/lib/lodgingColor.ts` (new, trivial),
`frontend/src/components/Dashboard/tabs/AllTab.tsx`, `frontend/src/index.css`,
`frontend/src/lib/cruiseColor.ts` (stale comment), `frontend/src/components/map/MapChromeSections.tsx` (only if needed).

- `buildLodgingLegend()` (one fixed swatch from `DOMAINS.lodging.color`, no mode) —
  layer AND legend now share one source (the CLAUDE.md invariant, closed properly).
- AllTab: fetch lodgings (analogous to cruises), `lodgingsVisible =
  filterDomains.includes("lodging") && isEnabled("lodging")`, pass `lodgingsOverride`
  — the currently DEAD domain chip becomes functional. Legend gains the lodging row
  when pins are visible.
- CSS: rename `--domain-hotel` → `--domain-lodging`, value `#d4778f` (the Phase-A
  deferred Minor, finally); fix the stale `cruiseColor.ts:27` comment.
- Tests: legend row present when visible; chip toggles pins; CSS var greps clean
  (no `--domain-hotel` left).

## Task 11: Lodging settings page (owner directive)

Files: the lodging settings tab section component (find via `lodgingPreferences` in
`frontend/src/pages/SettingsPage.tsx:141-147`), `frontend/src/lib/api/*` admin client,
`backend` admin route from Task 1.

- The lodging settings tab ("Präferenzen": today only the base-currency selector) gains
  a **"Geocoder" card, visible to admins only** (isAdmin gate; pattern: admin-global
  cards like Immich's "Externe Dienste"): Photon URL + Nominatim URL inputs with
  placeholder = the public default, empty = default, save via the instance-settings
  route; a "Verbindung testen" button hitting `GET /geo/search?q=Berlin` and showing
  hit/fail.
  **Guard against the Immich near-miss (recorded in ROADMAP): a failed GET must render
  a load-error state, NOT an empty form whose save would clear the stored URLs.**
- Non-admins see the Präferenzen section unchanged.
- DE+EN, tests: load-error guard (the near-miss), save roundtrip, admin gate.

## Task 12: i18n sweep + full gates + browser smoke

- Reconcile every new key (location.json + lodging/trips/cruise additions), DE/EN
  parity tests extended (interpolations incl. any count strings).
- Full gates: backend tsc/lint/tests (known 2 live-LLM flakes excepted), frontend
  tsc/lint/vitest, prettier on all touched files.
- Browser smoke on a fresh dev pair (fresh ports! orphan trap): hotel form search-fill →
  pin drag → save; StopModal paste-split; lodging tab slider resizes pins; pin
  tooltip + click; Alle-tab chip toggles pins; legend row; settings geocoder card
  load-error guard (intercept GET with 500).

## Explicitly out of scope (documented follow-ups)

- DMS + Plus-Code parsing (spec §4 note), reverse geocoding, replacing
  EventLocationPicker's UI with LocationInput, the POI dashboard tab itself.

## Final: whole-plan review

Standard SDD closing review over the whole task range, most capable model, with this
plan + the two explorer reports as context.
