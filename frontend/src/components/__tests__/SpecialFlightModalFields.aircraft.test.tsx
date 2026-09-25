/**
 * A sightseeing flight's aircraft comes from the same catalogue the flight
 * forms use, so its spelling matches what the statistics group by. It was a
 * bare text input, and every "C172" / "Cessna 172" became its own type.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const search = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../AirportAutocomplete", () => ({ default: () => null }));
vi.mock("../../lib/api/catalogue", () => ({
  airlinesApi: { search: vi.fn().mockResolvedValue([]) },
  aircraftApi: { search },
}));

import { SightseeingFields } from "../SpecialFlightModalFields";

describe("SightseeingFields — aircraft", () => {
  it("offers aircraft from the catalogue and takes the picked name", async () => {
    vi.useFakeTimers();
    search.mockResolvedValue([{ id: 7, name: "Cessna 172 Skyhawk", icao: "C172" }]);
    const onAircraftChange = vi.fn();
    const { rerender } = render(
      <SightseeingFields
        airport={null}
        onAirportChange={vi.fn()}
        aircraft=""
        onAircraftChange={onAircraftChange}
      />
    );

    const input = screen.getByRole("textbox", { name: "specialFlights:field.aircraft" });
    input.focus();
    fireEvent.change(input, { target: { value: "Cess" } });
    expect(onAircraftChange).toHaveBeenLastCalledWith("Cess");
    rerender(
      <SightseeingFields
        airport={null}
        onAirportChange={vi.fn()}
        aircraft="Cess"
        onAircraftChange={onAircraftChange}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    vi.useRealTimers();

    expect(search).toHaveBeenCalledWith("Cess");
    fireEvent.click(screen.getByRole("button", { name: /Cessna 172 Skyhawk/ }));
    expect(onAircraftChange).toHaveBeenLastCalledWith("Cessna 172 Skyhawk");
  });
});
