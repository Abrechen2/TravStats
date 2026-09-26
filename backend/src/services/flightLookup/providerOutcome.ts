/**
 * What each flight-data provider answered during ONE lookup.
 *
 * Every adapter used to turn a failure into an empty answer: a 401 from a
 * revoked key, a 429 from an exhausted quota and a five-second timeout all came
 * back as `[]` / `null`, the route said "no flights found", and the bulk refresh
 * counted the leg as "the provider has no data". Those call for opposite
 * actions — fix the key or wait, versus check the number and date — and the
 * user was always sent down the second road.
 *
 * The adapters still return their data the way they did (the auto-update and
 * refresh paths depend on it); they additionally record here what happened, so
 * the caller can tell "nobody knows this flight" from "somebody could not say".
 */

export type FlightDataProvider = "aviationstack" | "aerodatabox" | "airlabs" | "opensky";

/** A provider that could not do its job. Stable codes — the UI maps them. */
export type ProviderFailureKind =
  "auth" | "quota" | "timeout" | "plan_restricted" | "provider_error";

export type ProviderOutcomeKind = "ok" | "no_match" | ProviderFailureKind;

export interface ProviderOutcome {
  provider: FlightDataProvider;
  outcome: ProviderOutcomeKind;
}

export interface ProviderFailure {
  provider: FlightDataProvider;
  outcome: ProviderFailureKind;
}

/** Collects the outcomes of one lookup; pass it down the provider cascade. */
export class LookupOutcomeLog {
  private readonly entries: ProviderOutcome[] = [];

  record(provider: FlightDataProvider, outcome: ProviderOutcomeKind): void {
    this.entries.push({ provider, outcome });
  }

  all(): ProviderOutcome[] {
    return [...this.entries];
  }

  /** The providers that failed, one entry per provider (its last failure). */
  failures(): ProviderFailure[] {
    const byProvider = new Map<FlightDataProvider, ProviderFailureKind>();
    for (const entry of this.entries) {
      if (entry.outcome !== "ok" && entry.outcome !== "no_match") {
        byProvider.set(entry.provider, entry.outcome);
      }
    }
    return Array.from(byProvider, ([provider, outcome]) => ({ provider, outcome }));
  }
}

const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT", "ESOCKETTIMEDOUT"]);

/** Classify a thrown adapter error (axios or otherwise). */
export function classifyProviderError(error: unknown): ProviderFailureKind {
  const err = error as { code?: string; message?: string; response?: { status?: number } };
  const status = err?.response?.status;
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "quota";
  if ((err?.code && TIMEOUT_CODES.has(err.code)) || /timeout/i.test(err?.message ?? "")) {
    return "timeout";
  }
  return "provider_error";
}

/**
 * AirLabs answers most failures with HTTP 200 and an `error` object in the body
 * (`{"error":{"code":"unknown_api_key","message":…}}`). Returns null when the
 * body carries no error.
 */
export function classifyAirlabsBodyError(body: unknown): ProviderFailureKind | null {
  const error = (body as { error?: unknown } | null | undefined)?.error;
  if (error === undefined || error === null) return null;
  const code =
    typeof error === "string"
      ? error
      : `${(error as { code?: unknown }).code ?? ""} ${(error as { message?: unknown }).message ?? ""}`;
  if (/key|auth|permission|access|forbidden/i.test(code)) return "auth";
  if (/limit|quota|rate/i.test(code)) return "quota";
  return "provider_error";
}
