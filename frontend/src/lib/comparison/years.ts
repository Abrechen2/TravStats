import { now, todayIn } from "../../shared/time/clock";

/**
 * The years a period picker offers: this one and the ones before it. "This year" is the
 * year it is in the reader's zone (`useSettingsStore(s => s.display.timezone)`), not the
 * browser's — near midnight on New Year's the two differ.
 */
export function recentYears(zone: string, at: Date = now(), count = 15): number[] {
  const year = Number(todayIn(zone, at).slice(0, 4));
  return Array.from({ length: count }, (_, i) => year - i);
}
