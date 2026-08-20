import { useEffect } from "react";
import type { DashboardTab } from "../types/dashboard";
import { useFlightSelectionStore } from "../store/flightSelectionStore";
import { useCruiseSelectionStore } from "../store/cruiseSelectionStore";

/**
 * Clears every map selection (flight popup + rings, cruise selection) when
 * the dashboard domain tab changes (#257). Both selection stores are
 * module-level singletons, so without this a flight card selected on the
 * Flüge tab keeps rendering on the Unterkünfte tab's map. Runs on mount
 * too — entering the dashboard fresh must never resurrect a stale
 * selection from a previous visit. Mode switches (`?mode=`) don't change
 * `tab`, so a selection survives them — that part of the old behaviour is
 * intentional (see the contract note in cruiseSelectionStore.ts).
 */
export function useClearMapSelectionsOnTabChange(tab: DashboardTab): void {
  useEffect(() => {
    useFlightSelectionStore.getState().clearSelection();
    useCruiseSelectionStore.getState().clearSelection();
  }, [tab]);
}
