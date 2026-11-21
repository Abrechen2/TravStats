# Automatic photo links for every entry type (2026-11-21)

Owner, 2026-11-21: automatic linking of Immich/PhotoPrism photos for ALL domains,
not only place visits ("oder bei Flügen usw."; "Ja, alle Bereiche"). Extends
`2026-11-21-visit-photos-auto.md`: same matcher, same switch (`autoLinkVisitPhotos`),
same refusal and privacy rules. Server first, additive for the Companion.

## Data model: one table, a nullable FK per entry type

`entry_photo_links`: `userId`, one of `flightId | lodgingStayId | railJourneyId |
busJourneyId | ferryJourneyId | rentalId | cruiseStopId | tripStopId`, `provider`,
`assetId`, `provenance` (`manual` | `auto`), `refused`, `mimetype`, `takenAt`.

Why one table and not a table per domain: the matcher, the refusals, the gallery,
the thumbnail route, the export and the "remove all automatic" action are identical
for all eight; a table each would be eight copies of the same five queries and eight
migrations to keep in step. Why a nullable FK per type and not `(entryType, entryId)`:
a polymorphic pair has no foreign key, so deleting a flight would leave links
pointing at nothing, and every delete path of every entry (some fifty) would have to
remember to clean up. Real FKs cascade for free. The cost is eight nullable columns;
a CHECK (`entry_photo_links_one_entry`) holds "exactly one is set", and one unique
per (FK, provider, asset) makes a pass idempotent (NULLs are distinct in Postgres, so
the other seven uniques never collide).

Refusals are rows of the same table with `refused = true` (kept so no pass brings a
removed photo back; never listed). The place visit keeps its own tables
(`PlaceVisitPhoto`, `VisitPhotoRefusal`): they predate this and carry uploads, trip
photo links and the place cover.

Existing photo surfaces stay as they are and show NEXT to the links: a stay's
uploaded `LodgingPhoto` copies, a roadtrip station's `TripPhoto.stopId` photos (picked
or album import). The matcher does not write `TripPhoto` (it needs a trip and a file
name); a station's matched photos are `EntryPhotoLink` rows (`tripStopId`).

## Fits (`photoLinking/entryKinds.ts`)

| Kind           | Window                                                      | Location                                                  |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| `flight`       | 2 h before take-off to take-off; landing to 2 h after       | point at each airport, 5 km                               |
| `stay`         | check-in to check-out (instants, else the local days)       | point at the lodging, 1.5 km; month/year precision: none  |
| `rail`         | actual (else planned) departure to arrival                  | corridor between the stations, 25 km                      |
| `bus`          | same                                                        | corridor, 15 km                                           |
| `ferry`        | same                                                        | corridor, 10 km                                           |
| `rental`       | pick-up to drop-off                                         | corridor between the stations, 40 km (time bounds it)     |
| `cruiseStop`   | the stop's local day at the port                            | point at the port, 12 km; a sea day matches nothing       |
| `roadtripStop` | the station's local days                                    | point at the station, 3 km (roadtrip routes only)         |

An entry with day or unknown precision, no arrival, or no position is `untimed`: it
matches nothing and the UI says why. At most 24 automatic links per entry.

## Triggers

Not a call at each of some fifty creators: the database client reports every write
(`db.setWriteObserver`), `entryPhotoTriggers.ts` decides. A `create`/`createManyAndReturn`/
`createMany` of an entry, or an `update`/`upsert` whose data touches a time, precision
or position column, schedules the entry's pass after 4 s (debounced per entry, so an
enclosing transaction has committed; an import is one pass per entry through one
memoised search). A hotel geocoded after its stay was saved re-runs the lodging's stays.
`createMany` has no ids: a cruise's stops run by cruise, the others by "this user's
entries of that kind created in the last minute". The pass also runs once over every
visit and entry when the switch is turned on and on `POST /places/visits/photos/auto-link/run`
(one run record, `lastRun`, for both; an entry failure is `{visitId: "<kind>:<id>"}`).
Not installed under test unless a test installs it.

## Contract (all additive)

| Endpoint (`/api/v1/entry-photos/{kind}/{entryId}/…`)         | Meaning                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `GET photos`                                                 | `{ photos: [{ id, url, provider, assetId, provenance, takenAt, mimetype }] }`            |
| `GET photo-suggestions`                                      | `{ suggestions: [{ url, provider, assetId, takenAt, mimetype }], sources, untimed }`      |
| `POST photos` `{ provider?, assetIds }`                      | links what is among the current suggestions; `{ linked, skipped }`                        |
| `DELETE photos/{photoId}`, `DELETE photos/auto`              | removal; each becomes a refusal                                                          |
| `DELETE photo-refusals`                                      | offer the refused ones again                                                             |
| `GET photos/{photoId}/file`, `GET photo-suggestions/{provider}/{assetId}/file` | bytes, streamed from the asset's own source; a suggestion is served only if the server found it in the last minute |

`kind`: `flight | stay | rail | bus | ferry | rental | cruiseStop | roadtripStop`.
Source states as for visits: `ok`, `notConfigured`, `truncated`, or a failure kind.
Minimum server version: the release carrying this change.

## Sharing, federation, export

Links are the owner's own library pointers: never sent to a shared trip's members or
to a federated peer (`entryPhotoLinks` is in `NON_TRAVEL_RELATIONS`; members see what
they see today). The account export carries the table (`entryPhotoLinks: true`), so a
restore keeps links and refusals.

## Known limits

- A cruise save recreates its stops with new ids, so manual picks and refusals on a
  cruise stop do not survive a cruise edit (the automatic pass re-links the rest).
- Shared-trip copies are created by `sharing/adapters/*`; they trigger the pass in the
  recipient's account like any create, but only for a recipient who has a photo source.
- `updateMany`/`deleteMany` are not observed (status sweeps, trip moves, share keys do
  not move time or place); a catalogue coordinate change (a port moved) is picked up by
  the next full pass.
- A pass that read the refusals just before a user removes a link can re-link that photo.
- Rail and rental corridors are straight lines between the endpoints with generous radii:
  a photo from a detour inside the radius and the window matches.
