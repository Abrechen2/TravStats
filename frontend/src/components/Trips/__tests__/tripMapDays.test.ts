import { describe, it, expect } from "vitest";
import {
  collectDays,
  flightSpan,
  spanHasDay,
  splitByDay,
  stopSpan,
  tripDays,
} from "../tripMapDays";
import { numberInTripOrder } from "../tripMapSequence";
import { pickTripLabels, type TripLabelItem } from "../tripMapLabels";

describe("tripMapDays", () => {
  it("reads a flight's day on the airport's own clock, not the viewer's", () => {
    // 23:30 UTC on the 1st is already the 2nd in Tokyo.
    const span = flightSpan({
      departureTime: "2026-05-01T23:30:00Z",
      arrivalTime: "2026-05-02T05:00:00Z",
      depTimezone: "Asia/Tokyo",
      arrTimezone: "Asia/Tokyo",
    });
    expect(span).toEqual({ start: "2026-05-02", end: "2026-05-02" });
  });

  it("an entry with no date is never on a chosen day, but is on 'all days'", () => {
    expect(spanHasDay(null, "2026-05-01")).toBe(false);
    expect(spanHasDay(null, null)).toBe(true);
    expect(stopSpan({ startDate: null, endDate: null })).toBeNull();
  });

  it("a multi-day span covers every day inside it, ends included", () => {
    const span = { start: "2026-05-01", end: "2026-05-03" };
    expect(
      ["2026-04-30", "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04"].map((d) =>
        spanHasDay(span, d)
      )
    ).toEqual([false, true, true, true, false]);
  });

  it("splits a list into the chosen day's entries and the rest", () => {
    const items = [
      { id: "a", span: { start: "2026-05-01", end: "2026-05-01" } },
      { id: "b", span: { start: "2026-05-02", end: "2026-05-02" } },
      { id: "c", span: null },
    ];
    const { active, rest } = splitByDay(items, (i) => i.span, "2026-05-02");
    expect(active.map((i) => i.id)).toEqual(["b"]);
    expect(rest.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("lists each day of a trip once, ascending, with the days a stay spans", () => {
    expect(
      collectDays([
        { start: "2026-05-03", end: "2026-05-03" },
        { start: "2026-05-01", end: "2026-05-02" },
        null,
      ])
    ).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
    expect(tripDays({ stops: [{ startDate: "2026-06-09", endDate: null }] })).toEqual([
      "2026-06-09",
    ]);
  });

  it("cuts a runaway span instead of listing years of chips", () => {
    expect(collectDays([{ start: "2020-01-01", end: "2026-01-01" }]).length).toBeLessThanOrEqual(
      121
    );
  });
});

describe("tripMapSequence", () => {
  it("numbers dated entries by day then entry order, undated ones last", () => {
    const day = (d: string) => ({ start: d, end: d });
    const seq = numberInTripOrder([
      { key: "stop:c", kind: "stop", span: day("2026-05-03"), order: 0 },
      { key: "stop:u", kind: "stop", span: null, order: 1 },
      { key: "place:a", kind: "place", span: day("2026-05-01"), order: 10_000 },
      { key: "stop:b", kind: "stop", span: day("2026-05-03"), order: 2 },
    ]);
    expect([...seq.entries()].sort((x, y) => x[1] - y[1]).map(([k]) => k)).toEqual([
      "place:a",
      "stop:c",
      "stop:b",
      "stop:u",
    ]);
  });
});

describe("tripMapLabels: names by zoom", () => {
  const items: TripLabelItem[] = Array.from({ length: 40 }, (_, i) => ({
    position: [i * 5 - 100, (i % 7) * 8 - 20],
    text: `Place ${i}`,
    kind: "place",
    seq: i + 1,
  }));

  it("shows few names zoomed out and more as the reader zooms in", () => {
    const far = pickTripLabels(items, 1).length;
    const mid = pickTripLabels(items, 3).length;
    const near = pickTripLabels(items, 6).length;
    expect(far).toBeLessThanOrEqual(5);
    expect(mid).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(mid);
  });

  it("keeps a stop's name before a place's and a place's before an airport's", () => {
    const at = (kind: TripLabelItem["kind"], x: number): TripLabelItem => ({
      position: [x, 0],
      text: kind,
      kind,
    });
    const picked = pickTripLabels(
      [
        at("airport", 0),
        at("place", 20),
        at("stop", 40),
        ...Array.from({ length: 12 }, (_, i) => at("airport", 60 + i * 10)),
      ],
      1
    ).map((i) => i.kind);
    expect(picked.indexOf("stop")).toBeGreaterThanOrEqual(0);
    expect(picked.indexOf("stop")).toBeLessThan(
      picked.indexOf("place") === -1 ? 99 : picked.indexOf("place")
    );
  });
});

describe("tripMapArrows", () => {
  it("points a flight's arrow the way it flew, and keeps a round trip's two arrows apart", async () => {
    const { arrowFor, buildArrowLayer } = await import("../tripMapArrows");
    const out = {
      id: "a",
      group: "flights" as const,
      path: [
        [0, 0],
        [10, 0],
      ] as [number, number][],
      color: [1, 2, 3] as [number, number, number],
    };
    const back = {
      ...out,
      id: "b",
      path: [
        [10, 0],
        [0, 0],
      ] as [number, number][],
    };
    expect(Math.round(arrowFor(out)!.bearing)).toBe(90);
    expect(Math.round(arrowFor(back)!.bearing)).toBe(270);
    const data = buildArrowLayer([out, back])!.props.data as Array<{ position: [number, number] }>;
    expect(data).toHaveLength(2);
    expect(Math.abs(data[0].position[0] - data[1].position[0])).toBeGreaterThan(0.5);
  });

  it("draws no arrow for a line that goes nowhere", async () => {
    const { arrowFor } = await import("../tripMapArrows");
    expect(
      arrowFor({
        id: "z",
        group: "flights",
        path: [
          [1, 1],
          [1, 1],
        ],
        color: [0, 0, 0],
      })
    ).toBeNull();
  });
});
