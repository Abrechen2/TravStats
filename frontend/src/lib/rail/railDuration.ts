/** "3 h 42 min" from minutes; the unit words come from the locale. */
export function formatRailDuration(
  minutes: number,
  t: (key: string, o?: Record<string, unknown>) => string
): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? t("rail:detail.durationHm", { h, m }) : t("rail:detail.durationM", { m });
}
