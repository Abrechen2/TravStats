// The "Hohler Ring: nur geplant" key shows on the single-domain tabs' legends
// exactly when that domain draws a planned-only marker.
import { describe, expect, it } from "vitest";
import { legendRow } from "../allTabLegendRows";
import { buildRailLegendRows } from "../railMapOverlay";
import { buildRentalLegendRows } from "../rentalMapOverlay";
import { buildTerminalRideLegendRows } from "../terminalRideMapOverlay";
import { makeRailJourney } from "../../../rail/__tests__/railJourneyFixture";
import type { RentalMapSource } from "../../../layers/rentalLayer";

const t = (key: string) => key;
const keysOf = (rows: JSX.Element[]) => rows.map((r) => String(r.key));

describe("planned-marker legend row", () => {
  it("rail: only while a station is planned-only", () => {
    const planned = buildRailLegendRows(
      [makeRailJourney({ status: "scheduled" })],
      "#fff",
      t,
      legendRow
    );
    const done = buildRailLegendRows(
      [makeRailJourney({ status: "completed" })],
      "#fff",
      t,
      legendRow
    );
    expect(keysOf(planned)).toContain("planned-marker");
    expect(keysOf(done)).not.toContain("planned-marker");
  });
  it("bus and ferry terminals: only while a terminal is planned-only", () => {
    const ride = (status: string) => [
      { id: "r", status, depLat: 1, depLon: 1, arrLat: 2, arrLon: 2, geometry: null },
    ];
    const keys = { only: "o", drawn: "d", straight: "s", drawnRow: "dr", straightRow: "sr" };
    expect(
      keysOf(buildTerminalRideLegendRows(ride("scheduled"), "#fff", t, legendRow, keys))
    ).toContain("planned-marker");
    expect(
      keysOf(buildTerminalRideLegendRows(ride("completed"), "#fff", t, legendRow, keys))
    ).not.toContain("planned-marker");
  });
  it("rental: only while a booked rental is drawn", () => {
    const rental = (status: string): RentalMapSource => ({
      id: "r1",
      provider: "P",
      pickupStationName: "A",
      returnStationName: "A",
      pickupLat: 50,
      pickupLon: 8,
      returnLat: 50,
      returnLon: 8,
      oneWay: false,
      routeId: null,
      status: status as RentalMapSource["status"],
    });
    expect(keysOf(buildRentalLegendRows([rental("scheduled")], "#ffffff", t, legendRow))).toContain(
      "planned-marker"
    );
    expect(
      keysOf(buildRentalLegendRows([rental("cancelled")], "#ffffff", t, legendRow))
    ).not.toContain("planned-marker");
  });
});
