import { describe, expect, it } from "vitest";

import {
  currentStationIndex,
  groupRoadtrips,
  localToday,
  nextMorning,
  nextStation,
  roadtripPhase,
  sketchPath,
  spanDays,
  stationAfter,
  stationRows,
  stationWarnings,
  vehicleChoices,
  type StationDraft,
} from "../roadtripView";
import type { RoadtripStation } from "../../../types/roadtrip";

const at = (day: string) => `${day}T00:00:00.000Z`;

function station(id: string, from: string | null, to: string | null = null): RoadtripStation {
  return {
    id,
    title: id,
    lat: 60,
    lon: 7,
    startDate: from ? at(from) : null,
    endDate: to ? at(to) : null,
    notes: null,
    order: 0,
    state: "free",
    lodgingStayId: null,
    stay: null,
  };
}

const NORWAY = [
  station("Hamburg", "2026-09-18"),
  station("Hirtshals", "2026-09-18", "2026-09-19"),
  station("Stavanger", "2026-09-19", "2026-09-22"),
  station("Geiranger", "2026-09-25", "2026-09-27"),
  station("Ålesund", "2026-09-27", "2026-09-28"),
];

describe("roadtripPhase", () => {
  it("is planned before its first day, underway through its last, past after", () => {
    expect(roadtripPhase(at("2026-09-18"), at("2026-09-28"), "2026-09-17")).toBe("planned");
    expect(roadtripPhase(at("2026-09-18"), at("2026-09-28"), "2026-09-18")).toBe("underway");
    expect(roadtripPhase(at("2026-09-18"), at("2026-09-28"), "2026-09-28")).toBe("underway");
    expect(roadtripPhase(at("2026-09-18"), at("2026-09-28"), "2026-09-29")).toBe("past");
  });

  it("says undated rather than guessing a phase", () => {
    expect(roadtripPhase(null, null, "2026-09-25")).toBe("undated");
  });
});

describe("days", () => {
  it("counts both ends", () => {
    expect(spanDays(at("2026-09-18"), at("2026-09-28"))).toBe(11);
    expect(spanDays(at("2026-09-18"), null)).toBeNull();
  });

  it("reads the local calendar day, not the UTC one", () => {
    // 23:30 local on the 24th stays the 24th whatever the offset.
    expect(localToday(new Date(2026, 8, 24, 23, 30))).toBe("2026-09-24");
  });

  it("gives the morning after", () => {
    expect(nextMorning("2026-09-30")).toBe("2026-10-01");
  });
});

describe("stationRows", () => {
  it("opens a day where the arrival day changes, numbered from the start", () => {
    const rows = stationRows(NORWAY, at("2026-09-18"), "2026-09-25");
    expect(rows.map((r) => r.day?.number ?? null)).toEqual([1, null, 2, 8, 10]);
  });

  it("marks today and the stations not yet reached", () => {
    const rows = stationRows(NORWAY, at("2026-09-18"), "2026-09-25");
    expect(rows.map((r) => r.isToday)).toEqual([false, false, false, true, false]);
    expect(rows.map((r) => r.isPlanned)).toEqual([false, false, false, false, true]);
  });

  it("lets an undated station neither open nor close a day", () => {
    const rows = stationRows(
      [station("A", "2026-09-18"), station("x", null), station("B", "2026-09-18")],
      at("2026-09-18"),
      "2026-10-01"
    );
    expect(rows.map((r) => r.day?.number ?? null)).toEqual([1, null, null]);
  });
});

describe("where the reader is", () => {
  it("is the last station reached on or before today", () => {
    expect(NORWAY[currentStationIndex(NORWAY, "2026-09-23")].id).toBe("Stavanger");
    expect(nextStation(NORWAY, "2026-09-23")?.id).toBe("Geiranger");
  });

  it("is nowhere once the trip is over, and nowhere before it starts", () => {
    expect(currentStationIndex(NORWAY, "2026-10-05")).toBe(-1);
    expect(currentStationIndex(NORWAY, "2026-09-01")).toBe(-1);
  });
});

describe("sketchPath", () => {
  it("fits the points into the box and keeps their order", () => {
    const d = sketchPath(
      [
        [10, 53.55],
        [9.96, 57.59],
        [6.15, 62.47],
      ],
      320,
      120
    );
    expect(d?.startsWith("M")).toBe(true);
    expect(d?.split("L")).toHaveLength(3);
    for (const n of (d ?? "").match(/-?\d+(\.\d+)?/g) ?? []) {
      expect(Number(n)).toBeGreaterThanOrEqual(0);
      expect(Number(n)).toBeLessThanOrEqual(320);
    }
  });

  it("draws nothing for a single point — one dot is not a route", () => {
    expect(sketchPath([[10, 53]], 320, 120)).toBeNull();
  });
});

describe("vehicleChoices", () => {
  it("offers no rail: train journeys are their own domain (owner, 2026-09-25)", () => {
    expect(vehicleChoices()).not.toContain("rail");
  });

  it("keeps rail on display for a row that already says so", () => {
    expect(vehicleChoices("rail")).toContain("rail");
  });
});

describe("stationWarnings", () => {
  const draft = (over: Partial<StationDraft>): StationDraft => ({
    title: "Ort",
    lat: 60,
    lon: 7,
    startDate: null,
    endDate: null,
    notes: null,
    night: { kind: "pass" },
    ...over,
  });

  it("names a station without a place, a date before the previous, a free night without departure", () => {
    const warnings = stationWarnings([
      draft({ startDate: "2026-09-20", endDate: "2026-09-22" }),
      draft({ startDate: "2026-09-21" }),
      draft({ lat: null, lon: null, title: "" }),
      draft({ startDate: "2026-09-23", night: { kind: "free" } }),
    ]);
    expect(warnings).toEqual([
      { kind: "beforePrevious", index: 1 },
      { kind: "noPlace", index: 2 },
      { kind: "noDeparture", index: 3 },
    ]);
  });

  it("starts a new station where the one before it was left", () => {
    expect(stationAfter(draft({ startDate: "2026-09-20", endDate: "2026-09-22" }))).toMatchObject({
      startDate: "2026-09-22",
      night: { kind: "free" },
      lat: null,
    });
  });
});

describe("groupRoadtrips", () => {
  const rt = (name: string, from: string | null, to: string | null = from) => ({
    name,
    startDate: from ? at(from) : null,
    endDate: to ? at(to) : null,
  });

  it("sorts each roadtrip into exactly one section, in reading order", () => {
    const g = groupRoadtrips(
      [
        rt("Bretagne", "2023-06-02", "2023-06-16"),
        rt("Alpen", "2026-10-14", "2026-10-18"),
        rt("Fjorde", "2026-09-18", "2026-09-28"),
        rt("Schottland", "2026-05-12", "2026-05-24"),
        rt("Toskana", "2024-09-03", "2024-09-09"),
        rt("Irgendwann", null),
        rt("Winter", "2026-12-01", "2026-12-05"),
      ],
      "2026-09-25"
    );
    expect(g.underway.map((r) => r.name)).toEqual(["Fjorde"]);
    expect(g.planned.map((r) => r.name)).toEqual(["Alpen", "Winter"]);
    expect(g.years.map((y) => [y.year, y.rows.map((r) => r.name)])).toEqual([
      [2026, ["Schottland"]],
      [2024, ["Toskana"]],
      [2023, ["Bretagne"]],
    ]);
    expect(g.undated.map((r) => r.name)).toEqual(["Irgendwann"]);
  });
});
