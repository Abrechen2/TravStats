# Native location history — everything Dawarich does, and more, inside TravStats

Status: **direction set by the owner, details open** (2026-10-20). Branch
`dev/location-history`. **The plan for the whole feature — server and
Companion.** The Companion repository gets one ADR that points here and
replaces ADR 0013 points 3, 4 and 7; the work itself is planned in this file.

## 0. Owner direction (2026-10-20)

Verbatim: „Im Grunde soll das so nützlich wie möglich sein. Es soll am Ende eine
zusätzliche Option sein, also internes Location-Tracking oder mit Dawarich. Ich
möchte also die Dawarich-Funktionen + mehr komplett in TravStats haben, um Orte
und so festzuhalten, bei Reisen dann genaues Tracking und so weiter."

Read as decisions:

1. **Two interchangeable sources, chosen per user**: *internal* (TravStats stores
   the positions itself) or *Dawarich* (as today). Every feature built on
   positions works with either; nothing is internal-only by design except what
   Dawarich structurally cannot deliver (§3.3).
2. **Feature parity with Dawarich, then more** — the „more" is the logbook: every
   position is evidence for trips, stays, journeys and countries (§2).
3. **Everyday recording** to capture places, not only during trips — this goes
   beyond ADR 0013 (Companion) and needs its own ADR there (§5).
4. **Precise tracking during trips** — a track, not ADR 0013's coarse
   ~500 m / 5 min (§5).
5. **Everything settable, as in Dawarich** — recording rates on the phone and
   detection thresholds on the server have defaults, presets and „Eigene"
   values (§5).

Standing principle (same day): the server is the record, the Companion is only a
companion. A position the phone records reaches the server; the phone keeps a
cache.

## 1. Where we stand (measured on main, 2026-10-20)

TravStats has **no point store of its own**. It pulls from Dawarich (read-only
client pinned to 1.9.2, `GET /api/v1/points`, ≤ 50 × 1000 per call) and condenses
on the spot:

- `country_days` — daily sweep, flight air-time and speed filtered, shown as
  "unconfirmed" in the passport, never proof (forgejo#299). The table already
  carries `source` in its unique key (`countryDays/countryDaySource.ts`), so a
  second pipeline can disagree with Dawarich instead of overwriting it.
- `DawarichStay` findings — 6-hourly scan, 150 m / 20 min / 30 min gap,
  look-back ≤ 30 days, into the inbox; accepting creates a Place + PlaceVisit
  (forgejo#294); market/venue findings from cached OSM areas.
- On-demand track pulls for a tour or a cruise; Companion flight recordings
  (`flight_tracks`, ADR 0010); GPX/TCX/FIT archives; Strava.
- The raw points of every sweep and scan are thrown away. No ingest API, no
  Google Timeline import (only saved Maps lists), no raw-point map.
- In progress, **not merged**: `feat/trip-recording-316` (forgejo#316) stores the
  Companion's trip recording as one JSON blob per upload in `TripRecordingBatch`,
  bound to a trip, dropping points outside the trip's days and inside flights.
  On the Companion, the **device-only trip recorder of ADR 0013 is built and
  running** (`app/src/lib/trip-track/`: `syncTripRecorder`,
  `handleTripLocations`, per-trip AsyncStorage in `store.ts`, deleted 30 days
  after the trip). Only its upload (companion#73) is missing. This plan
  therefore migrates working behaviour; it does not start from nothing.

## 2. Dawarich feature map (v1.16, commit 2dc26c4) → TravStats

| Dawarich | TravStats internal | TravStats with Dawarich source | Phase |
|---|---|---|---|
| Points store, dedup on user+time+position | `location_points` (§3.1) | Dawarich holds them; pulled on demand | P1 |
| Own apps, OwnTracks, Overland, Traccar, Home Assistant ingest | Companion + OwnTracks/Overland HTTP ingest; HA via OwnTracks format | Dawarich's own | P1 / P4 |
| Imports: Google Takeout (Records, Semantic, phone Timeline), GPX, KML, GeoJSON, CSV, FIT, TCX, Polarsteps, photo geodata | all of these, as resumable jobs | Dawarich's own | P1 (Dawarich, GPX) / P4 (rest) |
| Visits (100 m / 5 min / 3 pts, suggested → confirmed) | stay detector on the store → inbox → Place + PlaceVisit (exists for Dawarich, forgejo#294) | as today | P2 |
| User-drawn areas | Places with a radius / polygon (Places exist) | same | P3 |
| Tracks + transport-mode detection | segments by speed/mode, matched against logged flights, rail, bus, ferry, rental, roadtrip | same, on pulled points | P4 |
| Trips (time range, distance, countries, photos) | away-from-home periods → trip suggestions; existing trips get a recording layer and a day timeline | same | P3 / P4 |
| Stats per month (distance, countries, cities) | year-in-review and stats: km on the ground, countries (P3); by mode and new cities once P4 derives them | same | P3 / P4 |
| Days in country | `country_days` (exists), second source `internal` | as today | P2 |
| Fog of war / heatmap (H3) | dashboard mode „Erkundet" (H3 or tile aggregation, never raw dots at world zoom) | same | P3 |
| Live map (own position) | „Zuletzt gesehen" on the dashboard (own only) | Dawarich's last point | P3 |
| Anomaly filter (teleports, frozen fixes) | `flags` on the point, filtered in every derivation | same filter on pulled points | P1 |
| Exports (GeoJSON, GPX, full archive) | GeoJSON/GPX by range; part of the TravStats backup | Dawarich's own | P1 |
| Family location sharing, Poster/Video studio, MCP | **not copied** — not logbook features; revisit on request | — | — |

**What TravStats adds that Dawarich cannot**: positions confirm the logbook —
a flight gets evidence for review, a stay can fill lodging nights, a
roadtrip gets its driven line, a missing journey becomes a question, a passport
country gets its evidence. The data stays on the trip, the day, the passport and
the dashboard, not on a separate „Standortverlauf" app screen.

## 3. Design

### 3.1 One point store
`location_points`: `user_id`, `t` (instant), `lat`, `lon`, `accuracy_m`,
`altitude_m`, `speed_mps`, `course`, `source` (companion | owntracks | overland |
gpx | google_timeline | dawarich_import | …), `device_id`, `import_id`,
`motion` (stationary | walking | running | cycling | automotive | unknown, as the
phone reports it), `flags` (anomaly, in_flight), index `(user_id, t)`.

**No position exists twice** (owner, 2026-10-20: „Doppelung soll nicht
gehen"). Each observation carries a stable id from its origin (the phone's
fix id, an import's row key), so a retry or a re-import is recognised exactly.
Two origins describing the same moment — a Companion fix and the same day from
a Google Timeline import, say — are merged on ingest when they lie within a
few seconds and inside each other's accuracy: one point is kept (the more
accurate), and the other origin is recorded as a second *membership* of that
point, not as a second row. Deleting one import therefore removes only points
no other origin still vouches for. Plain columns; PostGIS is not needed for
v1. A precise trip at ~1 point / 10–30 s is ~3–8 k points per travel day; a
travelling user-year stays in the low millions — fine for Postgres with the
`(user_id, t)` index; monthly partitions are a later optimisation, not a v1 need.

**forgejo#316 folds into this store before it merges.** Its web work (trip map
layer, day filter, GPX, delete) is kept and reads `location_points` by the trip's
time range. Its server-side trip bounds go: what is recorded is decided on the
phone by the user's consent (§5); the server keeps what it receives and marks
in-flight points with a flag instead of dropping them. Flight recordings stay in
`flight_tracks` (ADR 0010).

### 3.2 Ingest
One API for every client, **not bound to a trip** — the server derives the trip
from the time:

`POST /api/v1/location/points` — `{ uploadId, source, deviceId?, points: [...] }`,
≤ 5000 points per call, idempotent on `uploadId` (a retry answers the stored
result) and on the point unique key. Answer: accepted / duplicate / rejected
counts. The Companion deletes a point from its cache only after this answer.

Further paths into the same store:
1. Companion — §5.
2. **Full import from Dawarich** (paginated, resumable job) — for switching a
   user from the Dawarich source to internal with their whole history.
3. File imports: Google Timeline (on-device export JSON, Records.json, Semantic
   history), GPX/KML/GeoJSON/FIT/TCX (the track-archive readers exist),
   Dawarich/OwnTracks exports, later Polarsteps and photo geodata.
4. OwnTracks / Overland HTTP endpoints with a per-user token, translating into
   the same call — for users without the Companion (and Home Assistant via the
   OwnTracks format).
5. **Apple Shortcuts without the Companion** — a downloadable Shortcut template
   that posts one point to `POST /location/points` with a per-user ingest key,
   checking the privacy zones (Wi-Fi name, distance) before it sends. The owner
   runs exactly this against Dawarich today (2026-10-20).

### 3.3 Source choice: internal or Dawarich
A per-user setting **„Standortquelle: Intern / Dawarich"** (Settings →
Standortverlauf). Every derivation reads positions through one interface,
`LocationSource.points(userId, from, to, filter)`, with two adapters:

- **internal** — reads `location_points`;
- **dawarich** — today's `dawarichClient` pull, unchanged behaviour.

`country_days.source` gets the value `internal`; the stay findings move from
`DawarichStay` to a source-neutral table (or gain a `source` column).

**Exactly one source holds the positions, never both** (owner, 2026-10-20).
- *Intern*: everything lives in `location_points`; Dawarich is not read.
- *Dawarich*: everything lives in Dawarich. The Companion still uploads to
  TravStats (one pairing, one endpoint, nothing lost), and TravStats **relays**
  each batch to the user's Dawarich and keeps it only until Dawarich has
  accepted it — no lasting copy. Derivations read Dawarich alone.
- *Switching* Dawarich → intern runs the full import (§3.2 point 2) and then
  stops reading Dawarich. Intern → Dawarich sends the stored points to
  Dawarich, then deletes them here after a confirmation. Either way the
  positions end up in one place.

What only internal can do: device id and motion per point, precise trip
recordings tied to the Companion's consent, „Zuletzt gesehen" without a second
server, and positions that are part of the TravStats backup.

### 3.4 Derivations — all as suggestions with provenance (existing rule)
- **Country days** — `countryDays/reduce.ts` unchanged, reading the source;
  still „unconfirmed", never proof alone (forgejo#299). **Confirming a country
  means confirming an entry, not the country** (owner, 2026-10-20: „was
  bestätige ich da, müsste ich nicht einen Ort angeben"). The inbox card
  proposes the place where the points cluster that day („Hakata-Hafen,
  Fukuoka, 2 h 45 min") and a matching unlogged journey if one fits; the
  answers are: save that place (the country becomes „Besucht" with the place
  as evidence), choose another place, „nur durchgereist" (counts as „Am Boden
  gewesen", evidenced by the points), or „nicht dort gewesen" (never proposed
  again for that day, points stay). There is no bare „Land bestätigen".
- **Stays → place visits / lodging nights** — the forgejo#294 detector on the
  source; no 30-day look-back any more; suppression and coverage as today.
- **Trips** — away-from-home periods (home periods exist) → trip suggestions;
  existing trips get a day timeline („Tagesablauf": stays, moves, gaps).
- **Journeys** — segments by speed and the phone's `motion`, matched against
  logged flights, rail, bus, ferry, rental, roadtrip; a confirmed match fills
  actual times or the driven line, an unmatched segment becomes a „Fehlt hier
  eine Verbindung?" question. Mode detection runs only on precise segments
  (trip recordings, imports with dense points); coarse everyday points yield
  stays and countries, not modes.
- **Flights** — points at the departure airport and at the destination around
  the block times are **evidence offered for review**, never an automatic
  „flown" (Codex review point 9); ADR 0010's flight recorder stays the only
  source of observed actual times.
- **Cities** — reverse-geocoded stays ≥ 60 min, through the instance geocoder
  budget.

### 3.5 Where it shows
- Trip page: recording layer + day timeline (forgejo#316 starts this).
- Dashboard: „Erkundet" heatmap mode; „Zuletzt gesehen".
- Passport: unconfirmed countries from either source.
- Year in review: km on the ground by mode, new cities, countries.
- Settings → Standortverlauf: source, Companion modes, imports, OwnTracks/Overland
  token, last ingest, point count, privacy zones, export, delete by range.

### 3.6 Privacy and retention
Per user, never shared, never federated, never in a public link, never in a
`.travstats` file or a comparison (as forgejo#316). Kept until the user deletes
(owner principle), with delete-by-range, export and backup.

**Privacy zones mean no tracking at all** (owner, 2026-10-20: „Privatzonen
bedeuten gar kein Tracking"; earlier the same day: „daheim ist es aus und in
der Arbeit auch deaktiviert"). There is one mode, not two: a position inside a
zone is never recorded. The Companion and the Shortcut template drop it on the
phone, so it never leaves the device; the server drops it again on ingest for
sources that cannot filter (OwnTracks, Overland), and file imports skip it.
A new or enlarged zone also deletes the points already stored inside it,
after a confirmation that names the count. Nothing derives from a zone —
„Zuletzt gesehen" shows the last position before it. A change to a zone is
synced to the phone with the other location settings.

## 4. Phases — server and Companion together

This document is the plan for the whole feature, server and Companion alike
(owner, 2026-10-20: „nicht als Issue, sondern als Gesamtplan für das
Feature"). Work is tracked here and on the Leitstand, not as separate issues.
Order follows Codex's review (§8): the riskiest unknown, the phone, first.

| Phase | Server | Companion |
|---|---|---|
| **P0** proof | decide source routing and the open owner questions (§7) | spike: precise trip recording in the background on iOS and Android — survives kill, reboot, permission change; measured battery per hour |
| **P1** record and keep | `LocationSource` contract with a minimal internal adapter (the #316 map reads through it from day one), `location_points`, `POST /location/points` with receipts and idempotency, delete with tombstones, privacy zones, backup/restore, forgejo#316 folded in, Settings → Standortverlauf (Standard/Experte), Dawarich full import, GPX import | one recording coordinator replacing `syncTripRecorder` (trip / flight / pause precedence), a durable location queue replacing the per-trip AsyncStorage store (kept until acknowledged, existing recordings migrated), uploader on the flight-track upload pattern, „Reise genau" settings, privacy zones on the device, settings synced from the server |
| **P2** derive | Dawarich adapter for `LocationSource`, country days and stays on it, inbox cards that confirm an entry (§3.4), re-evaluation as a job | „Alltag" mode, the server's inbox in the app (retiring the local `useTripStayQuestions`), the native shared queue/keychain bridge, then the Shortcuts actions „Standort jetzt senden" and „Aufzeichnung pausieren / fortsetzen" |
| **P3** show | trip day timeline, „Erkundet", „Zuletzt gesehen", year in review (km and countries), areas; Shortcut template for users without the Companion | remaining Shortcuts actions (§5.1), recording state on the trip screen |
| **P4** connect | journey and trip suggestions, flight evidence for review, cities, km by mode and new cities in the stats, OwnTracks/Overland ingest, Google Timeline and further formats | Android shortcuts / broadcast intents, native visit monitoring if P0 shows it is needed |

### 4.1 P0 — the probe (built 2026-10-20)

Companion branch `spike/location-probe` (Forgejo): a throwaway recorder
behind the developer tools (seven taps on the version → developer mode →
„Aufzeichnungstest (P0)"). Its own task registered at the app entry, one file
per batch / process start / start-stop, nothing uploaded, „Standort
pausieren" wins, wiped on unpair. Three rates — Genau 20 m / 10 s,
Ausgewogen 100 m / 1 min, Akku sparen 500 m / 5 min — and „pause while
still". The screen shows fixes per hour, interval median / p90, delivery
delay, accuracy, share ≤ 20 m, battery per hour unplugged, process starts (in
the background = the OS woke a killed app), and every gap over 5 minutes with
whether a restart ended it; the raw log exports as JSON.

**Test day:** start „Genau", live a normal day, swipe the app away once,
restart the phone once, export in the evening — on the iPhone and on the
Android test phone. A second day with „pause while still" on.

**Expected before measuring (to be confirmed or refuted):**
- *Swipe-away on iOS stops standard location updates*, and iOS relaunches an
  app only for significant-change, region or visit events — not for the
  `startLocationUpdatesAsync` stream. If the probe shows a gap that only ends
  when the app is opened, the recorder needs a significant-change or geofence
  companion that wakes it and restarts the stream (native module, §5).
- *After a reboot* neither platform restarts the stream by itself; Android
  needs a boot receiver for the foreground service.
- *„Pause while still" on iOS* may resume late after walking off.

**Measured — Android, Xiaomi Mi 11 Ultra (MIUI), 20.10.2026 18:22–18:38,
APK `2b41cf2d`, driven over adb:**
- Screen off for 10 min: the foreground service kept running and kept a
  10 s high-accuracy request; no gap over 5 min; median accuracy 11 m, 85 % of
  fixes ≤ 20 m. A phone lying still yields few fixes (distance filter 20 m):
  20 in 11 min.
- **Swipe-away from recents does not kill it on MIUI** — same process id
  afterwards, recording continued.
- **A process death ends recording for good.** After `am crash` the process
  stayed gone, the service record showed `app=null`, `restartCount=0`, no
  restart scheduled. **Opening the app again did not resume it either**: the
  process came back, the location request did not, while the foreground
  notification „Aufzeichnungstest läuft" was still on screen. Nothing told
  the user it had stopped.
- Consequence for P1 regardless of iOS: the recorder needs a **watchdog** —
  on every app start, on a periodic background task (`expo-background-task`
  is already in the app) and on boot, compare „should be recording" with
  „last fix is recent" and restart the stream when they disagree; and the
  status the app shows must come from the last fix, not from „was started".
  A stale „läuft" is the silent-success failure class of CLAUDE.md.

**Decides:** whether „Reise genau" ships on `expo-location` alone or needs the
native wake-up module in P1, and the default rate (battery per hour against
interval).

## 5. Companion (needs an ADR in the Companion repo; supersedes ADR 0013 points 3, 4, 7)

Three recording modes under „Standort", each visible and pausable („Pause wins"
from ADR 0013 stays):

| Mode | When | Rate | Purpose |
|---|---|---|---|
| **Aus** | — | — | — |
| **Alltag** (new, default off) | always | coarse: significant changes + stationary geofence (~100 m exit wakes it), iOS visit monitoring where available | places, countries, „Zuletzt gesehen" |
| **Reise genau** | from the first to the last day of a trip (ADR 0013 bounds and „Jede laufende Reise aufzeichnen") | precise: continuous updates, ~25 m distance filter / 10–30 s, paused automatically while stationary | the track, day timeline, journeys |

**Everything in this table is settable** (owner, 2026-10-20: „Das muss
natürlich einstellbar sein, so wie in Dawarich"). The rates above are only the
defaults. Per mode the user can set accuracy (low / balanced / high), the
distance filter (m), the minimum time interval (s), whether to pause while
stationary, and for uploads the batch size, the interval and „nur im WLAN". A
preset row („Akku sparen / Ausgewogen / Genau") fills these; changing a value
switches it to „Eigene". The location screen shows the expected battery cost of
the current choice.

The server-side thresholds are settable in the same way, under Settings →
Standortverlauf, as Dawarich's are: the stay radius and minimum duration, the
gap that splits a track, the anomaly limits (maximum plausible speed, minimum
accuracy), the city dwell time and the heatmap / „Erkundet" cell size. Each has
a default and „zurücksetzen". A change re-runs the affected derivations as a
job; findings the user already confirmed or dismissed stay as they are.

Flights keep ADR 0010's recorder at full rate. Points are uploaded in batches
(on Wi-Fi or every N minutes, configurable), kept on the phone until the server
confirms them, then deleted from the phone — the 30-day device retention of
ADR 0013 point 4 becomes „until uploaded". Suggestions come from the server's
inbox; the app computes none of its own (ADR 0013 point 7). On unpair the cache
is wiped; the server keeps what it has.

Native note: iOS visit monitoring (`CLVisit`) is not exposed by `expo-location`;
P1 uses significant changes + geofences, a small native module later if needed.
App Review sees an always-on purpose — the mode is off by default, explained on
the location screen, with the iOS indicator; if Apple objects, „Alltag" goes
and „Reise genau" stays.

### 5.1 Shortcuts in the Companion (owner, 2026-10-20)
„Die Kurzbefehle müssen dann beim Companion auch geben." The Companion
exposes its location functions as Apple Shortcuts actions (App Intents), so a
user builds their own automations (time of day, arriving, Wi-Fi, CarPlay,
focus) without URLs or keys:

| Action | Does |
|---|---|
| Standort jetzt senden | one point, source `shortcut`, through the outbox, zones applied |
| Aufzeichnung pausieren / fortsetzen | optional duration; „Pause wins" as everywhere |
| Aufzeichnungsart setzen | Aus / Alltag / Reise genau |
| Ort jetzt speichern | today's „Ort jetzt" as an action, with an optional name |
| Bin ich in einer Privatzone? | returns yes/no for the user's own conditions |
| Laufende Reise | returns the current trip's name and day, or nothing |

Native constraint: an intent can run while the app is not running, so it must
work without the JS runtime — Swift (`AppIntents`, iOS 16+) in a local Expo
module beside `travstats-barcode`, reading the zones and the device token
from the App Group / Keychain and writing into the same outbox the recorder
uses. Android gets the same actions as App Shortcuts / broadcast intents
(Tasker, Home Assistant) later (P4).

### 5.2 Settings levels (forgejo#318)
Settings → Standortverlauf follows the Standard / Experte levels: source,
modes, preset, suggestions on/off, privacy zones, imports and export are
Standard; the detailed recording values, the detection thresholds, „Orte als
Fläche erkennen" (default on), the Dawarich full import and the
OwnTracks/Overland key are Experte. Search finds expert settings in either
view and switches to Experte. Prototype: claude.ai artifact
„Einstellungsstufen Prototyp".

## 6. Explicitly NOT copied
Family live-location sharing, a live map of others, Poster/Video studio, MCP.

## 7. Still open for the owner
Settled on 2026-10-20: „Alltag" defaults to off; one source at a time with
the Companion relayed to Dawarich (§3.3); no duplicates (§3.1); privacy zones
record nothing (§3.6).

1. Reverse geocoding for cities: which provider and daily budget?

## 8. Cold review by Codex (2026-10-20) — to resolve before P1

Ranked by severity; each becomes a decision or a design paragraph above.

1. **Source switch can strand recordings** — with Dawarich chosen, Companion
   points are stored internally but never derived from. Separate *storage*,
   *origin* and *derivation source*, or derive from both. **→ Answered (§3.3):
   one source at a time, the Companion relayed to Dawarich.**
2. **`LocationSource` needs a completeness contract** — cursor/streaming,
   ordering, coverage, truncation and upstream failure; the Dawarich client
   caps at 50 000 points per call and the stay window at 250 000.
3. **Dedup key conflates identity with coincidence** — give observations a
   stable id, keep origin/import membership; deleting one import must not
   remove another source's evidence. **→ Answered (§3.1): stable ids,
   merge on ingest, memberships.**
4. **Upload idempotency** — persist `(user, uploadId, payloadHash, result)`
   atomically, reject a reused id with other content, per-point
   acknowledgement, retryable vs permanent errors. **→ Answered (§10.2).**
5. **Deletion semantics** — tombstones so an offline phone or a re-import
   cannot resurrect deleted points; derived caches invalidated. **→ Answered
   (§10.3).**
6. **Privacy zones** — „nicht speichern" vs „speichern, nie zeigen", and their
   effect on exports, heatmap, „Zuletzt gesehen", suggestions and geocoder
   calls; derived PlaceVisits can leak through ordinary sharing. **→ Answered
   (§3.6): one mode, nothing is recorded inside a zone.**
7. **Re-running derivations is a subsystem** — algorithm/config version,
   input revision, bounded windows, atomic replacement; user decisions stored
   apart from regenerated candidates. **→ Answered (§10.4).**
8. **Raw points immutable, inferred flags versioned** — `in_flight` and
   anomaly depend on editable flights and thresholds. **→ Answered (§10.4
   point 2).**
9. **Never confirm a flight from a gap** — airport presence plus silence is
   evidence for review, not „flown" (the mockup already says so).
10. **Scale** — ~300 MB per heavy user-year before indexes; bounded reads,
    streamed exports, downsampled map tiles, resumable restore; #316's
    read-all-batches query must not survive.
11. **Phone** — Expo exposes no significant-change API and no `CLVisit`;
    `timeInterval` is Android-only; restart after kill/reboot and Android 12+/14+
    foreground-service rules are the hardest risk. Prototype the lifecycle and
    battery first, one recording coordinator, a durable outbox.
12. **Parity is overstated** — missing: raw-point search/management, import
    inspection and rollback, Immich/PhotoPrism geotag enrichment,
    Traccar/GPSLogger.

**Reordered phases (Codex):** prove phone lifecycle + battery and settle
source routing first; then point store, ingest receipts, deletion, streamed
backup/restore and the #316 map; then Dawarich migration + one simple file
importer; defer Semantic Timeline, mode inference, flight evidence, cities.

## 9. Integration — one position end to end (second Codex review, 2026-10-20)

Phone → server → logbook, with the seams in today's code:

1. **Record** — `TripTrackSync` → `syncTripRecorder` → `TRIP_TRACK_TASK` →
   `handleTripLocations` → `recordTripFixes` becomes one coordinator (Alltag /
   trip / flight / pause), applying zones and giving each fix a stable id.
   ADR 0010's flight recorder stays its own path. Tasks register in
   `app/index.ts`, before any screen.
2. **Keep** — `trip-track/store.ts` (per-trip JSON, swallowed write errors,
   expiry) gives way to a durable queue: nothing expires before the server
   acknowledges it; unpair guards stay.
3. **Send** — modelled on `uploadFlightTracksOnce` / `runTrackUploadTask`, not
   on the barcode `outbox.ts`; auth through the paired-device PAT
   (`claimDevice` → `setPat` → `authHeaders`).
4. **Ingest** — new route under `authenticate` + `requireWriteScope`, demo
   guard, rate and body limits; Zod; zones; tombstones; atomic receipt with
   payload hash; per-point outcome. Bare response shape (ADR 0001), OpenAPI
   path + response schema, ratchet baselines.
5. **Source** — a location-source resolver above `dawarichResolver.ts`;
   keep the distinction between `getDawarichConnection` (user → admin → ENV,
   interactive) and `buildUserDawarichConnection` (no fallback, unattended).
   „Dawarich configured" is not „Dawarich selected". Schedulers'
   `eligibleAccounts()` stop requiring Dawarich credentials.
6. **Derive** — `sweepUserCountryDays` (keep its incomplete-window and
   reducer-version guards; `COUNTRY_DAY_SOURCES` gains `internal`, sweep state
   becomes per source); `stays/scan.ts` `scanStays` with its whole input path
   incl. `collectMarketFindings`, without the 30-day limit; `stays/review.ts`
   `acceptStay` / `rejectStay` generalised beyond `DawarichStay` and
   `dataSource: "dawarich"`; `trackEvidence.unconfirmedTrackCountries` and
   `passportLoader` carry the row source; „nur durchgereist" is a stored review
   decision. `tripSuggestions/engine.ts` gets reviewed location inputs, its
   `dataStamp()` and `invalidateTripSuggestions()` follow them. Tour and cruise
   track pulls (`tour/tracks/*`, `routes/cruises/tracks.ts`) move onto the
   source too.
7. **Show** — web `InboxWorkspace` / `useInboxData` / `VisitSuggestionCard`,
   passport `UnconfirmedCountries`, #316's `TripMapWithTours` /
   `TripRecordingPanel`; new read APIs (bounded, downsampled) for timeline,
   heatmap, latest. Companion: `inbox-feed` / `server/api/inbox-sources`.
8. **Around it** — backup: `pg_dump` already carries new tables; restore
   tests and `restoreAftermath` must settle jobs and caches. Account export
   (`export/allDataExport.ts`) streams. Account deletion: cascading FKs, import
   files in `collectAccountFiles`. Sharing: points stay outside
   `SHARE_TYPES`, with regression tests for share, federation, public link,
   comparison. Migrations: points + indexes, origin/import membership,
   receipts, tombstones, jobs, zones, settings, versioned derivation and
   review state; existing stay/scan rows marked as Dawarich.

**Build order:** P0 phone spike + decisions (§7) → P1 contracts (identity,
completeness, receipts, tombstones), durable queue, ingest, restore tests →
one trip-map slice end to end → Dawarich import + GPX → P2 adapters and
server inbox → P3 views → P4 inference and the statistics that need it.

## 10. The four P1 rules — modelled on Dawarich

Owner, 2026-10-20: „checke genau, wie Dawarich alles macht, dort klappte es
über die gesamte Südkorea-Reise perfekt." Read from Dawarich 1.16.0
(`2dc26c40`); every Dawarich fact below cites its file. Where Dawarich has
**no** mechanism, the rule says so and says why TravStats needs one anyway —
always because of an owner decision above, never for its own sake.

### 10.1 Rule 1 — what makes a position the same position

**Dawarich:** unique on `(user_id, timestamp, lonlat)` — `timestamp` integer
Unix seconds, `lonlat` the exact PostGIS double, no rounding
(`db/schema.rb:513,523,540`). The batch is deduplicated in memory with the
same key first (`Point.dedup_key`, `app/models/point.rb:80-85`), otherwise
one bad pair loses the whole 1000-row slice. Device (`tracker_id`) is a plain
column, not part of the key (`schema.rb:526`). No near-duplicate merging.

**TravStats:**
1. **Same key as Dawarich** — `UNIQUE (user_id, t_s, lon, lat)`, `t_s`
   integer seconds, coordinates as sent (double), deduplicated in the batch
   before the insert with the identical key. Proven on the Korea trip; no
   reason to differ.
2. **Plus the origin's own id**: `origin` (`companion:<deviceId>`,
   `import:<importId>`, `owntracks:<tid>` …) and `origin_ref` (the phone's
   fix id, the import's row number). `UNIQUE (user_id, origin, origin_ref)`
   makes a retry recognisable even if a client re-serialises a coordinate.
3. **Across origins, merge instead of duplicating** (owner: „Doppelung soll
   nicht gehen" — Dawarich has nothing here, it keeps both rows). A point from
   another origin within ±5 s and within `max(accuracy_a, accuracy_b, 25 m)`
   of a stored one becomes a row in `location_point_origins` for that point;
   the more accurate one supplies the coordinates. **Within one device nothing
   is ever merged** — each fix is its own point.
4. **The Companion stops thinning on the device.** Today it folds every fix
   within 75 m into one point with a duration and stops at 6000 points per
   trip (`app/src/lib/trip-track/points.ts`, `MERGE_RADIUS_M`,
   `MAX_TRIP_POINTS`). That suits questions asked on the phone, not a record:
   from P1 the raw fixes are kept until the server confirms them, and the
   folding moves to the server's derivations.

### 10.2 Rule 2 — how an upload is acknowledged

**Dawarich:** every live endpoint stores **synchronously** through
`Points::Intake` (`app/services/points/intake.rb`), slices of 1000, then
answers: the native endpoint echoes the stored rows (200), Overland answers
`201 {result:'ok'}` even when every point was dropped
(`overland/batches_controller.rb:10`), invalid points are dropped
**silently**. No batch cap. 5xx or 422 means „send the whole batch again",
and that is safe because the write is an upsert. Slices commit separately, so
a 500 can follow a half-stored batch. Derived work runs afterwards, in jobs.

**TravStats:**
1. **Synchronous and idempotent, as in Dawarich** — the request is stored
   before it is answered; a repeat is harmless.
2. **One transaction per request**, ≤ 5000 points and a body limit, so a
   failure never leaves half a batch.
3. **Every point gets an outcome, nothing is dropped silently** (house rule
   „a failure reaches the user as itself"): `stored`, `duplicate`,
   `merged`, or `dropped` with a reason — `privacy_zone`, `deleted_range`,
   `no_position`, `no_time`, `null_island`, `invalid`. All of these are
   final: the phone removes every point that got an outcome. Only a non-2xx
   answer means „keep and retry"; 429 carries `Retry-After`.
4. **`uploadId` + payload hash** are kept for 30 days: the same id with the
   same content answers the stored outcome, the same id with other content is
   a 409.
5. **Source „Dawarich"**: TravStats forwards the batch to the user's Dawarich
   and answers only after Dawarich has stored it; if Dawarich is unreachable
   the answer is 503 and the phone keeps the points. Nothing stays here.

### 10.3 Rule 3 — what deleting means

**Dawarich:** every delete is a hard delete (`points/destroyer.rb:13`);
deleting an import removes only the points carrying that `import_id`
(`imports/destroy.rb:61,102-127`). **No tombstones**: a re-upload or
re-import of the same key brings a deleted point back. No delete by date range.
After a delete, stats and tracks are recomputed, **visits are not**.

**TravStats:**
1. **Hard delete of the rows, as in Dawarich**, plus a **deleted range** row
   `(user_id, from, to, created_at)` for every delete by time span. Ingest and
   import drop points inside a deleted range (`dropped: deleted_range`), so a
   phone that was offline or an import run again cannot bring them back.
   Ranges are listed under Experte („Gelöschte Zeiträume") and can be lifted
   there, which allows a deliberate re-import.
2. **Privacy zones** work the same way in space: a point inside one is
   dropped on ingest and import, and creating a zone deletes what is inside
   (§3.6).
3. **Deleting an import** removes the points that no other origin vouches for
   (§10.1 point 3); points another origin also holds stay and lose only that
   membership.
4. **After any delete the affected days are re-derived**, suggestions
   included — unlike Dawarich, whose visits keep pointing at nothing.
   Decisions the user already made stay (§10.4 point 3).
5. Account deletion cascades through every location table and import file.

### 10.4 Rule 4 — how findings are recomputed

**Dawarich:**
- New points: a debounced job (first trigger + 45 s, 2-min sliding TTL)
  rebuilds tracks from the **last 6 h** of untracked points
  (`tracks/realtime_debouncer.rb`, `incremental_generator.rb:25`); visits
  after 5 min, also the last 6 h (`visits/realtime_debouncer.rb`).
- Late points older than 6 h: their day ranges are queued and rebuilt a
  minute later (`tracks/backfill_scheduler.rb`); a nightly or 12-hourly job
  is the safety net (`config/schedule.yml`).
- One lock per user (`tracks/per_user_lock.rb`), work in day chunks with 6 h
  overlap (`tracks/time_chunker.rb`).
- **User decisions are anchors**: only machine-made visits (`suggested`,
  not imported, no note) are ever regenerated; confirmed, declined, deleted
  and annotated ones are fixed, and new machine stays are cut around them.
  The machine rows of a window are replaced in one transaction under
  `pg_advisory_xact_lock(user_id)`, and nothing is written if the result is
  identical (`visits/detection/persister.rb:5-118`).
- Anomalies are **flagged, never deleted** (`points/anomaly_filter.rb`):
  speed above `max(1000 km/h, 3 × median)` per device, runs of ≤ 5 points,
  same-second jumps > 1 km, accuracy > 10 km, null island, cell-tower
  sentinels, frozen fixes; flagged points are left out of tracks, visits and
  stats.
- Changing route or visit settings recomputes **nothing** by itself; the user
  starts a recalculation.

**TravStats:** the same machinery, with two differences.
1. **Copy:** debounced incremental derivation over the last 6 h, day-range
   backfill for late points, nightly safety net, one lock per user, day
   chunks with overlap, transactional replace of machine findings under an
   advisory lock, skip-if-identical, and the anomaly filter with Dawarich's
   thresholds — computed per device.
2. **Differs — flags are versioned:** anomaly and in-flight marks live in
   `location_point_flags (point_id, kind, version)`, not on the point, so a
   new filter version or an edited flight replaces them instead of leaving
   stale marks on raw data (Codex review point 8).
3. **Same anchors as Dawarich:** a finding the user saved, dismissed or edited
   is never regenerated; machine findings are cut around it. Dismissed stays
   dismissed after any re-evaluation (the inbox promise).
4. **Differs — a settings change re-evaluates by itself:** „Übernehmen und
   neu auswerten" (§5) starts a job; every finding carries the
   `config_version` it was made with, the job replaces only machine findings
   of an older version, window by window, and the settings page shows its
   progress.
5. **Defaults:** tracks as Dawarich (`minutes_between_routes` 30,
   `meters_between_routes` 500, `users/safe_settings.rb:17,21`); stay
   suggestions keep TravStats' place-level 150 m / 20 min (forgejo#294) —
   Dawarich's 100 m / 3 points / 5 min suit its own visit list, not the
   logbook's „Orte". Countries and cities skip runs above 500 km/h, as in
   Dawarich (`countries_and_cities.rb:7-10`).
