# Change history — every edited value keeps its history

Status: built on `fix/change-history` (server + web). Owner: "weiter bauen" on the council idea.

## Why

A corrected value used to replace the old one without a trace, so a statistic or a map
from before the correction could no longer be explained. The ledger keeps, per edited
field, what it was, what it became, who or what changed it and when — and lets the user
write one value back.

## Scope

Tracked entries (Prisma model → `entityType`):

| Model                                   | entityType               |
| --------------------------------------- | ------------------------ |
| Flight                                  | `flight`                 |
| LodgingStay                             | `lodgingStay`            |
| RailJourney / BusJourney / FerryJourney | `rail` / `bus` / `ferry` |
| RentalBooking                           | `rental`                 |
| Cruise / CruiseStop                     | `cruise` / `cruiseStop`  |
| Trip                                    | `trip`                   |
| PlaceVisit                              | `placeVisit`             |
| TripExpense                             | `expense`                |

Recorded: `update`, `updateMany`, `upsert` (its update branch) and `delete`, `deleteMany`.
A create is not a change and is not recorded. A no-op write (every value equal after
normalisation) writes nothing. Children removed by a database cascade (a cruise's stops)
are covered by their parent's delete row.

## Capture point

`services/changeLedger/capture.ts`, called by the one query extension in `db.ts` around
every write to a tracked model — so all ~200 write paths are covered without each calling
it. For a write that touches a recorded field the hook reads a before-snapshot of exactly
those fields (plus id, owner and a short label) on the unextended client, runs the write,
diffs, and queues the rows. A single `update`/`upsert` takes the new value from the row the
database handed back; an `updateMany` derives it from the written value (`set`, arithmetic,
`push` are understood; anything else is skipped rather than guessed).

Not recorded, by name (`IGNORED_FIELDS`): keys and bookkeeping (`id`, `userId`,
`createdAt`, `updatedAt`, `lastModifiedBy`, `nextApiCheckAt`, `shareKey`, …) and derived
payloads a refresh rewrites wholesale (`geometry`, `actualRoute`, `enrichmentHistory`).

## Sources

`source` is one of `web`, `companion`, `api`, `import`, `auto_update`, `merge`,
`share_sync`, `system` (`services/changeLedger/context.ts`, an AsyncLocalStorage store):

- every request runs in a store holding the request (`changeContextMiddleware`); a
  paired device token is `companion`, another token `api`, a cookie session `web`;
- the import and parser routes are marked `import` (`markChangeSource`, `index.ts`);
- the flight auto-update, status sweep, bulk refresh, final-arrival sweep and landing
  mark are `auto_update`; the duplicate merge and resolution are `merge`
  (`withChangeSource` wrappers on their exported entry points);
- a write the share propagation makes is `share_sync`, whatever else is set
  (`isPropagating()`);
- anything outside a request is `system`. Two maintenance backfills of derived time
  columns run under `withoutChangeLedger` and record nothing.

`actorUserId` is the request's account (or the declared one); null for the system.
`reason` is optional; a restore writes `restore`.

## Storage bound

- One row per changed field (`operation = update`) or per deleted entry
  (`operation = delete`, no values, a `label` of at most 160 characters).
- Values are JSON text of scalars and short JSON, capped at 1 000 characters
  (`MAX_VALUE_CHARS`). A larger value or bytes is recorded as `omitted = true` with no
  text: the history says the field changed and offers no restore. No payload dumps.
- A bulk write matching more than 5 000 rows is a migration, not an edit: it is logged
  (`change_ledger_bulk_skipped`) and not recorded.

## Performance budget

- A tracked write touching a recorded field: one extra primary-key/filter read
  (the snapshot). A write touching none (a version claim, a geometry refresh): nothing.
- Inserts are batched: rows are queued and written by one `createMany` per flush
  (200 ms or 500 rows), plus one owner-existence read per flush. Never one insert per write.
- The ledger's queries run on the unextended client, so they do not re-enter the hook and
  are not counted by `observeQueries`. `ledgerStats()` counts them; the 200-flight bulk
  edit test holds them to ≤ 200 snapshot reads and ≤ 20 inserts for 400 rows, while the
  route's own guard (≤ 620 queries) is unchanged.

## Limits (known, accepted)

- Transactions: every `prisma.$transaction` (callback or array form) runs through
  `runLedgerTransaction` (`db.ts` wraps the client's method; the extension API has no hook
  for a transaction's end). The rows its writes produce are collected per transaction and
  queued only after it committed; a rollback drops them, so a write that did not land never
  leaves a row. Chosen over inserting through the transaction client because a ledger
  failure must never abort the caller's transaction, and because a read through the outer
  client while a nested `tx.$transaction` is open waits on it. The snapshot therefore runs
  on the base client (committed values, never blocked by the transaction's locks); a field
  the same transaction already wrote takes its "before" from the transaction's own record.
  A nested `tx.$transaction` shares its outer scope: rows from a nested part that rolled
  back while the outer one still committed are kept (no write path does that today).
- Queued rows live in memory for at most one flush interval; a crash loses them.
- A relation written through `connect`/`disconnect` is not recorded (no tracked write path
  uses it today).
- A bulk write whose reported count differs from its snapshot (a concurrent edit) re-reads
  the rows and records only those that now hold the written value.

## Restore

`POST /api/v1/change-history/:id/restore` writes the row's old value back to the field,
through the same hook — so the restore is itself a row, with `restoredFromId` — and,
for a shareable entry, through the share propagation like any edit. Only free text and
labels nothing else is derived from are restorable (`RESTORABLE_FIELDS` in `history.ts`:
notes, tags, seat, gate, booking codes, room, cabin, vehicle, …). Everything else is shown
and changed through the entry's own form, because a direct write would skip what that form
recomputes: a time's instant, zone and precision (ADR 0002), an airport's coordinates and
zone, a price's FX snapshot, the companion links behind `companions`, a trip's status behind
`tripId`. A delete row and an omitted value are never restorable. A value naming a record that
is gone answers 409 `CHANGE_NOT_RESTORABLE`; a row of another account 404
`CHANGE_NOT_FOUND`.

## Privacy

- The ledger belongs to the account: `user_id` cascades with the account, every query is
  scoped to the caller, and another account's row answers 404.
- It never leaves through federation or a share: the leaderboard carries totals only and
  the `.travstats`/encrypted share carry entries, neither reads this table.
- It travels in the account archive (`tablePolicy.ts`: `owner`, `entity_id` re-keyed as an
  id column, `actor_user_id` and `restored_from_id` stripped). A row of an entry the archive
  does not carry (a deleted entry) is skipped on import.

## Retention

Default: keep. `CHANGE_HISTORY_RETENTION_DAYS=<n>` (positive whole number) prunes rows
older than n days daily at 03:58 UTC (`jobs/changeHistoryRetentionScheduler.ts`); an
invalid value is logged at start and nothing is deleted.

## UI

Each detail page (flight, rail, bus, ferry, rental, cruise, trip) shows "Verlauf" /
"History" full width below its grid: who (source), when, what (field), from → to, and a
restore button on restorable rows. The same component, `compact`, sits on each stay card of
a lodging, each visit of a place, each day card of a cruise (its stop) and in the expense
dialog. Loaded only when opened. DE first, EN mirrored; tokens only (design wardens).

## Open

Left for later (coordinator, 2026-11-22):

- Retention stays an env variable; an admin setting is a later step.
- An account-wide view including delete rows (the API already serves it without
  `entityType`).
