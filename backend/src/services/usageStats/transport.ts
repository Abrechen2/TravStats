import logger from "../../utils/logger";
import { getConsent, getStatsBaseUrl } from "./consent";
import { buildUsagePayload, type UsagePayload } from "./payload";

const TIMEOUT_MS = 5_000;

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** POST the payload. Never throws — telemetry must never affect the running app. */
export async function sendPing(payload: UsagePayload, baseUrl: string): Promise<boolean> {
  try {
    const response = await withTimeout((signal) =>
      fetch(`${baseUrl}/v1/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      }),
    );
    return response.ok;
  } catch (error) {
    logger.debug({ error }, "usage-stats ping failed");
    return false;
  }
}

/** Consent withdrawal: ask the server to erase this install's row. Never throws. */
export async function sendErasure(installId: string, baseUrl: string): Promise<boolean> {
  try {
    const response = await withTimeout((signal) =>
      fetch(`${baseUrl}/v1/install/${encodeURIComponent(installId)}`, {
        method: "DELETE",
        signal,
      }),
    );
    return response.ok;
  } catch (error) {
    logger.debug({ error }, "usage-stats erasure failed");
    return false;
  }
}

/**
 * Scheduled entry point. No-op unless consent is granted AND an endpoint is
 * configured. Swallows every error.
 */
export async function usageStatsTick(): Promise<void> {
  try {
    if ((await getConsent()) !== "granted") return;
    const baseUrl = getStatsBaseUrl();
    if (!baseUrl) return;
    await sendPing(await buildUsagePayload(), baseUrl);
  } catch (error) {
    logger.debug({ error }, "usage-stats tick error");
  }
}
