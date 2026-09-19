import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Flight } from "../../../types";
import type { TravelRecord } from "../../../types/travelRecords";

const getRecordsMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  statsApi: { getRecords: () => getRecordsMock() },
}));

import RecordsSection from "../RecordsSection";

/**
 * The Rekorde section draws what `/stats/records` sends and derives nothing.
 *
 * What is worth pinning is therefore not the arithmetic — the server owns that
 * and has its own tests — but the three things this side decides: that a
 * record's number is formatted in the reader's unit and locale, that an entry
 * is reachable, and that an empty answer and a failed one are told apart. The
 * last is the one that has gone wrong before on other screens: an empty grid
 * after a failed load reads as "you have no records", which is the single
 * thing it does not mean.
 */

const flight = (over: Partial<Flight>): Flight =>
  ({
    id: "f1",
    userId: "u1",
    airline: "Lufthansa",
    flightNumber: "LH 123",
    depIata: "MUC",
    depName: "Munich",
    depLat: 48,
    depLon: 11,
    arrIata: "SIN",
    arrName: "Singapore Changi",
    arrLat: 1,
    arrLon: 103,
    departureTime: "2024-03-07T09:00:00.000Z",
    arrivalTime: "2024-03-07T21:00:00.000Z",
    status: "flown",
    createdAt: "2024-03-01T00:00:00.000Z",
    ...over,
  }) as Flight;

const ALL_SEVEN: TravelRecord[] = [
  {
    id: "longest-flight",
    value: 10000,
    unit: "km",
    flightId: "f1",
    depIata: "MUC",
    arrIata: "SIN",
    durationMinutes: 720,
  },
  { id: "shortest-flight", value: 55, unit: "km", flightId: "f2", depIata: "HAM", arrIata: "BRE" },
  {
    id: "busiest-day",
    value: 3,
    unit: "flights",
    date: "2024-03-07",
    legs: ["MUC", "FRA", "LHR", "DUB"],
  },
  {
    id: "longest-aloft",
    value: 725,
    unit: "minutes",
    flightId: "f1",
    depIata: "MUC",
    arrIata: "SIN",
  },
  {
    id: "biggest-delay",
    value: 185,
    unit: "minutes",
    flightId: "f2",
    flightNumber: "LH 999",
    depIata: "HAM",
    arrIata: "BRE",
  },
  { id: "northernmost", value: 69.9726, unit: "degrees-north", airportIata: "TOS" },
  { id: "longest-streak", value: 4, unit: "days", startDate: "2024-03-05", endDate: "2024-03-08" },
];

/**
 * Two flights, so the naming can be measured in both directions: MUC and SIN
 * are named, HAM is named, and BRE is a code this account has never seen a
 * name for (`arrName` deliberately absent).
 */
const KNOWN_FLIGHTS: Flight[] = [
  flight({}),
  flight({
    id: "f2",
    flightNumber: "LH 999",
    depIata: "HAM",
    depName: "Hamburg",
    arrIata: "BRE",
    arrName: undefined,
  }),
];

const renderSection = (flights: Flight[] = KNOWN_FLIGHTS): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <RecordsSection flights={flights} />
    </MemoryRouter>
  );

describe("RecordsSection", () => {
  beforeEach(() => {
    getRecordsMock.mockReset();
  });

  it("draws every record kind, each with its value in the reader's unit", async () => {
    getRecordsMock.mockResolvedValue(ALL_SEVEN);
    renderSection();

    await waitFor(() =>
      expect(screen.getByText("stats:records.names.longest-flight")).toBeTruthy()
    );

    for (const record of ALL_SEVEN) {
      expect(screen.getByText(`stats:records.names.${record.id}`)).toBeTruthy();
    }

    // Kilometres, grouped by the UI language rather than the host's locale.
    expect(screen.getByText("10,000 stats:distance.kilometers")).toBeTruthy();
    expect(screen.getByText("55 stats:distance.kilometers")).toBeTruthy();
    // Minutes become hours and minutes; the payload never says "12h 5min".
    expect(screen.getByText("12h 5min")).toBeTruthy();
    expect(screen.getByText("3h 5min")).toBeTruthy();
    // A latitude arrives unrounded and is shown to one decimal — the server
    // refuses to make that choice, so this side has to.
    expect(screen.getByText("70° stats:records.units.north")).toBeTruthy();
    expect(screen.getByText("4 stats:records.units.days")).toBeTruthy();
    expect(screen.getByText("3 stats:records.units.flights")).toBeTruthy();
  });

  it("names the entry a record is about, and links to it", async () => {
    getRecordsMock.mockResolvedValue(ALL_SEVEN);
    renderSection();

    await waitFor(() =>
      expect(screen.getAllByText(/Munich → Singapore Changi/).length).toBeGreaterThan(0)
    );
    // The busiest day is a CHAIN of airports, assembled by the server, and
    // stays in codes: five written-out names do not fit a tile.
    expect(screen.getByText("MUC → FRA → LHR → DUB")).toBeTruthy();
    // The northernmost point is an airport, not a leg.
    expect(screen.getByText("TOS")).toBeTruthy();

    const links = screen.getAllByRole("link", { name: "stats:records.openFlight" });
    expect(links.length).toBe(4);
    expect(links[0].getAttribute("href")).toBe("/flights/f1");
  });

  it("writes an airport's NAME on a route where it knows one, code where it does not", async () => {
    getRecordsMock.mockResolvedValue(ALL_SEVEN);
    renderSection();

    // Both ends known — and the codes stay reachable in the tooltip, because
    // the names are what a reader recognises and the codes are what they
    // search for.
    const named = await screen.findByText("Munich → Singapore Changi · 12h");
    expect(named.getAttribute("title")).toBe("MUC → SIN");

    // One end known, one not: the unknown end falls back to its code by
    // ITSELF. Falling back per route would have cost Hamburg its name for
    // Bremen's sake.
    // Two records name that leg — the shortest flight and the biggest delay.
    const mixed = screen.getAllByText("Hamburg → BRE");
    expect(mixed.length).toBe(2);
    for (const node of mixed) expect(node.getAttribute("title")).toBe("HAM → BRE");
  });

  it("hangs no tooltip when it could name nothing — a repeat of the line is noise", async () => {
    getRecordsMock.mockResolvedValue([ALL_SEVEN[1]]);
    renderSection([]);

    const bare = await screen.findByText("HAM → BRE");
    expect(bare.getAttribute("title")).toBeNull();
  });

  it("shows how long the longest flight took, not only how far it went", async () => {
    getRecordsMock.mockResolvedValue([ALL_SEVEN[0]]);
    renderSection();

    // `durationMinutes` is served on this record and was read by nobody: "how
    // far" and "how long" are the two halves of what makes a leg the longest.
    await waitFor(() => expect(screen.getByText(/· 12h$/)).toBeTruthy());
  });

  it("leaves the duration off a record the server sent none for", async () => {
    getRecordsMock.mockResolvedValue([ALL_SEVEN[1]]);
    renderSection();

    const detail = await screen.findByText("Hamburg → BRE");
    // No " · " tail invented out of a missing field.
    expect(detail.textContent).toBe("Hamburg → BRE");
  });

  it("dates a flight record from the loaded flight, since the payload carries none", async () => {
    getRecordsMock.mockResolvedValue([ALL_SEVEN[0]]);
    renderSection();

    // DD.MM.YYYY is the suite's fixed display preference.
    await waitFor(() => expect(screen.getByText(/LH 123 · 07\.03\.2024/)).toBeTruthy());
  });

  it("leaves the date off when the record's flight is not in the loaded set", async () => {
    getRecordsMock.mockResolvedValue([ALL_SEVEN[0]]);
    renderSection([]);

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "stats:records.openFlight" })).toBeTruthy()
    );
    // Abstention, one level down: no flight row, so no date — never a guess.
    expect(screen.queryByText(/07\.03\.2024/)).toBeNull();
  });

  it("says an empty answer is empty rather than drawing nothing", async () => {
    getRecordsMock.mockResolvedValue([]);
    renderSection();

    await waitFor(() => expect(screen.getByText("stats:records.empty")).toBeTruthy());
  });

  it("says a failed load failed, and offers a retry", async () => {
    getRecordsMock.mockRejectedValue(new Error("network"));
    renderSection();

    // Not the empty state: "I could not ask" and "there is nothing" are
    // different sentences, and only one of them has a way out.
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("stats:page.loadError")).toBeTruthy();
    expect(screen.queryByText("stats:records.empty")).toBeNull();
  });
});
