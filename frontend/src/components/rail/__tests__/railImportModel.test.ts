import { describe, expect, it } from "vitest";

import {
  emptyParseMessageKey,
  isRowReady,
  rowsFrom,
  toImportInput,
  totalGoesTo,
  wallClockLabel,
} from "../railImportModel";
import { booking, leg, station } from "./railImportFixture";

describe("railImportModel", () => {
  it("ticks every leg except one already in the logbook", () => {
    const rows = rowsFrom(booking({ legs: [leg(), leg({ duplicateOf: "j-old" })] }));
    expect(rows.map((r) => r.selected)).toEqual([true, false]);
  });

  it("holds a leg with an unresolved station back until it has a position", () => {
    const [row] = rowsFrom(
      booking({ legs: [leg({ arrivalStation: station("Neufahrn", false) })] })
    );
    expect(row.arrival).toMatchObject({ name: "Neufahrn", lat: null, stationId: null });
    expect(isRowReady(row)).toBe(false);
    expect(isRowReady({ ...row, arrival: { ...row.arrival, lat: 48.3, lon: 11.7 } })).toBe(true);
  });

  it("writes the total once, on the first ticked leg — never on every train", () => {
    const rows = rowsFrom(booking());
    const at = totalGoesTo(rows);
    expect(at).toBe(0);
    const inputs = rows.map((row, i) => toImportInput(booking(), row, i === at));
    expect(inputs.map((i) => i.price)).toEqual([1084.5, null]);
    expect(inputs[1]).toMatchObject({
      trainCategory: "ICE",
      trainNumber: "1507",
      coach: "7",
      seat: "45",
      travelClass: "first",
      bookingReference: "210987654321",
      notes: "Flexpreis",
      departureLocal: "2026-03-14T09:46",
      departureStation: { stationId: 2, name: "Hamburg Hbf" },
    });
  });

  it("does not write the total again when a leg of the booking is already logged", () => {
    expect(totalGoesTo(rowsFrom(booking({ legs: [leg({ duplicateOf: "j" }), leg()] })))).toBe(-1);
  });

  it("formats a wall clock from its string, and names each empty-parse reason", () => {
    expect(wallClockLabel("2025-06-07T09:38")).toBe("07.06.2025 09:38");
    expect(wallClockLabel(null)).toBe("—");
    expect(emptyParseMessageKey("noItinerary")).toBe("rail:import.empty.noItinerary");
    expect(emptyParseMessageKey("llmUnreachable")).toBe("rail:import.empty.llmUnreachable");
    expect(emptyParseMessageKey(undefined)).toBe("rail:import.empty.nothingFound");
  });
});
