# Trip recording on the server (forgejo#316, slice 1)

Status: built 2026-10-20 on `feat/trip-recording-316`. Server half of companion#73.

## Why

The Companion records coarse positions during a trip (~500 m / ~5 min; ~100 m / ~1 min on a
roadtrip) and kept them on the phone only (`adrs/0013` point 4 in the Companion repo). The owner
reversed that on 2026-10-20: „denke daran das der Server immer alles wissen muss die App ist nur
ein Companion". A lost phone must not lose the record, and the web must show it.

## What is stored

`trip_recording_batches`, one row per upload:

| Column | Meaning |
|---|---|
| `user_id`, `trip_id` | owner and trip; both cascade on delete |
| `device_id` | the paired device (`ApiToken.deviceId`); null from a browser |
| `upload_id` | the client's id; unique per user — a retry is answered with the stored row |
| `started_at`, `ended_at` | first and last stored point |
| `points` | raw `[tMs, lat, lon, accuracyM \| null]`, sorted by time |
| `point_count`, `skipped_outside_trip`, `skipped_in_flight` | what the upload's answer said |

No simplification on write: the raw points are the record. Lines are simplified only for display.

## Bounds

- **Trip days.** A point is stored when it lies from 00:00 of the trip's first local day to the
  end of its last (23:59:59.999), each end read in its own zone (`startZone` / `endZone`), the
  profile zone where the span was typed without one. Others are counted (`outsideTrip`).
- **Flights.** A point inside a trip flight's recorder window — scheduled departure −30 min to
  arrival +30 min (`recorderWindow`, companion `adrs/0010`) — is counted (`inFlight`), not
  stored: the flight recording owns it. Cancelled flights arm nothing.
- **No span, no guess.** A trip without a first or last day refuses the upload
  (422 `TRIP_RECORDING_NO_SPAN`); the phone keeps it in its outbox.
- **Per upload:** at most 5000 points, body at most 1 MB, times as ISO instants with an offset.

## Retention

Kept like the rest of the logbook, until the user deletes it (trip map → "Aufzeichnung
löschen", or by deleting the trip). The account switch `tripRecording.enabled` (default on)
stops new uploads (409 `TRIP_RECORDING_DISABLED`) and keeps what is stored.

## Never shared

The recording is private to the person who made it. It does not travel with a shared trip's
copy, a `.travstats` trip file, a public share link, a comparison or a federation publication
(`NON_TRAVEL_RELATIONS`). `tripRecording.private.test.ts` proves the first three and guards
that only the recording's own router, its bounds helper and the account export read the table.
It DOES travel with the account's own data export (`USER_EXPORT_SELECT`) and with every
pg_dump backup.

## API

All under `/api/v1`, cookie or the Companion's write-scoped device token, bare answers.

- `POST /trips/:id/recording` — `{ uploadId, points: [{ t, lat, lon, accuracy? }] }` →
  `{ batchId, accepted, outsideTrip, inFlight, replayed }`. 201 stored; 200 on a replay or when
  nothing was left (`batchId: null`). Codes: `RECORDING_INVALID_POINT` (400),
  `TRIP_NOT_FOUND` (404), `TRIP_RECORDING_DISABLED` / `RECORDING_UPLOAD_ID_REUSED` (409),
  `TRACK_BODY_TOO_LARGE` (413), `TRIP_RECORDING_NO_SPAN` (422). Rate limited with the flight
  device data limiter.
- `GET /trips/:id/recording?day=YYYY-MM-DD` → `{ summary: { pointCount, firstAt, lastAt,
  devices, days }, segments }`. The trip's clock is its start zone, else its end zone, else
  the profile zone; `firstAt`/`lastAt` are `TimeValue`s, `days` `LocalDateValue`s on it.
  `segments` are `[lon, lat]` lines per device, cut where two fixes are more than 2 h or 50 km
  apart — never joined — and simplified for display.
- `GET /trips/:id/recording/gpx` — every raw point with its time, one `<trkseg>` per stretch.
- `DELETE /trips/:id/recording` — 204.

## What follows

- **Slice 2:** the stay and place suggestions read these points as evidence (not built).
- **companion#73:** the Companion uploads its recording through `POST` above.
