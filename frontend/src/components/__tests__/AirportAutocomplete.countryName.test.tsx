import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import AirportAutocomplete from "../AirportAutocomplete";
import { airportsApi, setupApi, type Airport } from "../../lib/api";

/**
 * The server sends an ISO 3166-1 alpha-2 country code, never a name — the
 * suggestion dropdown printed it raw ("Frankfurt, DE") instead of naming the
 * country in the reader's language (silent-fix sweep 2026-09-27, same defect
 * class as the flight-stats "TOP-LÄNDER" widget).
 */
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    airportsApi: { search: vi.fn(), getByCode: vi.fn() },
    setupApi: { getAirportSeedingStatus: vi.fn() },
  };
});

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

const FRANKFURT = {
  id: "a1",
  iata: "FRA",
  icao: "EDDF",
  name: "Frankfurt Airport",
  city: "Frankfurt",
  country: "DE",
} as unknown as Airport;

describe("AirportAutocomplete — country name in the dropdown", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(setupApi.getAirportSeedingStatus).mockResolvedValue({ status: "done" } as never);
    vi.mocked(airportsApi.search).mockImplementation(async () => [FRANKFURT]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("names the country instead of printing its ISO code", async () => {
    render(<AirportAutocomplete value={null} onChange={vi.fn()} label="Von" />);
    // Flush the mount-time seeding-status check before interacting.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const input = screen.getByRole("textbox");
    input.focus();
    fireEvent.change(input, { target: { value: "frank" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    await waitFor(() => expect(screen.getByText("Frankfurt, Deutschland")).toBeInTheDocument());
    expect(screen.queryByText("Frankfurt, DE")).not.toBeInTheDocument();
  });
});
