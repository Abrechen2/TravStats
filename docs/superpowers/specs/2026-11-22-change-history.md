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
those fields (plus id, owner and a short label), runs the write, diffs, and writes the rows
in the same transaction as the change (see Transactions). A single `update`/`upsert` takes the new value from the row the
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

## Transactions — a row commits with its change

A history row commits or rolls back with the change it describes: never a row for a write
that did not land, never a committed change without its row, never a row twice (nothing is
retried or queued).

- Interactive `$transaction` (and nested `tx.$transaction`, a savepoint in Prisma 7):
  `db.ts` wraps the client's method (the extension API has no hook for a transaction's
  end) and gives each one a scope. The snapshot is read through that transaction's client
  (it sees the transaction's earlier writes, needs no second connection); the rows are
  collected in the scope and inserted through the same client when the callback returns,
  before the commit. A nested transaction has its own scope, so its rows roll back with it.
  Options (isolation level, timeout) pass through unchanged; a nested call stays Prisma's
  own method on that `tx` — binding it to the top client opened a second, independent
  transaction that waited on the first (50 sharing tests caught that).
- A write outside any transaction runs inside a short transaction of its own on the base
  client: snapshot, the same call on the transaction's delegate, the rows.
- The array form `$transaction([...])` cannot carry extra statements: its snapshots read
  committed values and its rows are inserted right after it committed (a crash in that
  moment loses them; a rollback drops them).
- The insert runs in a savepoint: a ledger failure (an account deleted meanwhile) is logged
  with the row count and never aborts the caller's work. A failing snapshot inside a
  caller's transaction is the one ledger statement that could abort it; it is a plain
  primary-key/filter read.
- Memory: rows live only for the duration of their transaction and are inserted in chunks
  of 1 000; there is no process-wide queue.

## Performance budget

- A tracked write touching a recorded field: one snapshot read. A write touching none (a
  version claim, a geometry refresh): nothing.
- One insert per transaction (chunked), plus a savepoint around it; a standalone write adds
  its own BEGIN/COMMIT.
- The ledger's statements are not counted by `observeQueries`; `ledgerStats()` counts them.
  The 200-flight bulk edit (200 transactions) is held to ≤ 200 snapshot reads and ≤ 200
  inserts for 400 rows, while the route's own guard (≤ 620 queries) is unchanged.

## Limits (known, accepted)

- A relation written through `connect`/`disconnect` is not recorded (no tracked write path
  uses it today).
- A bulk write whose reported count differs from its snapshot (a concurrent edit) re-reads
  the rows and records only those that now hold the written value.
- A write inside a callback that uses a transaction client captured from an outer
  transaction is recorded in the inner scope.

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
