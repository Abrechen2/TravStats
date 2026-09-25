import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";

import { useStayDatesFromTrip } from "../useStayDatesFromTrip";
import type { DatedTrip } from "../../lib/tripForDate";

const TRIPS: DatedTrip[] = [
  { id: "summer", startDate: "2026-07-01T00:00:00.000Z", endDate: "2026-07-14T00:00:00.000Z" },
  { id: "autumn", startDate: "2026-10-03", endDate: "2026-10-05" },
  { id: "open", startDate: "2026-12-01", endDate: null },
  { id: "undated", startDate: null, endDate: null },
];

function setup(initial: {
  tripId?: string;
  checkIn?: string;
  checkOut?: string;
  enabled?: boolean;
}) {
  return renderHook(() => {
    const [tripId, setTripId] = useState(initial.tripId ?? "");
    const [checkIn, setCheckIn] = useState(initial.checkIn ?? "");
    const [checkOut, setCheckOut] = useState(initial.checkOut ?? "");
    const dates = useStayDatesFromTrip({
      enabled: initial.enabled ?? true,
      trips: TRIPS,
      tripId,
      checkIn,
      checkOut,
      onCheckInChange: setCheckIn,
      onCheckOutChange: setCheckOut,
    });
    return { ...dates, checkIn, checkOut, setTripId, setCheckIn };
  });
}

describe("useStayDatesFromTrip", () => {
  it("fills both empty dates from the picked trip, and follows a changed trip", () => {
    const { result } = setup({});
    act(() => result.current.setTripId("summer"));
    expect([result.current.checkIn, result.current.checkOut]).toEqual(["2026-07-01", "2026-07-14"]);
    act(() => result.current.setTripId("autumn"));
    expect([result.current.checkIn, result.current.checkOut]).toEqual(["2026-10-03", "2026-10-05"]);
    act(() => result.current.setTripId(""));
    expect([result.current.checkIn, result.current.checkOut]).toEqual(["", ""]);
  });

  it("leaves dates alone once the user changed one", () => {
    const { result } = setup({});
    act(() => result.current.setTripId("summer"));
    act(() => result.current.setCheckIn("2026-07-03"));
    act(() => result.current.setTripId("autumn"));
    expect([result.current.checkIn, result.current.checkOut]).toEqual(["2026-07-03", "2026-07-14"]);
    expect(result.current.offer).toBeNull();
  });

  it("only offers the trip's end when the check-in is typed, and writes it on accept", () => {
    const { result } = setup({ checkIn: "2026-07-05" });
    act(() => result.current.setTripId("summer"));
    expect(result.current.checkOut).toBe("");
    expect(result.current.offer).toEqual({ checkIn: null, checkOut: "2026-07-14" });
    act(() => result.current.accept());
    expect(result.current.checkOut).toBe("2026-07-14");
    expect(result.current.offer).toBeNull();
  });

  it("offers no check-out the trip would put before the check-in", () => {
    const { result } = setup({ checkIn: "2026-07-20", tripId: "summer" });
    expect(result.current.offer).toBeNull();
  });

  it("gives an open-ended trip's start alone, an undated trip nothing", () => {
    const open = setup({});
    act(() => open.result.current.setTripId("open"));
    expect([open.result.current.checkIn, open.result.current.checkOut]).toEqual(["2026-12-01", ""]);

    const undated = setup({});
    act(() => undated.result.current.setTripId("undated"));
    expect([undated.result.current.checkIn, undated.result.current.checkOut]).toEqual(["", ""]);
    expect(undated.result.current.offer).toBeNull();
  });

  it("does nothing for an existing stay", () => {
    const { result } = setup({ enabled: false });
    act(() => result.current.setTripId("summer"));
    expect([result.current.checkIn, result.current.checkOut]).toEqual(["", ""]);
    expect(result.current.offer).toBeNull();
  });
});
