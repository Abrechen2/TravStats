import { describe, expect, it } from "vitest";

import { editorNights } from "../editorNights";
import type { EditorStation } from "../editorStation";
import type { Lodging } from "../../../types/lodging";

const st = (patch: Partial<EditorStation>): EditorStation => ({
  key: "k",
  title: "x",
  lat: 1,
  lon: 1,
  startDate: null,
  endDate: null,
  night: { kind: "pass" },
  ...patch,
});

const lodging = {
  id: "l",
  type: "campsite",
  stays: [
    {
      id: "stay-1",
      checkIn: "2026-07-14T00:00:00.000Z",
      checkOut: "2026-07-17T00:00:00.000Z",
      datePrecision: "day",
      nights: null,
      status: "completed",
    },
  ],
} as unknown as Lodging;

describe("editorNights", () => {
  it("takes a linked stay's nights from the stay itself, a free station's from its dates", () => {
    const r = editorNights(
      [
        st({ key: "a", night: { kind: "stay", lodgingStayId: "stay-1" } }),
        st({
          key: "b",
          night: { kind: "free" },
          startDate: "2026-07-17T00:00:00.000Z",
          endDate: "2026-07-19T00:00:00.000Z",
        }),
        st({ key: "c" }),
      ],
      [lodging]
    );
    expect(r.nights).toBe(5);
    expect(r.nightsKnown).toBe(true);
    expect(r.byStation.get("a")).toEqual({ nights: 3, known: true });
    expect(r.byStation.get("b")).toEqual({ nights: 2, known: true });
    expect(r.byStation.get("c")).toBeNull();
  });

  it("does not turn a stay it cannot see into zero nights: the figure is marked unknown", () => {
    const r = editorNights(
      [st({ key: "a", night: { kind: "stay", lodgingStayId: "stay-1" } })],
      null
    );
    expect(r.nightsKnown).toBe(false);
    expect(r.byStation.get("a")?.known).toBe(false);
  });

  it("gives an unlinked stay night and a route correction no nights", () => {
    const r = editorNights(
      [
        st({ key: "a", night: { kind: "stay", lodgingStayId: null } }),
        st({ key: "b", night: { kind: "via" } }),
      ],
      []
    );
    expect(r.byStation.get("a")).toBeNull();
    expect(r.byStation.get("b")).toBeNull();
    expect(r.placesSlept).toBe(0);
  });
});
