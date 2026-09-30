/**
 * Where this process's time-model backfill stands (ADR 0002 phase 3b).
 *
 * In memory, like the job registry: the durable fact is
 * `AdminSettings.time_model_backfill_at`, set only when a run finished. What
 * lives here is what the report adds to it — a run is going on now, or the
 * last one failed and with which code — and a restart forgets both, because
 * the next boot runs the backfill again anyway.
 */

export type BackfillRunState =
  | { state: "idle" }
  | { state: "running"; jobId: string | null }
  | { state: "failed"; code: string };

let current: BackfillRunState = { state: "idle" };

export function backfillRunState(): BackfillRunState {
  return current;
}

export function setBackfillRunState(next: BackfillRunState): void {
  current = next;
}
