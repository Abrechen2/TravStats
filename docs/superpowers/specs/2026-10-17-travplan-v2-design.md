# TravPlan v2 — route plans, placeholders, co-planning across servers, ferry import, Companion

Status: proposed 2026-10-17. Branch `dev/travplan-v2` (long-running, merged into `main` only on the
owner's explicit release decision). Visual target: the design canvas "TravPlan Zielbild"
(claude.ai artifact `MUaxmk32mRzx8SsM9T2p8X`, eight boards). Builds on TravPlan v1
(`docs/features/travplan.md`, migration `20261014090000_travplan`).

## 1. Why

TravPlan v1 plans a trip with ONE destination: a day strip, ideas, bookings, packing, budget. A
UX walk-through on 2026-10-17 (local instance, every tab, desktop and 390 px) found it usable as a
set of forms but not as a planner: ISO dates everywhere, free-text time zone and currency,
eight equal tabs with no guidance, empty areas without explanation, no whole-trip view, no map,
no place search, `nightGap` silent without bookings, "Flexible Idee" on scheduled items, a
permanent undo button, "confirm as experienced" offered for future items.

The owner then described the trip they actually want to plan with it:

> Motorhome from Rosenheim to the Mediterranean, a ferry down to Sicily, campsites chosen and
> driven to one after another plus day trips, ferry back, drive home. First placeholders for a
> rough plan, then replace them with bookings via e-mail import or by hand. Campsites may be
> decided spontaneously on site. The father plans with them — on his own TravStats server.

v1 cannot represent that trip: no own-vehicle drive, no stages, no stations with nights, no
placeholder that a booking replaces (an import creates a second booking), one weather location,
no co-editing, no ferry e-mail parsing.

## 2. Owner decisions (verbatim or as given, 2026-10-17)

- D1. "Alles bauen": all four parts below are built, on one long-running branch.
- D2. The co-planner is on **another server** ("Es wären zwei Server").
- D3. The co-planner may do **everything except delete the plan** ("Alles außer löschen des planes").
- D4. Cross-server path **A — direct guest access** on the host server: the guest's browser/app
  talks directly (HTTPS) to the plan's host; the guest's own server only vouches for identity
  and never sees plan content. Full records still never travel server-to-server in plaintext
  (owner rule 2026-10-16 stands).
- D5. **The co-planner's logbook gets the whole trip, route included** (owner accepted the
  recommendation, 2026-10-17). This re-opens the S1 scope note "roadtrips are not shared"
  (2026-10-09) for this purpose: roadtrips and their stations become a shareable type for
  local members, and the single-trip exchange format gets a new version carrying the roadtrip
  (stations, legs, ferry↔leg links) for remote guests.
- D6. **Documents a co-planner sees** (owner accepted the recommendation, 2026-10-17): only
  documents attached to plan bookings and documents uploaded explicitly *for the plan* by any
  member; every other document of the trip stays invisible to members. Member uploads live on
  the host, are labelled with the uploader, and are plan documents, not the owner's private
  trip documents.
- Standing rules that apply: v1's "plans are staged separately, never counted as travel
  evidence"; merging to `main`, deploying and anything public stay owner decisions; DE+EN copy
  move together; beta registry for unfinished features.

## 3. Goals, non-goals, anti-goals

Goals
- G1. A plan can be a **route**: ordered stations with nights, stages between them (own drive,
  ferry, rail, flight, other), day trips per station — beside the existing single-destination
  plan.
- G2. **Placeholders**: any booking-like element (ferry, flight, campsite, …) can exist as a
  placeholder with an estimate; an imported or hand-entered booking **replaces** it on
  confirmation, keeping every reference to it.
- G3. **Night states** per station: booked, idea (with candidates), free pitch, spontaneous.
  Spontaneous is a chosen state and produces no warning.
- G4. **Dates flow**: stations carry nights, dates follow from the start day and the stages;
  lengthening a stay shifts later stations up to the next fixed anchor, and a collision is a
  finding, never a silent move of a booking.
- G5. **Variants** (≤3) of the same plan, compared side by side, one active.
- G6. **Weather per station**: forecast inside the horizon, measured climate means outside it,
  labelled as such.
- G7. **Co-planning**: a collaborator on the same server or on another server edits the plan
  with every right except deleting it; every change names its author, the other is told, undo
  works across authors.
- G8. **Ferry booking e-mails/PDFs** are recognised as ferry (not cruise) and become ferry
  bookings / placeholder replacements.
- G9. **Companion**: route plan view, "Tonight here" for a plan station, guest pairing, ferry
  parse domain.
- G10. **Handover** of a route plan creates a logged roadtrip (stations, legs, ferries linked
  to legs, campsite stays) on the owner's server; a guest receives their own copy as a file.
- G11. The v1 UX defects listed in §1 are fixed in the same rebuild (design canvas boards 1–6).

Non-goals
- Automatic booking, price search, availability lookups, campsite booking APIs.
- Live server-to-server push of plan content; any plaintext record transfer between servers.
- Real-time cursors/presence; offline editing on the web.
- Ferry operator templates without real sample documents (§9.4).
- Automatic E2E handover of the guest's logbook copy (later; §8.8).

Anti-goals (would make it a failure even if it works)
- A planned element counting as travel evidence (stats, passport, achievements) before the
  traveller confirms it.
- A placeholder and its booking both counted in the budget, or a booking silently created as a
  second element beside its placeholder.
- A booked element moved by a date shift without the user seeing it.
- A guest principal resolving to a local `User`, reaching anything outside its one plan, or the
  guest's server ever receiving plan content.
- Spontaneous nights nagging the user.

## 4. Constraints from the code (measured 2026-10-17, `main` 094cecf9f)

- Plan state is one JSON document (`TravelPlan.state`, ≤1 MiB, `.strict()` zod, `version: 1`,
  collection caps). A shape change needs `version: 2` and an upgrade of stored v1 JSON.
- Writes: `{clientRef, baseRevision, operation}`, CAS on `revision`, receipts with `before`,
  undo = latest mutation only. The Companion replays receipts — the write contract stays.
- Types are mirrored backend↔frontend (`travplanTypesMirror.test.ts`) and copied by hand in the
  Companion (`lib/travplan/types.ts`).
- Roadtrip domain exists: `TripRoute(kind="roadtrip")`, `TripStop` stations (stay/free/pass/via,
  derived), `TripRouteLeg` (mode road|ferry|rail|foot|bike, routed/straight), `FerryJourney`
  with `roadtripLegId`, `TripExpense` kinds incl. ferry/toll/pitch/fuel,
  `PUT /roadtrips/:id/stations` (atomic replace, `expectedStationIds`), `POST /roadtrips/:id/stations`
  (Companion append, idempotent within 150 m), `PUT /ferry/:id/roadtrip-leg`.
- Road routing: ORS / GraphHopper / OSRM, instance-wide provider, 300 calls/user/day, file
  cache, straight-chord fallback, never fails a save.
- Ports: `Port` table (~12 060 rows, UN/LOCODE, lat/lon, zone), `GET /ports?q=`.
- Weather: Open-Meteo forecast (v1, 16 days), observed past days (`openData/openMeteo.ts`,
  gated by `openDataEnabled`); no climate normals.
- Parsing: one dispatcher `parseDocument()`; `PARSER_SUPPORTED_DOMAINS` lacks ferry; ferry
  mails score as cruise; generic `POST /ferry/ticket-preview` exists; templates live in the
  external `travstats-templates` repo (v2 envelopes, `TEMPLATE_DOMAINS` lacks ferry).
- Federation: Ed25519 server keys, admin-pinned verified peers, https origins without port,
  one signed endpoint `POST /api/v1/comparison-peer`, no remote-user session, no write action,
  body ≤8 KB. "Full records never travel unencrypted." "A remote ID must never resolve directly
  to a local user or trip ID." Restored clones start with federation disabled.
- Same-server sharing: linked copies, consent first, facts sync, private fields, notices with
  undo; covers ferry; not roadtrips.
- Ratchets: 800-line file limit, OpenAPI coverage + response schema, response-shape family
  (travplan router = bare), coverage floor, DE/EN parity, beta registry with `why`/`returnsWhen`.
- Companion already has: TravPlan screens (Today/Plan/Packing/Documents) with offline edit queue
  and conflict handling; roadtrip "Tonight here" (`app/tonight.tsx`, nearby campsites via
  `GET /nearby/lodging`).

## 5. Part 1 — Route plans

### 5.1 Plan shape

`PlanState.version` becomes `2`. New top-level field `shape: "stay" | "route"` (v1 plans upgrade
to `"stay"`). Upgrade is a pure function `upgradeV1(state) → v2` applied on read and on the
first write; stored rows are rewritten lazily (no data migration needed, a test pins that every
v1 fixture upgrades losslessly).

New collections (all bounded, `.strict()`):

```
stations[] (≤60)  { id, title, place: Place, nights: 0..60, pinnedDay?: Day,
                    night: NightPlan, note, order }
stages[]   (≤80)  { id, fromStationId, toStationId, mode: "drive"|"ferry"|"rail"|"flight"|"other",
                    departDay?: Day, departTime?, durationMinutes?, distanceKm?,
                    metricsSource: "routed"|"straight"|"user"|"booking",
                    bookingId?: string, overnight: boolean, note }
variants[] (≤3)   { id, name, stations[], stages[] }   // inactive alternatives
activeVariantId   string | null
vehicle           { kind: RoadtripVehicle, lengthM?, consumptionPer100?, fuelPrice?, fuelCurrency? } | null
```

`Place = { name, lat, lon, country?(ISO2), zone?(IANA), ref?: { kind: "port"|"geo"|"place", id } }`
— produced by the place search (§5.6), never free text alone when a coordinate is known.

`NightPlan` (one of):
- `{ kind: "booked", bookingId }` — a lodging booking (campsite or other) covers the nights.
- `{ kind: "idea", candidates: [{ id, title, place?, url?, note }] (≤10) }`
- `{ kind: "pitch" }` — free pitch / Stellplatz, no booking expected.
- `{ kind: "spontaneous" }` — decided on site; never a finding.
- `{ kind: "onboard" }` — only valid when the arriving stage is an overnight ferry; set
  automatically.

Day trips are ordinary `items` with a new optional `stationId`; their `day` must fall inside
the station's days (finding otherwise).

The single-destination (`shape:"stay"`) plan keeps working unchanged; its UI gets the §5.8 fixes.

### 5.2 Placeholders

`PlanBooking` gains `placeholder: boolean` (default false) and `estimate: { amount, currency } | null`.
A placeholder has no reference/provider requirement and is never sent to execution.

- Budget: a placeholder counts its `estimate` as **estimated**; a booking counts `amount` as
  committed. A placeholder and its replacement are never both counted (anti-goal).
- New operation `replace_placeholder { placeholderId, value: PlanBooking }`:
  the placeholder's **id is kept** (so stages, nights, items and transfers keep pointing at it),
  `placeholder` becomes false, fields are taken from `value`, `details.replaced = { estimate,
  replacedAt, by: actor }`. Undo restores the placeholder (standard receipt `before`).
- **Matching on import** (pure function `matchPlaceholders(candidate, state)` → ranked list):
  same kind; endpoints within 30 km (ports/cities via coordinates when known, else normalised
  names); departure day within ±1; for lodging, overlap with the station's nights. The import
  review dialog (canvas board 8) shows the best match with a field-by-field table
  (changed = accent, new = good) and offers *Replace*, *Add as additional booking*,
  *Choose another placeholder*. No match → normal draft.
- Existing v1 duplicate merge (same kind/reference/days/places) still applies first.

### 5.3 Dates flow

Pure function `scheduleRoute(state) → { stationDays, stageTimes, conflicts }`:
- Station 1 arrives on `startDay`. A station's departure day = arrival + nights. A stage departs
  on the departure day of its from-station (or its own `departDay`/`departTime` when booked);
  arrival = departure + duration; an `overnight` stage (ferry) adds one night on board and the
  next station arrives the following day.
- **Anchors** are booked stages/nights and `pinnedDay`. Changing nights shifts every later
  station until the next anchor; if the shift would move an anchor, nothing booked moves —
  instead a `scheduleConflict` finding names both elements and the days.
- `endDay` is derived for route plans (last arrival), editable only as "planned return" target;
  a mismatch is a finding (`routeLongerThanTrip` / `routeShorterThanTrip`).

### 5.4 Findings for routes (added to `rules.ts`, same suppression model)

| code | when |
|---|---|
| `stageUndecided` | a stage with mode `ferry`/`rail`/`flight` that is neither booked nor a placeholder |
| `placeholderDue` | a placeholder whose stage departs within 21 days (info) / 7 days (attention) |
| `nightUndecided` | a station night `idea` with zero candidates — never for `spontaneous`/`pitch` |
| `scheduleConflict` | §5.3 |
| `longDrive` | a drive stage longer than pace limit (relaxed 5 h, balanced 7 h, busy 9 h) |
| `ferryConnection` | a ferry departs less than 2 h after the planned arrival of the drive before it |
| `dayTripOutside` | a day trip not inside its station's days |

`nightGap` for route plans counts station nights (every state except a missing night), so it
fires only for nights not covered by any station or stage — and never because of `spontaneous`.

### 5.5 Routing and metrics

Drive stages are routed through the existing provider (`services/tour/routing`), cached, with
the same quota and straight-chord fallback, `metricsSource` recording which. Ferry stages take
distance from the booking or the great-circle between ports; duration from the booking or the
user. Routing runs on demand (stage saved, "recalculate") and never blocks a save; the result is
applied as an ordinary mutation (`stage_metrics`) so receipts and undo stay uniform.

Fuel estimate per variant = Σ drive km × consumption × fuel price (vehicle settings, all
optional); unknown inputs → "unknown", never 0. Toll is entered by the user or unknown.

### 5.6 Place search

A single endpoint `GET /travplan/places?q&kind` merges (a) the user's own places and visited
destinations ("schon 2× besucht"), (b) ports (`Port`), (c) Open-Meteo geocoding (existing
`locations.ts`). Results carry `Place` incl. zone. Choosing the plan destination also sets
time zone, currency (country → ISO 4217 table, editable) and weather location (canvas board 3).

### 5.7 Weather per station

- Forecast: existing call, per station inside the 16-day horizon; one request per distinct
  station coordinate; quota per call as today.
- Climate means outside the horizon: Open-Meteo archive daily max/min/precip for the same
  calendar window over the last 10 years, averaged; cached per (rounded coordinate, month
  window) for 30 days; labelled "Mittel aus Messwerten 2016–2025". Gated by `openDataEnabled`
  like other open-data calls. Missing → "noch keine Angabe", never a fake value.

### 5.8 Web UI (canvas boards 1–8)

- Sections reduced to **Übersicht · Reiseplan/Route · Buchungen · Packen & Aufgaben · Budget**.
  Planungshilfe (AI) becomes a header action; Reisecheck findings move into "Als Nächstes" on
  the overview and inline in the plan; handover becomes an overview card.
- Overview: countdown, readiness checklist (derived from findings + tasks), budget card,
  "Als Nächstes" (top 3 findings with direct actions), weather, at-a-glance strip.
- Route view (board 7): stats row, legend of states, timeline of stations and stages with state
  styling (booked solid, placeholder dashed accent, spontaneous dashed neutral, own drive good),
  candidates and day trips per station, map with route (MapLibre + `MapboxOverlay`, colours via
  tokens), weather per station.
- Stay view (board 2): all days, items with time range, place, duration, walking/transit gap,
  ideas tray (drag to day; tap-to-assign fallback for touch/keyboard), map.
- Create flow (board 3): step 1 destination search + date range + travellers + pace, auto-taken
  zone/currency/weather shown and editable; step 2 bookings (import or placeholders). Route
  plans start from "Start", "Ziel" and optionally "zurück zum Start".
- Every trip page offers "Diese Reise planen" (also when no plan exists).
- Fixes: localised dates (`Sa, 24. Okt`) everywhere, empty states with an action, toast with
  undo instead of the permanent button, "Bearbeiten" vs "Neu" titles, cancel buttons, no
  confirm-as-experienced before the item's day, AI request as placeholder text with quick
  suggestions, header actions in an overflow menu on narrow widths, tasks shown once.
- Target device is the tablet (CLAUDE.md, owner 2026-09-28: "the web build is drawn for iPads",
  the phone is the Companion's job). Touch sizing follows `useCoarsePointer`, layout switches
  follow `useIsPhoneViewport`; the guest mode (§6.5) must still be usable on a phone browser,
  because a remote guest may have no Companion paired yet.
- Variants (board 8 right): compare table (km, drive days, nights on the island/at destination,
  ferry/known costs, fuel estimate), "activate" swaps active and alternative.
- All colours/sizes via design-system tokens (`travplanDesignSystem.test.ts` stays green).

### 5.9 Handover to the logbook (route plans)

Extends `handover`/`execution`. Confirming a route plan **after** its stations' days creates on
the owner's server, in one transaction per step and only for confirmed parts:
- the plan's one `TripRoute(kind="roadtrip")` on the plan's trip (created if absent, vehicle
  from the plan; see C1 in §11 — reconciled per station, never a blind replace);
- stations through `reconcilePlanStations` (C1), night mapping: booked → `stay` (creating `Lodging(type="campsite"|…)` + `LodgingStay` first),
  pitch/spontaneous-with-place → `free`, unknown → `free` with the place the Companion recorded;
- ferry bookings → `FerryJourney` created and linked to their leg (`PUT /ferry/:id/roadtrip-leg`
  logic, mode `ferry`);
- day trips → journal entries (existing) or day tours anchored to the station when the user
  recorded a track;
- `recomputeTripStatus` after the batch (the station PUT does not call it today).
Each created record carries `externalRef:"travplan:<id>"`; withdrawal follows v1's
"only untouched evidence" rule. Sharing propagation hooks are called as in the existing writers.

## 6. Part 2 — Co-planning

### 6.1 Roles

`TravelPlanMember { id, planId, kind: "owner"|"local"|"remote", userId?, remoteOrigin?,
remoteSubject?, displayName, role: "editor", status: "invited"|"active"|"left"|"revoked",
invitedAt, joinedAt, revokedAt }`.

- Owner: everything.
- Editor (local or remote): every plan operation except `delete_plan`, managing members, and
  changing the AI cloud policy (that is the owner's data-protection choice). Editors may
  upload documents to the plan's trip.
- Execution/handover acts on the **owner's** logbook only; an editor confirms nothing in the
  owner's logbook (they can mark "we did it" as a plan state, the owner's confirmation creates
  evidence).

### 6.2 Personal parts

`packing[].ownerMemberId` for `scope:"personal"` and `notes` per member (`memberNotes[]`) are
visible only to that member (filtered in the PlanView per principal). Shared packing shows who
brings it. Budget shows the trip total and optional per-member split (`costs[].splitMemberIds`).

### 6.3 Concurrency, attribution, notices

- Receipts gain `actorMemberId`; the PlanView exposes `lastMutation { id, actor, at, summary }`.
- CAS stays; a `PLAN_REVISION_CONFLICT` reloads and shows "Papa hat inzwischen X geändert" with
  the user's pending edit kept for re-apply (web) — the Companion already keeps both versions.
- Each accepted mutation by one member creates a plan notice for the others (local: existing
  inbox; remote guest: shown on their next load + optional e-mail if their address is known).
  Undo stays "latest mutation only" and may be done by any member; the notice names it.
- Polling: the web refetches the plan on focus and every 30 s while visible (`ETag` = revision,
  304 when unchanged). No push channel.

### 6.4 Same-server members

Invite a local user by username; requires an accepted `ShareConsent` in both directions (owner
rule 2026-10-16). The member accesses the plan through their normal session at
`/plan/<tripId>`; access checks move from `trip.userId === me` to `member(plan, me).status ===
"active"`. At handover each local member receives a linked copy through the existing trip
sharing (`shareTrip`), so facts sync and private fields stay private.

### 6.5 Remote guests (D4, path A)

Preconditions: federation enabled on both servers, each server has pinned and verified the
other as peer (existing admin flow), both reachable over `https://` without a port.

Flow
1. Owner invites: picks a verified peer origin and enters the guest's username there (display
   only) → host creates `TravelPlanMember(kind="remote", status="invited")` and an invite secret
   (32 bytes, stored hashed, single use, 7 days). The UI shows a link
   `https://<host>/plan/join#<inviteId>.<secret>` to send by any channel.
2. The guest opens the link; it lands on the host. The host page shows "Mit deinem TravStats-Server bestätigen" → redirects the browser to
   `https://<guest-origin>/federation/vouch?host=<host>&invite=<inviteId>&nonce=<n>` (host
   origin must be a verified peer of the guest server; otherwise the guest server refuses).
3. The guest server requires the guest's own session, shows "Bei <host> als <username>
   bestätigen?", and on consent issues a **vouch**: `{v:1, iss:<guest-origin>, aud:<host>,
   sub:<opaque per-host subject>, name:<display name>, invite:<inviteId>, nonce, iat, exp
   (≤120 s)}` signed with the guest server's Ed25519 key (canonical JSON, test vectors), and
   redirects back to `https://<host>/plan/join/callback` with the vouch in the URL fragment.
4. The host verifies: signature by the pinned key of `iss`, `aud` = itself, nonce matches the
   one it issued for this browser (HttpOnly cookie), invite open and bound to `iss`, not expired,
   nonce unseen (replay table). It activates the member (`remoteSubject = sub`) and issues a
   **guest session**: HttpOnly, Secure, SameSite=Lax cookie `ts_guest`, separate from the user
   JWT, scope `plan:<planId>`, 30-day sliding expiry, revocable server-side.
5. The guest uses the host's own web UI in **guest mode**: only `/plan/<tripId>` routes, header
   shows host name and "Gast"; no other navigation. The guest's server never sees plan data
   (it only signed a vouch).
6. Companion: from guest mode the guest can show a QR for a **guest PAT** (`ts_gpat_…`) scoped to
   the one plan, so the phone app talks to the host directly.

Guest API surface: `/api/v1/guest/plans/:planId/...` mirrors the plan endpoints (read, mutations,
forecast, places, packing suggestions, documents upload/list for the plan trip, proposals if
AI is allowed by the owner). A separate router, separate auth middleware
(`authenticateGuest`), never the user JWT path; `req.guest = { memberId, planId }`, never a
`userId`. AI and weather quota for guests count against the **owner's** limits.

Security (threat model, must be reviewed before un-gating):
- Principal isolation: guest tokens cannot authenticate any non-guest route (test enumerates the
  router table); guest middleware rejects user JWTs; plan id in path must equal the token's.
- Revocation: owner revokes → member `revoked`, all guest sessions/PATs for it deleted; peer key
  re-pin or peer suspension revokes all remote members of that origin; restore of a backup
  starts with every remote member suspended (re-enable per member).
- Limits: per guest 120 writes/min, 600 reads/min, uploads ≤20 MB each, ≤50 documents per plan
  per guest; per host total remote members ≤20.
- Audit: every guest write is a receipt with `actorMemberId`; owner sees a member activity list.
- Redirect safety: vouch endpoint only for verified peer hosts; callback path fixed; vouch in
  fragment (not logged by proxies); nonce bound to browser cookie (login CSRF).
- Cookies: `ts_guest` path `/api/v1/guest` + `/plan`; `no-store` default unchanged.
- No cross-server write: the peer protocol is not extended with write actions; the host never
  calls the guest server except the existing `ping`.
- Beta key `travPlanGuests` (separate from `travPlan`), `returnsWhen`: security review done.

### 6.6 Leaving, deletion

Guest leaves → member `left`, sessions deleted; the guest may first download the plan as a
`.travstats` single-trip export of the plan (planned data only). Owner deletes plan → members
see "Plan gelöscht" on next load; nothing remains accessible.

### 6.7 The guest's own logbook copy

After the trip the owner confirms; the guest gets a "Reise übernehmen" action in guest mode that
downloads a `.travstats` export of the **confirmed** trip (owner's roadtrip, ferries, stays,
journal — private fields of the owner excluded) which the guest imports on their server with
the existing single-trip import. Automatic E2E publication to the guest's server is a later step
(non-goal here).

### 6.8 Roadtrip sharing and exchange format (D5)

- `roadtrip` (TripRoute kind roadtrip + its stations and legs) joins `SHARE_TYPES` with an
  adapter, fact whitelist (name, vehicle, station title/place/dates/night state, leg mode and
  metrics) and private fields (notes, odometer, expenses, tracks); `DOMAIN_SHARING` updated,
  DE/EN labels, `shareTypes.test.ts` and `propagate.writePaths.test.ts` stay green
  (`replaceStations`, companion append, leg PUT, ferry link call `propagateWrite`).
- Exchange format version 4 (`services/trip/exchange/format.ts`): adds `roadtrips[]` with
  stations, legs and `ferryLegRef`; importer recreates the roadtrip and re-links ferries;
  v3 files keep importing.
- Plan document visibility (D6): `TravelPlanDocument { planId, documentId, uploadedByMemberId,
  bookingId? }`; member reads list only documents in this table; the owner's other trip
  documents are filtered out server-side (test).

## 7. Part 3 — Ferry booking import

- `ferry` joins `PARSER_SUPPORTED_DOMAINS` (backend + frontend mirror), `DomainBody` gets
  `FerryBody { domain:"ferry", crossings: FerryImportCandidate[], parserUsed, ollamaAvailable,
  fallbackCode?, fallbackReason?, domainMismatch? }`.
- Domain detection: `SIGNALS.ferry` (operator names GNV, Grimaldi, Moby, Tirrenia, Caronte &
  Tourist, Corsica Ferries, Minoan, Anek, Superfast, Stena, P&O, DFDS, Brittany, Finnlines,
  Tallink; shapes: vehicle registration/length + crossing, "imbarco", "Ro-Pax", "deck passage",
  "Fahrzeug" + "Überfahrt"), tuned so a ferry mail outranks cruise and a cruise mail does not
  become ferry (fixtures for both directions).
- Reader: templates (new `ferry` template domain, issuer kind `ferry-line`, runner, `v2Ferry.ts`)
  first; fallback = the existing `ticketPreview` labelled reader + verified LLM extraction.
  Ports resolved through `Port` / port geocoder; duplicate check against `FerryJourney`.
- Companion's `ParseDomain` gains `ferry`.
- TravPlan import maps ferry candidates to `kind:"ferry"` bookings and runs placeholder
  matching (§5.2). The ferry domain's own import creates `FerryJourney` as today's ticket
  preview does.
- Operator templates are written only from real sample documents (owner provides; stored under
  `test-samples/ferry/` with personal data redacted). Until then the generic reader serves.

## 8. Part 4 — Companion (repo `TravStatsCompanion`, branch `dev/travplan-v2`)

- 8.1 Types mirror updated to plan v2 (+ a mirror test in the app, today missing).
- 8.2 Route plan screen: stations/stages list, state badges, next stage, map of the route.
- 8.3 "Tonight here" for plans: from Today, when the current day falls on a station with night
  `idea`/`spontaneous`/`pitch`: one GPS fix → nearby campsites (`GET /nearby/lodging`) →
  choose → plan mutation `station_night { stationId, night: pitch|booked(place) , place }`
  queued through `queuePlanEdit`; if the plan's trip already has a roadtrip, also append the
  roadtrip station (existing `saveTonight`).
- 8.4 Guest pairing: scan the guest-PAT QR (§6.5.6); the app shows the plan only, labelled with
  the host name.
- 8.5 Ferry parse domain in capture.
- 8.6 Offline: existing plan cache/queue; route plan adds stations/stages to the cached view.
- 8.7 Plan notices from other members in the app's inbox view.
- 8.8 (later) E2E logbook copy for guests.

## 9. Build order (one branch, four parts; each step green before the next)

1. Plan v2 schema + upgrade + mirror + placeholder ops + scheduler + findings (backend, tests).
2. Place search, routing of stages, climate means (backend).
3. Web: overview/route/stay views, create flow, fixes, variants, import review with
   placeholder match (frontend).
4. Handover of route plans to roadtrips.
5. Members: data model, local members, notices, attribution, polling.
6. Remote guests: vouch endpoint, join flow, guest session/PAT, guest router, guest mode UI,
   limits, revocation, threat-model doc + tests.
7. Ferry parse domain + signals + fallback reader + TravPlan mapping.
8. Companion parts (separate repo).
Docs: `docs/features/travplan.md` rewritten, new `docs/features/travplan-guests.md` (threat
model), CHANGELOG via `/deploy` only.

## 10. Testing

- Pure functions (upgrade, scheduler, placeholder matching, findings, fuel estimate, vouch
  canonicalisation) with table tests; v1 fixtures upgrade losslessly.
- Integration (`jest.travplan.config.cjs`, loopback `travplan_*` DB): replace_placeholder with
  undo, schedule conflicts never move anchors, handover creates roadtrip + linked ferry + campsite
  stays and withdrawal deletes only untouched evidence, member permissions (editor cannot
  delete/manage), guest isolation (every non-guest route rejects a guest token), vouch replay /
  wrong audience / unverified issuer / expired, revocation kills sessions.
- Two-server E2E: two local backends with self-signed-free test origins via the existing
  federation E2E harness (`services/federation/e2e`), invite → vouch → join → edit → revoke.
- Parser fixtures: ferry vs cruise detection both directions; generic reader on redacted samples.
- The four silent-failure classes (CLAUDE.md "A failure must reach the user as itself") are
  tested on their failure paths: the place picker offers ports/places/geocoder results (not a
  derived subset) and a pick carries name, coordinates, country and zone; routing, climate,
  forecast, parse and vouch failures each surface their own reason code mapped to DE/EN copy,
  never a silent fallback presented as success; re-routing or a failed weather fetch never
  replaces stored metrics/values.
- Browser check of every board at 1366×1024 (tablet) and 390 px (guest mode), the airline-logo
  lesson: green tests are not a look.

## 11. Calls made by the author (not owner decisions — check while reading)

- C1. **One roadtrip per route plan, reconciled, never replaced.** The plan stores `roadtripId`
  and `stationLinks { planStationId → tripStopId }`. The roadtrip is created by the first of:
  handover of the first station, or a Companion "Tonight here" on a plan station. Handover is
  **per station** (with its arriving stage): it upserts that station's stop through a new
  service `reconcilePlanStations` built on `replaceStations` with `expectedStationIds`, keeping
  every stop the phone appended (ordered by date) — never a blind replace. Withdrawal removes
  only stops/ferries/stays this plan created and nobody touched.
- C2. **Variants share items and bookings.** Stations/stages copied into a variant keep their
  ids where they are the same place, so references survive a switch. On switch: day trips whose
  station is missing go to the ideas tray (kept, `stationId` cleared on activation, undoable);
  bookings/placeholders tied to a stage that is not in the active variant stay in Buchungen
  marked "nicht in der aktiven Route" and are counted in the budget only when booked
  (committed money stays real), placeholders of inactive stages are not counted. Placeholder
  matching on import searches the active variant first, then the others, labelled.
- C3. **Companion compatibility.** Clients send `X-TravPlan-Client: <n>` (the app sends it from
  this release; absent = 1). For `shape:"stay"` plans the server serves a v1-shaped view and
  accepts v1 operations from v1 clients (lossless; a test round-trips). Route plans answer v1
  clients with `409 PLAN_CLIENT_OUTDATED`, which old builds already show as an error and new
  copy explains ("App aktualisieren"). No downgrade of route plans.
- C4. Placeholders still open at handover stay in the plan only; they never become records.

## 12. Builder's latitude

Component structure, file split (≤800 lines), exact copy (DE first, EN mirror), map styling,
polling interval tuning, routing batching, quota numbers within the stated bounds.
