import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { useTripPreselection } from "../useTripPreselection";
import type { DatedTrip } from "../../lib/tripForDate";

const trips: DatedTrip[] = [
  { id: "summer", startDate: "2026-07-01T00:00:00.000Z", endDate: "2026-07-14T00:00:00.000Z" },
  { id: "autumn", startDate: "2026-10-03T00:00:00.000Z", endDate: "2026-10-05T00:00:00.000Z" },
];

interface Props {
  enabled: boolean;
  trips: DatedTrip[];
  date: string;
  initial?: string;
}

// The hook with a real piece of state behind it, the way a form holds tripId.
function setup(initialProps: Props) {
  return renderHook(
    (props: Props) => {
      const [value, setValue] = useState(props.initial ?? "");
      const pick = useTripPreselection({ ...props, value, onChange: setValue });
      return { value, pick };
    },
    { initialProps }
  );
}

describe("useTripPreselection", () => {
  it("preselects the one trip covering the date", () => {
    const { result } = setup({ enabled: true, trips, date: "2026-07-05" });
    expect(result.current.value).toBe("summer");
  });

  it("waits for the trip list to arrive", () => {
    const { result, rerender } = setup({ enabled: true, trips: [], date: "2026-07-05" });
    expect(result.current.value).toBe("");
    rerender({ enabled: true, trips, date: "2026-07-05" });
    expect(result.current.value).toBe("summer");
  });

  it("follows the date while untouched, and clears when the new day matches nothing", () => {
    const { result, rerender } = setup({ enabled: true, trips, date: "2026-07-05" });
    rerender({ enabled: true, trips, date: "2026-10-04" });
    expect(result.current.value).toBe("autumn");
    rerender({ enabled: true, trips, date: "2026-08-01" });
    expect(result.current.value).toBe("");
  });

  it("never changes the select again once the user has touched it", () => {
    const { result, rerender } = setup({ enabled: true, trips, date: "2026-07-05" });
    act(() => result.current.pick("summer"));
    rerender({ enabled: true, trips, date: "2026-10-04" });
    expect(result.current.value).toBe("summer");

    act(() => result.current.pick(""));
    rerender({ enabled: true, trips, date: "2026-07-06" });
    expect(result.current.value).toBe("");
  });

  it("leaves an existing entry's trip alone", () => {
    const { result } = setup({ enabled: false, trips, date: "2026-07-05", initial: "" });
    expect(result.current.value).toBe("");
  });

  it("does not overwrite a trip it did not choose", () => {
    const { result } = setup({ enabled: true, trips, date: "2026-07-05", initial: "autumn" });
    expect(result.current.value).toBe("autumn");
  });
});
