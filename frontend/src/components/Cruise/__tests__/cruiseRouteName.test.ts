import { describe, it, expect } from "vitest";

import { suggestCruiseRouteName } from "../cruiseRouteName";
import type { CruiseStopInput } from "../../../types";

const call = (name: string): CruiseStopInput => ({
  portId: 1,
  port: { name } as CruiseStopInput["port"],
  dayNumber: 1,
  isAtSea: false,
});
const seaDay: CruiseStopInput = { portId: null, dayNumber: 2, isAtSea: true };
const port = (name: string) => ({ name });

describe("suggestCruiseRouteName", () => {
  it("names the ports in order, skipping sea days and back-to-back repeats", () => {
    expect(
      suggestCruiseRouteName(port("Kiel"), [call("Kiel"), seaDay, call("Oslo")], port("Kiel"))
    ).toBe("Kiel → Oslo → Kiel");
  });

  it("keeps the name an unresolved import stop came with", () => {
    const unresolved: CruiseStopInput = {
      portId: null,
      dayNumber: 2,
      isAtSea: false,
      unresolvedPortName: "Flåm",
    };
    expect(suggestCruiseRouteName(port("Kiel"), [unresolved], null)).toBe("Kiel → Flåm");
  });

  it("collapses the middle of a long itinerary", () => {
    const stops = ["Kiel", "Oslo", "Bergen", "Flåm", "Geiranger"].map(call);
    expect(suggestCruiseRouteName(null, stops, port("Kiel"))).toBe("Kiel → Oslo → … → Kiel");
  });

  it("abstains when fewer than two ports remain", () => {
    expect(suggestCruiseRouteName(null, [], null)).toBe("");
    expect(suggestCruiseRouteName(port("Kiel"), [call("Kiel"), seaDay], port("Kiel"))).toBe("");
  });
});
