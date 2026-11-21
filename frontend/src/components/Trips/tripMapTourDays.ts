import type { TourGeometryEntry } from "../../lib/api/tourIndex";

/** A tour entry as the day filter leaves it: on the day, off it, or with no day to judge by. */
export type DayTourEntry = TourGeometryEntry & { dim: boolean; neutral: boolean };

/**
 * Sort a trip's tour lines onto the chosen day (forgejo#424). A roadtrip is
 * one route but many legs, each driven on its own day, so it is split per leg
 * (`legDays`); a day tour has one date. What no day can be read for stays in
 * the all-days style (`neutral`): calling it "another day" made an undated
 * roadtrip vanish the moment a day was chosen.
 */
export function splitToursByDay(
  entries: readonly TourGeometryEntry[],
  day: string | null
): DayTourEntry[] {
  if (day === null) return entries.map((e) => ({ ...e, dim: false, neutral: false }));
  const out: DayTourEntry[] = [];
  for (const entry of entries) {
    const { legDays } = entry;
    if (!legDays) {
      const own = entry.date?.slice(0, 10);
      out.push({ ...entry, dim: own != null && own !== day, neutral: own == null });
      continue;
    }
    const buckets = { active: [], dim: [], neutral: [] } as Record<
      "active" | "dim" | "neutral",
      TourGeometryEntry["geometry"]["features"]
    >;
    for (const feature of entry.geometry.features) {
      const days = legDays[feature.properties.legId];
      buckets[!days || days.length === 0 ? "neutral" : days.includes(day) ? "active" : "dim"].push(
        feature
      );
    }
    for (const kind of ["dim", "neutral", "active"] as const) {
      if (buckets[kind].length === 0) continue;
      out.push({
        ...entry,
        geometry: { ...entry.geometry, features: buckets[kind] },
        dim: kind === "dim",
        neutral: kind === "neutral",
      });
    }
  }
  return out;
}
