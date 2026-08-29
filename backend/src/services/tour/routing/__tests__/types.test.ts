import { isRoutableMode, ROUTING_PROVIDER_IDS, PROFILE_BY_MODE } from "../types";
import { LEG_MODES } from "../../tourDistance";

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

describe("PROFILE_BY_MODE", () => {
  it("has a profile for every routable mode and none for the rest", () => {
    for (const mode of LEG_MODES) {
      expect(mode in PROFILE_BY_MODE).toBe(isRoutableMode(mode));
    }
  });
});
