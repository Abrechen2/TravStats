import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useRouteEditorReports } from "../routeEditorReports";
import { TRACK_ERROR_KEYS } from "../../../lib/trackErrorKeys";
import { ROUTE_STOP_ERROR_KEYS } from "../../../lib/routeStopErrorKeys";

const t = (k: string): string => k;
const refused = (code: string): unknown =>
  Object.assign(new Error("refused"), {
    isAxiosError: true,
    response: { status: 409, data: { code, error: "English prose from the server" } },
  });

/** forgejo#246: a refused track adoption is said by its code, in DE/EN copy. */
describe("useRouteEditorReports", () => {
  it("maps a track refusal's code to its own sentence and offers no pointless retry", () => {
    const { result } = renderHook(() => useRouteEditorReports(t));
    act(() =>
      result.current.fail(
        "legs",
        refused("TRACK_GAP_IN_LEG"),
        "trips:tours.legError",
        () => {},
        TRACK_ERROR_KEYS
      )
    );
    expect(result.current.reports.legs).toEqual({
      kind: "error",
      message: "trips:tours.tracks.errors.gapInLeg",
      retry: undefined,
    });
  });

  it("clears a section's report and leaves the others", () => {
    const { result } = renderHook(() => useRouteEditorReports(t));
    act(() => {
      result.current.report("legs", { kind: "notice", message: "a" });
      result.current.report("tracks", { kind: "notice", message: "b" });
    });
    act(() => result.current.clear("legs"));
    expect(result.current.reports).toEqual({ tracks: { kind: "notice", message: "b" } });
  });

  // Review M4: an assignment refusal says its own reason; a claim lost to a
  // concurrent change offers the retry that can cure it.
  it("names an assignment refusal by its code, and retries only the lost claim", () => {
    const retry = (): void => {};
    const { result } = renderHook(() => useRouteEditorReports(t));
    act(() =>
      result.current.fail(
        "stops",
        refused("ROUTE_STOP_IN_OTHER_SECTION"),
        "trips:tours.assignError",
        retry,
        ROUTE_STOP_ERROR_KEYS
      )
    );
    expect(result.current.reports.stops).toEqual({
      kind: "error",
      message: "trips:tours.assignErrors.inOtherSection",
      retry: undefined,
    });
    act(() =>
      result.current.fail(
        "stops",
        refused("ROUTE_STOP_CLAIMED_MEANWHILE"),
        "trips:tours.assignError",
        retry,
        ROUTE_STOP_ERROR_KEYS
      )
    );
    expect(result.current.reports.stops).toEqual({
      kind: "error",
      message: "trips:tours.assignErrors.claimedMeanwhile",
      retry,
    });
  });
});
