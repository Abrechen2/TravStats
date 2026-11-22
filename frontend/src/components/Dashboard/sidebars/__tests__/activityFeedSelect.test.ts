import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectFeedItem, type FeedSelectDeps } from "../activityFeedSelect";
import type { ActivityFeedItem } from "../../../../lib/api/activityFeed";
import { railApi } from "../../../../lib/api/rail";
import { tourIndexApi } from "../../../../lib/api/tourIndex";

vi.mock("../../../../lib/api/rail", () => ({ railApi: { get: vi.fn() } }));
vi.mock("../../../../lib/api/bus", () => ({ busApi: { get: vi.fn() } }));
vi.mock("../../../../lib/api/ferry", () => ({ ferryApi: { get: vi.fn() } }));
vi.mock("../../../../lib/api/rental", () => ({ rentalApi: { get: vi.fn() } }));
vi.mock("../../../../lib/api/tourIndex", () => ({ tourIndexApi: { list: vi.fn() } }));

const item = (over: Partial<ActivityFeedItem>): ActivityFeedItem => ({
  key: "flight:f1",
  domain: "flight",
  id: "f1",
  subjectId: "f1",
  title: "MUC → VIE",
  subtitle: null,
  place: null,
  date: null,
  sortAt: null,
  planned: false,
  point: null,
  bbox: [11.78, 48.11, 16.57, 48.35],
  path: "/flights/f1",
  ...over,
});

function deps(over: Partial<FeedSelectDeps> = {}): FeedSelectDeps {
  return {
    findFlight: vi.fn((id: string) => (id === "f1" ? ({ id: "f1" } as never) : undefined)),
    cruises: [{ id: "c1" } as never],
    lodgings: [{ id: "l1" } as never],
    places: [{ id: "p1" } as never],
    selectFlight: vi.fn(),
    selectCruise: vi.fn(),
    selectLodging: vi.fn(),
    selectPlace: vi.fn(),
    selectLayerCard: vi.fn(),
    isDomainOnMap: () => true,
    showDomain: vi.fn(),
    focus: vi.fn(),
    colorOf: () => "#336699",
    leftInset: 320,
    isCurrent: () => true,
    ...over,
  };
}

describe("selectFeedItem", () => {
  beforeEach(() => vi.clearAllMocks());

  it("selects a flight and fits the camera to the route's bounds", async () => {
    const d = deps();
    await expect(selectFeedItem(item({}), d)).resolves.toBe("selected");
    expect(d.selectFlight).toHaveBeenCalledWith([{ id: "f1" }]);
    expect(d.focus).toHaveBeenCalledWith({
      point: null,
      bbox: [11.78, 48.11, 16.57, 48.35],
      leftInset: 320,
    });
  });

  it("selects a stay's HOTEL (not the stay) and zooms to the point", async () => {
    const d = deps();
    const row = item({
      key: "lodging:s9",
      domain: "lodging",
      id: "s9",
      subjectId: "l1",
      point: { lat: 38.7, lon: -9.1 },
      bbox: null,
    });
    await selectFeedItem(row, d);
    expect(d.selectLodging).toHaveBeenCalledWith({ id: "l1" });
    expect(d.focus).toHaveBeenCalledWith({
      point: { lat: 38.7, lon: -9.1 },
      bbox: null,
      leftInset: 320,
    });
  });

  it("selects a visit's PLACE and a cruise by their own stores", async () => {
    const d = deps();
    await selectFeedItem(
      item({ domain: "poi", id: "v1", subjectId: "p1", point: { lat: 1, lon: 1 }, bbox: null }),
      d
    );
    expect(d.selectPlace).toHaveBeenCalledWith({ id: "p1" });
    await selectFeedItem(item({ domain: "cruise", id: "c1", subjectId: "c1" }), d);
    expect(d.selectCruise).toHaveBeenCalledWith({ id: "c1" });
  });

  // The entry's layer is not on the map when its domain is unticked in the
  // map's domain filter: the click switches it on and reports that.
  it("switches an unticked domain ON for the selection and says so", async () => {
    const d = deps({ isDomainOnMap: () => false });
    await expect(selectFeedItem(item({}), d)).resolves.toBe("switchedOn");
    expect(d.showDomain).toHaveBeenCalledWith("flight");
    expect(d.selectFlight).toHaveBeenCalled();
  });

  it("does not touch the filter of a domain that is already on the map", async () => {
    const d = deps();
    await selectFeedItem(item({}), d);
    expect(d.showDomain).not.toHaveBeenCalled();
  });

  it("opens a rail ride's card through the layer-card store and fits its bounds", async () => {
    vi.mocked(railApi.get).mockResolvedValue({
      id: "r1",
      status: "completed",
      transitMode: "rail",
      depStationName: "Zürich HB",
      arrStationName: "Bern",
      depLat: 47.37,
      depLon: 8.54,
      arrLat: 46.95,
      arrLon: 7.44,
      departureTime: "2026-03-01T08:00:00Z",
      trainCategory: "IC",
      trainNumber: "1",
    } as never);
    const d = deps();
    const row = item({
      key: "rail:r1",
      domain: "rail",
      id: "r1",
      subjectId: "r1",
      bbox: [7.44, 46.95, 8.54, 47.37],
    });
    await selectFeedItem(row, d);
    expect(railApi.get).toHaveBeenCalledWith("r1");
    const pinned = vi.mocked(d.selectLayerCard).mock.calls[0][0];
    expect(pinned.kind).toBe("journeyRoute");
    expect(d.focus).toHaveBeenCalledWith({
      point: null,
      bbox: [7.44, 46.95, 8.54, 47.37],
      leftInset: 320,
    });
  });

  it("opens a tour's card from the tour list", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([
      {
        id: "t1",
        name: "Brocken",
        kind: "tour",
        mode: "foot",
        tripName: null,
        distanceKm: 12,
        ascentM: null,
        stopCount: 2,
        startDate: "2026-01-01",
        endDate: null,
        date: null,
      } as never,
    ]);
    const d = deps();
    await selectFeedItem(
      item({
        key: "tour:t1",
        domain: "tour",
        id: "t1",
        subjectId: "t1",
        point: { lat: 51, lon: 10 },
        bbox: null,
      }),
      d
    );
    expect(vi.mocked(d.selectLayerCard).mock.calls[0][0].kind).toBe("tour");
  });

  it("opens nothing and says so when the entry is not among the loaded rows", async () => {
    const d = deps({ findFlight: () => undefined });
    await expect(selectFeedItem(item({}), d)).resolves.toBe("notLoaded");
    expect(d.focus).not.toHaveBeenCalled();
    expect(d.selectFlight).not.toHaveBeenCalled();
  });

  it("does not fly anywhere for an entry without coordinates", async () => {
    const d = deps();
    await expect(selectFeedItem(item({ point: null, bbox: null }), d)).resolves.toBe("unplaced");
    expect(d.focus).not.toHaveBeenCalled();
    expect(d.selectFlight).not.toHaveBeenCalled();
    expect(d.showDomain).not.toHaveBeenCalled();
  });

  it("drops a slow ground fetch that a newer click has replaced", async () => {
    vi.mocked(railApi.get).mockResolvedValue({
      id: "r1",
      status: "completed",
      transitMode: "rail",
      depStationName: "A",
      arrStationName: "B",
      depLat: 1,
      depLon: 1,
      arrLat: 2,
      arrLon: 2,
      departureTime: "2026-03-01T08:00:00Z",
    } as never);
    const d = deps({ isCurrent: () => false });
    await expect(
      selectFeedItem(item({ domain: "rail", id: "r1", subjectId: "r1" }), d)
    ).resolves.toBe("superseded");
    expect(d.selectLayerCard).not.toHaveBeenCalled();
    expect(d.focus).not.toHaveBeenCalled();
  });

  it("rejects when the entry behind a ground row cannot be fetched, so the failure is shown", async () => {
    vi.mocked(railApi.get).mockRejectedValue(new Error("503"));
    const d = deps();
    await expect(
      selectFeedItem(item({ domain: "rail", id: "r1", subjectId: "r1" }), d)
    ).rejects.toThrow("503");
    expect(d.selectLayerCard).not.toHaveBeenCalled();
    expect(d.focus).not.toHaveBeenCalled();
  });
});
