# TravTrack diagnostics log

Owner request, 2026-10-28 (relayed by the `Travstats` session): explain why
TravTrack records fewer positions than Dawarich on the same phone, without a
cable to the iPhone. "The server is the record" — the phone writes a
diagnostics log, the server stores it, the web lines it up against the stored
points.

## Why

Prod, user `dennis`, 2026-10-28 (UTC): Dawarich 11 776 points, TravTrack 562,
same area, median accuracy 2.6 m vs 2 m. TravTrack has gaps Dawarich does not:
13:52Z for 60 min, 07:22Z for 112 min; around 10–12Z Dawarich has
~1 600–2 200 points/h, TravTrack 46–56. From the server side a filter, an iOS
suspension and a lost upload look the same: no row.

What the Companion knows today (`app/src/lib/location/`): `stats.ts` keeps
running COUNTS (server drops per reason, `notQueued`), `gaps.ts` reports
`zonesUnknown | recorderSilent | permission` spans, `tuning.ts` applies the OS
distance filter (default 10 m) and a 1 s interval thinning. Nothing records
WHEN a fix was thinned, dropped or held, when an upload failed, or when iOS
ended or relaunched the app. That timeline is what this feature adds.

## Phases

| Phase | Side | What | Status |
|---|---|---|---|
| D1 | server | tables, ingest, day analysis, export, delete, retention, capability | done, `feat/travtrack-diagnostics` 45f01e458 (Codex review: 1 × P1, 7 × P2 fixed) |
| D2 | web | Settings → TravTrack → Diagnose: day timeline per device, gaps with cause, JSON download, delete | done, same branch |
| D3 | Companion | ring buffer, recorder/uploader/lifecycle hooks, opt-in switch, "Jetzt senden" | built, Companion `feat/travtrack-diagnostics` 78f316a3 (not yet tried against this branch) |
| D4 | both | reproduce a gap like 2026-10-28 with the log switched on, and read its cause. The 28th itself cannot be explained afterwards: its timeline was never recorded. | owner's phone |

Codex reviewed the first draft (5 × P1, 7 × P2); every finding is folded in
below (correlation by upload id, per-device analysis, no claim from
`background`, `unexplained` instead of "the app ran", typed payloads, byte
packing, analysis over the complete day, split at reported gaps, carried
state, account isolation, minute deltas, prospective D4).

## Contract

The app sends only while `GET /travtrack/capabilities` answers
`diagnostics: true` (additive field; `version` stays 1).

### `POST /api/v1/travtrack/diagnostics`

Same door as `POST /travtrack/points`: authenticated, tier `on`, write scope,
not demo, **paired device only** (`403 TRAVTRACK_DEVICE_REQUIRED`). Its own
rate limit (30 / 15 min per account), so diagnostics never eat the points'
budget. Body ≤ 256 KB, else `413 TRACK_BODY_TOO_LARGE`.

```jsonc
{
  "uploadId": "string ≤ 200",       // idempotency key per device
  "device": {                       // optional; identifier strings ≤ 80
    "model": "iPhone15,2", "os": "iOS 26.1", "appVersion": "1.4.0 (212)",
    "timeZone": "Europe/Berlin"
  },
  "events": [                       // 1..2000, any order
    { "t": "2026-10-28T13:52:00.000Z", "kind": "fixes", "data": { … } }
  ]
}
```

**Packing is by bytes, not by count.** The app packs ≤ 200 KB before it
freezes a batch and its `uploadId`. A `413` stores nothing: the app splits the
frozen batch into two new batches with new ids and drops the old one.

Per event (a bad event is `rejected`, the rest of the upload goes in):

- `t`: ISO instant with zone; not older than 14 days, not more than 10 min in
  the future (`reason: "time"`).
- `kind`: `^[a-z][a-zA-Z0-9.]{0,39}$` (`reason: "kind"`). ANY such kind is
  stored, so the app can add kinds without a server release.
- `data` (`reason: "data"`): a flat object, ≤ 24 keys
  `^[a-zA-Z][a-zA-Z0-9]{0,39}$`; each value one of
  - `null`, `boolean`;
  - a number that is an integer or has at most **two** decimals (battery
    0.45 — a coordinate needs more, so none can travel here);
  - an **identifier** string `^[A-Za-z][A-Za-z0-9_.:-]{0,63}$` (a code such
    as `whenInUse` or `NETWORK_TIMEOUT`; no spaces, no free text);
  - one level of `{ identifier-key: integer }` for per-reason counts.
  - A key named `lat`, `lon`, `lng`, `latitude`, `longitude`, `coords`,
    `coordinate(s)`, `location`, `position`, `fixId` or `originRef` rejects
    the event (`reason: "coordinates"`) — the phone's fix ids embed positions.
  Positions travel only through `/points`. There is no free-text kind.
- Answer `201 { uploadId, stored, rejected: [{ index, reason }], replayed: false }`;
  the same `uploadId` with the same content → `200`, the stored answer,
  `replayed: true`; with other content → `409 RECORDING_UPLOAD_ID_REUSED`.
  Every `rejected` is final for the client.

**Minute buckets are immutable deltas.** A `fixes` event counts what happened
since the last `fixes` event the phone wrote for that minute; the server sums
every `fixes` event of a device and minute. Nothing is ever updated.

Interpreted kinds (all fields optional unless marked):

| kind | data | Meaning |
|---|---|---|
| `fixes` | `received`, `kept`, `dropped: { reason: n }` | per minute (`t` = minute start), delta. Reasons: `interval`, `accuracy`, `zonesUnknown`, `privacyZone`, `captureOff`, `notQueued`, others allowed |
| `upload` | `uploadId`* (the POINTS upload's id), `fromT`, `toT` (ms epoch, oldest/newest fix in the batch), `status` (HTTP, 0 = network), `points`, `gaps`, `durationMs`, `attempt`, `stored`, `duplicate`, `dropped`, `error` (code) | one per request to `/travtrack/points` |
| `lifecycle` | `event`*: `launch`, `backgroundLaunch`, `foreground`, `background`, `terminate`, `significantWake`, `taskRevived`, `memoryWarning` · `byLocation` | app process |
| `recorder` | `event`*: `start`, `stop`, `pause`, `resume`, `error` · `purpose`, `distanceM`, `intervalMs`, `accuracy`, `activityType`, `reason` | the location task, incl. iOS automatic pause where the native module reports it |
| `permission` | `status`* (`always`, `whenInUse`, `denied`, `notDetermined`, `restricted`), `precise` | at launch and on change |
| `power` | `lowPower`, `battery`, `charging`, `backgroundRefresh` (`available`, `denied`, `restricted`) | at launch and on change |
| `note` | `code` (e.g. `sendNow`) | a user action |

### `GET /api/v1/travtrack/diagnostics/day?date=YYYY-MM-DD&deviceId=…`

Tier `held`. The day on the profile clock (as `/travtrack/day`). Everything
is **per device**: `deviceId` picks one; without it the device with the most
events that day (else the one with the most points). Points counted are this
device's own (`travtrack_points.device_id`), never imports or another phone.

```jsonc
{
  "date": "2026-10-28", "zone": "Europe/Berlin",
  "from": "…", "until": "…",         // the window read; a running day ends now
  "deviceId": "…",
  "devices": [{ "deviceId": "…", "label": "iPhone von Dennis", "model": "…", "os": "…",
                "appVersion": "…", "events": 812, "points": 562 }],
  "hasLog": true,
  "pointsPerMinute": [{ "t": "…", "n": 12 }],          // non-zero minutes only
  "fixesPerMinute": [{ "t": "…", "received": 60, "kept": 58, "dropped": { "interval": 2 } }],
  "events": [{ "id": "…", "t": "…", "kind": "…", "data": { } }],   // non-`fixes`, oldest first, ≤ 2000
  "eventsTruncated": false,
  "carried": { "permission": "always", "recorder": "start", "lifecycle": "foreground" },
  "gaps": [{ "from": "…", "to": "…", "minutes": 60, "cause": "…", "evidence": { … } }]
}
```

`gaps` are computed over the COMPLETE day of that device (the server reads
every event; the 2000 cap applies only to what is returned).

**Gaps.** A point-free stretch ≥ 10 min of the device's day, between its first
and last point, plus the day's edges where the log has events. Reported gaps
(`travtrack_gaps` of this device) are cut out of a stretch first and shown as
their own parts (`reportedGap`); each remaining part ≥ 2 min is classified
alone. State (`permission`, `recorder`, `lifecycle`) is **carried forward**
from the latest event before the part, looked up across midnight and back to
the 14-day horizon. The first rule that holds wins:

1. carried or in-part `permission.status ≠ always` → `permission`
2. carried `recorder` `stop`/`pause` (no `start`/`resume` before the part
   ends) → `recorderPaused`
3. `fixes.kept > 0` inside the part: take the `upload` events whose
   `[fromT, toT]` overlaps the part. A 2xx among them → `lostAfterUpload`
   (evidence: its `uploadId`, `stored`, `dropped`, and whether the server holds
   a points receipt for it); only failures → `uploadFailed`; none →
   `notUploaded`
4. `fixes.received > 0` and `kept = 0` → `droppedOnPhone` (`dropped` per reason)
5. carried or in-part `lifecycle.terminate` with no later `launch`/
   `backgroundLaunch`/`significantWake` before the part ends → `appNotRunning`
6. no event at all from 30 min before the part to its end, and no carried
   state → `noLog`
7. otherwise → `unexplained`: no fix was logged and nothing the app can see
   says why (suspension, OS distance filter, or no delivery all fit).

`background` alone is never evidence: the recorder runs in the background.

### `GET /api/v1/travtrack/diagnostics/export?from&to&deviceId?`

Tier `held`. `Content-Disposition: attachment`. JSON
`{ exportedAt, from, to, devices, events, pointsPerMinute }` with every event
(fixes included) — for a session to read. Span ≤ 14 days.

### `DELETE /api/v1/travtrack/diagnostics`

Tier `held`. Deletes every diagnostics row of the account. `200 { deleted }`.

### Capability

`GET /travtrack/capabilities` gains `diagnostics: true`.

## Storage

`travtrack_diagnostic_events` (`user_id`, `device_id`, `t`, `kind`, `data`
jsonb; index `(user_id, t)`, `(t)`), `travtrack_diagnostic_uploads`
(`user_id`, `device_id`, `upload_id`, `payload_hash`, `device` jsonb,
`result` jsonb; unique `(user_id, device_id, upload_id)`). Cascade on user
delete. **Retention 14 days** (events by `t`, receipts by `created_at`): a
daily sweep at 03:40 UTC beside the other retention jobs, and once at start.

## Privacy

- Owner only. Not part of sharing, `.travstats`, public links, comparison,
  federation, the TravTrack export or the full data export: a diagnostic with
  a 14-day life, read through its own export. Account delete cascades.
- No coordinates by construction: typed values, two-decimal numbers,
  identifier strings, and a rejected key list.
- `privacyZone` appears only as a drop count per minute, in the owner's own
  view, with no position.

## Companion (D3, for `travstats-companion`)

- Switch "Diagnoseprotokoll" in Settings → Standort, **default off**; while
  off nothing is written, and switching it off clears the buffer.
- Ring buffer on disk, ≤ 3 days or ≤ 20 000 events, oldest out first.
  **Bound to the account session** like the point queue: unpairing or a new
  account clears it; an envelope frozen for one account is never sent for
  another.
- Upload rides along with the point uploader, plus "Jetzt senden"
  (`note: sendNow`). Byte packing and the 413 split as above; stable
  `uploadId` per frozen batch.
- Hooks: the collector writes minute `fixes` deltas with thinning / zone /
  capture-off drops; the uploader writes one `upload` per request WITH the
  points batch's `uploadId`, `fromT`, `toT`; lifecycle, `recorder`,
  permission and power at launch and on change.
- Report back what of the list the native modules cannot see.

## As built in the Companion (78f316a3) — accepted differences

- The app now reads `GET /travtrack/capabilities` (cached 6 h) before sending.
- A `400` or `409` drops the batch for good; it is not re-sent under a new id,
  so no minute's fixes can be counted twice.
- `recorder` also sends `event: update`, and every `start` carries
  `reason` (`start | restart | revive | orphan`) and `pausesAuto`. The server
  turns `pausesAuto` into the gap evidence `autoPause`, and the web adds "iOS
  was allowed to pause recording automatically" to an `unexplained` gap.
- A new kind `gap` mirrors what the phone reports to `/points`; stored, shown raw.
- Fixes held for unknown zones count as `dropped.zonesUnknown` although they
  are sent later. They become points, so they open no gap; only the per-minute
  drop count overstates.
- A fix that a flight and a trip both take counts `kept` twice. That only
  matters for `kept > 0`, so no cause changes.
- `power` carries no battery level or low-power mode (`expo-battery` is not
  installed).

## Open for Companion — what the native layer cannot see

- **iOS auto-pause.** Everyday recording sets `pausesUpdatesAutomatically:
  true`, and expo-location has no pause/resume callback, so a paused stretch
  reads `unexplained` (with `autoPause: true`). It is the likeliest source of
  the gaps against Dawarich. Seeing it needs a native callback
  (`locationManagerDidPauseLocationUpdates`), or turning the auto-pause off
  costs battery: an owner decision.
- **Swipe-kill or termination.** No JS runs, so there is no `terminate`; the
  next `launch` and the `recorderSilent` gap show it after the fact.
- **OS-deferred delivery** is invisible.
- **Android Doze / App Standby:** no callback, only `received` missing.
- iOS `restricted` arrives as `denied`; the significant-change wake is not
  visible.
