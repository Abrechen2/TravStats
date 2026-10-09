# Shared trips and single-trip export/import

Branch `dev/trip-sharing` (long-running). Owner decisions 2026-10-09 — Claude's proposals,
accepted as a whole ("Dein Vorschläge" / "Passt").

## Problem

A trip is often made together: the owner and a companion take the same flights, sleep in the
same hotels, ride the same cruise. Today a companion is only a name (`Companion` + the
`*Companion` join tables) — even when that person has an account on the same server, each of
them types the whole trip again, and a change one of them makes (a rebooked flight, a moved
hotel night) never reaches the other. A trip also cannot leave the server on its own: the only
export is the whole account (`services/export/allDataExport.ts`).

## Decisions

1. **Linked copies, not one shared trip.** Every member owns a complete trip of their own —
   trip, flights, stays, cruise, rail rides, rentals, stops — joined to the others by a share
   group. A flight belongs to exactly one user and every statistic (distance, countries, time
   aloft, achievements) is keyed on that; a row shared by two users would have to be counted
   for both in every one of them. Copies keep every count correct with no change to it.
2. **Facts sync, persons stay private.** A fact is what is true for everyone on the trip:
   flight number, airports, times, airline; hotel, check-in/out, board; cruise ship, dates,
   ports; rail stations and times; rental provider, stations, dates; stop place and day.
   Private per member: seat, cabin/room number, own price share, ratings, notes, photos,
   journal, documents, companions list. The booking's total price may be shown to the other
   member read-only.
3. **Changes apply and say so.** When any member creates or changes a fact, the other copies
   take it at once and each other member gets an inbox notice naming who changed what, with
   **undo** (restores the previous values on their copy only, if nothing changed since).
   **Deletes never propagate** — the others get a notice and decide.
4. **Consent first.** A companion can be linked to a user account on the same server; the
   linked user must accept once ("Dennis möchte Reisen mit dir teilen"). Without that, no trip
   can be pushed into another account. Either side can withdraw; existing copies then stay as
   independent trips.
5. **Sharing is per trip.** On a trip, a linked and consenting companion gets a "share" tick;
   ticking it copies the trip into their account and joins the group. Leaving the group keeps
   one's copy as an ordinary trip.
6. **Single-trip export/import.** A `.travstats` file (zip: `manifest.json` with format
   version, `trip.json` with every entry's facts and — if chosen — private fields,
   `documents/`, `photos/` only when chosen; default off). Import goes through the package
   proposal of the template engine (create / attach / skip against what exists) extended to
   rail, rental, stops and places. File first; server-to-server later.
7. **Web first**, the Companion phone app later.

## Data model (proposal)

- `Companion.linkedUserId?` (FK users, unique per owner) — the link.
- `ShareConsent { id, requesterId, targetId, status: pending|accepted|declined|withdrawn,
  createdAt, decidedAt }`, unique (requesterId, targetId). Sharing A→B needs an accepted
  consent B gave to A.
- `TripShareGroup { id, createdById, createdAt }`; `Trip.shareGroupId?`.
- `shareKey?` (uuid) on Flight, LodgingStay, Cruise, RailJourney, RentalBooking, TripStop —
  the same key on every member's copy of one entry. Unique (userId, shareKey) per table.
- `ShareNotice { id, userId (recipient), groupId, actorId, kind: shared|created|updated|
  deleted|left, entityType, entityKey, before Json?, after Json?, createdAt, readAt?,
  undoneAt? }` — the fourth inbox source beside pending updates, data-quality flags and trip
  suggestions.

## Propagation

- One service, `services/sharing/propagate.ts`, called by the write paths of the six entity
  types after a successful write (not a Prisma middleware: explicit, testable, and a
  propagation write must not propagate again — guarded by an AsyncLocalStorage flag).
- Field whitelist per entity type = the facts of decision 2. A write that touches only private
  fields propagates nothing.
- Conflict rule: last writer wins on facts; each overwrite leaves a notice with `before`, so
  nothing is lost silently. Undo refuses (409, says why) when the copy changed since.
- Time model: facts are copied as stored (wall clock + zone, ADR 0002) — never re-derived.

## Phases

- **S1 — link + consent + share + copy**: model, migration, consent API + inbox entry for the
  request, link a companion, share a trip (copy into the other account), leave group. UI:
  companion edit (link to account), consent requests in the inbox, share tick on the trip.
- **S2 — propagation + notices + undo**: propagate service wired into the six write paths,
  notices in the inbox with undo, delete notices.
- **S3 — export/import**: `.travstats` writer/reader (Zod-validated manifest, size caps, zip
  bomb guard), import via the proposal screen.

## Out of scope

Server-to-server sharing; sharing with someone who has no account; the phone app.
