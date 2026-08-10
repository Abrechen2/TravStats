/**
 * Punctuality aggregation (#2): 2.5 started recording actual-vs-scheduled
 * times and a delay per flight, but nothing ever summarised them. This turns
 * the stored `delayMinutes` into the numbers a frequent flyer actually wants —
 * how late on average, how often on time, and which airline and route are the
 * worst offenders — all from data already captured, no new lookups.
 *
 * Pure and DB-free so it is unit-testable; the route just feeds it rows.
 */

export interface PunctualityFlight {
  delayMinutes: number | null;
  airline: string | null;
  airlineIata: string | null;
  depIata: string | null;
  arrIata: string | null;
}

export interface PunctualityGroup {
  key: string;
  avgDelayMinutes: number;
  flights: number;
}

export interface PunctualityStats {
  /** Flights that carry a delay figure — the sample every number below rests on. */
  sampleSize: number;
  avgDelayMinutes: number;
  /** Share (0–1) of sampled flights that departed within the on-time grace. */
  onTimeRate: number;
  /** Lowest / highest average delay among groups meeting the sample floor. */
  bestAirline: PunctualityGroup | null;
  worstAirline: PunctualityGroup | null;
  worstRoute: PunctualityGroup | null;
}

/** Industry convention: a flight is "on time" if it is under 15 minutes late. */
export const ON_TIME_GRACE_MINUTES = 15;

/** Groups smaller than this are noise — one bad day should not crown an airline. */
export const MIN_GROUP_SAMPLE = 3;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function groupAverages(
  flights: PunctualityFlight[],
  keyOf: (f: PunctualityFlight) => string | null
): PunctualityGroup[] {
  const byKey = new Map<string, { sum: number; count: number }>();
  for (const f of flights) {
    const key = keyOf(f);
    if (!key) continue;
    const acc = byKey.get(key) ?? { sum: 0, count: 0 };
    acc.sum += f.delayMinutes as number;
    acc.count += 1;
    byKey.set(key, acc);
  }
  return [...byKey.entries()]
    .filter(([, v]) => v.count >= MIN_GROUP_SAMPLE)
    .map(([key, v]) => ({ key, avgDelayMinutes: round1(v.sum / v.count), flights: v.count }));
}

export function computePunctuality(rows: PunctualityFlight[]): PunctualityStats {
  const sample = rows.filter((f) => f.delayMinutes != null);
  const empty: PunctualityStats = {
    sampleSize: 0,
    avgDelayMinutes: 0,
    onTimeRate: 0,
    bestAirline: null,
    worstAirline: null,
    worstRoute: null,
  };
  if (sample.length === 0) return empty;

  const totalDelay = sample.reduce((s, f) => s + (f.delayMinutes as number), 0);
  const onTime = sample.filter((f) => (f.delayMinutes as number) <= ON_TIME_GRACE_MINUTES).length;

  const airlines = groupAverages(sample, (f) => f.airlineIata ?? f.airline);
  const routes = groupAverages(sample, (f) =>
    f.depIata && f.arrIata ? `${f.depIata}-${f.arrIata}` : null
  );

  // Deterministic tie-breaks (key) so equal averages order stably.
  const byDelayAsc = [...airlines].sort(
    (a, b) => a.avgDelayMinutes - b.avgDelayMinutes || a.key.localeCompare(b.key)
  );
  const byDelayDesc = [...airlines].sort(
    (a, b) => b.avgDelayMinutes - a.avgDelayMinutes || a.key.localeCompare(b.key)
  );
  const routesDesc = [...routes].sort(
    (a, b) => b.avgDelayMinutes - a.avgDelayMinutes || a.key.localeCompare(b.key)
  );

  return {
    sampleSize: sample.length,
    avgDelayMinutes: round1(totalDelay / sample.length),
    onTimeRate: round1((onTime / sample.length) * 100) / 100,
    bestAirline: byDelayAsc[0] ?? null,
    worstAirline: byDelayDesc[0] ?? null,
    worstRoute: routesDesc[0] ?? null,
  };
}
