import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Wrapped } from "../../types/wrapped";

const getWrappedMock = vi.fn();
vi.mock("../../lib/api", () => ({
  statsApi: { getWrapped: (year?: number) => getWrappedMock(year) },
}));

const domains = { flight: true, cruise: true };
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: Object.keys(domains),
    isEnabled: (key: string) => domains[key as keyof typeof domains] === true,
  }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

import WrappedPage from "../WrappedPage";

/**
 * Dein Jahr renders what `/stats/wrapped` sends. Four things are this side's
 * own and are pinned here.
 *
 * THE FIRST REQUEST CARRIES NO YEAR. Sending the current one would make the
 * page disagree with itself on 1 January — the server reads the year off the
 * data, and the whole point is that it, not the browser's clock, decides.
 *
 * A FAVOURITE THE YEAR CANNOT SUPPORT DRAWS NO CARD. The server sends null;
 * repeating that as a card reading "—" would undo the abstention.
 *
 * NO PERCENTAGE OF THE WORLD AND NO FLAGS — forgejo#53's two standing "do not
 * build" rules, checked against the rendered text rather than trusted.
 */

const wrapped = (over: Partial<Wrapped> = {}): Wrapped => ({
  year: 2024,
  availableYears: [2022, 2023, 2024],
  rank: "top",
  comparisonYear: null,
  flights: 42,
  distanceKm: 123456,
  earthFactor: 3.1,
  newCountries: 5,
  cruises: 2,
  topAirline: { name: "Lufthansa", code: "LH", flights: 19 },
  topRoute: { from: "FRA", to: "JFK", flights: 6 },
  ...over,
});

const renderAtRoute = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={["/stats/wrapped"]}>
      <Routes>
        <Route path="/stats/wrapped" element={<WrappedPage />} />
      </Routes>
    </MemoryRouter>
  );

describe("WrappedPage", () => {
  beforeEach(() => {
    getWrappedMock.mockReset();
    domains.flight = true;
    domains.cruise = true;
  });

  it("is reachable at /stats/wrapped and asks for no year on the first load", async () => {
    getWrappedMock.mockResolvedValue(wrapped());
    renderAtRoute();

    await waitFor(() => expect(screen.getByText("stats:wrapped.title")).toBeTruthy());
    expect(getWrappedMock).toHaveBeenCalledWith(undefined);
  });

  it("formats the headline numbers in the reader's unit and locale", async () => {
    getWrappedMock.mockResolvedValue(wrapped());
    renderAtRoute();

    await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
    expect(screen.getByText("123,456 stats:distance.kilometers")).toBeTruthy();
    expect(screen.getByText("stats:wrapped.distanceDesc")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("Lufthansa")).toBeTruthy();
    // A pair, not a direction: the server sorts the codes and counts both ways
    // together, so an arrow would claim something the number does not say.
    expect(screen.getByText("FRA – JFK")).toBeTruthy();
  });

  it("switches the request when the reader picks another year", async () => {
    getWrappedMock.mockResolvedValue(wrapped());
    renderAtRoute();

    await waitFor(() => expect(screen.getByLabelText("stats:wrapped.yearLabel")).toBeTruthy());
    getWrappedMock.mockResolvedValue(wrapped({ year: 2022, flights: 7 }));

    fireEvent.change(screen.getByLabelText("stats:wrapped.yearLabel"), {
      target: { value: "2022" },
    });

    await waitFor(() => expect(getWrappedMock).toHaveBeenLastCalledWith(2022));
    await waitFor(() => expect(screen.getByText("7")).toBeTruthy());
  });

  it("offers only the years the server says have something in them", async () => {
    getWrappedMock.mockResolvedValue(wrapped());
    renderAtRoute();

    await waitFor(() => expect(screen.getByLabelText("stats:wrapped.yearLabel")).toBeTruthy());
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["2024", "2023", "2022"]);
  });

  it("draws no card for a favourite the year cannot support", async () => {
    getWrappedMock.mockResolvedValue(wrapped({ topAirline: null, topRoute: null }));
    renderAtRoute();

    await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
    expect(screen.queryByText("stats:wrapped.topAirline")).toBeNull();
    expect(screen.queryByText("stats:wrapped.topRoute")).toBeNull();
  });

  it("hides the cruise figure for a reader who does not sail", async () => {
    domains.cruise = false;
    getWrappedMock.mockResolvedValue(wrapped());
    renderAtRoute();

    await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
    expect(screen.queryByText("stats:wrapped.cruises")).toBeNull();
  });

  it("says an empty year is empty instead of drawing a grid of zeros", async () => {
    getWrappedMock.mockResolvedValue(
      wrapped({ year: 2019, flights: 0, cruises: 0, distanceKm: 0, earthFactor: 0, rank: "other" })
    );
    renderAtRoute();

    await waitFor(() => expect(screen.getByText("stats:wrapped.emptyYear")).toBeTruthy());
    expect(screen.queryByText("stats:wrapped.flights")).toBeNull();
  });

  it("tells 'no story yet' apart from 'could not load'", async () => {
    getWrappedMock.mockRejectedValue(
      Object.assign(new Error("nope"), { isAxiosError: true, response: { status: 404 } })
    );
    const { unmount } = renderAtRoute();
    await waitFor(() => expect(screen.getByText("stats:wrapped.nothingYet")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();

    getWrappedMock.mockRejectedValue(new Error("network"));
    renderAtRoute();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("stats:wrapped.loadError")).toBeTruthy();
  });

  it("explains itself rather than asking for a number that cannot exist", async () => {
    domains.flight = false;
    renderAtRoute();

    await waitFor(() => expect(screen.getByText("stats:wrapped.needsFlights")).toBeTruthy());
    expect(getWrappedMock).not.toHaveBeenCalled();
  });

  it("shows no percentage and no flag — forgejo#53's two standing rules", async () => {
    getWrappedMock.mockResolvedValue(wrapped());
    const { container } = renderAtRoute();

    await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
    const text = container.textContent ?? "";
    // Nobody has picked a denominator for "the world's countries", so no
    // percentage may sit next to a country figure on this page at all.
    expect(text).not.toContain("%");
    // Regional-indicator pairs are how a flag emoji is written.
    expect(text).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
  });
});
