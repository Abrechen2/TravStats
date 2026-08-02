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

it("renders the logo on a neutral plate so a transparent mark stays visible", () => {
  const { container } = render(<AirlineWordmarkCell flight={flight} />);
  const img = container.querySelector("img");
  expect(img).toBeTruthy();
  // Not every tier ships a tile with its own background: kiwi's Lufthansa mark
  // is 94% transparent dark navy, and the Daisycon tail net returns transparent
  // wordmarks. Bare on the dark UI those are invisible. The plate is a
  // BACKGROUND, so an opaque tile covers it completely — unlike 2.5.0-beta.1,
  // which painted it in the airline's own brand colour and hid the mark.
  expect(img!.className).toContain("bg-white/90");
});

it("keeps the plate off the text fallback", () => {
  render(<AirlineWordmarkCell flight={flight} />);
  fireEvent.error(document.querySelector("img")!);
  const text = screen.getByText("Lufthansa");
  expect(text.className).not.toContain("bg-white");
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
