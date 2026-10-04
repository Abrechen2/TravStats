import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useColumnPrefs } from "../../../components/table/useColumnPrefs";
import { useSortPrefs } from "../../../components/table/useSortPrefs";
import { useSectionVisibility } from "../../../hooks/useSectionVisibility";
import { onLocalPrefWrite, useWebPrefsEpochStore } from "../prefEvents";

/**
 * The hooks that copy a stored preference into component state (forgejo#200):
 * when the sync writes the server's value after they mounted, they must show
 * it — otherwise their next save would put this device's old value back and
 * upload it. And their own writes must reach the sync.
 */
const bump = (section: string) => act(() => useWebPrefsEpochStore.getState().bump(section));

describe("hooks re-read a synced preference", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("useColumnPrefs shows the server's hidden columns and announces its own writes", () => {
    const { result } = renderHook(() => useColumnPrefs("flights"));
    expect(result.current.hiddenIds).toEqual([]);

    window.localStorage.setItem("travstats:table-hidden-columns:flights", JSON.stringify(["seat"]));
    bump("tablePrefs");
    expect(result.current.hiddenIds).toEqual(["seat"]);

    const heard = vi.fn();
    const off = onLocalPrefWrite((k) => k === "travstats:table-hidden-columns:flights", heard);
    act(() => result.current.toggle("gate"));
    expect(heard).toHaveBeenCalled();
    off();
  });

  it("useSortPrefs sorts by the server's choice", () => {
    const { result } = renderHook(() =>
      useSortPrefs("lodging", "name", "asc", ["name", "date"] as const)
    );
    window.localStorage.setItem(
      "travstats:table-sort:lodging",
      JSON.stringify({ by: "date", order: "desc" })
    );
    bump("tablePrefs");
    expect(result.current.sortBy).toBe("date");
    expect(result.current.sortOrder).toBe("desc");
  });

  it("useSectionVisibility hides the server's sections without writing the old list back", () => {
    const { result } = renderHook(() => useSectionVisibility("flights"));
    expect(result.current.isVisible("costs")).toBe(true);

    window.localStorage.setItem("stats.hiddenSections.flights", JSON.stringify(["costs"]));
    bump("statsHiddenSections");
    expect(result.current.isVisible("costs")).toBe(false);
    expect(JSON.parse(window.localStorage.getItem("stats.hiddenSections.flights")!)).toEqual([
      "costs",
    ]);
  });
});
