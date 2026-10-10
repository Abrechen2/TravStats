import type { DeadlineTimes } from "../../lib/deadlines";

/**
 * The editable form of a booking's deadlines (forgejo#285) and the wire
 * values it turns into. Strings throughout, as the inputs hold them.
 *
 * The cancellation deadline is a day plus an OPTIONAL time. Without a time it
 * goes out as the bare day — "until the end of that day" — and the server
 * keeps it as a day; no time of day is invented here either.
 */
export interface DeadlineDraft {
  cancelDay: string;
  cancelTime: string;
  /** The zone the deadline is stated in; empty = the entry's own place decides. */
  cancelZone: string;
  paymentDueOn: string;
}

export type CancellationWire = string | { local: string; zone?: string } | null;

export interface DeadlineWire {
  freeCancellationUntil?: CancellationWire;
  paymentDueOn?: string | null;
}

export const EMPTY_DEADLINE_DRAFT: DeadlineDraft = {
  cancelDay: "",
  cancelTime: "",
  cancelZone: "",
  paymentDueOn: "",
};

export function deadlineDraftFrom(times: DeadlineTimes | null | undefined): DeadlineDraft {
  const until = times?.freeCancellationUntil ?? null;
  const on = times?.freeCancellationOn ?? null;
  return {
    cancelDay: until ? until.local.slice(0, 10) : (on?.date ?? ""),
    cancelTime: until ? until.local.slice(11, 16) : "",
    cancelZone: until?.zone ?? on?.zone ?? "",
    paymentDueOn: times?.paymentDue?.date ?? "",
  };
}

function cancellationWire(draft: DeadlineDraft): CancellationWire {
  if (!draft.cancelDay) return null;
  if (!draft.cancelTime) return draft.cancelDay;
  const local = `${draft.cancelDay}T${draft.cancelTime}`;
  return draft.cancelZone ? { local, zone: draft.cancelZone } : { local };
}

/**
 * Only what changed against `initial`, so an untouched form never rewrites a
 * deadline (or clears one) — absent keys are left alone by the server.
 */
export function deadlineWire(draft: DeadlineDraft, initial: DeadlineDraft): DeadlineWire {
  const out: DeadlineWire = {};
  const cancelChanged =
    draft.cancelDay !== initial.cancelDay ||
    draft.cancelTime !== initial.cancelTime ||
    draft.cancelZone !== initial.cancelZone;
  if (cancelChanged) out.freeCancellationUntil = cancellationWire(draft);
  if (draft.paymentDueOn !== initial.paymentDueOn) out.paymentDueOn = draft.paymentDueOn || null;
  return out;
}

/** A time without a day cannot be sent; the form says so on the time field. */
export function deadlineDraftError(draft: DeadlineDraft): "timeWithoutDay" | null {
  return draft.cancelTime && !draft.cancelDay ? "timeWithoutDay" : null;
}
