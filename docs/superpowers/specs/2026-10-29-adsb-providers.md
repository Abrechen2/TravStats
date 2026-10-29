# ADS-B community providers: adsb.lol and ADS-B Exchange (forgejo#408)

Owner decision 2026-10-29: plan both, then build now. The owner feeds OpenSky, adsb.lol and
ADS-B Exchange from his own receiver since 2026-10-29.

## What they can and cannot answer

Both speak the readsb "v2" JSON (`{ ac: [{ hex, flight, r, t, lat, lon, alt_baro, gs, track, seen, … }], now }`),
so ONE adapter serves both; only base URL and auth differ.

| | adsb.lol | ADS-B Exchange |
|---|---|---|
| Base | `https://api.adsb.lol/v2` | `https://adsbexchange-com1.p.rapidapi.com/v2` (RapidAPI) |
| Auth | none | `X-RapidAPI-Key` + `X-RapidAPI-Host` (key per instance/user, like AeroDataBox) |
| Lookups used | `/callsign/{cs}`, `/hex/{hex}`, `/reg/{reg}` | same paths |
| Time window | **now only** (aircraft currently airborne/seen) | **now only** |

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
   - adsb.lol: keyless, so an explicit admin switch `adsbLolEnabled` (admin_settings,
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

| Phase | Side | State |
|---|---|---|
| 1 adapter + chain + opt-in | server | building (feat/adsb-providers) |
| 2 live position for the cockpit (app) | server + Companion | later — needs the cockpit's current source checked |
| 3 historical tracks from community dumps | server | later — own decision on size/terms |

## Open

- ADS-B Exchange: which API access the owner's feeder account grants and whether its terms allow
  use in a self-hosted app. Built as a bring-your-own-key provider, so nothing is used until a
  key is entered.
- adsb.lol announced that the API may require a feeder key in the future; the adapter keeps an
  optional key header slot so that is a config change, not a code change.
