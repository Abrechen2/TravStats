/**
 * Regression for #257: a flight selected on the Flüge tab (popup card +
 * selection rings) survived the switch to another domain tab, because both
 * selection stores are module-level singletons nothing ever reset. The
 * hook clears them whenever the dashboard tab changes — and on mount, so a
 * stale selection can't outlive a dashboard exit either.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { useClearMapSelectionsOnTabChange } from "../useClearMapSelectionsOnTabChange";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import { useCruiseSelectionStore } from "../../store/cruiseSelectionStore";
import type { Flight } from "../../types";
import type { Cruise } from "../../types/cruise";
import type { DashboardTab } from "../../types/dashboard";

const flight = { id: "f1" } as unknown as Flight;
const cruise = { id: "c1" } as unknown as Cruise;

describe("useClearMapSelectionsOnTabChange", () => {
  beforeEach(() => {
    useFlightSelectionStore.getState().clearSelection();
    useCruiseSelectionStore.getState().clearSelection();
  });

  it("clears the flight selection when the tab changes", () => {
    const { rerender } = renderHook(({ tab }: { tab: DashboardTab }) => useClearMapSelectionsOnTabChange(tab), {
      initialProps: { tab: "flight" as DashboardTab },
    });

    act(() => {
      useFlightSelectionStore.getState().setSelection([flight]);
    });
    expect(useFlightSelectionStore.getState().selectedFlights).toHaveLength(1);

    rerender({ tab: "lodging" });

    expect(useFlightSelectionStore.getState().selectedFlights).toHaveLength(0);
    expect(useFlightSelectionStore.getState().highlightMode).toBeNull();
  });

  it("clears the cruise selection when the tab changes", () => {
    const { rerender } = renderHook(({ tab }: { tab: DashboardTab }) => useClearMapSelectionsOnTabChange(tab), {
      initialProps: { tab: "cruise" as DashboardTab },
    });

    act(() => {
      useCruiseSelectionStore.getState().showDetails(cruise);
    });
    expect(useCruiseSelectionStore.getState().selectedCruiseId).toBe("c1");

    rerender({ tab: "all" });

    expect(useCruiseSelectionStore.getState().selectedCruiseId).toBeNull();
    expect(useCruiseSelectionStore.getState().detailOpen).toBe(false);
  });

  it("keeps a selection alive while the tab stays the same (mode switches)", () => {
    const { rerender } = renderHook(({ tab }: { tab: DashboardTab }) => useClearMapSelectionsOnTabChange(tab), {
      initialProps: { tab: "flight" as DashboardTab },
    });

    act(() => {
      useFlightSelectionStore.getState().setSelection([flight]);
    });

    rerender({ tab: "flight" });

    expect(useFlightSelectionStore.getState().selectedFlights).toHaveLength(1);
  });

  it("clears a stale selection on mount", () => {
    act(() => {
      useFlightSelectionStore.getState().setSelection([flight]);
    });

    renderHook(() => useClearMapSelectionsOnTabChange("lodging"));

    expect(useFlightSelectionStore.getState().selectedFlights).toHaveLength(0);
  });
});
