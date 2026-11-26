# Postgres and Node sizing

How to size the database and the app to the box they run on. The values
below come from the November 2026 performance audit of a 2 GiB / 2-core
install that ran into swap and a load of 15 during a large TravTrack import.

Nothing here is applied automatically to an existing database: Postgres
settings belong to whoever runs the `db` container. The app only sets its own
per-session timeouts and its Node heap.

## What the app does by itself

| What | Default | Override |
|---|---|---|
| Node heap (`--max-old-space-size`) | 55 % of the container's memory limit; without a limit 55 % of half of MemTotal; 512..4096 MB. The entrypoint logs `Node heap: … MB (…)` at boot. | `NODE_MAX_OLD_SPACE_MB`, or your own `--max-old-space-size` in `NODE_OPTIONS` |
| `statement_timeout` per app connection | 30 s | `DB_STATEMENT_TIMEOUT_MS` (0 = off) |
| `idle_in_transaction_session_timeout` | 5 min | `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` (0 = off) |
| Jobs that raise their own statement timeout | account deletion 30 min, archive restore 10 min (`SET LOCAL`, ends with the transaction) | — |

Migrations (`prisma migrate deploy`), `pg_dump` backups and the `psql` restore
open their own connections and are not bound by the app's timeouts.

## Postgres settings by box size

Pass them as `-c name=value` arguments to `postgres` (compose: the `db`
service's command, see the commented block in `docker-compose.prod.yml`;
Unraid: the PostGIS container's **Post Arguments**). Restart the database
afterwards. Values for a box that the app, the database and a few small
containers share:

| Setting | 2 GiB | 4 GiB | 8 GiB+ | Why |
|---|---|---|---|---|
| `shared_buffers` | 256MB | 512MB–1GB | 25 % of RAM, ≤ 4GB | the default 128MB left the cache hit ratio at 94.5 % |
| `effective_cache_size` | 768MB | 2GB–2.5GB | 50–60 % of RAM | a planner hint only; 5GB on a 2 GiB box misled it |
| `work_mem` | 8MB | 8–16MB | 16–32MB | 4MB made the TravTrack aggregates spill to disk |
| `maintenance_work_mem` | 128MB | 256MB | 512MB | index builds and vacuum |
| `jit` | off | off | off | JIT compile time dominated the small analytic queries |
| `random_page_cost` | 1.1–1.5 | 1.1–1.5 | 1.1–1.5 | only on SSD/NVMe/Ceph, and only after the benchmark below; keep 4 on spinning disks |
| `effective_io_concurrency` | 64 | 64 | 200 | SSD-class storage; 1 is the HDD default |
| `wal_compression` | on | on | on | less WAL I/O during bulk imports on network disks |
| `max_wal_size` | 2GB | 2–4GB | 4GB | fewer forced checkpoints during imports |
| `checkpoint_completion_target` | 0.9 | 0.9 | 0.9 | spreads checkpoint writes |

`random_page_cost`: measure before and after with the same query, e.g. the
day read of the largest account:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM travtrack_points
WHERE user_id = '<id>' AND t BETWEEN now() - interval '30 days' AND now()
ORDER BY t, seq;
```

Keep the lower value only if the plan and the time get better.

## pg_stat_statements (slow-query visibility)

The admin runtime card (**Admin → Wartung → System**, block "Laufzeit") lists the
slowest queries when the extension is available, and otherwise says
"nicht aktiviert". To enable it:

1. Add to the `postgres` arguments:
   `-c shared_preload_libraries=pg_stat_statements -c track_io_timing=on`
   and, for a server log of slow statements, `-c log_min_duration_statement=500ms`.
2. Restart the database container.
3. Create the extension once, as the superuser (the app role cannot):
   ```sh
   docker exec travstats-db psql -U postgres -d flights \
     -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;' \
     -c 'GRANT pg_read_all_stats TO flights;'
   ```
   On older installs where the app role `flights` is the superuser, use
   `-U flights`.

Without `pg_read_all_stats` the app sees only its own statements' text,
which is all the card needs; the grant adds other roles' statements.

## Checking a TravTrack index before dropping it

Never drop an index on a hunch: the counters start at the index's creation
and reset with the statistics. After at least a week of normal use run

```sh
docker exec travstats-db psql -U postgres -d flights -f - < scripts/ops/travtrack-index-usage.sql
```

(or paste the file into `psql`). It lists each index on the TravTrack tables
with its size, `idx_scan` and when statistics were last reset. An index with
0 scans after a week that included imports and the nightly jobs is a
candidate; check `pg_stat_statements` for a query that should use it, then
drop it with `DROP INDEX CONCURRENTLY` through a migration, never by hand.
Every index change on these tables uses `CONCURRENTLY`.

## Autovacuum for the bulk-written tables

The default scale factors re-analyse `travtrack_points` only after ~20 % of
it changed. After a large import the planner then works with stale
statistics. Either run `ANALYZE travtrack_points;` after the import, or set:

```sql
ALTER TABLE travtrack_points SET (autovacuum_vacuum_insert_scale_factor = 0.02,
                                  autovacuum_analyze_scale_factor = 0.02);
```
