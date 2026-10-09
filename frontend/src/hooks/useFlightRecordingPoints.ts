import { useEffect, useState } from "react";
import { flightsApi } from "../lib/api";
import { logger } from "../lib/logger";

/**
 * How many points the phone's recording of a flight holds (forgejo#193), for
 * the delete question — the recording cascades with the flight (review M8).
 * Asked only while a question is open (`flightId` non-null); `null` while
 * unknown, when there is none, or when it could not be read: the question
 * then claims nothing about a recording.
 */
export function useFlightRecordingPoints(flightId: string | null): number | null {
  const [points, setPoints] = useState<number | null>(null);
  useEffect(() => {
    setPoints(null);
    if (!flightId) return;
    let cancelled = false;
    const read = async (): Promise<void> => {
      try {
        const track = await flightsApi.getTrack(flightId);
        if (!cancelled) setPoints(track ? track.pointCount : null);
      } catch (err: unknown) {
        logger.warn({ err }, "useFlightRecordingPoints: recording could not be read");
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [flightId]);
  return points;
}
