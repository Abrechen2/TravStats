/**
 * The gap calendar's verdict on one day — the ONE place the precedence lives.
 * SQL only counts (`gapCalendarFacts` in `query.ts`); this decides. Abstention
 * is a result: a day nothing explains is `unknown`, a day outside the account's
 * history is `outside` and never a gap.
 */

export const DAY_STATES = [
  "entry",
  "home",
  "place",
  "track",
  "privacyZone",
  "implausible",
  "unknown",
  "outside",
] as const;
export type DayState = (typeof DAY_STATES)[number];

/** What the database counted for one local day. */
export interface DayFacts {
  /** Logbook entries (any domain) whose span covers the day. */
  entries: number;
  /** Plausible fixes outside every privacy zone. */
  goodFixes: number;
  /** Of those, the ones inside the day's home residence radius. */
  homeFixes: number;
  /** Fixes inside a privacy zone (a count the response never carries). */
  zoneFixes: number;
  /** Fixes that are implausible (null island, accuracy over 10 km) and outside every zone. */
  badFixes: number;
  /**
   * No fix at all that day, but the last good fix before it and the first after it both lie at
   * home and nothing in the logbook or the recording contradicts it: a quiet day at home
   * (iOS suspends the app when the phone stands still). Inferred, never recorded.
   */
  silentHome?: boolean;
  /** The same for a work or custom fixed place without a window; only when it is not home. */
  silentPlace?: boolean;
}

/**
 * First match wins: entry > home > track > privacyZone > implausible > unknown.
 * `home` only with every plausible fix at home — one fix elsewhere is a track day.
 */
export function classifyDay(facts: DayFacts): Exclude<DayState, "outside"> {
  if (facts.entries > 0) return "entry";
  if (facts.goodFixes > 0) return facts.homeFixes === facts.goodFixes ? "home" : "track";
  if (facts.zoneFixes > 0) return "privacyZone";
  if (facts.badFixes > 0) return "implausible";
  if (facts.silentHome) return "home";
  return facts.silentPlace ? "place" : "unknown";
}

/** Whether `classifyDay` read the day as home or a known place from standing still, not from a fix. */
export const isInferred = (facts: DayFacts): boolean => {
  const state = classifyDay(facts);
  return (state === "home" || state === "place") && facts.goodFixes === 0;
};

export interface DayRun {
  from: string;
  to: string;
  state: DayState;
  /** `home` or `place`: inferred from the silence around the day, no fix recorded on it. */
  inferred?: true;
}

/** Adjacent days of one state as one inclusive run. `days` are consecutive local dates in order. */
export function toRuns(
  days: ReadonlyArray<{ day: string; state: DayState; inferred?: boolean }>
): DayRun[] {
  const runs: DayRun[] = [];
  for (const { day, state, inferred } of days) {
    const last = runs[runs.length - 1];
    if (last && last.state === state && (last.inferred === true) === (inferred === true)) {
      last.to = day;
    } else
      runs.push({ from: day, to: day, state, ...(inferred ? { inferred: true as const } : {}) });
  }
  return runs;
}

export function countStates(days: ReadonlyArray<{ state: DayState }>): Record<DayState, number> {
  const counts = Object.fromEntries(DAY_STATES.map((s) => [s, 0])) as Record<DayState, number>;
  for (const { state } of days) counts[state] += 1;
  return counts;
}
