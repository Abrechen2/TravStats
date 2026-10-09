import { describe, expect, it } from "vitest";

import type { EditorStation } from "../editorStation";
import { shiftPreview, shiftStations, type StayRef } from "../shiftDays";

const st = (
  key: string,
  start: string | null,
  end: string | null,
  night: EditorStation["night"] = { kind: "free" }
): EditorStation => ({
  key,
  id: key,
  title: key,
  lat: 60,
  lon: 5,
  startDate: start,
  endDate: end,
  notes: null,
  night,
});
const NONE = { stays: [], ownTrip: null, trips: [], roadtrips: [] };

/** forgejo#241: following days move together, by calendar days. */
describe("shiftStations", () => {
  it("moves own dates from the chosen station on, across a month end, and leaves the rest", () => {
    const list = [
      st("a", "2026-07-28", "2026-07-29"),
      st("b", "2026-07-30T00:00:00.000Z", "2026-07-31"),
      st("c", null, null, { kind: "pass" }),
    ];
    expect(shiftStations(list, 1, 2).map((s) => [s.startDate, s.endDate])).toEqual([
      ["2026-07-28", "2026-07-29"],
      ["2026-08-01", "2026-08-02"],
      [null, null],
    ]);
    expect(shiftStations(list, 0, -1)[0]).toMatchObject({
      startDate: "2026-07-27",
      endDate: "2026-07-28",
    });
  });
});

describe("shiftPreview", () => {
  const list = [
    st("a", "2026-07-10", "2026-07-12"),
    st("b", "2026-07-12", "2026-07-14", { kind: "stay", lodgingStayId: "s-b" }),
    st("c", "2026-07-14", "2026-07-15"),
  ];
  const linked: StayRef = {
    id: "s-b",
    lodgingId: "l-b",
    label: "Camping Lom",
    checkIn: "2026-07-12",
    checkOut: "2026-07-14",
    cancelled: false,
  };

  it("shows each dated station's old and new days", () => {
    const p = shiftPreview(list, 1, 1, NONE);
    expect(p.rows.map((r) => `${r.station.key}:${r.before.start}>${r.after.start}`)).toEqual([
      "b:2026-07-12>2026-07-13",
      "c:2026-07-14>2026-07-15",
    ]);
  });

  it("never moves a linked stay, and lists it to check — saying when it no longer fits", () => {
    const p = shiftPreview(list, 1, 1, { ...NONE, stays: [linked] });
    expect(p.notices).toContainEqual(
      expect.objectContaining({ kind: "linkedStay", stay: linked, fits: false })
    );
    expect(linked).toMatchObject({ checkIn: "2026-07-12", checkOut: "2026-07-14" });
  });

  it("names a station that would begin before the one in front of it ends", () => {
    const p = shiftPreview(list, 1, -1, NONE);
    expect(p.notices).toContainEqual(expect.objectContaining({ kind: "beforePrevious" }));
  });

  it("names the days a later start leaves without a station", () => {
    const p = shiftPreview(list, 1, 2, NONE);
    expect(p.notices).toContainEqual(expect.objectContaining({ kind: "gap", days: 2 }));
  });

  it("names a night that now falls into another stay, and not one that already did or is cancelled", () => {
    const other: StayRef = {
      ...linked,
      id: "s-x",
      lodgingId: "l-x",
      label: "Hotel Fjord",
      checkIn: "2026-07-15",
      checkOut: "2026-07-16",
    };
    const cancelled: StayRef = { ...other, id: "s-y", cancelled: true };
    const p = shiftPreview(list, 2, 1, { ...NONE, stays: [linked, other, cancelled] });
    expect(p.notices.filter((n) => n.kind === "otherStay")).toEqual([
      expect.objectContaining({ stay: other }),
    ]);
    // Without the shift the same stay is no news.
    expect(shiftPreview(list, 2, 0, { ...NONE, stays: [other] }).notices).toEqual([]);
  });

  it("names the trip the roadtrip would leave, and trips or roadtrips it would newly run into", () => {
    const own = { id: "t1", name: "Norwegen", start: "2026-07-09", end: "2026-07-15" };
    const next = { id: "t2", name: "Schweden", start: "2026-07-17", end: "2026-07-20" };
    const rt = { id: "r2", name: "Lofoten", start: "2026-07-18", end: "2026-07-25" };
    const p = shiftPreview(list, 0, 4, {
      ...NONE,
      ownTrip: own,
      trips: [own, next],
      roadtrips: [rt],
    });
    expect(p.notices.map((n) => n.kind)).toEqual(
      expect.arrayContaining(["outsideTrip", "overlapsTrip", "overlapsRoadtrip"])
    );
  });
});
