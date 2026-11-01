import { API_TIMEOUTS } from "../../config/constants";
import { api } from "./client";
import { todayZoneNow } from "../../hooks/useTodayZone";

/** A provider that could not answer, as the server names it. */
export interface LookupProviderFailure {
  provider: "aviationstack" | "aerodatabox" | "airlabs" | "opensky";
  outcome: "auth" | "quota" | "timeout" | "plan_restricted" | "provider_error";
}

/** One airport side of a lookup hit. */
export interface LookupAirportSide {
  iata?: string;
  name?: string;
  /** UTC instant. */
  scheduledTime?: string;
  terminal?: string;
  gate?: string;
  /** IANA zone of the airport, when the server knows it. */
  timezone?: string;
  /** "YYYY-MM-DDTHH:mm" — the wall clock at the airport. */
  scheduledLocal?: string;
}

/** The body of GET /flight-lookup/:flightNumber (always HTTP 200 for a search that ran). */
export interface FlightLookupResponse<T> {
  success: boolean;
  count?: number;
  flights?: T[];
  /** A stable code when `success` is false (LOOKUP_NOT_CONFIGURED, …). */
  error?: string;
  providerFailures?: LookupProviderFailure[];
}

/** One row of `POST /flight-lookup/bulk` (up to 10 per call). */
export interface BulkLookupResultRow<T> {
  index: number;
  flightNumber: string;
  date?: string;
  success: boolean;
  flights?: T[];
  /** `LOOKUP_PROVIDER_FAILED`, `INVALID_DATE`, or the server's own sentence. */
  error?: string;
  providerFailures?: LookupProviderFailure[];
}

/** The server's per-call cap. */
export const BULK_LOOKUP_MAX = 10;

export const flightLookupApi = {
  /** One call for up to `BULK_LOOKUP_MAX` flights, each on its own date. */
  bulk: async <T>(
    items: ReadonlyArray<{ flightNumber: string; date?: string }>
  ): Promise<BulkLookupResultRow<T>[]> => {
    const { data } = await api.post<{ success: boolean; results: BulkLookupResultRow<T>[] }>(
      "/flight-lookup/bulk",
      { items },
      // Ten sequential-in-parallel provider calls: the single lookup's budget, once.
      { timeout: API_TIMEOUTS.FLIGHT_LOOKUP }
    );
    return data.results;
  },

  lookup: async <T>(flightNumber: string, date: string): Promise<FlightLookupResponse<T>> => {
    const { data } = await api.get<FlightLookupResponse<T>>(
      `/flight-lookup/${encodeURIComponent(flightNumber)}`,
      {
        params: {
          ...(date ? { date } : {}), // The zone "today" is answered in (ADR 0002 Q1): the confirmed profile
          // zone, else UTC — the same day on every device, not the browser's.
          tz: todayZoneNow(),
        },
        timeout: API_TIMEOUTS.FLIGHT_LOOKUP,
      }
    );
    return data;
  },
};
