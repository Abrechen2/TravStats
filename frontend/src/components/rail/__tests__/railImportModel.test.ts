import { describe, expect, it } from "vitest";

import {
  emptyParseMessageKey,
  isPlausibleStation,
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

  it("words a document that is another booking, and a model that read airport codes", () => {
    expect(emptyParseMessageKey("otherDomain")).toBe("rail:import.empty.otherDomain");
    expect(emptyParseMessageKey("looksLikeFlight")).toBe("rail:import.empty.looksLikeFlight");
  });
});

// Acceptance D1: the review offered "Mücka" for "MUC" and "Frant" for "FRA".
describe("isPlausibleStation — the minimum similarity of a suggestion", () => {
  it("never reads an airport code or a three-letter stub as a station", () => {
    expect(isPlausibleStation("MUC", "Mücka")).toBe(false);
    expect(isPlausibleStation("FRA", "Frant")).toBe(false);
    expect(isPlausibleStation("Muc", "Mücka")).toBe(false);
  });

  it("accepts the same name, a transliteration and real abbreviations", () => {
    expect(isPlausibleStation("Muenchen Hbf", "München Hbf")).toBe(true);
    expect(isPlausibleStation("Frankfurt(M) Flugh.", "Frankfurt (Main) Flughafen Fernbf")).toBe(
      true
    );
  });

  it("refuses a station that shares only a word start with the printed name", () => {
    expect(isPlausibleStation("Neufahrn", "Neu Ulm")).toBe(false);
    expect(isPlausibleStation("Hamburg Hbf", "Hamburg-Harburg")).toBe(false);
  });
});
