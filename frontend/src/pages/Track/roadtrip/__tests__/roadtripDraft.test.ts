import { describe, expect, it, vi } from "vitest";
import type { RoadtripPreview } from "../../../../lib/api/travtrackRoadtrip";
import {
  draftOf,
  dropStation,
  renameStation,
  RoadtripSaveError,
  saveRoadtrip,
  stationInputs,
  type RoadtripSaveApis,
} from "../roadtripDraft";

/** "Als Roadtrip übernehmen": editing the preview and writing it (rc46 extras A). */

const H = 3_600_000;
const T0 = Date.parse("2026-10-12T07:00:00Z");
const station = (key: string, kind: "start" | "stop" | "end", h: number, name: string | null) => ({
  key,
  kind,
  name,
  nameSource: name ? ("place" as const) : null,
  placeId: name ? `p-${key}` : null,
  lat: 48 + h / 10,
  lon: 7.8,
  arriveMs: kind === "start" ? null : T0 + h * H,
  departMs: kind === "end" ? null : T0 + h * H + (kind === "stop" ? H : 0),
  dwellMs: kind === "stop" ? H : null,
});
const leg = (from: string, to: string, km: number, est = 0) => ({
  fromKey: from,
  toKey: to,
  coordinates: [
    [7.8, 48],
    [7.8, 48.1],
  ] as [number, number][],
  estimated: est
    ? [
        [
          [7.8, 48],
          [7.8, 48.1],
        ] as [number, number][],
      ]
    : [],
  distanceKm: km,
  estimatedKm: est,
});
const preview: RoadtripPreview = {
  stations: [
    station("a", "start", 0, null),
    station("b", "stop", 1, "Titisee"),
    station("c", "stop", 3, null),
    station("d", "end", 5, "Basel"),
  ],
  legs: [leg("a", "b", 20), leg("b", "c", 30, 12), leg("c", "d", 40)],
  distanceKm: 90,
  estimatedKm: 12,
  zone: "Europe/Berlin",
};
const draft = () => draftOf(preview, (n) => `Halt ${n}`);
const days = { fromDay: "2026-10-12", toDay: "2026-10-12" };
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe("the draft", () => {
  it("names unnamed stations 'Halt N' and keeps the place names", () => {
    expect(draft().stations.map((s) => s.title)).toEqual(["Halt 1", "Titisee", "Halt 3", "Basel"]);
  });

  it("dropping a station joins its two legs, distance and estimate included", () => {
    const d = dropStation(draft(), "c");
    expect(d.stations.map((s) => s.key)).toEqual(["a", "b", "d"]);
    expect(d.legs.map((l) => [l.fromKey, l.toKey, l.distanceKm, l.estimatedKm])).toEqual([
      ["a", "b", 20, 0],
      ["b", "d", 70, 12],
    ]);
  });

  it("the first and last station cannot be dropped", () => {
    const d = draft();
    expect(dropStation(d, "a")).toBe(d);
    expect(dropStation(d, "d")).toBe(d);
  });

  it("renaming touches one station only", () => {
    const d = renameStation(draft(), "c", "Feldberg");
    expect(d.stations.map((s) => s.title)).toEqual(["Halt 1", "Titisee", "Feldberg", "Basel"]);
  });

  it("each station is a pass-through dated by its days, linked to its place", () => {
    const inputs = stationInputs(draft(), dayOf);
    expect(inputs[1]).toEqual({
      title: "Titisee",
      lat: 48.1,
      lon: 7.8,
      startDate: "2026-10-12",
      endDate: "2026-10-12",
      night: { kind: "pass", placeId: "p-b" },
    });
    expect(inputs[0].night).toEqual({ kind: "pass", placeId: null });
  });
});

function apis(over: Partial<RoadtripSaveApis> = {}): RoadtripSaveApis {
  return {
    create: vi.fn(async () => ({ id: "rt" })),
    replaceStations: vi.fn(async (_id, stations) => ({
      stations: stations.map((_s: unknown, i: number) => ({ id: `s${i}` })),
    })),
    setDrawnLeg: vi.fn(async () => ({})),
    remove: vi.fn(async () => {}),
    ...over,
  };
}

describe("saveRoadtrip", () => {
  it("creates with the track span, then the stations, then every leg as a drawn line", async () => {
    const a = apis();
    const id = await saveRoadtrip(
      draft(),
      { name: " Schwarzwald ", tripId: null, trackSpan: days, zone: "Europe/Berlin" },
      a,
      dayOf
    );
    expect(id).toBe("rt");
    expect(a.create).toHaveBeenCalledWith({ name: "Schwarzwald", tripId: null, trackSpan: days });
    expect(vi.mocked(a.setDrawnLeg).mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["s0", "s1"],
      ["s1", "s2"],
      ["s2", "s3"],
    ]);
    expect(a.remove).not.toHaveBeenCalled();
  });

  it("a failed line removes the half-made roadtrip and names the step", async () => {
    const a = apis({
      setDrawnLeg: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("500")),
    });
    const error = await saveRoadtrip(
      draft(),
      { name: "x", tripId: null, trackSpan: days, zone: "UTC" },
      a,
      dayOf
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RoadtripSaveError);
    expect(error).toMatchObject({ step: "line", rolledBack: true, roadtripId: null });
    expect(a.remove).toHaveBeenCalledWith("rt");
  });

  it("says when the half-made roadtrip could not be removed", async () => {
    const a = apis({
      replaceStations: vi.fn().mockRejectedValue(new Error("409")),
      remove: vi.fn().mockRejectedValue(new Error("down")),
    });
    await expect(
      saveRoadtrip(draft(), { name: "x", tripId: null, trackSpan: days, zone: "UTC" }, a, dayOf)
    ).rejects.toMatchObject({ step: "stations", rolledBack: false, roadtripId: "rt" });
  });

  it("a failed create leaves nothing to remove", async () => {
    const a = apis({ create: vi.fn().mockRejectedValue(new Error("400")) });
    await expect(
      saveRoadtrip(draft(), { name: "x", tripId: null, trackSpan: days, zone: "UTC" }, a, dayOf)
    ).rejects.toMatchObject({ step: "create" });
    expect(a.remove).not.toHaveBeenCalled();
  });
});
