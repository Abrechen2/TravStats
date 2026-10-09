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

## S1 — as built (2026-10-09)

**Migration** `20261009112351_trip_sharing_s1`, as proposed with three refinements:
`TripStop.shareKey` is unique per `(tripId, shareKey)` — a stop has no user column, and a
trip has exactly one owner, so that is per user. `TripShareGroup.createdById` is nullable
(SetNull): the creator's account going away must not dissolve the others' group.
`ShareNotice.groupId`/`actorId` are nullable (SetNull) for the same reason. A pending consent
request is read from `ShareConsent` itself; it writes no notice.

**Facts** — `backend/src/services/sharing/facts/`, one module per type (trip, flight,
stay + lodging, cruise + stops + legs, rail, rental, stop), each a whitelist and the function
that copies exactly those columns as stored. A column not listed is private. Beyond the
decision-2 list, the measured route of a flight (`actualRoute`, `routeDistance`, overflown
countries, CO₂) and a cruise's computed legs are copied, because they describe the vehicle's
path and let the recipient's statistics count the copy without a lookup. A copied stay's
`status` is re-derived from its dates (`deriveLodgingStatus`).

**Lodging reuse** (security review): the recipient's own lodging is reused only for the same
house — same normalised name AND coordinates within 300 m, or, when either side has none, the
same city and country (`isSameHouse`). Otherwise a new lodging is created; a sharer-owned
chain is not carried over, a catalogue chain is.

**API** — `/api/v1/sharing`, enveloped, demo account read-only:
`GET|POST /consents`, `POST /consents/:id/{accept,decline,withdraw}`,
`GET /companions`, `PUT|DELETE /companions/:id/link`, `GET /trips/:tripId`,
`POST /trips/:tripId/{share,leave}`, `GET /notices`, `POST /notices/:id/read`,
`GET /inbox/count`. Codes: `SHARE_USER_NOT_FOUND`, `SHARE_SELF`, `SHARE_CONSENT_DUPLICATE`,
`SHARE_CONSENT_NOT_FOUND`, `SHARE_CONSENT_NOT_PENDING`, `SHARE_CONSENT_REQUIRED`,
`COMPANION_NOT_FOUND`, `SHARE_COMPANION_ALREADY_LINKED`, `SHARE_COMPANION_NOT_LINKED`,
`SHARE_TRIP_NOT_SHARED`, `SHARE_NOTICE_NOT_FOUND`, `TRIP_NOT_FOUND`. Consent requests are
limited to 30 an hour per user (a request answers whether a username exists).

**Share** copies in one transaction, keys the sharer's rows on first share, and is idempotent
by `shareKey`: sharing again creates only what the recipient lacks (so an entry added since is
copied too). A stop wrapping an entry is re-pointed at the recipient's copy. Roadtrip
stations, route corrections and `placeId` are not copied; nor are bookings, photos, journal,
documents, expenses, tours or roadtrips. **Leave** clears the caller's keys and group (own copy
stays), notifies the others (`left`), and deletes a group nobody is left in.

**UI** — Posteingang tab "Geteilte Reisen" (requests with Zustimmen/Ablehnen, notices with
Reise öffnen/Gelesen) and a fourth badge source; Einstellungen → Reisen → "Reisen teilen"
(request by username, consents with withdraw, per companion "Mit Konto verknüpfen"); trip
overview panel "Geteilt" (members, a share tick per linked companion, Gruppe verlassen).

**Open for S2**
- Withdrawing a consent blocks further shares only; S2's propagation must also check it,
  and decide whether a withdrawal detaches existing group copies (decision 4 says they stay).
- `before`/`undoneAt` are unused until propagation; notice kinds `created|updated|deleted`
  are reserved.
- Entries moved out of a shared trip keep their `shareKey`; propagation must define what that
  means (leave currently clears keys only on rows still filed on the trip).
- Re-sharing after leaving creates a fresh copy (the old one has no key); no merge.
- Cruise leg routes (`CruiseLegRoute` overrides) are not copied; the recipient's map draws the
  default schematic route.
- The companion editor is the settings list — there is still no standalone companion editor.

## S2 — as built (2026-10-09)

**Propagation** — `backend/src/services/sharing/propagate.ts`, one adapter per type under
`sharing/adapters/` (load, copies in a group, create a copy, apply facts, remove). Every write
path calls it explicitly: `shareSnapshot(s)` before the write, `propagateWrite(s)` /
`propagateDelete(s)` after it, inside the write's transaction where there is one (otherwise
propagation opens its own). `propagate.writePaths.test.ts` scans the tree for every writer of
the six types (plus houses, port calls and legs) and fails on a writer that neither propagates
nor stands in its exemption list with a reason, and on a stale exemption. Background jobs that
maintain each account's rows alike (status sweep, provider tracking, time migrations, geocoding)
are exempt; the spreadsheet import is propagated once per run (`bulkSync.ts`).

One function decides what a write was, from the entry's trip and key: an unkeyed entry on a
shared trip is a **create** (it gets a key; every receiving member a copy and a `created`
notice); a keyed entry that stayed is an **update**; a keyed entry now outside its trip is a
**move out** (key cleared; members holding a copy get a `deleted` notice with
`reason: "movedOut"`; their copies stay); a delete is **notices only** (`reason: "deleted"`).
A copy a member deleted or moved away is never re-created by a later change.

An update carries only the facts THIS write changed (snapshot vs. now, by the whitelist), and
writes them only onto copies that differ. A private-only write changes nothing anywhere. A fact
the writer did not touch is never pushed — a gate a provider filled in on one account is not
overwritten by another account's stale value (defect class 4). Pseudo-facts: a stay's house
(`lodging`: re-used when it is the same house, `isSameHouse`, and then updated in place;
otherwise the stay is re-pointed at a matching or a new house — the recipient's other stays
never move), a cruise's port calls (matched by position, so a member's own excursion note stays
on its day) and legs (replaced), a stop's wrapped entry (by share key, resolved per account).
A change to the house itself (`PATCH /lodging/:id`) propagates through its shared stays.

**No recursion**: propagation runs inside an AsyncLocalStorage flag (`propagationGuard.ts`);
every propagate call inside it is a no-op.

**The boundary** (security review): copies are looked up by key AND the source's share group,
never by key alone; a row's group counts only through its owner's own trip; a row that is not
the actor's is ignored. Share keys never leave the server: a json replacer on the app drops
`shareKey` from every response (the all-data export included), entry notices carry no key,
request schemas strip unknown keys and the `.travstats` schemas are strict.

**Consent withdrawn** (open point, decided): withdrawing a consent detaches the TARGET's trips
from every group the requester is also in — keys and group cleared, the others get a `left`
notice, the copies stay as independent trips — unless an accepted consent remains in the other
direction. Propagation also skips any member with a withdrawn and no accepted consent towards
the actor. Two members brought in by a third have no consent row between them: membership is
the consent. Deleting a shared trip, and merging one away, detaches it first; a shared trip is
never dissolved as a "micro trip".

**Move in/out** (open point, decided): moving an entry out of a shared trip clears its key and
notifies as a delete; moving one in (assign, booking filing, suggestions, merge, imports onto a
shared trip) keys it and propagates as a create.

**Notices**: `updated` stores `before: {facts, zones}` (the recipient's old values) and
`after: {facts, zones, label, tripId, entryId}`; `GET /notices` adds `changes` — one row per
fact with both values in the API time shapes (`TimeValue`/`LocalDateValue`, wall-clock shadows
shown only alone), and `undoneAt`.

**Undo** — `POST /sharing/notices/:id/undo`: on the caller's OWN copy inside the notice's group,
only if its current facts equal `after` (else 409 `SHARE_UNDO_STALE`, `fields` names what
changed since); restores `before`, sets `undoneAt`. It is a write by the caller and propagates
like any change, with its own notice (owner decision 3) — so the original author can undo the
undo. `POST /sharing/notices/:id/delete-copy` deletes the caller's own copy after a `deleted`
notice and notifies whoever still holds one. Codes: `SHARE_UNDO_STALE`,
`SHARE_UNDO_UNAVAILABLE` (not a change, or already undone), `SHARE_COPY_NOT_FOUND`.

**Booking total** (decision 2): `GET /sharing/trips/:tripId` carries `bookingTotals` — the other
members' booking prices for their trip of the group, one sum per currency, read through the
group (only a member's own trip opens it). No booking row crosses.

**UI**: the inbox tab lists each notice with actor, entry and every changed fact (labels DE/EN,
values through the time helpers), Rückgängig / Bei mir auch löschen / Gelesen; a refusal stays
on the notice in its own words. The trip panel shows the members' booking totals.

**Open for later**
- Trip-level facts (name, dates) are not propagated; only the six entry types.
- Roadtrip stations, tour points and route membership stay unshared (S1 scope).
- Writes without a transaction around them (stay create/update, accepted pending updates, the
  booking/assign routes) propagate in a transaction of their own right after the write; a
  failure there is reported, but the member's own write is already stored.
- A cruise's leg-route overrides still do not travel.
