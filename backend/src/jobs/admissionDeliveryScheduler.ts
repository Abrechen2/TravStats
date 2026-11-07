/**
 * Admission delivery scheduler (spec 2026-11-07 §6.2): a pass every minute over the outgoing
 * admission requests whose own admin approved them (`services/federation/admissionDelivery.ts`),
 * and an immediate pass when the admin clicks. What is due and the backoff live in the service;
 * this only decides when a pass runs. An idle pass costs one query.
 */
import logger from "../utils/logger";
import { runAdmissionDeliveries } from "../services/federation/admissionDelivery";

const INTERVAL_MS = 60_000;
const KICK_DELAY_MS = 500;

let interval: NodeJS.Timeout | null = null;

function pass(): void {
  runAdmissionDeliveries().catch((error: unknown) =>
    logger.warn({ operation: "federation_admission_pass_error", err: error })
  );
}

/** Runs a pass soon, e.g. right after an admin approved an outgoing request. */
export function kickAdmissionDelivery(): void {
  setTimeout(pass, KICK_DELAY_MS).unref();
}

export function startAdmissionDeliveryScheduler(): void {
  if (interval) return;
  interval = setInterval(pass, INTERVAL_MS);
  interval.unref();
}

export function stopAdmissionDeliveryScheduler(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
