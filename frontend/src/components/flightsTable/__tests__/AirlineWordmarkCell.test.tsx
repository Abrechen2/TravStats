import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Flight } from "../../../types";
import { api } from "../../../lib/api/client";

import AirlineWordmarkCell from "../AirlineWordmarkCell";

const flight = {
  id: "1", airline: "Lufthansa", airlineIata: "LH", flightNumber: "LH2462",
  depLat: 0, depLon: 0, arrLat: 0, arrLon: 0,
} as unknown as Flight;

it("requests the wordmark variant from the proxy", () => {
  render(<AirlineWordmarkCell flight={flight} />);
  const img = screen.getByRole("img") as HTMLImageElement;
  expect(img.src).toContain("/api/v1/airline-logos/LH?variant=logo");
});

it("resolves the logo from the stored airline NAME when no structured code exists", () => {
  // Most stored flights carry only the name — the catalogue maps it to LH.
  render(<AirlineWordmarkCell flight={{ ...flight, airlineIata: undefined, flightNumber: undefined } as unknown as Flight} />);
  const img = screen.getByRole("img") as HTMLImageElement;
  expect(img.src).toContain("/api/v1/airline-logos/LH?variant=logo");
});

it("renders the logo with no plate behind it", () => {
  const { container } = render(<AirlineWordmarkCell flight={flight} />);
  const img = container.querySelector("img");
  expect(img).toBeTruthy();
  // The tile arrives with its own background. Anything we paint behind it is a
  // second background — which is what shipped broken in 2.5.0-beta.1 and .2.
  const wrapper = img!.parentElement!;
  expect(wrapper.style.background).toBe("");
});

it("does not fetch a manifest", async () => {
  const spy = vi.spyOn(api, "get");
  render(<AirlineWordmarkCell flight={flight} />);
  await waitFor(() => expect(spy).not.toHaveBeenCalledWith("/airline-logos/manifest"));
});

it("falls back to the airline name when no logo resolves", () => {
  render(<AirlineWordmarkCell flight={{ ...flight, airline: "Lufthansa" }} />);
  fireEvent.error(document.querySelector("img")!);
  expect(screen.getByText("Lufthansa")).toBeInTheDocument();
});

it("falls back to the name immediately when nothing resolves", () => {
  render(<AirlineWordmarkCell flight={{
    ...flight, airline: "Some Unknown Carrier", airlineIata: undefined, flightNumber: undefined,
  } as unknown as Flight} />);
  expect(screen.getByText("Some Unknown Carrier")).toBeInTheDocument();
});
