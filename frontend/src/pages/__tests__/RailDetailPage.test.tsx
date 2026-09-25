import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { makeRailJourney } from "../../components/rail/__tests__/railJourneyFixture";
import type { RailJourneyDetail } from "../../types/rail";

/**
 * The rail detail page (spec 2026-09-25-rail-domain, phase 2b): every time on
 * its station's clock, a distance that says what it measures, an unrecorded
 * delay kept apart from an on-time arrival, and the connection it belongs to.
 */
const getMock = vi.fn();
vi.mock("../../lib/api/rail", () => ({
  railApi: { get: (...a: unknown[]) => getMock(...a), remove: vi.fn() },
}));
// Its own suites cover these; here they would only reach for the network or WebGL.
vi.mock("../../components/documents/DocumentsSection", () => ({
  default: ({ entry }: { entry: { type: string; id: string } }) => (
    <div data-testid="documents-stub">{`${entry.type}:${entry.id}`}</div>
  ),
}));
vi.mock("../../components/rail/RailRouteMap", () => ({
  RailRouteMap: () => <div data-testid="map-stub" />,
}));
vi.mock("../../components/rail/RailFormModal", () => ({ RailFormModal: () => null }));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import RailDetailPage from "../RailDetailPage";

function detail(overrides: Partial<RailJourneyDetail> = {}): RailJourneyDetail {
  return { ...makeRailJourney(), booking: null, ...overrides };
}

async function renderPage(journey: RailJourneyDetail): Promise<void> {
  getMock.mockResolvedValue(journey);
  render(
    <MemoryRouter initialEntries={[`/rail/${journey.id}`]}>
      <Routes>
        <Route path="/rail/:id" element={<RailDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText("Frankfurt → Fulda");
}

describe("RailDetailPage", () => {
  // Braces matter: a function returned from beforeEach is run as its cleanup.
  beforeEach(() => {
    getMock.mockReset();
  });

  it("shows each time on its station's clock, with the zone it was read in", async () => {
    await renderPage(detail());
    // 04:15 UTC is 06:15 in Frankfurt (CEST).
    expect(screen.getAllByText(/06:15 \(Europe\/Berlin\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/07:10 \(Europe\/Berlin\)/).length).toBeGreaterThan(0);
  });

  it("keeps an unrecorded delay apart from an on-time arrival", async () => {
    await renderPage(detail({ delayMinutes: null }));
    expect(screen.getByText("rail:detail.delayUnknown")).toBeInTheDocument();
    expect(screen.queryByText("rail:onTime")).toBeNull();
  });

  it("says an on-time arrival is on time", async () => {
    await renderPage(detail({ delayMinutes: 0 }));
    expect(screen.getAllByText("rail:onTime").length).toBeGreaterThan(0);
  });

  it("labels a measured distance as a straight line", async () => {
    await renderPage(detail({ distanceSource: "great_circle", geometry: null }));
    expect(screen.getByText("rail:straightLine")).toBeInTheDocument();
  });

  it("lists the booking's legs, linking the others", async () => {
    const legs = [
      { id: "j1", depStationName: "Frankfurt", arrStationName: "Fulda" },
      { id: "j2", depStationName: "Fulda", arrStationName: "Berlin" },
    ].map((l) => ({
      ...l,
      departureTime: "2026-09-26T04:15:00.000Z",
      arrivalTime: null,
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Berlin",
      trainCategory: "ICE",
      trainNumber: "1",
      status: "completed" as const,
    }));
    await renderPage(detail({ booking: { id: "b1", pnr: "AB12CD", railJourneys: legs } }));
    expect(screen.getByRole("link", { name: "2. Fulda → Berlin" })).toHaveAttribute(
      "href",
      "/rail/j2"
    );
    expect(screen.queryByRole("link", { name: /1\. Frankfurt/ })).toBeNull();
  });

  it("files documents with the journey", async () => {
    await renderPage(detail());
    expect(screen.getByTestId("documents-stub")).toHaveTextContent("railJourney:j1");
  });

  it("says a failed load, and offers no 'not found' for it", async () => {
    getMock.mockRejectedValue(new Error("network"));
    render(
      <MemoryRouter initialEntries={["/rail/j1"]}>
        <Routes>
          <Route path="/rail/:id" element={<RailDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:detail.loadError");
  });
});
