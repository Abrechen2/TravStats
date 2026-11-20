import type { CatalogStore } from "../marketVisits/catalog";

jest.mock("../../openData/http", () => ({
  ...jest.requireActual("../../openData/http"),
  isOpenDataEnabled: jest.fn(),
}));
jest.mock("../../instanceTuning", () => ({ instanceTuning: () => ({ marketOverpassUrl: null }) }));
jest.mock("../marketVisits/catalogStore", () => ({ marketCatalogStore: {} }));

import { isOpenDataEnabled } from "../../openData/http";
import { clearVenueCaches, fetchVenueEvidence, venueQuery } from "./venueAreas";

const point = { lat: 52.52, lon: 13.405 };
const d = 0.0001;
const building = {
  type: "way",
  id: 1001,
  tags: { name: "McDonald's", building: "yes", amenity: "fast_food", "brand:wikidata": "Q38076" },
  geometry: [
    { lat: point.lat - d, lon: point.lon - d },
    { lat: point.lat - d, lon: point.lon + d },
    { lat: point.lat + d, lon: point.lon + d },
    { lat: point.lat + d, lon: point.lon - d },
    { lat: point.lat - d, lon: point.lon - d },
  ],
};
const ok = (elements: object[]) =>
  new Response(JSON.stringify({ elements }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function fakeStore(claim: Date | null = new Date()): jest.Mocked<CatalogStore> {
  return {
    read: jest.fn(),
    write: jest.fn(),
    claim: jest.fn().mockResolvedValue(claim),
    complete: jest.fn().mockResolvedValue(undefined),
  };
}

describe("fetchVenueEvidence", () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    clearVenueCaches();
    (isOpenDataEnabled as jest.Mock).mockResolvedValue(true);
    fetchMock = jest.spyOn(global, "fetch");
  });
  afterEach(() => fetchMock.mockRestore());

  it("asks Overpass once and answers the second card from the point cache", async () => {
    fetchMock.mockResolvedValue(ok([building]));
    const store = fakeStore();
    const first = await fetchVenueEvidence(point, [], store);
    const second = await fetchVenueEvidence(point, [], store);
    expect(first.state).toBe("ok");
    expect(first.elements.map((e) => e.ref)).toEqual(["way/1001"]);
    expect(second.elements.map((e) => e.ref)).toEqual(["way/1001"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenCalledWith(expect.any(Date), expect.any(Number), 0);
  });

  it("an Overpass outage is a visible state and is never cached as 'no venues'", async () => {
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 504 }));
    const store = fakeStore();
    const down = await fetchVenueEvidence(point, [], store);
    expect(down).toEqual({ state: "timeout", elements: [] });
    expect(store.complete).toHaveBeenCalledWith(expect.any(Date), 0, expect.any(Number));
    fetchMock.mockResolvedValueOnce(ok([building]));
    const back = await fetchVenueEvidence(point, [], store);
    expect(back.state).toBe("ok");
    expect(back.elements).toHaveLength(1);
  });

  it("maps 429 to rateLimited and an Overpass 'remark' answer to unavailable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    expect((await fetchVenueEvidence(point, [], fakeStore())).state).toBe("rateLimited");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ elements: [], remark: "runtime error: Query timed out" }))
    );
    expect((await fetchVenueEvidence(point, [], fakeStore())).state).toBe("unavailable");
  });

  it("makes no call when open data is off or the shared budget is spent", async () => {
    (isOpenDataEnabled as jest.Mock).mockResolvedValueOnce(false);
    expect((await fetchVenueEvidence(point, [], fakeStore())).state).toBe("off");
    expect((await fetchVenueEvidence(point, [], fakeStore(null))).state).toBe("budget");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an outline that cannot be built is skipped and the state says partial", async () => {
    const broken = {
      type: "relation",
      id: 77,
      tags: { name: "Halle", building: "yes" },
      members: [],
    };
    fetchMock.mockResolvedValue(ok([building, broken]));
    const result = await fetchVenueEvidence(point, [], fakeStore());
    expect(result.state).toBe("partial");
    expect(result.elements.map((e) => e.ref)).toContain("way/1001");
  });

  it("queries containment by pivot and candidates by id", () => {
    const q = venueQuery([point], ["node/5", "way/9"]);
    expect(q).toContain("is_in(52.52,13.405)->.a0;");
    expect(q).toContain("way(pivot.all)");
    expect(q).toContain("node(id:5);");
    expect(q).toContain("way(id:9);");
  });
});
