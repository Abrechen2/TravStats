import { useEffect, useMemo, useState } from "react";
import { statsApi } from "../api";
import { logger } from "../logger";
import type { DomainKey } from "../../shared/domains";

/** Entries per year, per domain and overall — `GET /stats/years/counts`. */
export interface YearCountRow {
  year: number;
  total: number;
  byDomain: Partial<Record<DomainKey, number>>;
}

const FRESH_MS = 60_000;
let cached: { at: number; rows: Promise<YearCountRow[]> } | null = null;

/** One request shared by every picker on the page, and by the next page within a minute. */
function loadYearCounts(): Promise<YearCountRow[]> {
  const now = Date.now();
  if (cached && now - cached.at < FRESH_MS) return cached.rows;
  const rows = statsApi.getYearCounts().then((r) => r.years);
  cached = { at: now, rows };
  // A failed read must not stay cached for a minute.
  rows.catch(() => {
    if (cached?.rows === rows) cached = null;
  });
  return rows;
}

/** Forget the cache (tests, and after an entry was added or removed). */
export function resetYearCounts(): void {
  cached = null;
}

export interface YearCounts {
  /** Entries per year over every domain (or just `domain`); a year without an entry is absent. */
  of: (domain?: DomainKey) => Record<number, number>;
}

/**
 * The captions of the year picker. They are decoration: while the request runs, or when it
 * fails (logged), the pickers show plain years rather than a wrong number.
 */
export function useYearCounts(): YearCounts {
  const [rows, setRows] = useState<YearCountRow[]>([]);
  useEffect(() => {
    let live = true;
    loadYearCounts()
      .then((r) => {
        if (live) setRows(r);
      })
      .catch((err: unknown) => logger.warn("Year counts could not be loaded", err));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(
    () => ({
      of: (domain?: DomainKey): Record<number, number> => {
        const out: Record<number, number> = {};
        for (const row of rows) {
          const n = domain === undefined ? row.total : row.byDomain[domain];
          if (n) out[row.year] = n;
        }
        return out;
      },
    }),
    [rows]
  );
}
