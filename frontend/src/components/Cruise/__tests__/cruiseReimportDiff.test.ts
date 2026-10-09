import { describe, it, expect } from "vitest";
import { diffItinerary, mergeItinerary } from "../cruiseReimportDiff";
import type { CruiseStopInput, Port } from "../../../types";

/** forgejo#225: a re-read booking against the stored itinerary. */

const port = (id: number, name: string): Port => ({ id, name }) as Port;
const call = (day: number, id: number, name: string, extra: Partial<CruiseStopInput> = {}) =>
  ({
    dayNumber: day,
    isAtSea: false,
    portId: id,
    port: port(id, name),
    ...extra,
  }) as CruiseStopInput;
const sea = (day: number): CruiseStopInput => ({ dayNumber: day, isAtSea: true, portId: null });

const stored: CruiseStopInput[] = [
  call(1, 1, "Kiel", { departureTime: "2026-10-05T17:00:00.000Z" }),
  call(3, 2, "Oslo", {
    uiKey: "s3",
    arrivalTime: "2026-10-07T08:00:00.000Z",
    departureTime: "2026-10-07T17:00:00.000Z",
    excursionNote: "Holmenkollen",
    allAboardTime: "16:30",
  }),
  call(4, 3, "Bergen", { excursionNote: "Fløibanen" }),
  call(6, 4, "Ålesund", { excursionNote: "Aksla" }),
];

const imported: CruiseStopInput[] = [
  call(1, 1, "Kiel", { departureTime: "2026-10-05T17:00:00.000Z" }),
  sea(2),
  // Oslo: later departure; no note in the booking.
  call(3, 2, "Oslo", {
    arrivalTime: "2026-10-07T08:00:00.000Z",
    departureTime: "2026-10-07T18:30:00.000Z",
  }),
  // Bergen swapped for Stavanger.
  call(4, 5, "Stavanger", { arrivalTime: "2026-10-08T09:00:00.000Z" }),
  // Ålesund gone.
];

describe("diffItinerary", () => {
  it("names added, removed and changed ports and times, day by day", () => {
    const changes = diffItinerary(stored, imported);
    expect(changes.map((c) => [c.kind, c.day])).toEqual([
      ["added", 2],
      ["times", 3],
      ["port", 4],
      ["removed", 6],
    ]);
  });

  it("finds nothing when the plan is the same, and ignores times the booking leaves out", () => {
    const withoutTimes = stored.map((s) => ({ ...s, arrivalTime: null, departureTime: null }));
    expect(diffItinerary(stored, stored)).toEqual([]);
    expect(diffItinerary(stored, withoutTimes)).toEqual([]);
  });
});

describe("mergeItinerary", () => {
  const changes = diffItinerary(stored, imported);
  const all = new Set(changes.map((c) => c.id));

  it("applies only what was accepted, keeps own notes, and keeps the day order", () => {
    const keepAlesund = new Set(changes.filter((c) => c.kind !== "removed").map((c) => c.id));
    const merged = mergeItinerary(stored, changes, keepAlesund);
    expect(merged.map((s) => [s.dayNumber, s.port?.name ?? "sea"])).toEqual([
      [1, "Kiel"],
      [2, "sea"],
      [3, "Oslo"],
      [4, "Stavanger"],
      [6, "Ålesund"],
    ]);
    const oslo = merged[2];
    expect(oslo).toMatchObject({
      uiKey: "s3",
      departureTime: "2026-10-07T18:30:00.000Z",
      arrivalTime: "2026-10-07T08:00:00.000Z",
      excursionNote: "Holmenkollen",
      allAboardTime: "16:30",
    });
    // The swapped day keeps the note written for that day.
    expect(merged[3]).toMatchObject({ portId: 5, excursionNote: "Fløibanen" });
  });

  it("creates no second port call when the same plan is accepted again", () => {
    const once = mergeItinerary(stored, changes, all);
    expect(diffItinerary(once, imported)).toEqual([]);
    const twice = mergeItinerary(once, diffItinerary(once, imported), all);
    expect(twice).toHaveLength(once.length);
    expect(twice.filter((s) => s.portId === 2)).toHaveLength(1);
  });

  it("changes nothing when everything is rejected", () => {
    expect(mergeItinerary(stored, changes, new Set())).toEqual(stored);
  });
});

/** Review I2/I3: a re-read never undoes the user's resolution, nor moves one port's times to another. */
describe("re-import edge cases", () => {
  it("never offers a resolved port back to the name the parser still cannot match", () => {
    const resolved = [
      call(4, 77, "Cristóbal (Colón)", { arrivalTime: "2026-10-08T07:00:00.000Z" }),
    ];
    const reread: CruiseStopInput[] = [
      { dayNumber: 4, isAtSea: false, portId: null, unresolvedPortName: "Colón" },
    ];
    expect(diffItinerary(resolved, reread)).toEqual([]);
  });

  it("still offers an imported catalogue port for a stored unresolved name", () => {
    const named: CruiseStopInput[] = [
      { dayNumber: 4, isAtSea: false, portId: null, unresolvedPortName: "Colón" },
    ];
    expect(diffItinerary(named, [call(4, 77, "Cristóbal (Colón)")]).map((c) => c.kind)).toEqual([
      "port",
    ]);
  });

  it("drops the old port's all-aboard time and takes the new times as a pair", () => {
    const bergen = [
      call(4, 3, "Bergen", {
        arrivalTime: "2026-10-08T08:00:00.000Z",
        departureTime: "2026-10-08T17:00:00.000Z",
        allAboardTime: "16:30",
        excursionNote: "Fløibanen",
      }),
    ];
    const stavanger = [call(4, 5, "Stavanger", { arrivalTime: "2026-10-08T09:00:00.000Z" })];
    const changes = diffItinerary(bergen, stavanger);
    const [merged] = mergeItinerary(bergen, changes, new Set(changes.map((c) => c.id)));
    expect(merged).toMatchObject({
      portId: 5,
      arrivalTime: "2026-10-08T09:00:00.000Z",
      departureTime: null,
      allAboardTime: null,
      excursionNote: "Fløibanen",
    });
  });

  it("carries no times onto a day that became a sea day", () => {
    const bergen = [
      call(4, 3, "Bergen", { departureTime: "2026-10-08T17:00:00.000Z", allAboardTime: "16:30" }),
    ];
    const changes = diffItinerary(bergen, [sea(4)]);
    const [merged] = mergeItinerary(bergen, changes, new Set(changes.map((c) => c.id)));
    expect(merged).toMatchObject({
      isAtSea: true,
      portId: null,
      arrivalTime: null,
      departureTime: null,
      allAboardTime: null,
    });
  });
});
