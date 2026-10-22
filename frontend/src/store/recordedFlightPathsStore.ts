import { create } from "zustand";
import { loadMapAppearance, saveMapAppearance } from "../components/map/mapAppearance";

/**
 * Whether the dashboard map draws recorded flight paths (forgejo#312) beside
 * the route arcs — „Aufgezeichnete Flugwege zeigen (wo vorhanden)" in the
 * map panel's flight section.
 *
 * Off by default: the dashboard shows ROUTES, aggregated per airport pair,
 * and a recording is one FLIGHT. The switch lives inside the map panel while
 * the fetch lives in `MapContainer3D` (`useRecordedFlightPaths`), so it is a
 * store both read — the `mapLabelsModeStore` shape. Persisted on change only,
 * through the shared `mapAppearance` blob (and with it the web-prefs sync).
 */
export function loadShowRecordedFlightPaths(): boolean {
  return loadMapAppearance().showRecordedFlightPaths === true;
}

interface RecordedFlightPathsState {
  show: boolean;
  setShow: (show: boolean) => void;
}

export const useRecordedFlightPathsStore = create<RecordedFlightPathsState>((set) => ({
  show: loadShowRecordedFlightPaths(),
  setShow: (show) => {
    saveMapAppearance({ showRecordedFlightPaths: show });
    set({ show });
  },
}));
