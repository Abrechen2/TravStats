import { describe, it, expect } from "vitest";
import {
  bulkEditGaps,
  bulkEditPreview,
  bulkEditRequest,
  emptyBulkEditDraft,
  type BulkEditDraft,
} from "../bulkEditModel";

const flights = [
  { id: "a", tripId: null, tags: ["work"], companions: ["Bo"] },
  { id: "b", tripId: "t-old", tags: [], companions: [] },
  { id: "c", tripId: "t-new", tags: ["autumn", "work"], companions: ["Anna"] },
];
const trips = [
  { id: "t-old", name: "Sommer" },
  { id: "t-new", name: "Herbst" },
];

const draft = (over: Partial<BulkEditDraft>): BulkEditDraft => ({
  ...emptyBulkEditDraft(),
  ...over,
});

/** forgejo#217 — the preview says, per field, what is added and what is replaced. */
describe("bulkEditPreview", () => {
  it("counts flights gaining, replacing and already having the trip", () => {
    const p = bulkEditPreview(draft({ trip: { mode: "set", tripId: "t-new" } }), flights, trips);
    expect(p.trip).toEqual({ kind: "set", tripName: "Herbst", gain: 1, replace: 1, already: 1 });
  });

  it("counts flights that lose a trip when it is cleared", () => {
    const p = bulkEditPreview(draft({ trip: { mode: "clear" } }), flights, trips);
    expect(p.trip).toEqual({ kind: "clear", remove: 2, none: 1 });
  });

  it("adds as a union: a flight that has every value already is not a change", () => {
    const p = bulkEditPreview(draft({ tags: { mode: "add", values: ["autumn"] } }), flights, trips);
    expect(p.tags).toEqual({ kind: "add", values: ["autumn"], change: 2, already: 1, lost: [] });
  });

  it("replaces, and names what falls away", () => {
    const p = bulkEditPreview(
      draft({ companions: { mode: "replace", values: ["Anna"] } }),
      flights,
      trips
    );
    expect(p.companions).toEqual({
      kind: "replace",
      values: ["Anna"],
      change: 2,
      already: 1,
      lost: ["Bo"],
    });
  });

  it("previews nothing for a field left alone", () => {
    expect(bulkEditPreview(emptyBulkEditDraft(), flights, trips)).toEqual({
      trip: null,
      tags: null,
      companions: null,
    });
  });
});

describe("bulkEditGaps", () => {
  it("asks for a change, a trip and values to add — but not for an emptying replace", () => {
    expect(bulkEditGaps(emptyBulkEditDraft())).toEqual(["nothing"]);
    expect(bulkEditGaps(draft({ trip: { mode: "set", tripId: "" } }))).toEqual(["trip"]);
    expect(bulkEditGaps(draft({ tags: { mode: "add", values: [] } }))).toEqual(["tags"]);
    expect(bulkEditGaps(draft({ tags: { mode: "replace", values: [] } }))).toEqual([]);
  });
});

describe("bulkEditRequest", () => {
  it("sends only the fields that change, for the ids given", () => {
    expect(
      bulkEditRequest(draft({ trip: { mode: "clear" }, tags: { mode: "add", values: ["x"] } }), [
        "a",
        "b",
      ])
    ).toEqual({
      flightIds: ["a", "b"],
      trip: { mode: "clear" },
      tags: { mode: "add", values: ["x"] },
    });
  });
});
