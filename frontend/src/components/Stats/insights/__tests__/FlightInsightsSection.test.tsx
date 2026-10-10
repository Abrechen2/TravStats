import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import type { FlightInsights } from "../../../../types/flightInsights";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";
import { expectNoNestedTriggers } from "../../__tests__/noNestedTriggers";
import { useEvidenceOpenStore } from "../../../evidence/evidenceOpenStore";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "year" in o ? `${k}|${o.year}` : k),
    i18n: { language: "de" },
  }),
}));
const getFlightInsights = vi.fn();
vi.mock("../../../../lib/api", () => ({
  statsApi: { getFlightInsights: (year: number | null) => getFlightInsights(year) },
}));

import FlightInsightsSection from "../FlightInsightsSection";

/**
 * forgejo#256 on the web: the section draws the server's figures, and what it
 * owns is checked here — every count opens the entries behind it under the
 * scope the row shows, every block carries help a keyboard can reach, an
 * absent figure reads as absent (never as 0), and a failed load is not an
 * empty logbook.
 */

const transfer = {
  minutes: 135,
  airport: "FRA",
  airportChange: null,
  day: "2024-03-02",
  arrivingFlightId: "f-feeder",
  departingFlightId: "f-long",
  arrivingFlightNumber: "LH 100",
  departingFlightNumber: "LH 400",
};

const INSIGHTS: FlightInsights = {
  history: {
    firstYear: 2014,
    lastYear: 2024,
    airportsTotal: 5,
    connectionsTotal: 4,
    countedFlights: 5,
    undatedFlights: 0,
    placeholderDateFlights: 0,
    unknownEndFlights: 0,
  },
  years: [
    {
      year: 2024,
      flights: 4,
      distanceKm: 9000,
      airportsUsed: 5,
      newAirports: ["BOS", "JFK", "MUC"],
      discoveryRate: 0.6,
      connections: 4,
      newConnections: ["BOS-JFK", "FRA-JFK", "FRA-MUC"],
      repeatedConnections: ["FRA-LIS"],
      flightsOnNewConnections: 3,
      flightsOnRepeatedConnections: 1,
    },
  ],
  reunions: [
    {
      airport: "LIS",
      fromDay: "2014-06-10",
      toDay: "2024-06-12",
      days: 3655,
      years: 10,
      fromFlightId: "f-out",
      toFlightId: "f-back",
    },
  ],
  quarterAirports: [],
  transfers: {
    years: [
      {
        year: 2024,
        count: 1,
        totalMinutes: 135,
        medianMinutes: 135,
        shortest: transfer,
        longest: transfer,
      },
    ],
    shortest: transfer,
    longest: transfer,
    coverage: {
      bookings: 1,
      gaps: 1,
      measured: 1,
      unknownTime: 0,
      unknownOrder: 0,
      conflict: 0,
      separate: 0,
      notFlown: 0,
    },
  },
  story: {
    year: 2024,
    availableYears: [2014, 2024],
    firstRecordedYear: false,
    newAirports: ["BOS", "JFK", "MUC"],
    biggestChange: null,
    curiousRepetition: {
      kind: "reunion",
      reunion: {
        airport: "LIS",
        fromDay: "2014-06-10",
        toDay: "2024-06-12",
        days: 3655,
        years: 10,
        fromFlightId: "f-out",
        toFlightId: "f-back",
      },
    },
    funFacts: {
      fastestDay: "2024-03-02",
      fastestDayFlights: 3,
      routeMaster: "FRA-LIS",
      routeMasterCount: 2,
      timezones: 3,
    },
    transfers: { count: 1, shortestMinutes: 135 },
  },
};

let search = "";
function LocationProbe(): null {
  search = useLocation().search;
  return null;
}

function renderSection(year: number | null = null): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LocationProbe />
      <FlightInsightsSection flights={[]} year={year} />
    </MemoryRouter>
  );
}

describe("FlightInsightsSection (forgejo#256)", () => {
  beforeEach(() => {
    getFlightInsights.mockReset();
    search = "";
  });

  it("asks for the page's year, so the story follows the year pill", async () => {
    getFlightInsights.mockResolvedValue(INSIGHTS);
    renderSection(2024);
    await waitFor(() => expect(getFlightInsights).toHaveBeenCalledWith(2024));
  });

  it("opens the flights behind a year's new airports, scoped to that year", async () => {
    getFlightInsights.mockResolvedValue(INSIGHTS);
    const { container } = renderSection();
    const trigger = await screen.findByRole("button", {
      name: "stats:insights.discovery.newAirports 2024",
    });
    act(() => trigger.click());
    expect(search).toContain("flightNewAirportsCount");
    // The scope travels beside the URL, with the figure the row showed.
    expect(useEvidenceOpenStore.getState().scope).toEqual({ period: "year", year: 2024 });
    expect(useEvidenceOpenStore.getState().renderedValue).toBe(3);
    expectNoNestedTriggers(container);
  });

  it("wires only keys a resolver serves", async () => {
    getFlightInsights.mockResolvedValue(INSIGHTS);
    renderSection();
    await screen.findByRole("heading", { name: "stats:insights.discovery.title" });
    const opened = new Set<string>();
    for (const button of screen.getAllByRole("button")) {
      if (button.getAttribute("aria-haspopup") !== "dialog") continue;
      act(() => button.click());
      const key = /metric(?:%3A|:)([A-Za-z]+)/.exec(search)?.[1];
      if (key) opened.add(key);
    }
    expect([...opened].sort()).toEqual([
      "flightNewAirportsCount",
      "flightNewConnectionsCount",
      "flightRepeatedConnectionsCount",
      "flightTransferCount",
    ]);
    for (const key of opened) expect(EVIDENCE_MEASURES[key]?.servedIn).toBe(1);
  });

  it("gives every block help a keyboard reaches", async () => {
    getFlightInsights.mockResolvedValue(INSIGHTS);
    renderSection();
    await screen.findByRole("heading", { name: "stats:insights.discovery.title" });
    // story, transfers, discovery (+ routes), reunions, quarters
    const summaries = screen.getAllByText("stats:counting.summary");
    expect(summaries).toHaveLength(5);
    const discovery = screen.getByTestId("insights-discovery-help");
    for (const topic of ["discovery", "routes"]) {
      expect(within(discovery).getByText(`stats:insights.help.${topic}.exclusions`)).toBeTruthy();
    }
    fireEvent.click(summaries[0]);
    expect(summaries[0].closest("details")).toHaveAttribute("open");
  });

  it("links both flights of a long return", async () => {
    getFlightInsights.mockResolvedValue(INSIGHTS);
    renderSection();
    await screen.findByText("stats:insights.reunions.title");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/flights/f-out", "/flights/f-back"]));
  });

  it("says a transfer could not be measured instead of showing zero", async () => {
    getFlightInsights.mockResolvedValue({
      ...INSIGHTS,
      transfers: {
        years: [],
        shortest: null,
        longest: null,
        coverage: { ...INSIGHTS.transfers.coverage, measured: 0, unknownTime: 1 },
      },
    });
    renderSection();
    expect(await screen.findByText("stats:insights.transfers.empty")).toBeTruthy();
    expect(screen.getByText(/stats:insights.transfers.coverageDetail/)).toBeTruthy();
  });

  it("tells a failed load apart from an empty logbook", async () => {
    getFlightInsights.mockRejectedValue(new Error("boom"));
    renderSection();
    await waitFor(() => expect(getFlightInsights).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("stats:insights.empty")).toBeNull());
    expect(screen.queryByText("common:loading.default")).toBeNull();
  });

  it("never lets a slow answer for the previous year overwrite the current one", async () => {
    let answerOld: (value: FlightInsights) => void = () => undefined;
    getFlightInsights
      .mockImplementationOnce(() => new Promise<FlightInsights>((resolve) => (answerOld = resolve)))
      .mockResolvedValueOnce({ ...INSIGHTS, story: { ...INSIGHTS.story!, year: 2024 } });
    const view = render(
      <MemoryRouter>
        <FlightInsightsSection flights={[]} year={2014} />
      </MemoryRouter>
    );
    view.rerender(
      <MemoryRouter>
        <FlightInsightsSection flights={[]} year={2024} />
      </MemoryRouter>
    );
    await screen.findByText("stats:insights.story.title|2024");
    await act(async () => answerOld({ ...INSIGHTS, story: { ...INSIGHTS.story!, year: 2014 } }));
    expect(screen.queryByText("stats:insights.story.title|2014")).toBeNull();
    expect(screen.getByText("stats:insights.story.title|2024")).toBeTruthy();
  });

  it("says the first recorded year discovers everything", async () => {
    getFlightInsights.mockResolvedValue({
      ...INSIGHTS,
      story: { ...INSIGHTS.story!, firstRecordedYear: true },
    });
    renderSection();
    expect(await screen.findByText("stats:insights.story.firstRecordedYear")).toBeTruthy();
  });

  it("explains which records would enable the section when there are none", async () => {
    getFlightInsights.mockResolvedValue({
      ...INSIGHTS,
      history: { ...INSIGHTS.history, firstYear: null, lastYear: null },
      years: [],
      story: null,
    });
    renderSection();
    expect(await screen.findByText("stats:insights.empty")).toBeTruthy();
  });
});
