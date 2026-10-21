/**
 * Trip-share delivery scheduler (spec 2026-10-20 F7, phase F-S4d): sends the outbox of trip
 * sharing across servers (`services/sharing/federation/outbox.ts`) every 30 seconds, and a second
 * after a message was queued (`deliveryKick.ts`). What is due, the order and the backoff live in
 * the outbox; this only decides when a pass runs. A pass with the feature off sends nothing and
 * costs one settings read.
 *
 * An interval rather than a cron slot: the shortest backoff is a minute, and a change should
 * reach the other server within seconds when it answers.
 */
import logger from "../utils/logger";
import { onDeliveryKick } from "../services/sharing/federation/deliveryKick";
import { runDeliveries } from "../services/sharing/federation/outbox";

const INTERVAL_MS = 30_000;
const KICK_DELAY_MS = 1_000;

let interval: NodeJS.Timeout | null = null;
let kick: NodeJS.Timeout | null = null;

function pass(): void {
  runDeliveries().catch((error: unknown) =>
    logger.warn({ operation: "trip_share_delivery_error", error }, "Trip-share delivery failed")
  );
}

export function startTripShareDeliveryScheduler(): void {
  if (interval) return;
  interval = setInterval(pass, INTERVAL_MS);
  interval.unref();
  onDeliveryKick(() => {
    if (kick) return;
    kick = setTimeout(() => {
      kick = null;
      pass();
    }, KICK_DELAY_MS);
    kick.unref();
  });
  pass();
}

export function stopTripShareDeliveryScheduler(): void {
  if (interval) clearInterval(interval);
  if (kick) clearTimeout(kick);
  interval = null;
  kick = null;
  onDeliveryKick(null);
}
