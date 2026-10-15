import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import StayReviewCard from "../StayReviewCard";
import DawarichStayScanCard from "../../Settings/DawarichStayScanCard";
import { dawarichStaysApi, type DawarichStay } from "../../../lib/api/dawarichStays";
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: {
    accept: vi.fn(),
    reject: vi.fn(),
    state: vi.fn(),
    enable: vi.fn(),
    scan: vi.fn(),
  },
}));
const row: DawarichStay = {
  id: "finding",
  status: "pending",
  name: null,
  startAt: "2026-10-10T14:50:00Z",
  endAt: "2026-10-10T15:20:00Z",
  sourceStartAt: "2026-10-10T14:50:00Z",
  sourceEndAt: "2026-10-10T15:20:00Z",
  sourceLat: 37.57,
  sourceLon: 126.97,
  lat: 37.57,
  lon: 126.97,
  zone: "Asia/Seoul",
  pointCount: 4,
  placeId: null,
  tripId: null,
  visitId: null,
  visit: null,
  detectedAt: "2026-10-11T00:00:00Z",
  resolvedAt: null,
  evidence: {
    source: "dawarich",
    zone: "Asia/Seoul",
    pointIds: [1, 2, 3, 4],
    maxGapMinutes: 10,
    uncertainties: ["sourceUnknown"],
  },
};
const choices = {
  places: [{ id: "place", name: "Palace", lat: 37.58, lon: 126.98 }],
  trips: [{ id: "trip", name: "Korea" }],
};
beforeEach(() => vi.clearAllMocks());
const mount = (over: Partial<DawarichStay> = {}) => {
  const done = vi.fn();
  render(
    <MemoryRouter>
      <StayReviewCard row={{ ...row, ...over }} choices={choices} onDone={done} />
    </MemoryRouter>
  );
  return done;
};
describe("Dawarich stays remain reviewable suggestions", () => {
  it("never auto-accepts and preserves local midnight in the editor", () => {
    mount();
    expect(dawarichStaysApi.accept).not.toHaveBeenCalled();
    expect(screen.getByLabelText("trips:dawarichStays.start")).toHaveValue("2026-10-10T23:50");
    expect(screen.getByLabelText("trips:dawarichStays.end")).toHaveValue("2026-10-11T00:20");
    expect(screen.getByText("trips:dawarichStays.uncertainty.sourceUnknown")).toBeInTheDocument();
  });
  it("carries the selected place coordinates, corrected times and trip into acceptance", async () => {
    vi.mocked(dawarichStaysApi.accept).mockResolvedValue();
    const done = mount();
    fireEvent.change(screen.getByLabelText("trips:dawarichStays.place"), {
      target: { value: "place" },
    });
    fireEvent.change(screen.getByLabelText("trips:dawarichStays.trip"), {
      target: { value: "trip" },
    });
    fireEvent.change(screen.getByLabelText("trips:dawarichStays.start"), {
      target: { value: "2026-10-10T23:55" },
    });
    fireEvent.click(screen.getByRole("button", { name: "trips:dawarichStays.accept" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(dawarichStaysApi.accept).toHaveBeenCalledWith("finding", {
      placeId: "place",
      tripId: "trip",
      name: "Palace",
      lat: 37.58,
      lon: 126.98,
      startAt: { local: "2026-10-10T23:55" },
      endAt: { local: "2026-10-11T00:20" },
    });
  });
  it("keeps the form and corrections when acceptance fails", async () => {
    vi.mocked(dawarichStaysApi.accept).mockRejectedValue({
      response: { data: { code: "DAWARICH_VISIT_TRIP_CONFLICT" } },
    });
    const done = mount();
    fireEvent.change(screen.getByLabelText("trips:dawarichStays.name"), {
      target: { value: "Corrected name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "trips:dawarichStays.accept" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("trips:dawarichStays.tripConflict")
    );
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByLabelText("trips:dawarichStays.name")).toHaveValue("Corrected name");
  });
  it("retains source evidence and an entry link after acceptance", () => {
    mount({
      status: "accepted",
      visit: { id: "visit", placeId: "place" },
      visitId: "visit",
      resolvedAt: "2026-10-12T00:00:00Z",
    });
    expect(screen.getByRole("link", { name: "trips:dawarichStays.openVisit" })).toHaveAttribute(
      "href",
      "/places/place"
    );
    expect(screen.getByText("Dawarich · finding")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "trips:dawarichStays.accept" })).toBeNull();
  });
  it("shows upstream authentication failure rather than an empty successful scan", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      enabled: true,
      connected: true,
      result: "failed",
      error: "auth",
      startedAt: null,
      finishedAt: "2026-10-12T00:00:00Z",
      dataThrough: null,
      windowStart: null,
      windowEnd: null,
      pointCount: 0,
      createdCount: 0,
    });
    render(
      <MemoryRouter>
        <DawarichStayScanCard />
      </MemoryRouter>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "trips:tours.tracks.dawarich.errors.auth"
    );
    expect(dawarichStaysApi.scan).not.toHaveBeenCalled();
  });
});

it("labels the entire market and exposes only safe OSM provenance links", () => {
  mount({
    name: "Market",
    evidence: {
      ...row.evidence,
      kind: "market",
      market: {
        identity: "wikidata:Q1234",
        areaIds: ["way/1234"],
        sourceUrls: ["https://www.openstreetmap.org/way/1234", "javascript:alert(1)"],
        interiorPointCount: 12,
        overlappingMarketIds: [],
      },
    },
  });
  expect(screen.getByText("trips:dawarichStays.markets.venue")).toBeInTheDocument();
  fireEvent.click(screen.getByText("trips:dawarichStays.provenance"));
  expect(screen.getByRole("link", { name: "trips:dawarichStays.markets.source" })).toHaveAttribute(
    "rel",
    "noopener noreferrer"
  );
  expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).not.toBeInTheDocument();
  expect(dawarichStaysApi.accept).not.toHaveBeenCalled();
});

it.each(["mall", "park", "zoo", "themePark", "museum"] as const)(
  "labels %s as an independent venue and keeps review manual",
  (venueType) => {
    mount({
      name: "Whole venue",
      evidence: {
        ...row.evidence,
        kind: "venue",
        market: {
          identity: "wikidata:Q9876",
          venueType,
          areaIds: ["way/9876"],
          sourceUrls: ["https://www.openstreetmap.org/way/9876", "javascript:alert(1)"],
          interiorPointCount: 15,
          overlappingMarketIds: [],
        },
      },
    });
    expect(screen.getByText(`trips:dawarichStays.venues.types.${venueType}`)).toBeInTheDocument();
    fireEvent.click(screen.getByText("trips:dawarichStays.provenance"));
    expect(screen.getByRole("link", { name: "trips:dawarichStays.venues.source" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/way/9876"
    );
    expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).not.toBeInTheDocument();
    expect(dawarichStaysApi.accept).not.toHaveBeenCalled();
  }
);
