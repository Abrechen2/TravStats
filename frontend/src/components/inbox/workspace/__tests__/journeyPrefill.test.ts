import { afterEach, describe, expect, it } from "vitest";
import {
  busDraftFromRun,
  clearPendingLink,
  pendingLink,
  railDraftFromRun,
  savePendingLink,
} from "../journeyPrefill";
import { run } from "./journeyRun";

/**
 * A journey question opens the TravStats form with what TravTrack saw
 * (TravTrack plan E7): both ends and both times on each end's own clock.
 */

describe("journeyPrefill", () => {
  afterEach(() => localStorage.clear());

  it("opens the rail form with times and both ends", () => {
    const draft = railDraftFromRun(run);
    expect(draft.departure).toMatchObject({ lat: 50.1, lon: 8.66, name: "" });
    expect(draft.arrival).toMatchObject({ lat: 49.79, lon: 9.95, name: "" });
    // Each time on its own end's clock, as the form takes it.
    expect(draft.departureLocal).toBe("2026-10-20T06:32");
    expect(draft.arrivalLocal).toBe("2026-10-20T07:02");
    expect(draft.departureDayOnly).toBe(false);
    expect(draft.arrivalDayOnly).toBe(false);
  });

  it("opens the bus form the same way", () => {
    const draft = busDraftFromRun(run);
    expect(draft.departure).toMatchObject({ lat: 50.1, lon: 8.66 });
    expect(draft.arrival).toMatchObject({ lat: 49.79, lon: 9.95 });
    expect(draft.departureLocal).toBe("2026-10-20T06:32");
    expect(draft.arrivalLocal).toBe("2026-10-20T07:02");
  });

  it("remembers an entry saved whose link failed, per question and run", () => {
    expect(pendingLink("s1", 0)).toBeNull();
    savePendingLink("s1", 0, { entryKind: "rail", entryId: "r1" });
    expect(pendingLink("s1", 0)).toEqual({ entryKind: "rail", entryId: "r1" });
    expect(pendingLink("s1", 1)).toBeNull();
    clearPendingLink("s1", 0);
    expect(pendingLink("s1", 0)).toBeNull();
  });

  it("an unreadable store is no saved entry", () => {
    localStorage.setItem("travstats.journeyLink.s1.0", "{not json");
    expect(pendingLink("s1", 0)).toBeNull();
  });
});
