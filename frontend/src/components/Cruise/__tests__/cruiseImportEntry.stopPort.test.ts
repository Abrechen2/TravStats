import { describe, it, expect } from "vitest";
import { stopPortOf } from "../cruiseImportEntry";
import type { CruiseStopInput, Port } from "../../../types";

const port = (id: number, name: string): Port => ({ id, name }) as Port;

/** Two calls on one day: the by-day map carries only one of them. */
describe("stopPortOf", () => {
  const bergen = port(11, "Bergen");
  const flaam = port(12, "Flåm");
  const entry = { stopPorts: { 4: flaam }, stopPortsById: { 11: bergen, 12: flaam } };

  it("shows each matched call its own port", () => {
    const stop: CruiseStopInput = { dayNumber: 4, isAtSea: false, portId: 11 };
    expect(stopPortOf(entry, stop)).toBe(bergen);
  });

  it("lends no port to an unresolved call on the same day", () => {
    const stop: CruiseStopInput = {
      dayNumber: 4,
      isAtSea: false,
      portId: null,
      unresolvedPortName: "Atlantis",
    };
    expect(stopPortOf(entry, stop)).toBeNull();
  });

  it("never shows a by-day port whose id is another stop's (older backend)", () => {
    const stop: CruiseStopInput = { dayNumber: 4, isAtSea: false, portId: 11 };
    expect(stopPortOf({ stopPorts: { 4: flaam } }, stop)).toBeNull();
  });
});
