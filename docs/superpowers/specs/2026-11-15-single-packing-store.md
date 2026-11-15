# One packing list per trip (forgejo#398, H13)

Owner decision 2026-11-15: **one store** — the trip's packing list is the only
packing list; TravPlan shows and edits exactly that one. Design reviewed with
Codex the same day.

## Today

| | A: `TripPackingList` | B: TravPlan `state.packing` |
|---|---|---|
| Where | `trip_packing_lists`, one row per trip (`tripId @unique`) | JSON in the plan state (`services/travplan/schema.ts` `packingSchema`) |
| Item | `{id, label, done}` | `{id, label, category, quantity, packed, scope, note, manual, ownerMemberId}` |
| Who | trip owner only, private | plan members (also on other servers); `privacy.ts` filters personal items per member |
| Writers | Companion (offline, whole-list PUT, `rev` + `mutationId`), web | web TravPlan operations (upsert/remove/undo), Companion copies A → B one way |

Every `TravelPlan` belongs to exactly one trip (`tripId @unique`, required), so
"a plan without a trip" cannot occur.

## Design

1. **`TripPackingList` is the sole store**: one row per trip, rich items in
   `items` JSON, one `rev`. `userId` stays the trip owner.
2. **Item shape (stored):** `{id, label, done, category, quantity, scope,
   note, manual, ownerPrincipal, assigneePrincipal}`. `packed` (B) maps to
   `done`; only `done` is stored. `scope` is `personal | shared`.
   `ownerPrincipal` (personal item: whose) and `assigneePrincipal` (shared item:
   who brings it, or null) are `{server, subjectId}` — a remote plan member
   needs no local `User` row. Null owner = the trip owner (all existing A items).
3. **Defaults:** existing A items and new bare items are owner-personal,
   `category ""`, `quantity 1`, `note ""`, `manual true`. Nothing private is ever
   published by the migration.
4. **Privacy server-side, everywhere** (GET, PUT, plan view, federation, export,
   undo): a member sees shared items plus their own personal items. Trip
   ownership alone does not reveal another member's personal items.

## Contract

### `GET /api/v1/trips/:id/packing` — unchanged for old clients

Without `?shape=rich`: the caller's projection as `{id, label, done}` (plus
`rev`), exactly as today. With `?shape=rich`: full items of the caller's
projection plus `rev`. Additive.

### `PUT /api/v1/trips/:id/packing` — legacy merge

Body as today (`items [{id,label,done}]`, `rev`, `mutationId`).
- Merges **by id** into the stored items: `label` and `done` update; every rich
  field an old client does not know is **kept**.
- An id missing from the body deletes the item **only if it is in the caller's
  projection**; hidden items (other members' personal ones) are untouched.
- A new id is created owner-personal with the defaults above. A body id that
  collides with a hidden item is refused (409 `PACKING_ID_CONFLICT`).
- Stale `rev` → 409 `PACKING_LIST_STALE` with the stored `rev` (unchanged).
  Retries are answered from durable, actor-scoped mutation receipts (table
  `packing_mutations(tripId, actor, mutationId)`), not only `lastMutationId`,
  so interleaved retries from two devices stay idempotent.
- With `?shape=rich` the body carries rich items; scope/ownership changes only
  through rich writes.

### TravPlan

- Plan reads take `packing` as the filtered rich projection of A; the plan JSON
  no longer stores `state.packing` (kept read-only during migration, then
  dropped).
- Plan operations `upsert/remove packing` and their undo become commands on A
  with the packing `rev` check. The plan's other collections are unchanged.
- Federated members act through the plan's existing remote-member path; their
  writes resolve to their principal.

### Minimum versions

- Server: first release with this plan (rc.35+). Additive for every installed
  Companion: bare GET/PUT keep working and cannot wipe rich fields.
- Companion: stops copying A → B once it talks to a server with this feature
  (feature flag in `/api/v1/version` capabilities: `packingSingleStore`).

## Migration

One transactional, idempotent migration per plan: map each B item
`(planId, itemId)` into A (create A row if missing, bump `rev`), preserving rich
fields and privacy. Items already copied from A by the Companion (same label,
proven copy identity) merge; ambiguous duplicates are kept, colliding ids are
remapped. Re-running changes nothing.

## Phases

| Phase | Side | What | State |
|---|---|---|---|
| P1 | server | schema (items JSON shape, `packing_mutations`), legacy merge PUT, rich GET/PUT, privacy, capability flag | open |
| P2 | server | migration B → A, TravPlan operations on A, `state.packing` read-only | open |
| P3 | web | TravPlan packing UI and trip packing card read/write A (rich) | open |
| P4 | Companion | stop A → B copy when `packingSingleStore`; optional rich fields in the app | open |
| P5 | server | drop `state.packing` from the plan schema | open |

## Tests that must exist

Metadata preservation on a legacy PUT; hidden-item deletion refused/ignored;
id collision 409; interleaved retries from two devices; federation member sees
only shared + own; migration idempotency and duplicate merge; undo of a plan
packing operation against a moved `rev`.

## Open for Companion

P4 — waits for P1 on a server branch.
