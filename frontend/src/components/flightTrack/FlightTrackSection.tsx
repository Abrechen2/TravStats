import { useEffect, useState } from "react";
import type { JSX } from "react";
import DetailSection from "../ui/DetailSection";
import { FlightTrackMap } from "./FlightTrackMap";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { flightsApi } from "../../lib/api";
import { convertDistance, getDistanceLabel } from "../../lib/units";
import { logger } from "../../lib/logger";
import type { FlightTrack } from "../../types/flightTrack";

type TrackState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "failed" }
  | { kind: "loaded"; track: FlightTrack };

/**
 * The flight page's "recorded by the phone" section (forgejo#193). Draws
 * nothing while loading and nothing when no recording exists — most flights
 * have none. A failed load says so in one line instead of passing for "no
 * recording": the two are different answers.
 */
export default function FlightTrackSection({ flightId }: { flightId: string }): JSX.Element | null {
  const { t, i18n } = useTranslation(["flights", "stats"]);
  const distanceUnit = useSettingsStore((state) => state.units.distanceUnit);
  const [state, setState] = useState<TrackState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const track = await flightsApi.getTrack(flightId);
        if (!cancelled) setState(track ? { kind: "loaded", track } : { kind: "none" });
      } catch (err: unknown) {
        logger.warn({ err }, "FlightTrackSection: recording could not be loaded");
        if (!cancelled) setState({ kind: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flightId]);

  if (state.kind === "loading" || state.kind === "none") return null;
  if (state.kind === "failed") {
    return (
      <DetailSection title={t("flights:track.title")}>
        <p className="t-caption" role="status">
          {t("flights:track.loadError")}
        </p>
      </DetailSection>
    );
  }

  const { track } = state;
  const distance = `${Math.round(convertDistance(track.distanceKm, distanceUnit)).toLocaleString(
    i18n.language
  )} ${getDistanceLabel(distanceUnit, t)}`;
  const gaps = Math.max(0, new Set(track.segmentStarts).size - 1);

  return (
    <DetailSection title={t("flights:track.title")}>
      <div className="flex flex-col gap-2">
        <FlightTrackMap geometry={track.geometry} segmentStarts={track.segmentStarts} />
        <p className="t-caption" data-testid="flight-track-caption">
          {t("flights:track.caption", {
            distance,
            points: track.pointCount.toLocaleString(i18n.language),
          })}
          {gaps > 0 && ` ${t("flights:track.gaps", { count: gaps })}`}
        </p>
      </div>
    </DetailSection>
  );
}
