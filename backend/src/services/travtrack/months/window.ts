/** `[first day, first day of the next month)` of the UTC month starting on `month` (`YYYY-MM-01`). */
export function monthWindow(month: string): { fromMs: number; untilMs: number } {
  const from = new Date(`${month}T00:00:00.000Z`);
  const until = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return { fromMs: from.getTime(), untilMs: until.getTime() };
}
