import { API_TIMEOUTS } from "../../config/constants";
import { api } from "./client";

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

/** The asker's zone, so the server knows what "today" is for them. */
function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export const flightLookupApi = {
  lookup: async <T>(flightNumber: string, date: string): Promise<FlightLookupResponse<T>> => {
    const { data } = await api.get<FlightLookupResponse<T>>(
      `/flight-lookup/${encodeURIComponent(flightNumber)}`,
      {
        params: { ...(date ? { date } : {}), tz: browserTimezone() },
        timeout: API_TIMEOUTS.FLIGHT_LOOKUP,
      }
    );
    return data;
  },
};
