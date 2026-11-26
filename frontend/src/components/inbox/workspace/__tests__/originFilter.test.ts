import { describe, expect, it } from "vitest";
import { buildInboxItems, type InboxRecord } from "../model";
import { hasOrigin, originChips } from "../originFilter";
import type { DawarichStay } from "../../../../lib/api/dawarichStays";

const t = (key: string) => key.split(".").pop() ?? key;
const stay = (id: string, sources: DawarichStay["sources"]) =>
  ({
    source: "dawarich",
    data: {
      id,
      name: id,
      startAt: "2026-10-10T14:50:00Z",
      endAt: "2026-10-10T15:20:00Z",
      zone: "UTC",
      tripId: null,
      sources,
    },
  }) as unknown as InboxRecord;

describe("inbox source filter", () => {
  const items = buildInboxItems(
    [
      stay("a", [
        { kind: "smartList", id: "l1", name: "Maccis" },
        { kind: "calendar", id: null, name: null },
        { kind: "travtrack", id: null, name: null },
      ]),
      stay("b", [
        { kind: "plugin", id: "p1", name: "Projekte" },
        { kind: "travtrack", id: null, name: null },
      ]),
      stay("c", [{ kind: "dawarich", id: null, name: null }]),
    ],
    [],
    t,
    "de"
  );

  it("offers each smart list and plugin by name, then calendar and TravTrack, with counts", () => {
    expect(originChips(items, t).map((c) => [c.label, c.count])).toEqual([
      ["Maccis", 1],
      ["Projekte", 1],
      ["calendar", 1],
      ["travtrack", 2],
    ]);
  });

  it("a suggestion with several sources is found under each", () => {
    const keep = (origin: string) =>
      items.filter((i) => hasOrigin(i, origin, t)).map((i) => i.data.id);
    expect(keep("smartList:l1")).toEqual(["a"]);
    expect(keep("calendar")).toEqual(["a"]);
    expect(keep("plugin:p1")).toEqual(["b"]);
    expect(keep("travtrack")).toEqual(["a", "b"]);
    expect(items.filter((i) => hasOrigin(i, null, t))).toHaveLength(3);
  });
});
