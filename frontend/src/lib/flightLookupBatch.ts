import { isAxiosError } from "axios";
import { BULK_LOOKUP_MAX, flightLookupApi, type LookupProviderFailure } from "./api/flightLookup";
import { apiErrorCode, DEMO_FORBIDDEN_CODE } from "./apiError";
import { logger } from "./logger";

/** One flight to look up, under a key the caller recognises it by. */
export interface LookupRow {
  key: string;
  flightNumber: string;
  /** `YYYY-MM-DD`; a row without one is not asked (a lookup without a day answers for today). */
  date: string | null;
}

/** Why a row has no answer — each its own sentence in the UI (`flights:lookupReason.*`). */
export type LookupReason =
  | "noFlightNumber"
  | "noDate"
  | "invalidDate"
  | "providers"
  | "demo"
  | "rateLimited"
  | "network"
  | "timeout"
  | "invalid"
  | "server";

export type LookupOutcome<T> =
  | { status: "found"; flights: T[]; providerFailures: LookupProviderFailure[] }
  | { status: "empty"; providerFailures: LookupProviderFailure[] }
  | { status: "failed"; reason: LookupReason; providerFailures: LookupProviderFailure[] };

/** Why a whole call failed, from the HTTP answer (or the lack of one). */
export function callFailureReason(error: unknown): LookupReason {
  if (!isAxiosError(error)) return "server";
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return "timeout";
  const status = error.response?.status;
  if (status === undefined) return "network";
  if (status === 403 && apiErrorCode(error) === DEMO_FORBIDDEN_CODE) return "demo";
  if (status === 429) return "rateLimited";
  if (status === 400) return "invalid";
  return "server";
}

const failed = (reason: LookupReason): LookupOutcome<never> => ({
  status: "failed",
  reason,
  providerFailures: [],
});

/**
 * Look the rows up through `POST /flight-lookup/bulk`, ten to a call and one
 * call at a time (the route is rate-limited and every row is a billed provider
 * call). Every row ends with an outcome of its own: a row that cannot be asked
 * says why (no flight number, no day), a refused call marks only its own batch
 * and the walk goes on, and a provider outage is `providers`, never "empty".
 */
export async function lookupFlightsBatched<T>(
  rows: readonly LookupRow[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, LookupOutcome<T>>> {
  const out = new Map<string, LookupOutcome<T>>();
  const askable: Array<LookupRow & { date: string }> = [];
  for (const row of rows) {
    if (!row.flightNumber.trim()) out.set(row.key, failed("noFlightNumber"));
    else if (!row.date) out.set(row.key, failed("noDate"));
    else askable.push({ ...row, date: row.date });
  }

  let done = rows.length - askable.length;
  onProgress?.(done, rows.length);
  for (let i = 0; i < askable.length; i += BULK_LOOKUP_MAX) {
    const batch = askable.slice(i, i + BULK_LOOKUP_MAX);
    try {
      const results = await flightLookupApi.bulk<T>(
        batch.map((r) => ({ flightNumber: r.flightNumber.trim(), date: r.date }))
      );
      batch.forEach((row, position) => {
        const result = results.find((r) => r.index === position);
        const providerFailures = result?.providerFailures ?? [];
        if (!result) out.set(row.key, failed("server"));
        else if (result.success && (result.flights?.length ?? 0) > 0) {
          out.set(row.key, { status: "found", flights: result.flights ?? [], providerFailures });
        } else if (result.success) out.set(row.key, { status: "empty", providerFailures });
        else if (result.error === "INVALID_DATE") out.set(row.key, failed("invalidDate"));
        else
          out.set(row.key, {
            status: "failed",
            reason: result.error === "LOOKUP_PROVIDER_FAILED" ? "providers" : "server",
            providerFailures,
          });
      });
    } catch (error) {
      logger.warn("A bulk flight lookup call failed", error);
      const reason = callFailureReason(error);
      for (const row of batch) out.set(row.key, failed(reason));
    }
    done += batch.length;
    onProgress?.(done, rows.length);
  }
  return out;
}
