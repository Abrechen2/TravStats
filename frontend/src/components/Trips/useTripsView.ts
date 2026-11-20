import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export type TripsView = "tiles" | "list";

export const TRIPS_VIEW_KEY = "travstats.trips.view";

const isView = (value: string | null | undefined): value is TripsView =>
  value === "tiles" || value === "list";

/** The view the reader last chose; null when nothing is stored or storage is unreadable. */
export function readStoredTripsView(): TripsView | null {
  try {
    const raw = window.localStorage.getItem(TRIPS_VIEW_KEY);
    return isView(raw) ? raw : null;
  } catch {
    // Private window, blocked site data: the tiles stay the default.
    return null;
  }
}

function storeTripsView(view: TripsView): void {
  try {
    window.localStorage.setItem(TRIPS_VIEW_KEY, view);
  } catch {
    // Not remembering is a convenience lost, not an error to show.
  }
}

/**
 * Tiles or the table. The URL (`?view=`) wins, so a bookmark or a shared link
 * opens as written; without it the reader's last choice applies (owner,
 * 2026-11-20: "Standard ist, was der User zuletzt hatte"), and without that
 * the tiles. Other query parameters are carried through untouched.
 */
export function useTripsView(): [TripsView, (next: TripsView) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get("view");
  const view: TripsView = isView(fromUrl) ? fromUrl : (readStoredTripsView() ?? "tiles");
  const setView = useCallback(
    (next: TripsView): void => {
      storeTripsView(next);
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.set("view", next);
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  return [view, setView];
}
