import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAllTabActivity } from "../allTabActivity";
import { useDashboardFilterStore } from "../../../../store/dashboardFilterStore";
import type { Lodging } from "../../../../types/lodging";

const hotel = (checkIns: string[]): Lodging =>
  ({
    id: "h",
    stays: checkIns.map((checkIn) => ({ checkIn, checkOut: checkIn })),
  }) as unknown as Lodging;

beforeEach(() => useDashboardFilterStore.getState().reset?.());

describe("useAllTabActivity", () => {
  it("counts a stay outside the selected range no more than the map draws it", () => {
    useDashboardFilterStore.setState({
      time: { from: "2026-01-01T00:00:00Z", to: "2026-12-31T23:59:59Z" },
    });
    const { result } = renderHook(() =>
      useAllTabActivity([], [hotel(["2019-05-01T00:00:00Z", "2026-05-01T00:00:00Z"])], [], [])
    );
    const lodging = result.current.find((a) => a.domain === "lodging");
    expect(lodging?.dates).toEqual(["2026-05-01T00:00:00Z"]);
  });

  it("counts tours and roadtrips by start date, each under its own domain", () => {
    const tours = [
      { kind: "tour", startDate: "2026-03-01" },
      { kind: "roadtrip", startDate: "2026-04-01" },
      { kind: "roadtrip", startDate: null },
    ] as unknown as Parameters<typeof useAllTabActivity>[3];
    const { result } = renderHook(() => useAllTabActivity([], [], [], tours));
    const of = (d: string) => result.current.find((a) => a.domain === d)?.dates.filter(Boolean);
    expect(of("tour")).toEqual(["2026-03-01"]);
    expect(of("roadtrip")).toEqual(["2026-04-01"]);
  });
});
