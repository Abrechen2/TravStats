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

A history row never describes a write that did not land, and no ledger failure ever fails or
aborts the caller's write.

- Interactive `$transaction` (and nested `tx.$transaction`, a savepoint in Prisma 7):
  `db.ts` wraps the client's method (the extension API has no hook for a transaction's
  end) and gives each one a scope. The snapshot is read through that transaction's client
  (it sees the transaction's earlier writes and needs no second connection); the rows are
  collected in the scope and inserted through the same client when the callback returns,
  before the commit. A nested transaction has its own scope, so its rows roll back with it.
  Options (isolation level, timeout) pass through unchanged; a nested call stays Prisma's
  own method on that `tx` — binding it to the top client opened a second, independent
  transaction that waited on the first (50 sharing tests caught that).
- A write outside any transaction: snapshot, write and insert are three plain statements,
  each holding a pool connection only for itself, so no write holds a connection longer
  than it does without the ledger. A crash between the write and the insert loses its rows
  (never invents one).
- The array form `$transaction([...])` cannot carry extra statements: its snapshots read
  committed values and its rows are inserted right after it committed.
- Never aborting: the insert and the single-row snapshot are two SQL functions
  (`change_ledger_insert`, `change_ledger_snapshot`, migration
  `20261122144646_change_ledger_functions`) whose PL/pgSQL exception block is a savepoint
  taken on the server — one round trip each instead of SAVEPOINT / statement / RELEASE. A
  failure returns -1 or `ok: false`, is logged and counted (`ledgerStats()`), and leaves the
  transaction usable. A snapshot by a wider filter (an `updateMany`) runs in a Prisma
  savepoint. Tests inject a real database error into each and assert the user's writes
  commit.
- Memory: rows live only for the duration of their transaction and are inserted in chunks
  of 1 000; there is no process-wide queue.

## Performance budget

Measured 2026-11-22 on the worker database (`changeLedger.measure.test.ts`, run with
`MEASURE_CHANGE_LEDGER=1`), ledger off → on:

| Workload | Wall time | Statements (observed + ledger) | Peak active connections |
|---|---|---|---|
| Flight bulk edit, 200 flights | 700 → 864 ms (+23 %) | 606 → 1006 | 1 → 1 |
| xlsx re-import, 500 bus rows (all updates) | 1318 → 1695 ms (+29 %) | 1058 → 2058 | 5 → 2 |
| Share a trip of 50 flights | 259 → 243 ms (noise) | 399 → 452 | 1 → 1 |
| 50 edits propagated to the member | 2686 → 2619 ms (noise) | 4101 → 4300 | 4 → 5 |

The first version (Prisma savepoints around snapshot and insert) cost +104 % and +99 % on
the first two; the SQL functions brought both under 30 %. TravTrack ingest writes no
tracked model and is not affected. Per tracked write: one snapshot round trip; per
transaction: one insert round trip. A write touching no recorded field costs nothing.

## Limits (known, accepted)

- A relation written through `connect`/`disconnect` is not recorded (no tracked write path
  uses it today).
- A bulk write whose reported count differs from its snapshot (a concurrent edit) re-reads
  the rows and records only those that now hold the written value.
- A write inside a callback that uses a transaction client captured from an outer
  transaction is recorded in the inner scope.
- Standalone writes are recorded at most once (three plain statements), transactional
  writes exactly once with their transaction.

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

Rolling window per account (owner, 2026-11-23): 3, 6, 12 or 24 months, 12 by default
(`user_settings.change_history_retention_months`, Einstellungen → Daten). A nightly job at
03:58 UTC (`jobs/changeHistoryRetentionScheduler.ts`) deletes older rows in batches of 2000
(indexed on `created_at`, a short pause between batches). The account archive selects only rows
inside the window; the history dialog says "Verlauf der letzten 12 Monate". The env variable
`CHANGE_HISTORY_RETENTION_DAYS` is gone.

## UI

No visible button or section (owner, 2026-11-23). "Änderungsverlauf" / "Change history" is an
item of the entry's ⋯ menu (detail pages, trip menu, stay card) or of a bare ⋯ on a place visit,
a cruise day card and in the expense dialog; it opens a dialog with who (source), when, what
(field), from → to and a restore button on restorable rows. Loaded only when opened. DE first,
EN mirrored; tokens only (design wardens).

## Open

Left for later (coordinator, 2026-11-22):

- An account-wide view including delete rows (the API already serves it without
  `entityType`).
