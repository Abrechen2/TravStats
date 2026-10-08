import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  makeRailBookingLeg,
  FULDA_TO_BERLIN,
  makeRailJourney,
} from "../../components/rail/__tests__/railJourneyFixture";
import type { RailJourneyDetail } from "../../types/rail";

/**
 * The rail detail page (spec 2026-09-25-rail-domain, phase 2b): every time on
 * its station's clock, a distance that says what it measures, an unrecorded
 * delay kept apart from an on-time arrival, and the connection it belongs to.
 */
const getMock = vi.fn();
const getConnectionMock = vi.fn();
vi.mock("../../lib/api/rail", () => ({
  railApi: {
    get: (...a: unknown[]) => getMock(...a),
    getConnection: (...a: unknown[]) => getConnectionMock(...a),
    remove: vi.fn(),
  },
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
vi.mock("../../components/rail/RailFormModal", () => ({
  RailFormModal: ({ journey }: { journey: { id: string } | null }) => (
    <div data-testid="rail-editor">{journey?.id ?? "new"}</div>
  ),
}));
vi.mock("../../components/common/TripPhotoWindowStrip", () => ({
  default: ({ entry, id }: { entry: string; id: string }) => (
    <div data-testid="photo-window-stub">{`${entry}:${id}`}</div>
  ),
}));
// The connection view lists each leg's originals through the documents router.
const listForEntry = vi.fn();
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...a: unknown[]) => listForEntry(...a) },
  documentFileUrl: (doc: { url: string }) => doc.url,
}));
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
    getConnectionMock.mockReset().mockRejectedValue(new Error("not asked in this test"));
    listForEntry.mockReset().mockResolvedValue([]);
  });

  it("shows each time on its station's clock, with the zone it was read in", async () => {
    await renderPage(detail());
    // 04:15 UTC is 06:15 in Frankfurt (CEST).
    expect(screen.getAllByText(/06:15 \(Europe\/Berlin\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/07:10 \(Europe\/Berlin\)/).length).toBeGreaterThan(0);
  });

  // As a flight shows them: the trip's photos taken on board, for a ride on a trip.
  it("asks for no photos for a ride on no trip", async () => {
    await renderPage(detail({ tripId: null }));
    expect(screen.queryByTestId("photo-window-stub")).toBeNull();
  });

  it("asks for the photos of the ride's own window", async () => {
    const journey = detail({
      tripId: "trip-1",
      trip: { id: "trip-1", name: "Rhön", color: "#fff" },
    });
    await renderPage(journey);
    expect(screen.getByTestId("photo-window-stub").textContent).toBe(`rail:${journey.id}`);
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

  it("labels a converted ride's distance and says its time was a placeholder", async () => {
    await renderPage(
      detail({
        distanceKm: 243.5,
        distanceSource: "roadtrip",
        externalRef: "roadtrip:s1:l1",
        arrivalTime: null,
      })
    );
    expect(screen.getByText("rail:roadtripLine")).toBeInTheDocument();
    expect(screen.getByTestId("rail-converted-note")).toHaveTextContent(
      "rail:detail.convertedFromRoadtrip rail:detail.convertedPlaceholder"
    );
  });

  it("lists the booking's legs, linking the others", async () => {
    const legs = [
      { id: "j1", depStationName: "Frankfurt", arrStationName: "Fulda" },
      { id: "j2", depStationName: "Fulda", arrStationName: "Berlin", ...FULDA_TO_BERLIN },
    ].map((l) => makeRailBookingLeg(l));
    await renderPage(detail({ booking: { id: "b1", pnr: "AB12CD", railJourneys: legs } }));
    expect(screen.getByRole("link", { name: "2. Fulda → Berlin" })).toHaveAttribute(
      "href",
      "/rail/j2"
    );
    expect(screen.queryByRole("link", { name: /1\. Frankfurt/ })).toBeNull();
    // The mock answers no connection here: the legs stay listed, no link drawn.
    expect(screen.queryByTestId("rail-connection-link")).toBeNull();
  });

  // forgejo#234: the booking's legs show what lies between them — here a next
  // train that leaves before this one arrives, at another station.
  it("shows a conflict and a change of stations between the booking's legs", async () => {
    const legs = [
      makeRailBookingLeg({ id: "j1", arrivalTime: "2026-09-26T05:10:00.000Z" }),
      makeRailBookingLeg({
        id: "j2",
        depStationName: "Fulda Süd",
        arrStationName: "Berlin",
        departureTime: "2026-09-26T05:00:00.000Z",
      }),
    ];
    await renderPage(detail({ booking: { id: "b1", pnr: "AB12CD", railJourneys: legs } }));
    const note = screen.getByTestId("rail-transfer-1");
    expect(note).toHaveAttribute("data-kind", "conflict");
    expect(note.textContent).toContain('rail:detail.durationM {\\"m\\":10}');
    expect(screen.getByTestId("rail-transfer-1-station-change")).toHaveTextContent(
      'rail:transfer.stationChange {"from":"Fulda","to":"Fulda Süd"}'
    );
  });

  // forgejo#235: the whole connection is readable here — seats and originals
  // of the other train too, without opening it.
  it("bundles every leg's seat and its originals in the connection section", async () => {
    listForEntry.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(
        id === "j2"
          ? [
              {
                id: "d9",
                displayName: "Reservierung.pdf",
                kind: null,
                url: "/api/v1/documents/d9/file",
              },
            ]
          : []
      )
    );
    const legs = [
      makeRailBookingLeg({ id: "j1" }),
      makeRailBookingLeg({
        id: "j2",
        depStationName: "Fulda",
        arrStationName: "Berlin",
        ...FULDA_TO_BERLIN,
        coach: "12",
        seat: "61",
      }),
    ];
    await renderPage(detail({ booking: { id: "b1", pnr: "AB12CD", railJourneys: legs } }));
    expect(screen.getByTestId("rail-connection-leg-j1-seat")).toHaveTextContent(
      "rail:connectionView.noReservation"
    );
    expect(screen.getByTestId("rail-connection-leg-j2-seat")).toHaveTextContent(
      'rail:connectionView.seat {"seat":"61"}'
    );
    expect(
      await screen.findByRole("link", { name: 'documents:openLabel {"name":"Reservierung.pdf"}' })
    ).toHaveAttribute("href", "/api/v1/documents/d9/file");
  });

  it("links up to the whole ride when the server says this train has a change", async () => {
    const legs = [
      { id: "j1", depStationName: "Frankfurt", arrStationName: "Fulda" },
      { id: "j2", depStationName: "Fulda", arrStationName: "Berlin", ...FULDA_TO_BERLIN },
    ].map((l) => makeRailBookingLeg(l));
    getConnectionMock.mockResolvedValue({
      id: "j1",
      booking: { id: "b1", pnr: "AB12CD" },
      legs: [
        makeRailJourney(),
        makeRailJourney({
          id: "j2",
          depStationName: "Fulda",
          arrStationName: "Berlin",
          ...FULDA_TO_BERLIN,
        }),
      ],
    });
    await renderPage(detail({ booking: { id: "b1", pnr: "AB12CD", railJourneys: legs } }));
    const link = await screen.findByTestId("rail-connection-link");
    expect(link).toHaveAttribute("href", "/rail/connection/j1");
    expect(link.textContent).toContain("Frankfurt → Fulda → Berlin");
    expect(getConnectionMock).toHaveBeenCalledWith("j1");
  });

  it("draws no link up for a train that is a ride of its own", async () => {
    getConnectionMock.mockResolvedValue({ id: "j1", booking: null, legs: [makeRailJourney()] });
    const legs = [
      makeRailBookingLeg({ id: "j1" }),
      makeRailBookingLeg({
        id: "j9",
        depStationName: "Fulda",
        arrStationName: "Frankfurt",
        departureTime: "2026-09-28T04:15:00.000Z",
        trainNumber: "2",
      }),
    ];
    await renderPage(detail({ booking: { id: "b1", pnr: null, railJourneys: legs } }));
    await waitFor(() => expect(getConnectionMock).toHaveBeenCalled());
    expect(screen.queryByTestId("rail-connection-link")).toBeNull();
  });

  // forgejo#250: what goes (the ride, its originals) and what stays (the
  // trip, the booking's other trains), on the detail page too.
  it("names the ride, its originals and what stays in the delete question", async () => {
    listForEntry.mockResolvedValue([{ id: "d1" }]);
    const legs = [
      makeRailBookingLeg({ id: "j1" }),
      makeRailBookingLeg({
        id: "j2",
        depStationName: "Fulda",
        arrStationName: "Berlin",
        ...FULDA_TO_BERLIN,
      }),
    ];
    await renderPage(
      detail({
        bookingId: "b1",
        trip: { id: "t1", name: "Rhön", color: "#fff" },
        booking: { id: "b1", pnr: null, railJourneys: legs },
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "rail:delete" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
    expect(dialog.textContent).toContain('rail:deleteConfirmNamed {"route":"Frankfurt → Fulda"}');
    expect(dialog.textContent).toContain('rail:deleteSurvivors.trip {\\"name\\":\\"Rhön\\"}');
    expect(dialog.textContent).toContain('rail:deleteSurvivors.otherLegs {\\"count\\":1}');
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

describe("RailDetailPage — ?edit=1 from the inbox", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  // The inbox's link for a journey whose zone or time the time-model
  // migration left open (ADR 0002, plan Phase 3b; timeFlagLinks.ts).
  it("opens the journey's own editor once it has loaded", async () => {
    const journey = detail();
    getMock.mockResolvedValue(journey);
    render(
      <MemoryRouter initialEntries={[`/rail/${journey.id}?edit=1`]}>
        <Routes>
          <Route path="/rail/:id" element={<RailDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByTestId("rail-editor")).toHaveTextContent(journey.id);
  });

  it("opens no editor without the parameter", async () => {
    await renderPage(detail());
    expect(screen.queryByTestId("rail-editor")).not.toBeInTheDocument();
  });

  // forgejo#132 item 16.
  it("names the stations' short codes under the title", async () => {
    await renderPage(detail({ depStationShortCode: "FF", arrStationShortCode: "FFU" }));
    expect(screen.getAllByTestId("station-short-code").map((el) => el.textContent)).toEqual([
      "FF",
      "FFU",
    ]);
  });

  it("names no code for stations no source knows", async () => {
    await renderPage(detail({ depStationShortCode: null, arrStationShortCode: null }));
    expect(screen.queryByTestId("station-short-code")).toBeNull();
  });
});
