# Place captures — an unnamed "Ort jetzt" reaches the server (companion#90)

Owner, 2026-10-31: the server is the record. A position the Companion captured
with "Ort jetzt" and no name used to wait on the phone, because `POST /places`
requires `name`. It now goes to `place_captures` and waits there for a name.

| Phase | Side | Status |
|---|---|---|
| Table `place_captures`, endpoints, OpenAPI, export | server | done (`feat/place-captures`) |
| Inbox section "Unbenannter Ort" (name / dismiss) | web | done |
| Upload on capture, bind after naming on the phone | Companion | open for Companion |

## Contract

Places router family: enveloped (`{success, data}`, ADR 0001). Errors `{error, code}`.
All routes need auth; a read-only token can GET only.

`Capture = {id, clientId, lat, lon, accuracyM: number|null, capturedAt: ISO, note: string|null,
status: "open"|"resolved"|"dismissed", placeId: string|null, visitId: string|null, createdAt: ISO}`

- `POST /api/v1/places/captures` `{clientId: uuid, lat, lon, accuracyM: number|null, capturedAt: ISO with offset,
  note?: string|null}` -> `201 {success, data: Capture}`. `clientId` is unique per user: a repeat answers the
  existing row with `200` (the body of the repeat is ignored).
- `GET /api/v1/places/captures?status=open` (default `open`; also `resolved`, `dismissed`) -> `{success, data: Capture[]}`,
  `capturedAt` desc, id tie-break, at most 200.
- `POST /api/v1/places/captures/:id/resolve`, three body forms:
  - `{name, category?}`: creates a place at the captured position and a visit at `capturedAt`;
  - `{placeId}`: the same, on a place the caller owns (404 `VISIT_PLACE_NOT_FOUND` otherwise);
  - `{placeId, visitId}`: already written by the phone. Binds the capture (status `resolved`), creates
    NO place and NO visit. `visitId` must be a visit of that `placeId` and of the caller, else
    `400 VALIDATION_FAILED`.
  One transaction; the visit counts per `shared/placeCounting` and files itself on the one trip spanning its day.
  -> `200 {success, data: Capture}`.
- `DELETE /api/v1/places/captures/:id`: status `dismissed`, the row is kept -> `200 {success, data: Capture}`.
- Errors: `VALIDATION_FAILED` (400; lat -90..90, lon -180..180), `CAPTURE_NOT_FOUND` (404, also for another
  user's capture), `CAPTURE_ALREADY_RESOLVED` (409, for resolve and dismiss of a non-open capture).
- Minimum server version for the app: the release containing this change (additive only).

`POST /places` and `POST /places/:id/visits` are unchanged. The visit's id is the `id` of the
`POST /places/:id/visits` response (the Companion binds with `{placeId, visitId}`).

## Server notes

- Not shareable: no `share_key`; classified in the federation graph as a non-travel relation.
- In the takeout export (`placeCaptures`); the backup is a database dump and carries the table.
- `capturedAt` is an instant; it is on the time-shape allow-list (the phone's clock, no place zone).
