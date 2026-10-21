/**
 * A nudge for the delivery scheduler (`jobs/tripShareDeliveryScheduler.ts`): a message queued in
 * the outbox should not wait for the next interval. The queueing code runs inside the write's
 * transaction and cannot know when it commits, so the scheduler debounces the nudge and simply
 * finds nothing if it came too early — the interval picks it up then.
 *
 * Until the scheduler is started (tests, a process with the feature never on) a nudge does
 * nothing: tests drain the outbox themselves.
 */
let handler: (() => void) | null = null;

export function onDeliveryKick(next: (() => void) | null): void {
  handler = next;
}

export function kickDelivery(): void {
  handler?.();
}
