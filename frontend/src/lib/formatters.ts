/** Format a duration in minutes to "2h 35min" / "45min" / "2h" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/**
 * Same as `formatDuration` but prefixes a `~` when the value is an
 * estimate (e.g. great-circle-based for DATE_ONLY rows). Returns the
 * fallback marker `"—"` when minutes is null.
 */
export function formatDurationWithEstimate(
  minutes: number | null | undefined,
  estimated: boolean
): string {
  if (minutes == null) return "—";
  const base = formatDuration(minutes);
  return estimated ? `~${base}` : base;
}
