import { describe, it, expect } from "@jest/globals";

import { cruiseDays } from "../dayPattern";
import { eventsOfCruise } from "../events";
import { excursionsOf, linkTours, type ExcursionTour } from "../excursions";
import {
  cruisesPerPort,
  foldNewAndRevisited,
  longestPortReunion,
  repeatedItineraries,
} from "../ports";
import { foldPortStays, stayExtremes } from "../portStays";
import { call, cruise } from "./fixtures";

const NORWAY_2019 = cruise("a", "2019-06-01", "2019-06-05", "HAM", "HAM", [
  call(2, "OSL", "2019-06-02", { arrive: "2019-06-02T08:00", leave: "2019-06-02T17:30" }),
  call(3, null, "2019-06-03"),
  call(4, "BGO", "2019-06-04", { arrive: "2019-06-04T07:00", leave: "2019-06-04T09:00" }),
]);
const NORWAY_2024 = cruise("b", "2024-06-01", "2024-06-05", "HAM", "HAM", [
  call(2, "OSL", "2024-06-02", { arrive: "2024-06-02T08:00", note: "Holmenkollen" }),
  call(3, null, "2024-06-03"),
  call(4, "BGO", "2024-06-04", { arrive: "2024-06-04", leave: "2024-06-04", precision: "day" }),
]);
const BALTIC_2024 = cruise("c", "2024-08-01", "2024-08-03", "HAM", "CPH", [
  call(2, null, "2024-08-02", { unresolved: "Skagen Reede" }),
]);

describe("new ports and ports seen again (forgejo#257)", () => {
  it("judges 'new' against every sailed cruise, oldest start first", () => {
    const folds = foldNewAndRevisited([BALTIC_2024, NORWAY_2024, NORWAY_2019]);
    expect(
      folds.map((f) => [f.cruiseId, f.newPorts.map((p) => p.name), f.revisitedPorts.length])
    ).toEqual([
      ["a", ["Hamburg", "Oslo", "Bergen"], 0],
      ["b", [], 3],
      ["c", ["Kopenhagen"], 1],
    ]);
  });

  it("finds the longest pause before a port was seen again", () => {
    // Hamburg is left on 5 June 2019 and boarded on 1 June 2024; Oslo waited
    // from 2 June to 2 June — four days longer.
    expect(longestPortReunion([NORWAY_2019, NORWAY_2024])).toMatchObject({
      portName: "Oslo",
      fromCruiseId: "a",
      toCruiseId: "b",
      fromDay: "2019-06-02",
      toDay: "2024-06-02",
      days: 1827,
    });
  });

  it("puts an undated cruise in no order, but still counts the cruises a port was on", () => {
    const undated = cruise("u", null, null, "HAM", "HAM", []);
    expect(foldNewAndRevisited([undated, NORWAY_2019]).map((f) => f.cruiseId)).toEqual(["a"]);
    expect(cruisesPerPort([undated, NORWAY_2019, NORWAY_2024])[0]).toMatchObject({
      portName: "Hamburg",
      cruiseIds: ["u", "a", "b"],
    });
  });

  it("sees an identical port sequence, and never one with an unresolved call", () => {
    const groups = repeatedItineraries([NORWAY_2019, NORWAY_2024, BALTIC_2024]);
    expect(groups).toHaveLength(1);
    expect(groups[0].ports.map((p) => p.name)).toEqual(["Hamburg", "Oslo", "Bergen", "Hamburg"]);
    expect(groups[0].cruiseIds).toEqual(["a", "b"]);
    expect(repeatedItineraries([BALTIC_2024, BALTIC_2024], 1)).toEqual([]);
  });
});

describe("time in port (forgejo#257)", () => {
  it("measures only calls with both times to the minute, and says why the rest are out", () => {
    const fold = foldPortStays([NORWAY_2019, NORWAY_2024, BALTIC_2024]);
    expect(fold.stays.map((s) => s.minutes).sort((x, y) => x - y)).toEqual([120, 570]);
    // Oslo 2024 has no departure, Bergen 2024 only days, Skagen no times at all.
    expect(fold).toMatchObject({ calls: 5, missingTime: 3, inconsistent: 0 });
    expect(stayExtremes(fold.stays).longest).toMatchObject({ portName: "Oslo", minutes: 570 });
  });

  it("refuses a departure before the arrival", () => {
    const odd = cruise("x", "2024-01-01", "2024-01-02", null, null, [
      call(1, "OSL", "2024-01-01", { arrive: "2024-01-01T18:00", leave: "2024-01-01T08:00" }),
    ]);
    expect(foldPortStays([odd])).toMatchObject({ stays: [], inconsistent: 1 });
  });

  it("refuses a departure AT the arrival too — a stay of zero minutes is no stay", () => {
    const still = cruise("z", "2024-01-01", "2024-01-02", null, null, [
      call(1, "OSL", "2024-01-01", { arrive: "2024-01-01T08:00", leave: "2024-01-01T08:00" }),
    ]);
    expect(foldPortStays([still])).toMatchObject({ stays: [], inconsistent: 1 });
  });
});

describe("sea days and port days (forgejo#257)", () => {
  it("counts listed days and leaves unlisted ones out instead of guessing", () => {
    expect(cruiseDays(NORWAY_2019)).toMatchObject({
      seaDays: 1,
      portDays: 2,
      listedDays: 3,
      unlistedDays: 2,
      type: "balanced",
    });
    const crossing = cruise("t", "2024-04-01", "2024-04-08", "HAM", "HAM", [
      call(2, null, "2024-04-02"),
      call(3, null, "2024-04-03"),
      call(4, "OSL", "2024-04-04"),
    ]);
    expect(cruiseDays(crossing).type).toBe("seaHeavy");
    expect(cruiseDays(BALTIC_2024)).toMatchObject({ portDays: 1, type: null });
  });

  it("calls a river cruise's portless day a river day — no sea day, and not unlisted (#359)", () => {
    // The same itinerary on the Rhine: the rollup and the badges say a
    // river's day between ports is not a sea day (`isSeaDay`); the day
    // pattern asked `isAtSea` alone and made one up.
    const rhine = cruise("r", "2019-06-01", "2019-06-05", "HAM", "HAM", NORWAY_2019.calls);
    const river = { ...rhine, input: { ...rhine.input, kind: "river" } };
    expect(cruiseDays(river)).toMatchObject({
      seaDays: 0,
      portDays: 2,
      riverDays: 1,
      listedDays: 2,
      unlistedDays: 2,
      type: "portIntensive",
    });
  });
});

describe("shore excursions (forgejo#257)", () => {
  const hike: ExcursionTour = {
    id: "t1",
    name: "Fløyen",
    activity: "hike",
    day: "2019-06-04",
    start: { lat: 60.39, lon: 5.33 },
    recordedKm: 7.5,
    plannedKm: null,
    ascentM: 320,
  };

  it("links a tour on the call's day near the port, and nothing else", () => {
    const far = { ...hike, id: "t2", start: { lat: 48.1, lon: 11.5 } };
    const otherDay = { ...hike, id: "t3", day: "2019-06-03" };
    const linked = linkTours([NORWAY_2019], [hike, far, otherDay]);
    expect(linked.get("a")!.map((t) => t.id)).toEqual(["t1"]);
    const ex = excursionsOf(NORWAY_2019, linked.get("a")!);
    expect(ex).toMatchObject({
      documentedStopIds: [NORWAY_2019.calls[2].stopId],
      activities: { hike: 1 },
      recordedKm: 7.5,
      plannedKm: null,
      onFootRecordedKm: 7.5,
      onFootPlannedKm: null,
      ascentM: 320,
    });
  });

  it("never adds a planned route to a recorded one", () => {
    const planned: ExcursionTour = {
      ...hike,
      id: "t4",
      activity: "walk",
      start: { lat: 60.38, lon: 5.32 },
      recordedKm: null,
      plannedKm: 3,
      ascentM: null,
    };
    const linked = linkTours([NORWAY_2019], [hike, planned]).get("a")!;
    expect(excursionsOf(NORWAY_2019, linked)).toMatchObject({
      recordedKm: 7.5,
      plannedKm: 3,
      onFootRecordedKm: 7.5,
      onFootPlannedKm: 3,
    });
  });

  it("counts a note as documented and claims no distance it never measured", () => {
    const ex = excursionsOf(NORWAY_2024, []);
    expect(ex).toMatchObject({ notedCalls: 1, recordedKm: null, plannedKm: null, ascentM: null });
    expect(ex.documentedStopIds).toHaveLength(1);
  });

  it("says nothing about tours while the reader does not see them", () => {
    expect(excursionsOf(NORWAY_2019, null)).toMatchObject({
      tours: null,
      activities: null,
      recordedKm: null,
      plannedKm: null,
      documentedStopIds: [],
    });
  });
});

describe("special events per voyage (forgejo#257)", () => {
  it("names the cruise that crossed the equator, through the badges' own calculator", () => {
    const southbound = cruise("e", "2024-02-01", "2024-02-04", "SIN", "BAL", []);
    expect(eventsOfCruise(southbound, undefined)).toContain("equator");
    expect(eventsOfCruise(NORWAY_2019, undefined)).not.toContain("equator");
    const birthday = cruise("bd", "2024-03-01", "2024-03-05", "HAM", "HAM", []);
    expect(eventsOfCruise(birthday, { month: 3, day: 3 })).toContain("birthdayAtSea");
    expect(eventsOfCruise(birthday, undefined)).not.toContain("birthdayAtSea");
  });
});
