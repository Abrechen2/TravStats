import { isRoutableMode, ROUTING_PROVIDER_IDS, RoutableMode } from "../types";
import { LEG_MODES } from "../../tourDistance";
import { ORS_PROFILE_BY_MODE } from "../openRouteService";
import { GRAPHHOPPER_PROFILE_BY_MODE } from "../graphHopper";
import { OSRM_PROFILE_BY_MODE } from "../customOsrm";

describe("isRoutableMode", () => {
  it("routes the three modes a road router understands", () => {
    expect(isRoutableMode("road")).toBe(true);
    expect(isRoutableMode("foot")).toBe(true);
    expect(isRoutableMode("bike")).toBe(true);
  });

  it("never routes a ferry or a train", () => {
    // A ferry crosses water no road router knows, and a train follows track
    // the traveller does not choose. Asking a road router for either returns
    // a plausible road detour — a wrong number that looks right.
    expect(isRoutableMode("ferry")).toBe(false);
    expect(isRoutableMode("rail")).toBe(false);
  });
});

describe("ROUTING_PROVIDER_IDS", () => {
  it("lists exactly the three shipped providers", () => {
    expect([...ROUTING_PROVIDER_IDS]).toEqual(["openrouteservice", "graphhopper", "custom"]);
  });
});

/**
 * There is deliberately no shared `PROFILE_BY_MODE` any more — ORS,
 * GraphHopper and a self-hosted OSRM each speak their own profile
 * vocabulary (see the per-adapter maps and their doc comments). What still
 * has to hold, and is worth pinning here rather than only inside each
 * adapter's own test file, is the coverage property the old shared map
 * used to guarantee for free: every adapter answers for exactly the
 * routable modes, and none of the others.
 */
describe("per-adapter profile maps", () => {
  const adapterMaps: Array<[string, Record<RoutableMode, string>]> = [
    ["openRouteService", ORS_PROFILE_BY_MODE],
    ["graphHopper", GRAPHHOPPER_PROFILE_BY_MODE],
    ["customOsrm", OSRM_PROFILE_BY_MODE],
  ];

  it.each(adapterMaps)("%s has an entry for every routable mode and none for the rest", (_name, map) => {
    for (const mode of LEG_MODES) {
      expect(mode in map).toBe(isRoutableMode(mode));
    }
  });
});
