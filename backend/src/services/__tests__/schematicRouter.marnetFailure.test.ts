import { MASK_BYTES } from "../../shared/geo/landMaskGrid";
import { MASK1_BYTES } from "../../shared/geo/landMaskGridCoarse";

const mockLoggerError = jest.fn();
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: mockLoggerError, debug: jest.fn() },
}));
jest.mock("../marnet/marnetRouter", () => ({
  ...jest.requireActual("../marnet/marnetRouter"),
  routeMarnet: jest.fn(async () => {
    throw new Error("ENOENT marnet.geojson");
  }),
}));

import { computeSchematicRoute, setCoarseMaskForTesting } from "../schematicRouter";

// forgejo#385 (RULE-34): the bare `catch { return null }` hid a marnet that
// would not load — every leg quietly took the coarse fallback.
describe("a marnet that fails to load", () => {
  afterEach(() => setCoarseMaskForTesting(null));

  it("is logged once at error level and the route still falls back", async () => {
    setCoarseMaskForTesting(new Uint8Array(MASK1_BYTES), new Uint8Array(MASK_BYTES));
    const first = await computeSchematicRoute({ lat: 35.5, lon: 10.3 }, { lat: 45.7, lon: -15.2 });
    await computeSchematicRoute({ lat: 36, lon: 11 }, { lat: 46, lon: -14 });

    expect(first.waypoints.length).toBeGreaterThanOrEqual(2);
    const calls = mockLoggerError.mock.calls.filter(
      ([arg]) => arg?.message === "schematic_router_marnet_failed"
    );
    expect(calls).toHaveLength(1);
  });
});
