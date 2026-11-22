import { compareCruiseStops, sortCruiseStops } from "../stopOrder";

describe("compareCruiseStops (forgejo#435)", () => {
  const yangtze = [
    { id: "0-zhongxian", dayNumber: 2, arrivalTime: "2026-10-02T15:00:00Z", departureTime: null },
    { id: "f-fengdu", dayNumber: 2, arrivalTime: "2026-10-02T07:00:00Z", departureTime: null },
    { id: "0-wushan", dayNumber: 3, arrivalTime: "2026-10-03T14:00:00Z", departureTime: null },
    { id: "f-fengjie", dayNumber: 3, arrivalTime: "2026-10-03T08:00:00Z", departureTime: null },
  ];

  it("orders a shared day by arrival time, not by id", () => {
    expect(sortCruiseStops(yangtze).map((s) => s.id)).toEqual([
      "f-fengdu",
      "0-zhongxian",
      "f-fengjie",
      "0-wushan",
    ]);
  });

  it("puts a stop without times after one with times, then breaks the tie by id", () => {
    const a = { id: "b", dayNumber: 1 };
    const b = { id: "a", dayNumber: 1 };
    const timed = { id: "z", dayNumber: 1, arrivalTime: "2026-10-01T10:00:00Z" };
    expect(sortCruiseStops([a, timed, b]).map((s) => s.id)).toEqual(["z", "a", "b"]);
    expect(compareCruiseStops(a, a)).toBe(0);
  });

  it("falls back to the departure time when no arrival is known", () => {
    const early = { id: "x", dayNumber: 1, departureTime: "2026-10-01T08:00:00Z" };
    const late = { id: "a", dayNumber: 1, departureTime: "2026-10-01T18:00:00Z" };
    expect(sortCruiseStops([late, early]).map((s) => s.id)).toEqual(["x", "a"]);
  });

  it("keeps same-day stops without times in position order, not uuid order (forgejo#438)", () => {
    const first = { id: "z-uuid", dayNumber: 4, position: 0 };
    const second = { id: "a-uuid", dayNumber: 4, position: 1 };
    const third = { id: "m-uuid", dayNumber: 4, position: 2 };
    expect(sortCruiseStops([third, second, first]).map((s) => s.id)).toEqual([
      "z-uuid",
      "a-uuid",
      "m-uuid",
    ]);
  });

  it("lets a time beat the position and the position beat the id (forgejo#438)", () => {
    const timedLate = { id: "a", dayNumber: 1, arrivalTime: "2026-10-01T15:00:00Z", position: 0 };
    const timedEarly = { id: "b", dayNumber: 1, arrivalTime: "2026-10-01T07:00:00Z", position: 5 };
    expect(sortCruiseStops([timedLate, timedEarly]).map((s) => s.id)).toEqual(["b", "a"]);
    expect(
      compareCruiseStops({ id: "b", dayNumber: 1 }, { id: "a", dayNumber: 1 })
    ).toBeGreaterThan(0);
  });
});
