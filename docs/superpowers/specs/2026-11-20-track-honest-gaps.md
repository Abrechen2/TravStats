# TravTrack — honest stay gaps and reasons for empty days (web + Companion)

**Owner:** approved 2026-11-20 (web from the AI-council review; Companion phase
"ja" the same day). **Branch:** `feat/track-review` (server + web).

## Why

A stay that spans a recording silence read as fully measured, and a day that
draws nothing gave no reason. Returning to the same place does not prove the
traveller stayed there the whole time; a day hidden by a privacy zone is not a
day without recording.

## Phases

| Phase | Side | What | State |
|---|---|---|---|
| S1 | server | `/travtrack/day` carries `omitted`, stops carry `coverage`, `?includeImplausible=1` | built, merged, shipped in 2.8.0-rc.38 (main b67921f03) |
| W1 | web | stop card / leg list: "gemessen X · angenommen Y" + dashed gap bar; empty-day reasons with actions; iPad split view | built, shipped in 2.8.0-rc.38 |
| C1 | Companion | Track screen shows the same: coverage on stops, reason for an empty day | built, PR companion#130 (`feat/track-honest-gaps` @ 6a6fddbd); green against rc.38 on the RC server on 2026-11-21 (release APK f4316781 = iOS build 90), all four cases, no contract deviation |

## Contract (minimum server: the first RC that contains `feat/track-review`)

All fields are additive; an older server sends none of them, and the app must
then show today's neutral text.

`GET /api/v1/travtrack/day?date=YYYY-MM-DD[&includeImplausible=1]`

- `omitted: { privacyZone: number, implausible: number }` — always present on
  a server that has S1. Integers ≥ 0.
  - `privacyZone`: stored fixes the privacy cut hid.
  - `implausible`: fixes left out as implausible (coarse, null island).
- `includeImplausible=1`: also draw the implausible fixes; `omitted.implausible`
  is then 0. The privacy cut still applies — zone fixes are never drawn.
- `stops[].coverage?: { observedMs: number, inferredMs: number, gaps: { fromMs: number, untilMs: number }[] }`
  — present ONLY when the stop spans a recording silence; absent otherwise.
  `observedMs + inferredMs` = the stop's duration. Times are epoch ms (instants).

Empty-day reasons, in this order (the web's `TrackEmptyReasons`):
1. load failed → its own error + retry (unchanged);
2. no stored fix and `omitted` all zero → "keine Aufzeichnung" (action: check
   recording / import);
3. `omitted.privacyZone > 0` → "durch eine Privatzone ausgeblendet" (action:
   zone settings);
4. `omitted.implausible > 0` → "als unplausibel herausgefiltert" (action: show
   them via `includeImplausible=1`);
5. `omitted` missing (old server) → neutral text, no claim.

Range reads (week/month/year) carry no reasons yet: neutral text there.

No error cases beyond today's `/travtrack/day` ones.

## Open for Companion

- C1 built. App wording: "Privatzone" (its existing term); "Aufzeichnung prüfen" opens location settings (the app has no import screen).
