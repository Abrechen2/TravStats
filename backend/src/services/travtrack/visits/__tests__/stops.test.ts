import type { Stop } from "../../legs";
import { STOP_MS } from "../../dayMovement";
import { visitEvidence, visitStopsOf, stopTimes } from "../stops";
import type { VisitPick } from "../resolve";

const HOUR = 3_600_000;
const window = { fromMs: 0, untilMs: 24 * HOUR };
const stop = (over: Partial<Stop> = {}): Stop => ({
  fromMs: 10 * HOUR,
  untilMs: 10 * HOUR + 25 * 60_000,
  anchor: { lat: 37.5, lon: 127 },
  stayRef: null,
  place: null,
  folded: null,
  ...over,
});
const pick: VisitPick = {
  source: "osm",
  name: "McDonald's",
  lat: 37.5001,
  lon: 127.0001,
  placeId: null,
  osmRef: "way/1",
  type: "fast_food",
  category: "restaurant",
  isArea: true,
  resolved: "contains",
  distanceM: 14,
  alternatives: [
    { name: "McCafé", osmRef: "node/2", type: "cafe", distanceM: 9, foldedInto: "McDonald's" },
  ],
};

describe("visitStopsOf", () => {
  it("keeps a plain stop and drops what is already answered for", () => {
    const plain = stop();
    const kept = visitStopsOf(
      [
        plain,
        stop({ dismissed: true }),
        stop({ place: { name: "Home", lat: 1, lon: 1, source: "fixed" } }),
        stop({ folded: { fixCount: 3 } }),
        stop({ fromMs: 30 * HOUR, untilMs: 31 * HOUR }),
      ],
      window
    );
    expect(kept).toEqual([plain]);
  });

  it("a stop a stay finding points at stays a candidate: the run matches it to the finding, not the stop list", () => {
    const pointed = stop({ stayRef: { id: "s1", status: "rejected" } });
    expect(visitStopsOf([pointed], window)).toEqual([pointed]);
  });

  it("a stop that began the day before and ends in this window is still the window's", () => {
    const across = stop({ fromMs: -2 * HOUR, untilMs: 1 * HOUR });
    expect(visitStopsOf([across], window)).toEqual([across]);
  });
});

describe("stopTimes", () => {
  it("splits a stop across a silence into observed and assumed time that add up", () => {
    const s = stop({
      coverage: {
        observedMs: 10 * 60_000,
        inferredMs: 15 * 60_000,
        gaps: [{ fromMs: 1, untilMs: 2 }],
      },
    });
    const t = stopTimes(s);
    expect(t.inferredMs).toBe(15 * 60_000);
    expect(t.observedMs + t.inferredMs).toBe(t.durationMs);
  });

  it("a stop with no coverage note is wholly observed", () => {
    expect(stopTimes(stop()).inferredMs).toBe(0);
  });
});

describe("visitEvidence", () => {
  it("names the window, observed vs assumed time, the venue, its alternative, and the unchanged minimum stop", () => {
    const e = visitEvidence(
      stop({
        coverage: {
          observedMs: 20 * 60_000,
          inferredMs: 5 * 60_000,
          gaps: [{ fromMs: 1, untilMs: 2 }],
        },
      }),
      pick,
      { geocoder: "ok", venues: "ok" },
      "complete"
    );
    expect(e.visit.durationMs).toBe(25 * 60_000);
    expect(e.visit.observedMs).toBe(20 * 60_000);
    expect(e.visit.inferredMs).toBe(5 * 60_000);
    expect(e.visit.minimumStopMs).toBe(STOP_MS);
    expect(e.visit.venue).toMatchObject({
      name: "McDonald's",
      osmRef: "way/1",
      resolved: "contains",
    });
    expect(e.visit.alternatives[0]).toMatchObject({ name: "McCafé", foldedInto: "McDonald's" });
    expect(e.uncertainties).toEqual(["stopInferred"]);
    expect(e.explanation).toEqual({
      code: "stay.stop",
      params: { minutes: 25, observedMinutes: 20, inferredMinutes: 5, radiusM: 50, distanceM: 14 },
    });
  });
});
