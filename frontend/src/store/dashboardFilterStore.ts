import { create } from "zustand";
import { AVAILABLE_DOMAINS, isValidDomain, type DomainKey } from "../shared/domains";

export interface TimeRange {
  readonly from: string | null; // ISO yyyy-mm-dd
  readonly to: string | null;
}

export interface FlightFilter {
  readonly airline?: string;
  readonly status?: string;
}

export interface CruiseFilter {
  readonly cruiseLine?: string;
  readonly status?: string;
}

export interface PoiFilter {
  readonly category?: string;
}

interface DashboardFilterState {
  time: TimeRange;
  /**
   * Year dropdown selection. `null` means "all years" — keeps the
   * underlying `time` range null/null. A specific year populates
   * `time` with `YYYY-01-01` / `YYYY-12-31` so existing
   * range-overlap checks (intervalOverlapsRange) keep working.
   */
  year: number | null;
  /**
   * Domain visibility filter — only meaningful on the cross-domain
   * "Alle" tab. Empty array = show none, undefined-equivalent
   * (full set) = show all. Single-domain tabs ignore this filter.
   */
  domains: readonly DomainKey[];
  flight: FlightFilter;
  cruise: CruiseFilter;
  poi: PoiFilter;
  /**
   * Fully replaces the global time filter. Callers must guarantee
   * `from <= to` — inverted ranges are not normalised here.
   */
  setTimeRange(from: string | null, to: string | null): void;
  /**
   * Sets the year dropdown selection. Pass null to clear (= all years).
   * Mirrors the year into the `time` range so consumers that read
   * `time.from`/`time.to` keep working unchanged.
   */
  setYear(year: number | null): void;
  /**
   * Replaces the active domain filter set. The "Alle" tab uses this
   * to toggle flight/cruise/poi visibility together.
   */
  setDomains(domains: readonly DomainKey[]): void;
  setFlightFilter(patch: Partial<FlightFilter>): void;
  setCruiseFilter(patch: Partial<CruiseFilter>): void;
  setPoiFilter(patch: Partial<PoiFilter>): void;
  reset(): void;
}

const EMPTY_TIME: TimeRange = { from: null, to: null };
// "All domains" defaults to whatever the build currently exposes —
// AVAILABLE_DOMAINS reads from the static DOMAINS registry so tab
// availability and filter availability stay in sync.
const ALL_DOMAINS: readonly DomainKey[] = AVAILABLE_DOMAINS;

/**
 * The "Alle" tab's domain chips are remembered per viewer, in this browser
 * only (tester 2026-09-26). What is stored is the HIDDEN set, not the shown
 * one: a domain added in a later release then starts visible instead of
 * silently missing from a map that was filtered before it existed. Storage
 * can throw (private window, blocked site data); the filter then simply
 * starts full and forgets, which is the right degradation for a convenience.
 */
const HIDDEN_DOMAINS_KEY = "dashboard.hiddenDomains";

function readHiddenDomains(): DomainKey[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_DOMAINS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key): key is DomainKey => typeof key === "string" && isValidDomain(key));
  } catch {
    return [];
  }
}

function writeHiddenDomains(shown: readonly DomainKey[]): void {
  try {
    const hidden = ALL_DOMAINS.filter((key) => !shown.includes(key));
    if (hidden.length === 0) window.localStorage.removeItem(HIDDEN_DOMAINS_KEY);
    else window.localStorage.setItem(HIDDEN_DOMAINS_KEY, JSON.stringify(hidden));
  } catch {
    // Not remembered; the choice still applies for this visit.
  }
}

function initialDomains(): readonly DomainKey[] {
  const hidden = readHiddenDomains();
  return ALL_DOMAINS.filter((key) => !hidden.includes(key));
}

export const useDashboardFilterStore = create<DashboardFilterState>((set) => ({
  time: EMPTY_TIME,
  year: null,
  domains: initialDomains(),
  flight: {},
  cruise: {},
  poi: {},
  setTimeRange: (from, to) => set({ time: { from, to } }),
  setYear: (year) =>
    set({
      year,
      time: year === null ? EMPTY_TIME : { from: `${year}-01-01`, to: `${year}-12-31` },
    }),
  setDomains: (domains) => {
    writeHiddenDomains(domains);
    set({ domains });
  },
  setFlightFilter: (patch) => set((s) => ({ flight: { ...s.flight, ...patch } })),
  setCruiseFilter: (patch) => set((s) => ({ cruise: { ...s.cruise, ...patch } })),
  setPoiFilter: (patch) => set((s) => ({ poi: { ...s.poi, ...patch } })),
  reset: () => {
    writeHiddenDomains(ALL_DOMAINS);
    set({
      time: EMPTY_TIME,
      year: null,
      domains: ALL_DOMAINS,
      flight: {},
      cruise: {},
      poi: {},
    });
  },
}));

/**
 * True when the interval [startDate, endDate] overlaps the filter range
 * [from, to]. Used for cruise time-filtering where each cruise is an
 * interval and the global time-slider is also a range. Null `endDate`
 * means open-ended cruise (treated as still ongoing). Null `from` / `to`
 * means that bound is unset.
 */
export function intervalOverlapsRange(
  startDate: string,
  endDate: string | null,
  from: string | null,
  to: string | null
): boolean {
  const toNumber = (v: string | null, fallback: number): number => {
    if (v === null) return fallback;
    const n = Date.parse(v);
    return Number.isNaN(n) ? fallback : n;
  };
  const start = toNumber(startDate, Number.NEGATIVE_INFINITY);
  const end = toNumber(endDate, Number.POSITIVE_INFINITY);
  const rangeFrom = toNumber(from, Number.NEGATIVE_INFINITY);
  const rangeTo = toNumber(to, Number.POSITIVE_INFINITY);
  return start <= rangeTo && end >= rangeFrom;
}
