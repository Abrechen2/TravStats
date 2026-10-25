import { useEffect, useState } from "react";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { travTrackViewsApi, type TravTrackFlightPanel } from "../../../lib/api/travtrackViews";
import { logger } from "../../../lib/logger";

export type FlightPanelState =
  | { kind: "loading" }
  | { kind: "loaded"; panel: TravTrackFlightPanel }
  | { kind: "failed"; key: string };

/**
 * The flight's panel, read again whenever `generation` moves: a deletion on
 * the map (a span or one point) can take vertices of this very flight.
 */
export function useFlightPanel(flightId: string, generation = 0): FlightPanelState {
  const [state, setState] = useState<FlightPanelState>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    travTrackViewsApi
      .flightPanel(flightId)
      .then((panel) => live && setState({ kind: "loaded", panel }))
      .catch((err: unknown) => {
        logger.warn("TravTrack flight panel could not be loaded", err);
        if (live) setState({ kind: "failed", key: flightErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [flightId, generation]);
  return state;
}

function flightErrorKey(err: unknown): string {
  const code = (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  return code === "TRAVTRACK_FLIGHT_NOT_FOUND" ? "track:flight.notFound" : trackErrorKey(err);
}
