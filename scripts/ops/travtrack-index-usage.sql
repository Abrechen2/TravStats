-- Index usage on the TravTrack tables (perf audit 2026-11, item 7).
-- Read-only. Run after at least a week of normal use, including imports and
-- the nightly jobs; see docs/ops/postgres-tuning.md before dropping anything.
-- Every index change on these tables goes through a migration with
-- CREATE/DROP INDEX CONCURRENTLY.
SELECT now() AS checked_at,
       (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()) AS stats_reset;

SELECT s.relname                                   AS table_name,
       s.indexrelname                              AS index_name,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size,
       s.idx_scan                                  AS scans,
       s.idx_tup_read                              AS tuples_read,
       i.indisunique                               AS is_unique
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON i.indexrelid = s.indexrelid
 WHERE s.relname LIKE 'travtrack\_%'
 ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC;

SELECT relname AS table_name, seq_scan, seq_tup_read, idx_scan,
       pg_size_pretty(pg_relation_size(relid)) AS heap,
       pg_size_pretty(pg_indexes_size(relid)) AS indexes
  FROM pg_stat_user_tables
 WHERE relname LIKE 'travtrack\_%'
 ORDER BY seq_tup_read DESC;
