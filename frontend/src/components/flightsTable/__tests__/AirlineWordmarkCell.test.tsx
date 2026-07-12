import { it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AirlineWordmarkCell from "../AirlineWordmarkCell";
import type { Flight } from "../../../types";

const flight = {
  id: "1", airline: "Lufthansa", airlineIata: "LH", flightNumber: "LH2462",
  depLat: 0, depLon: 0, arrLat: 0, arrLon: 0,
} as unknown as Flight;

it("requests the wordmark variant from the proxy", () => {
  render(<AirlineWordmarkCell flight={flight} />);
  const img = screen.getByRole("img") as HTMLImageElement;
  expect(img.src).toContain("/api/v1/airline-logos/LH?variant=logo");
});

it("falls back to the airline name text when the logo fails", () => {
  render(<AirlineWordmarkCell flight={flight} />);
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText("Lufthansa")).toBeInTheDocument();
});

it("resolves the logo from the stored airline NAME when no structured code exists", () => {
  // Most stored flights carry only the name — the catalogue maps it to LH.
  render(<AirlineWordmarkCell flight={{ ...flight, airlineIata: undefined, flightNumber: undefined } as unknown as Flight} />);
  const img = screen.getByRole("img") as HTMLImageElement;
  expect(img.src).toContain("/api/v1/airline-logos/LH?variant=logo");
});

it("falls back to the name immediately when nothing resolves", () => {
  render(<AirlineWordmarkCell flight={{
    ...flight, airline: "Some Unknown Carrier", airlineIata: undefined, flightNumber: undefined,
  } as unknown as Flight} />);
  expect(screen.getByText("Some Unknown Carrier")).toBeInTheDocument();
});
