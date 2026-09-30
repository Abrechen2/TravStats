/**
 * The flight-number lookup, end to end through the hook: what the user sees
 * in the form after picking a hit, and what the form says when nothing came
 * back.
 *
 * Silent-failure review 2026-09-26:
 *  - the providers answer in UTC and the form cut "HH:MM" out of that text,
 *    so LH400's 13:25 Frankfurt departure was entered — and saved — as 11:25;
 *  - a 429 read "enter an API key", the demo account's 403 "no flights";
 *  - a provider that refused the key was reported as "no flights found";
 *  - an airport code the catalogue could not give back left the field empty
 *    without a word.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Airport } from "../../lib/api";
import type { FlightLookupResult } from "./flightFormModel";

const clientGet = vi.fn();
vi.mock("../../lib/api/client", () => ({
  api: { get: (...args: unknown[]) => clientGet(...args) },
}));

const getByCode = vi.fn();
vi.mock("../../lib/api/airports", () => ({
  airportsApi: { getByCode: (code: string) => getByCode(code) },
}));

vi.mock("../../lib/api/flights", () => ({ flightsApi: { createBatch: vi.fn() } }));
vi.mock("../../lib/api/trips", () => ({ tripsApi: {} }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "provider" in opts ? `${key}[${String(opts.provider)}]` : key,
    i18n: { language: "de" },
    ready: true,
  }),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../store/settingsStore", () => {
  const settings = {
    units: { currency: "EUR" },
    defaults: {},
    display: { timezone: "America/Los_Angeles" },
    features: {},
  };
  return { useSettingsStore: () => settings };
});

vi.mock("../../store/toastStore", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

vi.mock("../../lib/timeEstimation", () => ({
  storeHistoricalFlightTime: vi.fn(),
  // A wrong answer on purpose: if the estimator overwrites the provider's
  // arrival, the assertions below see 23:59.
  estimateFlightTimes: vi.fn(() => ({
    arrivalTime: "23:59",
    source: "heuristic",
    confidence: "low",
  })),
}));

import { useFlightForm } from "./useFlightForm";

const airport = (iata: string, timezone: string): Airport =>
  ({ iata, icao: `X${iata}`, name: `${iata} Airport`, lat: 1, lon: 1, timezone }) as Airport;

const AIRPORTS: Record<string, Airport> = {
  HND: airport("HND", "Asia/Tokyo"),
  FRA: airport("FRA", "Europe/Berlin"),
  JFK: airport("JFK", "America/New_York"),
};

/**
 * NH203 HND→FRA: leaves Tokyo at 06:00 on the 27th, which is 21:00 UTC on the
 * 26th, and lands in Frankfurt at 13:00 local (11:00 UTC). Crosses the date
 * line in UTC terms and eight hours of zone.
 */
const NH203: FlightLookupResult = {
  flightNumber: "NH203",
  airline: "ANA",
  departure: { iata: "HND", scheduledTime: "2026-09-26T21:00:00.000Z" },
  arrival: { iata: "FRA", scheduledTime: "2026-09-27T11:00:00.000Z" },
};

describe("useFlightForm — picking a lookup hit enters each airport's own clock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getByCode.mockImplementation(async (code: string) => {
      const hit = AIRPORTS[code];
      if (!hit) throw Object.assign(new Error("nf"), { response: { status: 404 } });
      return hit;
    });
  });

  it("converts UTC instants with the airports' zones (no search date)", async () => {
    const { result } = renderHook(() => useFlightForm(vi.fn(), vi.fn()));
    act(() => result.current.setSearchDate(""));
    await act(async () => {
      await result.current.handleSelectFlight(NH203);
    });

    expect(result.current.departureDate).toBe("2026-09-27");
    expect(result.current.departureTime).toBe("06:00");
    expect(result.current.arrivalDate).toBe("2026-09-27");
    expect(result.current.arrivalTime).toBe("13:00");
  });

  it("prefers the server's own wall clock and shifts the arrival with the search date", async () => {
    const { result } = renderHook(() => useFlightForm(vi.fn(), vi.fn()));
    act(() => result.current.setSearchDate("2026-09-28"));
    await act(async () => {
      await result.current.handleSelectFlight({
        ...NH203,
        departure: {
          ...NH203.departure,
          scheduledLocal: "2026-09-27T06:00",
          timezone: "Asia/Tokyo",
        },
        arrival: {
          ...NH203.arrival,
          scheduledLocal: "2026-09-27T13:00",
          timezone: "Europe/Berlin",
        },
      });
    });

    expect(result.current.departureDate).toBe("2026-09-28");
    expect(result.current.departureTime).toBe("06:00");
    expect(result.current.arrivalDate).toBe("2026-09-28");
    expect(result.current.arrivalTime).toBe("13:00");
  });

  it("keeps an overnight arrival on the following day (LH400 FRA→JFK is not; a red-eye is)", async () => {
    // JFK 22:30 local (02:30 UTC next day) → FRA 12:05 local next day.
    const { result } = renderHook(() => useFlightForm(vi.fn(), vi.fn()));
    act(() => result.current.setSearchDate("2026-09-26"));
    await act(async () => {
      await result.current.handleSelectFlight({
        flightNumber: "LH401",
        airline: "Lufthansa",
        departure: { iata: "JFK", scheduledTime: "2026-09-27T02:30:00.000Z" },
        arrival: { iata: "FRA", scheduledTime: "2026-09-27T10:05:00.000Z" },
      });
    });

    expect(result.current.departureDate).toBe("2026-09-26");
    expect(result.current.departureTime).toBe("22:30");
    expect(result.current.arrivalDate).toBe("2026-09-27");
    expect(result.current.arrivalTime).toBe("12:05");
  });

  it("says which airport code the catalogue could not resolve", async () => {
    const { result } = renderHook(() => useFlightForm(vi.fn(), vi.fn()));
    await act(async () => {
      await result.current.handleSelectFlight({
        ...NH203,
        arrival: { iata: "QQQ", scheduledTime: "2026-09-27T11:00:00.000Z" },
      });
    });

    expect(result.current.step).toBe("complete");
    expect(result.current.arrival).toBeNull();
    expect(result.current.error).toBe("errors:airportNotInCatalogue");
  });
});

describe("useFlightForm — a search that found nothing says why", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const search = async (): Promise<ReturnType<typeof useFlightForm>> => {
    const { result } = renderHook(() => useFlightForm(vi.fn(), vi.fn()));
    act(() => result.current.setFlightNumber("LH400"));
    await act(async () => {
      await result.current.handleFlightLookup();
    });
    return result.current;
  };

  it("names the provider that refused the key instead of 'no flights found'", async () => {
    clientGet.mockResolvedValue({
      data: {
        success: false,
        count: 0,
        error: "LOOKUP_PROVIDER_FAILED",
        providerFailures: [{ provider: "airlabs", outcome: "auth" }],
      },
    });
    const state = await search();
    expect(state.error).toContain("errors:lookupProviderFailed");
    expect(state.error).toContain("errors:providerFailure.auth[AirLabs]");
    expect(state.error).not.toContain("errors:noFlightsFound");
  });

  it("reads a 429 as 'too many searches', not 'enter an API key'", async () => {
    clientGet.mockRejectedValue(Object.assign(new Error("429"), { response: { status: 429 } }));
    const state = await search();
    expect(state.error).toBe("errors:lookupRateLimited");
  });

  it("reads the demo account's 403 as the demo refusal", async () => {
    clientGet.mockRejectedValue(
      Object.assign(new Error("403"), {
        response: { status: 403, data: { error: "DEMO_ACCOUNT_FORBIDDEN" } },
      })
    );
    const state = await search();
    expect(state.error).toBe("errors:lookupDemoForbidden");
  });

  it("asks with the browser's zone and a timeout that outlasts the provider cascade", async () => {
    clientGet.mockResolvedValue({ data: { success: false, error: "No flights found" } });
    const state = await search();
    expect(state.error).toBe("errors:noFlightsFound");
    const [, config] = clientGet.mock.calls[0] as [
      string,
      { timeout: number; params: { tz?: string } },
    ];
    expect(config.timeout).toBeGreaterThanOrEqual(60_000);
    expect(typeof config.params.tz).toBe("string");
  });
});
