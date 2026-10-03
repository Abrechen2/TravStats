import { describe, expect, it } from "vitest";
import { makeRailJourney } from "../../../components/rail/__tests__/railJourneyFixture";
import {
  connectionDurationMinutes,
  connectionSpan,
  connectionStations,
  connectionStatus,
  connectionTrains,
  transferMinutes,
} from "../railConnection";

/** forgejo#187 — what a grouped logbook entry reads off its legs. */
const first = makeRailJourney();
const second = makeRailJourney({
  id: "j2",
  depStationName: "Fulda",
  arrStationName: "Berlin Hbf",
  departureTime: "2026-09-26T05:25:00.000Z",
  arrivalTime: "2026-09-26T08:05:00.000Z",
  trainCategory: null,
  trainNumber: null,
});

describe("railConnection", () => {
  it("names start, every change and destination in travel order", () => {
    expect(connectionStations([first, second])).toEqual(["Frankfurt", "Fulda", "Berlin Hbf"]);
    expect(connectionStations([first])).toEqual(["Frankfurt", "Fulda"]);
    expect(connectionStations([])).toEqual([]);
  });

  it("lists only the trains a leg names", () => {
    expect(connectionTrains([first, second])).toEqual(["ICE 696"]);
  });

  it("spans the first departure to the last arrival", () => {
    const span = connectionSpan([first, second]);
    expect(span?.departureTime).toBe(first.departureTime);
    expect(span?.arrivalTime).toBe(second.arrivalTime);
    expect(connectionSpan([])).toBeNull();
  });

  it("measures the whole time on the way, waits included", () => {
    expect(connectionDurationMinutes([first, second])).toBe(230);
  });

  it("measures nothing when the last arrival is unknown", () => {
    expect(connectionDurationMinutes([first, { ...second, arrivalTime: null }])).toBeNull();
  });

  it("measures the wait between two legs, or abstains", () => {
    expect(transferMinutes(first, second)).toBe(15);
    expect(transferMinutes({ ...first, arrivalTime: null }, second)).toBeNull();
  });

  it("states a status only when every leg agrees", () => {
    expect(connectionStatus([first, second])).toBe("completed");
    expect(connectionStatus([first, { ...second, status: "cancelled" }])).toBeNull();
    expect(connectionStatus([])).toBeNull();
  });
});
