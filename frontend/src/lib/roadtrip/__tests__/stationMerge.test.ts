import { describe, expect, it } from "vitest";

import type { EditorStation } from "../editorStation";
import { mergeStations, sameStationList } from "../stationMerge";

const st = (id: string, over: Partial<EditorStation> = {}): EditorStation => ({
  key: id,
  id,
  title: id,
  lat: 60,
  lon: 5,
  startDate: null,
  endDate: null,
  notes: null,
  night: { kind: "free" },
  ...over,
});
const titles = (list: EditorStation[]): string[] => list.map((s) => s.title);

/**
 * forgejo#244: before a local draft goes over a NEWER server state, every
 * field both sides changed is a question; everything else merges by itself,
 * and nothing either side did is lost without being named.
 */
describe("mergeStations", () => {
  const base = [st("a", { title: "Bergen" }), st("b", { title: "Flåm" })];

  it("takes each side's own change without asking when they touch different fields", () => {
    const mine = [st("a", { title: "Bergen sentrum" }), st("b", { title: "Flåm" })];
    const theirs = [st("a", { title: "Bergen", notes: "Fischmarkt" }), st("b", { title: "Flåm" })];
    const m = mergeStations(base, mine, theirs);
    expect(m.conflicts).toEqual([]);
    expect(m.resolve()[0]).toMatchObject({ title: "Bergen sentrum", notes: "Fischmarkt" });
  });

  it("asks per field when both changed the same one, and starts on the server's side", () => {
    const mine = [st("a", { title: "Bergen sentrum" }), st("b", { title: "Flåm" })];
    const theirs = [st("a", { title: "Bergen Bryggen" }), st("b", { title: "Flåm" })];
    const m = mergeStations(base, mine, theirs);
    expect(m.conflicts).toEqual([
      expect.objectContaining({ kind: "field", stationId: "a", field: "title" }),
    ]);
    expect(titles(m.resolve())).toEqual(["Bergen Bryggen", "Flåm"]);
    expect(titles(m.resolve({ [m.conflicts[0].id]: "mine" }))).toEqual(["Bergen sentrum", "Flåm"]);
  });

  it("reads a typed day and its stored midnight as the same date", () => {
    const b = [st("a", { startDate: "2026-07-14T00:00:00.000Z" })];
    const m = mergeStations(b, [st("a", { startDate: "2026-07-14" })], b);
    expect(m.conflicts).toEqual([]);
  });

  it("keeps a station the phone added, between the stations it was added between", () => {
    const mine = [st("a", { title: "Bergen sentrum" }), st("b", { title: "Flåm" })];
    const theirs = [
      st("a", { title: "Bergen" }),
      st("p", { title: "Voss" }),
      st("b", { title: "Flåm" }),
    ];
    const m = mergeStations(base, mine, theirs);
    expect(titles(m.addedThere)).toEqual(["Voss"]);
    expect(titles(m.resolve())).toEqual(["Bergen sentrum", "Voss", "Flåm"]);
  });

  it("keeps a station added here at its place in this device's list", () => {
    const mine = [
      st("a", { title: "Bergen" }),
      { ...st("x", { title: "Voss" }), id: undefined, key: "new-1" },
      st("b", { title: "Flåm" }),
    ];
    const m = mergeStations(base, mine, base);
    expect(titles(m.resolve())).toEqual(["Bergen", "Voss", "Flåm"]);
    expect(m.resolve()[1].id).toBeUndefined();
  });

  it("lets a removal on the server stand for an untouched station, and names it", () => {
    const m = mergeStations(base, base, [base[0]]);
    expect(m.conflicts).toEqual([]);
    expect(titles(m.removedThere)).toEqual(["Flåm"]);
    expect(titles(m.resolve())).toEqual(["Bergen"]);
  });

  it("asks when the server removed a station this device changed — restoring it as a new one", () => {
    const mine = [base[0], st("b", { title: "Flåm stasjon" })];
    const m = mergeStations(base, mine, [base[0]]);
    expect(m.conflicts).toEqual([
      expect.objectContaining({ kind: "removedThere", stationId: "b" }),
    ]);
    expect(titles(m.resolve())).toEqual(["Bergen"]);
    const restored = m.resolve({ [m.conflicts[0].id]: "mine" });
    expect(titles(restored)).toEqual(["Bergen", "Flåm stasjon"]);
    // The old id no longer exists on the server, which would refuse it.
    expect(restored[1].id).toBeUndefined();
  });

  it("asks when this device removed a station the server changed", () => {
    const theirs = [base[0], st("b", { title: "Flåm stasjon" })];
    const m = mergeStations(base, [base[0]], theirs);
    expect(m.conflicts).toEqual([expect.objectContaining({ kind: "removedHere", stationId: "b" })]);
    expect(titles(m.resolve())).toEqual(["Bergen", "Flåm stasjon"]);
    expect(titles(m.resolve({ [m.conflicts[0].id]: "mine" }))).toEqual(["Bergen"]);
  });

  it("follows the side that moved stations, and asks only when both moved them differently", () => {
    const three = [st("a"), st("b"), st("c")];
    expect(titles(mergeStations(three, [st("b"), st("a"), st("c")], three).resolve())).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(titles(mergeStations(three, three, [st("c"), st("a"), st("b")]).resolve())).toEqual([
      "c",
      "a",
      "b",
    ]);
    const both = mergeStations(three, [st("b"), st("a"), st("c")], [st("a"), st("c"), st("b")]);
    expect(both.conflicts).toEqual([expect.objectContaining({ kind: "order" })]);
    expect(titles(both.resolve())).toEqual(["a", "c", "b"]);
    expect(titles(both.resolve({ order: "mine" }))).toEqual(["b", "a", "c"]);
  });

  it("carries the stay's name with a night taken from the server", () => {
    const b = [st("a", { night: { kind: "free" } })];
    const mine = [st("a", { title: "Neu", night: { kind: "free" } })];
    const theirs = [
      st("a", { night: { kind: "stay", lodgingStayId: "s1" }, stayLabel: "Camping Lom" }),
    ];
    expect(mergeStations(b, mine, theirs).resolve()[0]).toMatchObject({
      title: "Neu",
      night: { kind: "stay", lodgingStayId: "s1" },
      stayLabel: "Camping Lom",
    });
  });
});

describe("sameStationList", () => {
  it("is the same list when ids, order and every field agree", () => {
    expect(sameStationList([st("a")], [st("a", { startDate: null })])).toBe(true);
    expect(sameStationList([st("a"), st("b")], [st("b"), st("a")])).toBe(false);
    expect(sameStationList([st("a")], [st("a", { notes: "x" })])).toBe(false);
  });
});
