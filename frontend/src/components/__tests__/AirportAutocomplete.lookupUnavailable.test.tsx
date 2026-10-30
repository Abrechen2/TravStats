import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

import AirportAutocomplete from "../AirportAutocomplete";
import { airportsApi, setupApi } from "../../lib/api";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { code?: string }) => `${key}|${params?.code ?? ""}`,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    airportsApi: { search: vi.fn(), getByCode: vi.fn() },
    setupApi: { getAirportSeedingStatus: vi.fn() },
  };
});

describe("AirportAutocomplete — AIRPORT_LOOKUP_UNAVAILABLE (503)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(setupApi.getAirportSeedingStatus).mockResolvedValue({ status: "done" } as never);
    vi.mocked(airportsApi.search).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function typeCode(): Promise<void> {
    render(<AirportAutocomplete value={null} onChange={vi.fn()} label="Nach" />);
    await act(async () => {});
    const input = screen.getByRole("textbox");
    input.focus();
    fireEvent.change(input, { target: { value: "ZZZ" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
  }

  it("says the online lookup timed out instead of 'airport not found'", async () => {
    vi.mocked(airportsApi.getByCode).mockRejectedValue({
      response: {
        status: 503,
        data: { code: "AIRPORT_LOOKUP_UNAVAILABLE", reason: "timeout" },
      },
    });
    await typeCode();
    expect(screen.getByText("errors:airportLookupUnavailable.timeout|ZZZ")).toBeTruthy();
    expect(screen.queryByText(/airportAutocomplete\.notFound/)).toBeNull();
  });

  it("still says 'not found' for a plain miss", async () => {
    vi.mocked(airportsApi.getByCode).mockRejectedValue({ response: { status: 404, data: {} } });
    await typeCode();
    expect(screen.getByText("flights:airportAutocomplete.notFound|ZZZ")).toBeTruthy();
  });
});
