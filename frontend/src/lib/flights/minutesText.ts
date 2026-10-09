type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "42 Min." / "1 Std. 12 Min." / "3 Std." — the magnitude of a span of
 * minutes, in words; the sign is the caller's sentence ("später", "vor der
 * Landung"). One home, so the deviation (forgejo#216) and the transfer
 * (forgejo#218) never spell the same 75 minutes two ways.
 */
export function minutesText(minutes: number, t: Translate): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return t("flights:planActual.durationM", { m });
  if (m === 0) return t("flights:planActual.durationH", { h });
  return t("flights:planActual.durationHM", { h, m });
}
