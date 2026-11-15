# ADS-B community providers: adsb.lol and ADS-B Exchange (forgejo#408)

Owner decision 2026-10-29: plan both, then build now. The owner feeds OpenSky, adsb.lol and
ADS-B Exchange from his own receiver since 2026-10-29.

## What they can and cannot answer

Both speak the readsb "v2" JSON (`{ ac: [{ hex, flight, r, t, lat, lon, alt_baro, gs, track, seen, … }], now }`),
so ONE adapter serves both; only base URL and auth differ.

|              | adsb.lol                                        | ADS-B Exchange                                                                 |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Base         | `https://api.adsb.lol/v2`                       | `https://adsbexchange-com1.p.rapidapi.com/v2` (RapidAPI)                       |
| Auth         | none                                            | `X-RapidAPI-Key` + `X-RapidAPI-Host` (key per instance/user, like AeroDataBox) |
| Lookups used | `/callsign/{cs}`, `/hex/{hex}`, `/reg/{reg}`    | same paths                                                                     |
| Time window  | **now only** (aircraft currently airborne/seen) | **now only**                                                                   |

Neither has a by-date endpoint through these APIs. They therefore join the chain like AirLabs:
live/ad-hoc only, **never** in `flightProviderAvailability().byDate`. Historical traces
(adsb.lol `globe_history` dumps, ADSBx globe traces) are out of scope for this phase — size,
terms and storage need their own decision (see Open).

## Phase 1 (server, this branch)

1. `services/flightLookup/adsbV2.ts` — adapter: `lookupAdsbV2(provider, query)` for callsign /
   hex / registration. Returns registration (`r`), ICAO type (`t`), ICAO24 hex, last position
   (lat, lon, alt, ground speed, track, `seen` age). Every failure has its own reason through
   the existing `providerOutcome` vocabulary (network, 4xx/5xx, 429, auth, timeout, disabled,
   no result) — no `null` that hides a failure.
2. Chain: after AirLabs, before OpenSky, **only for a lookup whose date is today** (the live
   window). Order between the two: ADS-B Exchange (keyed) before adsb.lol.
   What they fill: aircraft registration and type for a flight in the air now. They never
   overwrite a value another provider supplied.
3. Opt-in (forgejo#392 rule: every external service OFF by default):
   - ADS-B Exchange: a key in the existing api-key system (user → admin global → ENV
     `ADSBX_RAPIDAPI_KEY`), resolver kind `adsbx`. No key = off.
   - adsb.lol: keyless (an optional key slot exists, see Open), so an explicit admin switch `adsbLolEnabled` (admin_settings,
     default `false`) — **schema change foreseen**: one migration adding the column.
     Both appear in Admin → API-Schlüssel with a DE/EN line saying what they unlock
     („nur Flüge, die gerade in der Luft sind“).
4. Quota/rate limiting reuse `apiQuota` (adsb.lol: be polite, ≤ 1 request/s per instance,
   cache answers 60 s in the existing NodeCache).
5. OpenAPI, settings allowlist (`diagnostics/settingsAllowlist.ts`), usage-stats payload and
   the api-key tester get the two providers wherever the other providers are listed.

## Contract

Additive only. `source` of a lookup result may now be `"adsbx"` or `"adsblol"`; settings
responses gain `adsbLolEnabled` and the `adsbx` key-presence flag in the same shape as the
other providers. No endpoint removed. Minimum app version: none (the app reads `source` as a
string).

## Phases

| Phase                                                                   | Side              | State                                                                                          |
| ----------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| 1 adapter + chain + opt-in                                              | server + admin UI | built (feat/adsb-providers, efe789c41)                                                         |
| 2 live position for the cockpit/web (server half)                       | server            | built (fix/adsb-p23): `GET /flights/:id/live-position`. Companion half: see "Phase 2 contract" |
| 3 historical tracks, REDESIGNED: the user's own tar1090/readsb receiver | server + Settings | built (fix/adsb-p23): `POST /flights/:id/track/receiver`, catalogue entry `tar1090`            |
| per-user key cards (ADS-B Exchange, adsb.lol) in Settings → Dienste     | web               | built (fix/adsb-p23)                                                                           |

### Deviations from the original plan

- Phase 3 no longer reads community dumps. adsb.lol publishes `globe_history` as one daily tarball
  of the whole network (about 2 TB a year) with no per-aircraft query; fetching a single flight would
  mean downloading a day (tens of GB) and unpacking it. ADS-B Exchange offers no history through the
  RapidAPI product. Not feasible for a self-hosted app, so it is dropped, not deferred.
- Cockpit check (2026-11-15): the Companion cockpit takes its position from the DEVICE (location
  fixes, `flight-motion-memory.ts`); no server live-position endpoint existed (OpenSky is used for
  lookups only). Phase 2 therefore adds one endpoint instead of extending one.
- The brief assumed the flight-track pipeline "already accepts readsb files". It did not (GPX, KML,
  KMZ, TCX, FIT, FR24 CSV). Phase 3 reuses the pipeline behind them (`flightTrackColumns`: jitter,
  holes, distance, simplification) and adds the source value `readsb` to `flight_tracks.source`
  (a text column, no migration for that).
- Schema change (one migration, `tar1090_receiver_url`): `admin_settings.global_tar1090_base_url`,
  `user_settings.tar1090_base_url`.
- `ADSBLOL_KEY_HEADER` could not be verified: api.adsb.lol/docs names no auth scheme and the API
  source (github.com/adsblol/api) only says a key "will be required in the future"; no header is read.
  The constant stays `api-auth` as a placeholder, now documented in code.

## Phase 2 contract (Companion cockpit, web flight page)

`GET /api/v1/flights/{id}/live-position` — session cookie or any PAT (read-only is enough);
30 requests per minute per user; answers are cached 60 s server-side, so polling every 15-30 s costs
at most one upstream request a minute. Minimum server version: the release carrying this branch.

200, always (unavailable is not an error):

```
{ "status": "ok",
  "position": { "lat": 49.5, "lon": 9.1, "altBaro": 34000|null, "onGround": false,
                "groundSpeed": 440|null, "track": 123|null, "seenSeconds": 2|null },
  "source": "adsblol"|"adsbx", "fetchedAt": "<ISO>", "icao24": "3C6444"|null, "registration": "D-AIXA"|null }
{ "status": "unavailable", "reason": <one of below>, "failures"?: [{ "provider", "outcome" }] }
```

`reason`: `not_live_window` (outside departure − 1 h .. arrival + 3 h, or cancelled) · `no_schedule` ·
`no_provider` (no ADS-B provider enabled; the app should stay on the device position) ·
`no_identifier` (no hex, registration or callsign) · `no_hit` · `no_position` (aircraft heard, no fix) ·
`provider_error` with `failures[].outcome` in `auth|quota|timeout|plan_restricted|provider_error`
(the providerOutcome vocabulary). 404 `FLIGHT_NOT_FOUND` for another user's flight, 429 when polled too fast.
Lookup order: ICAO24 hex (`aircraftModeS`), registration, ICAO callsign; ADS-B Exchange before adsb.lol.
`altBaro` is feet, `groundSpeed` knots, `track` degrees true. The app should prefer its own device
fix when it has one and use this for the aircraft's position while the phone is not on board.

## Phase 3: own receiver (tar1090 / readsb)

Setting: Settings → Dienste → "Eigener Empfänger (tar1090)" (catalogue id `tar1090`, category flight,
level instance + account). Off until an address is saved; the admin's address is the instance's (LAN
allowed), an account's own address follows the forgejo#411 rule (public addresses only unless the
account is an admin; refused with `PRIVATE_TARGET`, re-checked on every request, redirects never followed).
The admin policy switch and the account's own "off" both win (`RECEIVER_OFF`).

`POST /api/v1/flights/{id}/track/receiver` (write scope, 30 / 15 min, body `{ replace?: boolean }`): looks
the flight's ICAO24 hex up in, per UTC day of the flight window, `globe_history/YYYY/MM/DD/traces/<hex[-2:]>/trace_full_<hex>.json`,
then `data/traces/<hex[-2:]>/trace_full_<hex>.json`, then `trace_recent_<hex>.json` (404 moves on). The leg that
overlaps the schedule most is cut out (a day file holds every flight of the aircraft; legs split at the
"new leg" flag; a flight across midnight UTC is joined), converted and stored with `source: readsb`. A passenger
recording is never replaced without `replace: true`; a server line (`aeroapi`, `readsb`) is, and a phone
upload replaces a `readsb` line without asking.
Failure codes, one each: `RECEIVER_OFF`, `RECEIVER_NOT_CONFIGURED`, `RECEIVER_NO_AIRCRAFT` (no/invalid hex),
`RECEIVER_NO_SCHEDULE`, `RECEIVER_NOT_FOUND` (no file for that aircraft/day), `RECEIVER_OUTSIDE_WINDOW`,
`RECEIVER_AUTH` (401/403), `RECEIVER_TIMEOUT`, `RECEIVER_UNREACHABLE`, `RECEIVER_ERROR` (other HTTP/transport),
`RECEIVER_BAD_TRACE` (200 that is not a trace file), `RECEIVER_WINDOW_TOO_LONG` (schedule over 2 days), `RECEIVER_TOO_LARGE`, `PRIVATE_TARGET`, `TRACK_ALREADY_RECORDED`.

Bounds of one fetch (security review): window at most 2 days (so at most 3 days x 3 files), 60 MB and 400 000 fixes
across all files, 60 s overall deadline (reported as `RECEIVER_TIMEOUT`).

Trace format source: wiedehopf/readsb `README-json.md` (trace_full / trace_recent) and tar1090's
`html/script.js` (`processTraceData`): `{ icao, r, t, timestamp, trace: [[secs, lat, lon, alt|"ground"|null, gs,
track, flags, vrate, detail, …]] }`, flags bit 0 stale, bit 1 new leg. Tests use synthetic fixtures in exactly
this shape (`services/tar1090/__tests__/traceFixtures.ts`); no recording from a real receiver has been tested yet.
Not built: a connection tester for the receiver (the card has none), automatic fetching after landing (the call is
explicit), lookup by registration when a flight has no hex.

## Open

- ADS-B Exchange: which API access the owner's feeder account grants and whether its terms allow
  use in a self-hosted app. Built as a bring-your-own-key provider, so nothing is used until a
  key is entered.
- adsb.lol key header: unverifiable today (see Deviations); re-check when adsb.lol enforces keys.
- A lookup with ADS-B hit but no AirLabs/OpenSky route returns the aircraft only (no airports); the
  flight form fills registration and type and leaves the route to the user.
- Companion: a cockpit consumer for `live-position`, and a button for `track/receiver` on a past flight.
- Web: a "fetch from my receiver" action on the flight page (the server part is done).
