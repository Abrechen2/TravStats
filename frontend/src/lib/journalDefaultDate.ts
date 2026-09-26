/**
 * The day a new journal entry starts on (acceptance 2026-09-26: it was always
 * today, so an entry written after a trip — the usual case — landed outside
 * it). Today while the trip is on; otherwise the day after the last entry,
 * so a diary written up afterwards moves forward one day per entry; failing
 * that, the trip's first day. Days are "YYYY-MM-DD" calendar days.
 */
export interface JournalDaySource {
  startDate: string | null;
  endDate: string | null;
  journalEntries?: ReadonlyArray<{ date: string }>;
}

const day = (value: string): string => value.slice(0, 10);

function nextDay(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The viewer's own calendar day — "today" is where the writer is. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function defaultJournalDate(trip: JournalDaySource, today: string): string {
  const start = trip.startDate ? day(trip.startDate) : null;
  const end = trip.endDate ? day(trip.endDate) : start;
  if (!start) return today;
  if (today >= start && (!end || today <= end)) return today;

  const last = (trip.journalEntries ?? [])
    .map((e) => day(e.date))
    .filter((d) => d >= start && (!end || d <= end))
    .sort()
    .pop();
  if (last) {
    const next = nextDay(last);
    return end && next > end ? end : next;
  }
  return start;
}
