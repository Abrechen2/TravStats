# Automatic photo links for place visits (2026-11-21)

Owner, 2026-11-21: photos of a place visit should be linked automatically from
Immich and PhotoPrism. Server side only in this slice; additive for the Companion.

## What the server does

`services/photoLinking/matcher.ts` is the one matcher (window + locations → assets):
known capture time AND position, never inside a TravTrack privacy zone, refusals
respected, capped. `linkTargets.ts` classifies every domain (wired, or why not).
Place visits are wired: the visit's local day, a point at the place with
`PHOTO_RADIUS_KM`, at most `VISIT_PHOTO_SUGGESTION_CAP` links per visit, links only.

A pass runs for a new visit and when a visit's time changes (background job
`placeVisitPhotos.autoLink`), once over all dated visits when the switch is turned
on, and on `POST /places/visits/photos/auto-link/run` (job, with progress).

## Contract (all additive)

| Where | Change |
| --- | --- |
| Visit photo DTO (`photos[]` of the visit/place detail, `GET .../photos`) | new `provider: "immich" \| "photoprism"`, `provenance: "manual" \| "auto"`. Show "automatisch verknüpft" + source label for `auto`. |
| `GET /places/visits/:id/photo-suggestions` | suggestions of kind `library` carry `provider`; response gains `sources: { immich?: state, photoprism?: state }`; `library` is unchanged (aggregate: "ok" when any source answered). |
| `POST .../photo-suggestions/link` and `/refusals` | optional `provider` (default `immich`); `assetIds` may be PhotoPrism hash ids. |
| `GET .../photo-suggestions/library/:assetId/file` | optional `?provider=` (default `immich`). |
| `GET /places/visits/photos/auto-link` | `{ enabled, lastRun: { at, linked, failedVisits, sources } \| null }`; a source state is `ok`, `notConfigured` or a failure kind. |
| `PUT /places/visits/photos/auto-link` | `{ enabled }`; switching on starts a pass (`jobId`). Default is on. |
| `POST /places/visits/photos/auto-link/run` | 202 `{ jobId }`; 409 `{ error: "disabled" }` when off. |
| `DELETE /places/visits/:id/photos/auto` | removes every auto link of the visit and records refusals; `{ removed }`. |
| `DELETE /places/visits/:id/photos/:photoId` | a removed library link is now also recorded as a refusal. |

Minimum server version: the release carrying this change; older servers omit the new fields.
