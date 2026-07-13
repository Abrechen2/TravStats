import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Flight } from "../../../types";

// The manifest says which logo tier will answer, which decides how the cell
// frames the asset. Default: the pre-vendoring world (no brands) — so the cases
// below that don't touch it exercise the bare wordmark tile.
const manifest = vi.hoisted(() => ({
  value: { premium: false, brands: {} as Record<string, { color: string }> },
}));
vi.mock("../../../hooks/useAirlineLogoManifest", () => ({
  useAirlineLogoManifest: () => manifest.value,
}));

import AirlineWordmarkCell from "../AirlineWordmarkCell";

const flight = {
  id: "1", airline: "Lufthansa", airlineIata: "LH", flightNumber: "LH2462",
  depLat: 0, depLon: 0, arrLat: 0, arrLon: 0,
} as unknown as Flight;

beforeEach(() => {
  manifest.value = { premium: false, brands: {} };
});

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

/**
 * The vendored mark is drawn IN the brand colour — Lufthansa's crane has
 * fill="#05164d". The first beta painted that same navy behind it and shipped an
 * invisible logo. The plate must therefore CONTRAST with the mark, not match it.
 */
it("puts a light plate under a dark brand mark", () => {
  manifest.value = { premium: false, brands: { LH: { color: "#05164d" } } };

  const { container } = render(<AirlineWordmarkCell flight={flight} />);

  const tile = container.querySelector("span > span") as HTMLElement;
  expect(tile).toBeTruthy();
  expect(tile.style.background).toContain("rgb(255, 255, 255)");
});

/** ...and the other way round, or a white mark would vanish on white. */
it("puts a dark plate under a light brand mark", () => {
  manifest.value = { premium: false, brands: { LH: { color: "#f5f5f5" } } };

  const { container } = render(<AirlineWordmarkCell flight={flight} />);

  const tile = container.querySelector("span > span") as HTMLElement;
  expect(tile.style.background).toContain("rgb(13, 17, 23)");
});

/**
 * With a logostream key the premium tier answers first and returns a wordmark
 * that already carries its own background. Painting a brand colour behind THAT
 * would double the background — so the server reports no brands at all when a
 * key is configured, and the cell must render the bare tile.
 */
it("renders the bare wordmark tile when the premium tier will answer", () => {
  manifest.value = { premium: true, brands: {} };

  const { container } = render(<AirlineWordmarkCell flight={flight} />);

  expect(container.querySelector("span > span")).toBeNull();
});

/** An airline the snapshot does not hold keeps the neutral wordmark tile. */
it("renders the bare wordmark tile for an airline outside the snapshot", () => {
  manifest.value = { premium: false, brands: { LH: { color: "#05164d" } } };

  const { container } = render(
    <AirlineWordmarkCell
      flight={{ ...flight, airline: "American Airlines", airlineIata: "AA", flightNumber: "AA100" } as unknown as Flight}
    />
  );

  expect(container.querySelector("span > span")).toBeNull();
});
