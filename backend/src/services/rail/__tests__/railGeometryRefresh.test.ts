import { readStoredLine, refetchJourneyGeometry, type StoredJourneyLine } from "../railGeometry";
import { railRoutingBaseUrl, routeRailLine } from "../openRailRouting";
import { fetchTransitousLine } from "../lookup/transitous";
import { railProviderSwitches } from "../lookup";

jest.mock("../openRailRouting", () => ({
  railRoutingBaseUrl: jest.fn(),
  routeRailLine: jest.fn(),
}));
jest.mock("../lookup", () => ({ railProviderSwitches: jest.fn() }));
jest.mock("../lookup/transitous", () => ({ fetchTransitousLine: jest.fn() }));
const oldLine: [number, number][] = [
  [8, 50],
  [8.005, 50.005],
  [8.01, 50],
];
const newLine: [number, number][] = [
  [8, 50],
  [8.005, 50.001],
  [8.01, 50],
];
const stored: StoredJourneyLine = {
  depLat: 50,
  depLon: 8,
  arrLat: 50,
  arrLon: 8.01,
  lookupProvider: null,
  lookupRef: null,
  geometry: oldLine,
  geometrySource: "openrailrouting",
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(railRoutingBaseUrl).mockResolvedValue("https://routing.test");
  jest.mocked(routeRailLine).mockResolvedValue({ ok: true, line: newLine });
  jest.mocked(railProviderSwitches).mockResolvedValue({ transitous: true, dbRest: true });
});
it("replaces an automatic line of equal quality on explicit refresh", async () => {
  expect(await refetchJourneyGeometry(stored)).toMatchObject({
    kind: "refetched",
    geo: { geometry: newLine, geometrySource: "openrailrouting" },
  });
  expect(routeRailLine).toHaveBeenCalledWith(
    "https://routing.test",
    [
      [8, 50],
      [8.01, 50],
    ],
    { refresh: true }
  );
});
it("keeps the previous line when the provider fails", async () => {
  jest.mocked(routeRailLine).mockResolvedValue({ ok: false, reason: "unavailable" });
  expect(await refetchJourneyGeometry(stored)).toMatchObject({
    kind: "kept",
    line: oldLine,
    fallback: "railRoutingUnavailable",
  });
});
it("keeps manual geometry without a provider request", async () => {
  expect(await refetchJourneyGeometry({ ...stored, geometrySource: "manual" })).toMatchObject({
    kind: "kept",
    line: oldLine,
  });
  expect(routeRailLine).not.toHaveBeenCalled();
});
it("refreshes the timetable trace too", async () => {
  jest.mocked(fetchTransitousLine).mockResolvedValue(newLine);
  expect(
    await refetchJourneyGeometry({
      ...stored,
      lookupProvider: "transitous",
      lookupRef: "trip-1",
      geometrySource: "transitous",
    })
  ).toMatchObject({ kind: "refetched", geo: { geometrySource: "transitous" } });
  expect(fetchTransitousLine).toHaveBeenCalledWith("trip-1", true);
});
it("never downgrades a timetable trace after refresh failure", async () => {
  jest.mocked(fetchTransitousLine).mockResolvedValue(null);
  expect(
    await refetchJourneyGeometry({
      ...stored,
      lookupProvider: "transitous",
      lookupRef: "trip-1",
      geometrySource: "transitous",
    })
  ).toMatchObject({ kind: "kept", line: oldLine });
});
it.each([NaN, Infinity, 181])("refuses stored invalid longitude %s", (value) => {
  expect(
    readStoredLine([
      [8, 50],
      [value, 50],
    ])
  ).toBeNull();
});
