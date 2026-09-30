import type { TimeMigrationTable } from "../../schemas/timeMigration";

/**
 * Per table: the SQL condition "this row's new time columns are filled"
 * (ADR 0002 phase 3b). The report counts, with it, the rows a phase-2 write
 * path or a seed had already filled when the backfill came — the rows it left
 * exactly as they were. The backfill's own candidate queries (one module per
 * table) are the negation of the same condition; `backfill.demoSeed.test.ts`
 * holds the two together by counting a freshly seeded demo account.
 *
 * Constants only — table and column names never come from a request.
 */
export const FILLED_SQL: Record<TimeMigrationTable, string> = {
  flights:
    "dep_timezone IS NOT NULL OR arr_timezone IS NOT NULL OR dep_precision IS NOT NULL OR arr_precision IS NOT NULL",
  rail_journeys: "dep_precision IS NOT NULL",
  place_visits: "visited_precision IS NOT NULL",
  cruise_stops: "time_precision IS NOT NULL OR stop_date IS NOT NULL",
  cruises: "start_day IS NOT NULL OR end_day IS NOT NULL",
  trip_stops: "precision IS NOT NULL",
  trips: "start_day IS NOT NULL OR end_day IS NOT NULL",
  trip_journal_entries: '"day" IS NOT NULL',
  lodging_stays: "check_in_date IS NOT NULL OR check_out_date IS NOT NULL",
  users: "birth_day IS NOT NULL",
};
