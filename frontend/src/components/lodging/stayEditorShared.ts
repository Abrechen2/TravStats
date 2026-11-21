import { dayInput } from "../../lib/api/timeInput";

// `pointer-coarse:` - touch sizing follows the POINTER, not the width
// (forgejo#249): an iPad is wide and finger-operated, and a `py-2 text-sm`
// input is ~38 px tall under a 44 px target.
export const INPUT_CLASS =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] pointer-coarse:min-h-(--ts-size-touch-min)";

// A stay's dates are calendar days, sent as the bare `YYYY-MM-DD` the
// picker gives (ADR 0002): the server stores a DATE, so there is no instant
// to parse. It used to send `T00:00:00.000Z` because the schema ran
// `new Date(v)` on whatever arrived and an offset-less string would have
// been read in the SERVER's zone - the time model removes that parse.
export const fromDateInput = (date: string): string | null => dayInput(date);

export const splitCsv = (v: string): string[] =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
