# Trip sharing rework — one contract per entry type, one copy path, one people section

Status: proposed 2026-10-16. Builds on `docs/superpowers/specs/2026-10-09-trip-sharing-design.md`
(S1/S2, bus addendum) and on the fix branch `fix/ct142-sharing` (main `0400dc137` + the
onward-consent, cruise-port-call, house-diff, own-flight, trip-status and booking-total
fixes). It assumes `fix/ct142-transport` (`restatusTrips`, ferry roadtrip-leg restore) and
`fix/ct142-stats` are merged too; every path below is named as it stands after those merges.

## 1. Why

Trip sharing works, and it is on production (2.7.0-rc line, the owner's instance). What does
not work is its shape:

- **The entry types are a list kept by hand in ten places.** `SHARE_ENTITIES`
  (`services/sharing/adapters/types.ts`) is its own vocabulary beside `AVAILABLE_DOMAINS`
  (`shared/domains.ts`) and the sync feed's entities (`services/sync/entities.ts`). The
  per-type knowledge sits in `copyEntries.ts` (`assignShareKeys` + seven `copyX`), `detach.ts`
  (seven `updateMany`), `adapters/index.ts`, `facts/index.ts`, `bulkSync.ts` (a seven-arm
  ternary), the `WRITE` regex of `__tests__/propagate.writePaths.test.ts`, the stale
  `ShareNotice.entityType` comment in `schema.prisma`, `trip/exchange/commit.ts`
  (`SHARED_KINDS`), `tripCleanupService.ts` (`moved` map), the OpenAPI `counts` schema,
  `frontend/src/types/sharing.ts` and `sharing.json` (`entityTypes`, `fields`).
  Bus was missing from all of them until forgejo#288 (a 73-file fix). **Ferry is missing
  today**: `FerryJourney.shareKey` exists with its unique index, nothing reads it — a shared
  trip silently carries no crossing, `detachTrip` leaves no ferry key behind only because none
  is ever set, a trip merge moves crossings without telling anyone, and the write-path guard
  does not even look at `ferryJourney`.
- **Two copy paths.** Sharing a trip copies through `copyEntries.ts` (seven hand-written
  `copyX`); propagating a new entry copies through `adapter.createCopy`. They differ already:
  `copyLodgingStays` has its own house-reuse code (`recipientLodgingId`) beside the adapter's
  `houseFor`; only the share path joins the recipient's own logged flight (`ownFlightMatch`);
  the lodging status is re-derived in three places, each against the server clock instead of
  the recipient's profile zone that `stayWrites.ts` uses.
- **The write-path guard is per file.** A file with eight writes and one propagate call passes
  (`trip/exchange/commit.ts` 8/1, `tripCleanupService.ts` 8/2, `lodgingImportBatches.ts` 3/1,
  `routes/trips.ts` 3/2 — counted 2026-10-16 with the guard's own regex plus `ferryJourney`).
  It proves "this file mentions propagation", not "this write propagates".
- **Strings without a vocabulary in the database.** `ShareConsent.status`, `ShareNotice.kind`
  and `ShareNotice.entityType` are free `String` columns; the comment on `entityType` lists
  seven names and is wrong (no `bus`).
- **One provider change, two inbox items.** When Anna accepts a pending flight update on a
  shared flight, it propagates to Ben's copy (Ben gets an `updated` notice) — and Ben's own
  pending update for the same provider change stays open, offering to apply what is already
  applied.
- **The UI says "share" three ways in three places.** The trip page has "Reisende" (a name
  list), a separate "Geteilt" panel with a raw checkbox that irreversibly copies the trip into
  another account, and an "Als Link teilen" button for public links; linking a companion to an
  account is only possible in Einstellungen; copy says "Freigabe" for sharing although
  "Freigabe" is the comparison feature's word; the inbox notice row is hand-styled while the
  pending-update card next to it has its own look.

## 2. Owner decisions that stand (verbatim, 2026-10-09 and 2026-10-16)

From `2026-10-09-trip-sharing-design.md`, accepted as a whole ("Dein Vorschläge" / "Passt"):

1. **Linked copies, not one shared trip.** Every member owns a complete trip of their own —
   trip, flights, stays, cruise, rail rides, rentals, stops — joined to the others by a share
   group.
2. **Facts sync, persons stay private.** Private per member: seat, cabin/room number, own price
   share, ratings, notes, photos, journal, documents, companions list. The booking's total
   price may be shown to the other member read-only.
3. **Changes apply and say so.** When any member creates or changes a fact, the other copies
   take it at once and each other member gets an inbox notice naming who changed what, with
   **undo** (restores the previous values on their copy only, if nothing changed since).
   **Deletes never propagate** — the others get a notice and decide.
4. **Consent first.** … Without that, no trip can be pushed into another account. Either side
   can withdraw; existing copies then stay as independent trips.
5. **Sharing is per trip.** … Leaving the group keeps one's copy as an ordinary trip.
6. **Single-trip export/import** (`.travstats`).
7. **Web first**, the Companion phone app later.

From `fix/ct142-sharing` (`f32945a72`), owner decision 2026-10-16: **joining a group hands the
newcomer writes into every member's copy, so the sharer's consent alone does not admit them.
Each other current member must have an accepted consent with the recipient**
(`SHARE_GROUP_CONSENT_REQUIRED`), and a write reaches only members with an accepted consent
with the writer (`receivingMembers`).

## 3. Goals

- G1. One registry of shareable entry types, keyed by the domain registry, from which every
  per-type list derives; a test fails when a table with a `share_key` column is not shareable
  and when a domain is not classified.
- G2. Ferry crossings are shareable on rail's/bus's rule, end to end: share, propagate,
  detach, merge, bulk, undo, notices, `.travstats`, inbox labels.
- G3. One copy path: sharing a trip, propagating a create, and the ferry backfill all go
  through `copyInto` (own-entry join → or adapter copy → derive).
- G4. Derived columns of a copy (status, the trip's status) come from the same function the
  domain's own write path uses, evaluated for the RECIPIENT (their profile zone).
- G5. A per-call write-path guard; the low-ratio files are covered or carry a per-call reason.
  Propagation runs in the write's transaction for the stay, trip-assignment and
  pending-update paths.
- G6. Database-checked vocabularies for consent status, notice kind and notice entity type,
  Zod-checked unions in code.
- G7. One rule for a provider change that reaches a member twice.
- G8. One "Reisende" section on the trip page with per-person status and actions; one "Teilen"
  entry point in the trip head; inbox notices on the same card as pending updates.
- G9. A rollout that leaves existing production groups correct and tells the owner which
  groups are only half-connected.

## 4. Non-goals

- Server-to-server sharing, sharing with someone without an account, the phone app.
- Propagating trip-level facts — the period syncs since forgejo#280 point 4 (locally); the name stays each member's own.
- Sharing roadtrips, tours, place visits, notes, photos, journal, documents, expenses (owner
  decision 2: private). Ferry's link to a roadtrip leg (`roadtripLegId`,
  `roadtripLegBefore`) is part of the roadtrip and stays private.
- Moving `statusSweep.ts` onto the new derivation helpers (it already derives per row with the
  same `derive*Status` functions; only the copy path changes).
- A beta switch. See §11.

## 5. Decisions of this rework

**D1 — The registry is data, the adapters are behaviour, the Record type is the guard.**
`services/sharing/shareTypes.ts` holds `SHARE_TYPES`, one entry per shareable type, declared in
copy order (stops last, because a stop resolves the entry it wraps by key):

| entity (notice vocabulary) | domain | Prisma delegate | SQL table | copy-count key | `.travstats` kind |
|---|---|---|---|---|---|
| `flight` | `flight` | `flight` | `flights` | `flights` | `flight` |
| `lodgingStay` | `lodging` | `lodgingStay` | `lodging_stays` | `lodgingStays` | `stay` |
| `cruise` | `cruise` | `cruise` | `cruises` | `cruises` | `cruise` |
| `rail` | `rail` | `railJourney` | `rail_journeys` | `railJourneys` | `rail` |
| `bus` | `bus` | `busJourney` | `bus_journeys` | `busJourneys` | `bus` |
| `ferry` | `ferry` | `ferryJourney` | `ferry_journeys` | `ferryJourneys` | `ferry` |
| `rental` | `rental` | `rentalBooking` | `rental_bookings` | `rentals` | `rental` |
| `stop` | — | `tripStop` | `trip_stops` | `stops` | `stop` |

`ShareEntity` is `keyof typeof SHARE_TYPES`; `SHARE_ENTITIES` is its keys in declared order.
`DOMAIN_SHARING: Record<DomainKey, ShareEntity | { notShared: string }>` classifies every
domain (`poi`: "a place visit is the visitor's own"; `roadtrip`: "roadtrips are not shared,
S1 scope") — `Record<DomainKey, …>` makes a new domain a compile error until classified.
`ADAPTERS: Record<ShareEntity, EntityAdapter>` and `DERIVE: Record<ShareEntity, DeriveCopy>`
make a new entity a compile error until it has behaviour. Prisma enums were rejected for the
vocabulary (see D6).

**D2 — Key operations are generic over the registry.** `services/sharing/keyOps.ts` gives
`assignShareKeys`, `clearTripKeys` (detach), `sharedIdsOf` (bulk) and `heldKeys` (idempotent
share) once, through `keyedDelegate(c, entity)` — an exhaustive switch over `ShareEntity`
returning the Prisma delegate behind a small structural interface. The trip-stop scope
(`tripId`, `routeId: null`, `viaPoint: false`, no `userId` column) is the one special case and
lives in `scopeOnTrip(entity, ownerId, tripId)`.

**D3 — One copy path.** `services/sharing/copyInto.ts`:
`copyInto(c, entity, source, recipient) → { id, joined }` — first `adapter.ownMatch` (flight:
`ownFlightMatch.sameFlight`; ferry: same terminals within 1 km and the same local departure
day; others: none) joins the recipient's own unkeyed row by giving it the key (and filing it
on the recipient's trip when it had none); otherwise `adapter.createCopy`; then
`DERIVE[entity]`. `shareTrip` loops `SHARE_ENTITIES` over the owner trip's keyed rows that the
recipient does not hold; `propagate.createCopies` calls the same function; the ferry backfill
calls the same function. `copyEntries.ts` is deleted. A join during propagation writes a
`created` notice with `after.joined: true` ("Dein eigener Eintrag ist jetzt damit verbunden").
*Behaviour change:* propagation now joins an own logged flight/crossing instead of creating a
duplicate, as the share path already did.

**D4 — Derived columns: one home per domain, evaluated for the recipient.** Copies carry facts
as stored (ADR 0002; the domains' `build*CreateData` / `merge*Journey` helpers convert
REQUEST input — wall clocks, ticket times — and are the wrong tool for stored values). What a
copy must not take as stored are the derived columns. `services/sharing/deriveCopy.ts`
(`DERIVE`) re-derives each copy's `status` with the domain's own function and inputs:
`deriveFlightStatus`, `deriveLodgingStatus` with `now: dayAnchorNowFor(recipientId)`,
`deriveCruiseStatus` with the same anchor, `deriveRailStatus` / `deriveBusStatus` (also
ferry) with `endsAt: rideEndsAt(row)`, `deriveRentalStatus` with the return precision and
zone; stops derive nothing. `dayAnchorNowFor(userId)` moves into
`shared/time/profileZone.ts` and replaces the private `stayStatusNow` in `stayWrites.ts` and
the inline expression in `cruise/createCruise.ts` — one home. After any copy write the
member's trip is re-statused through `restatusTrips([tripId], c)` (one home since
`fix/ct142-transport`). House reuse stays in the lodging adapter (`houseFor` + `isSameHouse`),
now its only home.

**D5 — Per-call write-path guard.** `propagate.writePaths.test.ts` is rewritten: every write
call to a shareable table (registry delegates + `lodging`, `cruiseStop`, `cruiseLeg`) must
either (a) be followed by a propagation call (`propagateWrite(s)`, `propagateDelete(s)`,
`propagateBulk`, `detachTrip`) inside the same top-level declaration (the text from one
column-0 declaration to the next), or (b) carry `// share-exempt: <reason>` on the line
above, or (c) sit in a file whose every write shares one reason (`FILE_EXEMPT`, kept small:
propagation's own writers, the ADR 0002 migrations, the status sweep and provider jobs, the
xlsx run helpers). A `share-exempt` comment not followed by a write within two lines fails
(stale reason). The four low-ratio files: `trip/exchange/commit.ts` — the seven writes in
`createEntry` return their id to the caller that propagates `ids[kind]`, annotated, and an
integration test imports a file into a shared trip; `tripCleanupService.ts` — the merge's
`moved` map is built from the registry (ferry included), integration-tested;
`lodgingImportBatches.ts` — the two `lodging` writes are house bookkeeping (empty house,
`batchId`), annotated; `routes/trips.ts` — the roadtrip `tripStop.updateMany` on delete is
roadtrip stations (not shared), annotated, and the flight assignment moves into one
transaction with its propagation.

**D6 — Vocabularies: CHECK constraints + Zod unions, not Prisma enums.** The loyalty domain
precedent (`LOYALTY_DOMAINS` + a CHECK constraint): a Prisma enum needs an `ALTER TYPE` per
value and cannot be derived from code, while the entity vocabulary IS code (the registry).
Migration `share_vocabulary_checks` adds
`share_consents_status_check (status IN ('pending','accepted','declined','withdrawn'))`,
`share_notices_kind_check (kind IN ('shared','created','updated','deleted','left'))`,
`share_notices_entity_type_check (entity_type IS NULL OR entity_type IN ('trip','flight',
'lodgingStay','cruise','rail','bus','ferry','rental','stop'))`. It first counts offending rows
and raises with the counts, so a failure on production names what is wrong instead of a bare
constraint error. `schemas/sharing.ts` exports `consentStatusSchema`, `shareNoticeKindSchema`,
`shareEntityTypeSchema` (`z.enum(["trip", ...SHARE_ENTITIES])`); `notices.ts` and `undo.ts`
parse with them. `shareVocabulary.test.ts` reads `pg_constraint` and fails when the CHECK lists
and the code lists disagree (as `syncTriggers.test.ts` does for the sync feed). The schema
comments are corrected.

**D7 — One provider change, one inbox item: the share notice wins.** When propagation applies
facts to a member's flight copy (`updated`) and that copy has open pending updates
(`pending` or `edited`), each such update whose every proposed field (its `editedData` when
edited, else `proposedData`) now equals the copy's value is set to status `superseded`
(`metadata.supersededBy = { noticeId, actorId }`). A partially satisfied update stays open —
it still proposes something the copy does not have. The reverse order needs no rule: a
member's own acceptance that arrives second finds the copy equal and propagates nothing. The
pending-update UI shows `superseded` as "Durch geteilte Reise übernommen" / "Applied through
shared trip"; the inbox count and default list already filter `status = pending`.

**D8 — Same-transaction propagation where the write has none.** `createStayRecord` /
`updateStayRecord` (`stayWrites.ts`), `POST /trips/:id/flights` (`routes/trips.ts`) and
`applyPendingUpdate` (`pendingUpdateService.ts`) wrap write + propagation in one
`prisma.$transaction`; a failing propagation rolls the member's own write back, as the
transactional paths already do. `lodgingImportCommit.ts` keeps its own-transaction
propagation (its writes span geocoding and file storage); that is stated in the spec's
"open" list rather than hidden.

**D9 — The trip page has one people section.** "Reisende" (`trips:detail.companions`) becomes
`TripPeopleSection`: one row per trip companion (from `TripCompanion` → `Companion`) plus one
per group member who is not a companion of this trip. Each row: initials, name, `@username`
when linked, and status pills — **Konto verknüpft** (linked), **Teilt diese Reise** (member),
**Zustimmung offen** (my request pending, or a member without an accepted consent with me —
the latter with the hint "Eure Änderungen kommen gegenseitig nicht an, bis ihr beide
zugestimmt habt"). Row action, at most one: **Mit Konto verknüpfen…** (not linked) or
**Reise teilen…** (linked, consenting, not a member, group consent complete). No checkbox: the
action opens `ShareTripDialog` stating what is copied, what stays private, and that the copy
cannot be taken back, with one confirm button. A refusal (`SHARE_GROUP_CONSENT_REQUIRED`) is
known before the click: the server returns `shareBlockedBy`, the row shows why. The section
footer carries the read-only booking totals and **Geteilte Reise verlassen** (not "Gruppe
verlassen": "Reisegruppe" is the comparison feature's word). Einstellungen → Reisen teilen
keeps consent management and the full companion list (a companion on no trip can only be
linked there).

**D10 — One "Teilen" entry point.** `TripHead` gets a **Teilen** button opening a menu with
**Mit Mitreisenden (eigene Kopie)** (opens `ShareTripDialog` with a person picker) and
**Öffentlicher Link** (opens the existing `ShareLinkDialog`, `kind="trip"`). The
`ShareLinkButton` leaves the trip overview; it stays on flights and the year in review. Code
of public links (`components/shareLinks`, `routes/shareLinks.ts`) is untouched. Both
surfaces read one revision counter (`store/tripSharingStore.ts`) so a share from the head
refreshes the section without touching `TripDetailPage.tsx` (frozen at 1056 lines by the
file-size ratchet).

**D11 — Terminology.** "teilen" = account copies; "Link" = public link; "Reisegruppe" and
"Freigabe" stay in Vergleichen only. A test fails when `sharing.json` outside `links.*`
contains "Freigabe"/"freigeb" or "Gruppe" (DE) / "group" (EN).

**D12 — Inbox: applied, then notified, with prominent undo (owner decision 3 kept).** The
"Geteilte Reisen" tab is rebuilt as `ShareNoticeCard` on `Card` with the pending-update
card's anatomy: a header with a status pill (Hinzugefügt / Geändert / Gelöscht / Geteilt /
Verlassen), actor and time; the entry's label as title; the first three changes inline and
the full list in `ChangeDiffView` behind "Details"; actions in a footer — **Rückgängig** is
the primary button on every `updated` notice that can still be undone, **Bei mir auch
löschen** the danger button on `deleted`, **Gelesen** secondary. `ChangeDiffView` gains
`formatValue` and `fieldLabel` props so share values (already in ADR 0002 display shapes)
are shown as formatted, never re-parsed. Loading shows `GlobeLoader`, empty and failed
loads `EmptyState` (`nothing` / `degraded` with retry).

## 6. Architecture after the rework

```
shared/domains.ts (DomainKey) ──► services/sharing/shareTypes.ts
                                     SHARE_TYPES, ShareEntity, SHARE_ENTITIES,
                                     DOMAIN_SHARING, SHARED_SOURCE
                     ┌───────────────────┼─────────────────────────┐
             adapters/index.ts      keyOps.ts                 deriveCopy.ts
             ADAPTERS (Record)      assignShareKeys            DERIVE (Record)
             + adapters/ferry.ts    clearTripKeys              (domain derive* fns,
             + facts/ferry.ts       sharedIdsOf, heldKeys       dayAnchorNowFor)
                     └───────────────┬───┴─────────────────────────┘
                                 copyInto.ts  (ownMatch → createCopy → derive)
                         ┌───────────┼───────────────┬──────────────────┐
                    shareTrip.ts  propagate.ts   scripts/backfillSharedFerries.ts
                                  + pendingSupersede.ts (flight copies)
detach.ts, bulkSync.ts, tripCleanupService.ts (merge), trip/exchange/commit.ts → registry lists
schemas/sharing.ts (Zod unions) ⇄ migration share_vocabulary_checks ⇄ shareVocabulary.test.ts
```

## 7. Data model and migrations

- `share_vocabulary_checks` (D6). No column changes. `prisma migrate dev --create-only`,
  then the SQL is written by hand (CHECK constraints are invisible to Prisma; `check:drift`
  stays green, as for the loyalty CHECKs).
- No migration for ferry: `ferry_journeys.share_key` and `@@unique([userId, shareKey])`
  exist. `schema.prisma` comments: `ShareNotice.entityType` lists the nine values and points
  to `SHARE_TYPES`; `ShareConsent.status` and `ShareNotice.kind` point to the CHECKs.
- `PendingFlightUpdate.status` gains the value `superseded` (string column, no constraint;
  comment updated).

## 8. API contract (all `/api/v1/sharing`, enveloped family — unchanged family)

- `GET /sharing/trips/:tripId` — new shape:
  ```ts
  {
    groupId: string | null;
    people: TripPerson[];          // NEW
    linkableUsers: SharePerson[];  // NEW: accounts with an accepted consent from the caller
    bookingTotals: MemberBookingTotal[];
  }
  interface TripPerson {
    key: string;                   // "c:<companionId>" | "u:<userId>"
    companionId: string | null;    // null: a member who is no companion of this trip
    name: string;
    account: SharePerson | null;
    consent: "none" | "pending" | "accepted" | "declined" | "withdrawn"; // caller → account
    member: boolean;
    receivesChanges: boolean | null; // members only: an accepted consent in either direction
    shareBlockedBy: "notLinked" | "consentMissing" | "consentPending" | "groupConsentMissing"
                    | "alreadyMember" | null;
  }
  ```
  `members` and `candidates` were served alongside for one deploy and are removed (only the
  web read them; the Companion does not call `/sharing` — checked 2026-10-16).
- `POST /sharing/trips/:tripId/share` — `created` gains `ferryJourneys`; the counts object's
  keys are the registry's count keys.
- `GET /sharing/notices` — `entityType` is the enum `trip | <SHARE_ENTITIES>`; `kind` the
  enum; `after.joined?: boolean` on `created`.
- Companion link stays `PUT|DELETE /sharing/companions/:id/link`; the consent request stays
  `POST /sharing/consents` (the row's link dialog uses both).
- OpenAPI (`services/openapi/paths/sharing.ts`) is updated with each change; the response-
  schema and coverage ratchets keep their baselines (no new endpoints). The response-shape
  ratchet has `sharing.ts` in the enveloped family already.
- `.travstats`: `ferry[]` (rail/bus shape: `vesselName`, terminals, times, distance;
  private: `fareClass`, `seat`, `bookingReference`, `ticketReference`, `cabinType`, own price,
  notes, companions; never: vehicle fields, roadtrip link). `formatVersion` 3 when a file
  carries crossings, else as today (1 without bus, 2 with); this build reads 1–3 and an older
  importer refuses 3 by name.

## 9. UI

Components used: `Card`, `Button`, `Dialog`, `Field`/`Select`/`Input`, `Pill`, `EmptyState`,
`GlobeLoader`, `DetailSection`, `PeopleList` (extended with `rows`), `ChangeDiffView`
(extended), `ShareLinkDialog`.

| Surface | Component | Replaces |
|---|---|---|
| Trip overview side column, "Reisende" | `components/sharing/TripPeopleSection.tsx` | `PeopleList names=…` + `TripSharingPanel` + `ShareLinkButton` on the trip |
| Row action dialogs | `ShareTripDialog.tsx`, `LinkAccountDialog.tsx` | the checkbox; the Settings-only link |
| Trip head | `components/sharing/TripShareMenu.tsx` in `TripHead.tsx` | — |
| Inbox tab | `components/inbox/ShareNoticeCard.tsx`, rebuilt `SharingTab.tsx` | `ShareNoticeRow.tsx` |

Copy (DE primary / EN), informal "du":

| Key | DE | EN |
|---|---|---|
| `sharing:people.badges.linked` | Konto verknüpft | Account linked |
| `sharing:people.badges.member` | Teilt diese Reise | Shares this trip |
| `sharing:people.badges.consentPending` | Zustimmung offen | Consent pending |
| `sharing:people.noChangesHint` | Eure Änderungen kommen gegenseitig nicht an, bis ihr beide zugestimmt habt. | Your changes don't reach each other until you have both agreed. |
| `sharing:people.actions.link` | Mit Konto verknüpfen… | Link to account… |
| `sharing:people.actions.share` | Reise teilen… | Share trip… |
| `sharing:people.blocked.consentMissing` | {{name}} hat dem Teilen noch nicht zugestimmt. | {{name}} has not agreed to sharing yet. |
| `sharing:people.blocked.groupConsentMissing` | Nicht alle, die diese Reise teilen, haben dem Teilen mit {{name}} zugestimmt. | Not everyone on this shared trip has agreed to sharing with {{name}}. |
| `sharing:people.leave` | Geteilte Reise verlassen | Leave shared trip |
| `sharing:shareDialog.title` | Reise mit {{name}} teilen | Share trip with {{name}} |
| `sharing:shareDialog.copied` | {{name}} bekommt eine eigene Kopie dieser Reise: Flüge, Unterkünfte, Kreuzfahrten, Bahn-, Bus- und Fährfahrten, Mietwagen und Stopps mit Zeiten, Orten und Status. Ändert einer von euch später etwas daran, kommt es bei allen an und lässt sich im Posteingang rückgängig machen. | {{name}} gets their own copy of this trip: flights, stays, cruises, train, bus and ferry rides, rentals and stops with their times, places and status. When one of you changes something later, it reaches everyone and can be undone in the inbox. |
| `sharing:shareDialog.private` | Privat bleiben: Sitzplatz, Kabine und Zimmer, dein Preis, Buchungsnummern, Bewertungen, Notizen, Fotos, Tagebuch und Dokumente. | Staying private: seat, cabin and room, your price, booking references, ratings, notes, photos, journal and documents. |
| `sharing:shareDialog.final` | Das lässt sich nicht zurücknehmen: {{name}} behält die Kopie, auch wenn einer von euch die geteilte Reise verlässt. | This cannot be taken back: {{name}} keeps the copy even if one of you leaves the shared trip. |
| `sharing:shareDialog.confirm` | Reise teilen | Share trip |
| `sharing:menu.button` | Teilen | Share |
| `sharing:menu.companions` | Mit Mitreisenden (eigene Kopie) | With travel companions (own copy) |
| `sharing:menu.link` | Öffentlicher Link | Public link |
| `pendingUpdates:status.superseded` | Durch geteilte Reise übernommen | Applied through shared trip |

Fixed copy: `sharing:trip.errors.loadFailed` "Die Freigabe dieser Reise …" → "Wer diese Reise
teilt, konnte nicht geladen werden."; `sharing:settings.errors.loadFailed` "Die Freigaben …" →
"Die Einstellungen zum Teilen konnten nicht geladen werden."; `trip.leave*` "Gruppe" →
"geteilte Reise"; `trip.privateHint` adds Fährfahrten.

## 10. Rollout from today's production state

Production (CT 100) runs `2.7.0-rc.*` with sharing live and the beta switch on.

1. **Vocabulary migration** runs at boot. Expected to pass: every value written so far is in
   the lists (`shared|created|updated|deleted|left`; `trip` + seven entity names). If not, the
   migration raises with counts and the deploy stops before the app starts — the RC server
   (CT 107, a prod-data mirror) runs it first, per the RC-first rule.
2. **Groups created before the consent rule** (a member brought in onward with no consent
   towards the others) keep existing; propagation has skipped the unconsented pairs since
   `fix/ct142-sharing`. New: the section shows such a member with **Zustimmung offen** and the
   hint; `npm run sharing:report-consent` (read-only, `backend/src/scripts/reportShareGroupConsent.ts`)
   lists every group with its unconsented pairs, run on the RC copy and then prod, results to
   the owner. No automatic consent, no automatic detach (owner decision 4: consent is given,
   never inferred).
3. **Crossings missing from existing groups.** `npm run sharing:backfill-ferries`
   (`backend/src/scripts/backfillSharedFerries.ts`) — dry run by default, prints per group how
   many crossings would be joined and how many copied; `--apply` runs, per group and per
   consenting ordered pair, the same `copyInto` the share path uses (own crossing joined when
   same terminals ± 1 km and same local day, else copied; a `created` notice each). Run on CT
   107 first, owner reads the dry run, then prod with `--apply` only on the owner's word.
4. **Pending updates already doubled** are not rewritten retroactively: they expire on their
   own (`expiresAt`); only changes propagated after the deploy supersede.
5. **No data moves for the UI.** The old `TripSharingPanel` shape (`members`, `candidates`)
   is served until the last task, so a cached old bundle keeps working through one deploy.

## 11. Beta gate

Trip sharing has **no** beta key — measured in `frontend/src/config/betaFeatures.ts` on
`fix/ct142-sharing`: the registry holds `comparison`, `devicePairing`, `roadtrips`,
`lodgingEnrichment`, `rentalDomain`, `railDomain`, `ferryDomain`, `busDomain`, `cruiseTracks`.
Sharing shipped un-gated in 2.7 and runs on the owner's production. This rework adds none: a
key on a released feature would hide sharing on every install that has the switch off and
keep two UIs alive, and the 2.7 goal is an empty registry. Instead every task leaves main
shippable — backend tasks are behaviour-preserving except where stated (ferry, join on
propagate, superseded), and each UI task swaps one surface whole, deleting what it replaces
in the same commit. Ferry crossings are copied into a recipient's account whether or not
their `ferryDomain` gate is open, as rail and bus rides are; the gate hides pages, not rows.

## 12. What gets deleted

`services/sharing/copyEntries.ts` (`assignShareKeys` moves to `keyOps.ts`, `SHARED_SOURCE` to
`shareTypes.ts`); the seven-arm ladder in `bulkSync.ts`; the seven `updateMany` in
`detach.ts`; `SHARED_KINDS` in `trip/exchange/commit.ts`; the hand list in
`tripCleanupService.ts`'s `moved`; `derivedStatus` and the inline `deriveLodgingStatus` in
`adapters/lodgingStay.ts`; the private `stayStatusNow`; `components/sharing/TripSharingPanel.tsx`
and its test; `components/inbox/ShareNoticeRow.tsx`; the trip overview's
`ShareLinkButton`; `TripSharingView.members` / `.candidates` and `ShareCandidate`
(backend, OpenAPI, frontend types); i18n keys `sharing:trip.{title,members,candidates,
shareTick,sharedTick,noCandidates,settingsLink,notShared,shared}`.

## 13. Risks

- **The per-call guard is a source scanner and will age** (memory: "Quelltext-scannende
  Waechter altern"). Mitigated by the stale-exemption check and by integration tests on the
  four paths that were low-ratio; it does not replace them.
- **Joining on propagate** could hang a sharer's new flight on a recipient's different one.
  `sameFlight` is deliberately conservative (number + route + local day); the ferry rule adds a
  1 km terminal tolerance and the local day. Pinned by tests across a midnight.
- **Recipient-zone derivation** changes a copied stay's status for a recipient far from the
  sharer for a few hours around midnight — that is the correction, not a regression.
- **CHECK migration on production** fails the boot if an unexpected string exists; the RC
  server runs it first on a copy of production.
- **Superseding** touches another member's pending updates; it only ever sets `superseded`
  when every proposed field already holds — the update would have changed nothing.

## 14. Docs

This file goes to `docs/superpowers/specs/2026-10-16-trip-sharing-rework-design.md`; the
2026-10-09 spec gets a "Rework (2026-10-16)" pointer section and its ferry/bus lists fixed;
`CLAUDE.md` Critical Gotchas gains the line: "**Shareable entry types** — a new domain with a
`share_key` column is classified in `services/sharing/shareTypes.ts` (`DOMAIN_SHARING`) and
gets an adapter and a `DERIVE` entry; `shareTypes.test.ts` fails otherwise. Writes to a
shareable table propagate or carry `// share-exempt: <reason>`
(`propagate.writePaths.test.ts`)." and the Enforced table gains the two checks.
