import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorStation } from "../editorStation";
import {
  clearStationDraft,
  readStationDraft,
  stationDraftKey,
  writeStationDraft,
} from "../stationDraftStore";

const STATION: EditorStation = {
  key: "a",
  id: "a",
  title: "Bergen",
  lat: 60.39,
  lon: 5.32,
  startDate: "2026-07-12",
  endDate: null,
  notes: null,
  night: { kind: "stay", lodgingStayId: null },
};

describe("stationDraftStore (forgejo#244)", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps a draft per user AND roadtrip, and gives it back", () => {
    expect(writeStationDraft("u1", "r1", { base: [], drafts: [STATION] })).toBe(true);
    expect(readStationDraft("u1", "r1")?.drafts).toEqual([STATION]);
    // Another account on the same browser, another roadtrip: nothing.
    expect(readStationDraft("u2", "r1")).toBeNull();
    expect(readStationDraft("u1", "r2")).toBeNull();
  });

  it("forgets it when cleared", () => {
    writeStationDraft("u1", "r1", { base: [], drafts: [STATION] });
    clearStationDraft("u1", "r1");
    expect(readStationDraft("u1", "r1")).toBeNull();
  });

  it("drops a record it cannot trust instead of restoring it", () => {
    window.localStorage.setItem(stationDraftKey("u1", "r1"), "{not json");
    expect(readStationDraft("u1", "r1")).toBeNull();
    window.localStorage.setItem(
      stationDraftKey("u1", "r1"),
      JSON.stringify({ version: 1, savedAt: "x", base: [], drafts: [{ title: 3 }] })
    );
    expect(readStationDraft("u1", "r1")).toBeNull();
    expect(window.localStorage.getItem(stationDraftKey("u1", "r1"))).toBeNull();
  });

  it("says so when the browser refuses to keep it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(writeStationDraft("u1", "r1", { base: [], drafts: [STATION] })).toBe(false);
  });
});
