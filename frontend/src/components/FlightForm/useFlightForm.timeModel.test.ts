import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Airport } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  airportsApi: { getByCode: vi.fn() },
}));

vi.mock("../../lib/api/flights", () => ({
  flightsApi: { createBatch: vi.fn() },
}));

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../store/settingsStore", () => {
  // A stable object, NOT a fresh literal per call — real Zustand hooks
  // return the same reference across renders unless the store actually
  // changes. A fresh literal here would re-trigger the hook's
  // `useEffect(..., [settings])` (which seeds departureDate/arrivalDate to
  // "today") on every render, silently overwriting the dates this test sets.
  const settings = {
    units: { currency: "EUR" },
    defaults: {},
    // Deliberately distinct from both airports below so a depTimezone that
    // silently fell back to the user's display zone instead of the
    // departure airport's own zone would be caught.
    display: { timezone: "Europe/Berlin" },
    features: {},
  };
  return { useSettingsStore: () => settings };
});

vi.mock("../../store/toastStore", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

vi.mock("../../lib/timeEstimation", () => ({
  storeHistoricalFlightTime: vi.fn(),
  estimateFlightTimes: vi.fn(() => ({
    arrivalTime: "14:00",
    source: "heuristic",
    confidence: "low",
  })),
}));

/**
 * The create form under the time model (ADR 0002, D2/D3): a flight time is
 * read in its AIRPORT's zone and nowhere else, and a refusal reaches the
 * reader as a German sentence — never as the server's English `error` text.
 */
import { useFlightForm } from "./useFlightForm";

function makeAirport(iata: string, timezone: string | undefined): Airport {
  return { iata, icao: `X${iata}`, name: `${iata} Airport`, lat: 50, lon: 8, timezone } as Airport;
}

const submitEvent = (): React.FormEvent => ({ preventDefault: () => {} }) as React.FormEvent;

function refused(status: number, code: string, error: string) {
  return { isAxiosError: true, response: { status, data: { error, code } } };
}

async function fillAndSubmit(
  onSubmit: Parameters<typeof useFlightForm>[0],
  dep: Airport,
  arr: Airport,
  depTime = "02:30"
) {
  const { result } = renderHook(() => useFlightForm(onSubmit, vi.fn()));
  act(() => {
    result.current.setDeparture(dep);
    result.current.setArrival(arr);
    result.current.setDepartureDate("2027-03-28");
    result.current.setDepartureTime(depTime);
  });
  act(() => {
    result.current.setArrivalDate("2027-03-28");
    result.current.setArrivalTime("09:00");
  });
  await act(async () => {
    await result.current.handleSubmit(submitEvent());
  });
  return result;
}

describe("useFlightForm — time model", () => {
  const onSubmit = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    onSubmit.mockReset().mockResolvedValue(undefined);
  });

  it("sends the airport's own zone with each wall clock ({local, zone})", async () => {
    await fillAndSubmit(
      onSubmit,
      makeAirport("FRA", "Europe/Berlin"),
      makeAirport("NRT", "Asia/Tokyo"),
      "11:00"
    );
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({
      departureLocal: "2027-03-28T11:00",
      depTimezone: "Europe/Berlin",
      arrivalLocal: "2027-03-28T09:00",
      arrTimezone: "Asia/Tokyo",
    });
  });

  // Class 2 / D2: the settings mock above holds Europe/Berlin. An airport
  // record without a zone used to be sent on the reader's clock, then "UTC".
  it("refuses an airport without a zone instead of borrowing the profile's, and says why", async () => {
    const result = await fillAndSubmit(
      onSubmit,
      makeAirport("XXA", undefined),
      makeAirport("NRT", "Asia/Tokyo"),
      "11:00"
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/keine Zeitzone bekannt/);
  });

  it("shows the DST-gap refusal in German, not the server's English", async () => {
    onSubmit.mockRejectedValue(
      refused(422, "LOCAL_TIME_NONEXISTENT", "2027-03-28T02:30 does not exist in Europe/Berlin")
    );
    const result = await fillAndSubmit(
      onSubmit,
      makeAirport("FRA", "Europe/Berlin"),
      makeAirport("NRT", "Asia/Tokyo")
    );
    expect(result.current.error).toBe(
      "Diese Uhrzeit gibt es an dem Tag dort nicht (Zeitumstellung). Bitte wähle eine Uhrzeit davor oder danach."
    );
  });

  it("shows TZ_UNRESOLVED from the server as the place-has-no-zone sentence", async () => {
    onSubmit.mockRejectedValue(refused(422, "TZ_UNRESOLVED", "This place has no time zone: x"));
    const result = await fillAndSubmit(
      onSubmit,
      makeAirport("FRA", "Europe/Berlin"),
      makeAirport("NRT", "Asia/Tokyo"),
      "11:00"
    );
    expect(result.current.error).toMatch(/keine Zeitzone bekannt/);
    expect(result.current.error).not.toMatch(/This place/);
  });

  it("asks a stale bundle to reload when the server wants the new time shape", async () => {
    onSubmit.mockRejectedValue(refused(422, "TIME_SHAPE_REQUIRED", "local time shape required"));
    const result = await fillAndSubmit(
      onSubmit,
      makeAirport("FRA", "Europe/Berlin"),
      makeAirport("NRT", "Asia/Tokyo"),
      "11:00"
    );
    expect(result.current.error).toMatch(/lade die Seite neu/);
  });
});
