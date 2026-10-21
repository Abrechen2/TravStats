import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FerryTripCard } from "../FerryTripCard";
import type { TripFerryJourney } from "../../../types/ferry";

// beta.22 UAT: the Kiel–Oslo night crossing read "10.08.2026, 14:00 → 10:00"
// on the trip timeline — the arrival on 11.08 shown as a clock alone.
const ride = {
  id: "fe1",
  operator: "Color Line",
  vesselName: null,
  depStationName: "Kiel Norwegenkai",
  arrStationName: "Oslo Hjortneskaia",
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/Oslo",
  departureTime: "2026-08-10T12:00:00.000Z",
  arrivalTime: "2026-08-11T08:00:00.000Z",
  price: null,
  currency: null,
} as TripFerryJourney;

describe("FerryTripCard — an overnight crossing", () => {
  it("shows the day it docks beside the clock", () => {
    render(
      <MemoryRouter>
        <FerryTripCard ride={ride} date="2026-08-10" dateLabel="10.08." />
      </MemoryRouter>
    );
    expect(screen.getByText(/14:00 → (11\.08\.2026|11 Aug 2026), 10:00/)).toBeInTheDocument();
  });
});
