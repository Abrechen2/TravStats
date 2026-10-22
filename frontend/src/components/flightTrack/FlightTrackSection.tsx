import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import DetailSection from "../ui/DetailSection";
import { FlightTrackMap } from "./FlightTrackMap";
import FlightTrackControls from "./FlightTrackControls";
import { JitterNote } from "../tracks/JitterNote";
import { flownVsGreatCircle, type AirportPosition } from "./flownVsGreatCircle";
import { useTranslation } from "../../hooks/useTranslation";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
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

interface Props {
  flightId: string;
  /** The airports' positions, for the flown-vs-great-circle line (forgejo#312). */
  departure?: AirportPosition | null;
  arrival?: AirportPosition | null;
}

/**
 * The flight page's recording section — the phone's (forgejo#193) or an
 * uploaded file (forgejo#312). A failed load says so in one line instead of
 * passing for "no recording": the two are different answers.
 *
 * Without the `flightTrackUpload` beta key it is what it was: nothing while
 * loading and nothing without a recording. With it, a flight without one gets
 * the upload, and one with a recording gets replace, delete and the measured
 * distance set against the great circle.
 */
export default function FlightTrackSection({
  flightId,
  departure,
  arrival,
}: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["flights", "stats"]);
  const { isFeatureVisible } = useBetaFeatures();
  const canUpload = isFeatureVisible("flightTrackUpload");
  const distanceUnit = useSettingsStore((state) => state.units.distanceUnit);
  const [state, setState] = useState<TrackState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

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
  }, [flightId, reloadKey]);

  if (state.kind === "loading") return null;
  if (state.kind === "none" && !canUpload) return null;
  if (state.kind === "failed") {
    return (
      <DetailSection title={t("flights:track.title")}>
        <p className="t-caption" role="status">
          {t("flights:track.loadError")}
        </p>
      </DetailSection>
    );
  }

  const km = (value: number): string =>
    `${Math.round(convertDistance(value, distanceUnit)).toLocaleString(
      i18n.language
    )} ${getDistanceLabel(distanceUnit, t)}`;

  if (state.kind === "none") {
    return (
      <DetailSection title={t("flights:track.title")}>
        <div className="flex flex-col gap-2">
          <p className="t-caption">{t("flights:track.uploadIntro")}</p>
          <FlightTrackControls flightId={flightId} hasTrack={false} onChanged={reload} />
        </div>
      </DetailSection>
    );
  }

  const { track } = state;
  const gaps = Math.max(0, new Set(track.segmentStarts).size - 1);
  const captionKey =
    track.source === "companion" ? "flights:track.caption" : "flights:track.captionFile";
  const comparison = canUpload ? flownVsGreatCircle(track.distanceKm, departure, arrival) : null;

  return (
    <DetailSection title={t("flights:track.title")}>
      <div className="flex flex-col gap-2">
        <FlightTrackMap
          geometry={track.geometry}
          segmentStarts={track.segmentStarts}
          departure={departure}
          arrival={arrival}
        />
        <p className="t-caption" data-testid="flight-track-caption">
          {t(captionKey, {
            distance: km(track.distanceKm),
            points: track.pointCount.toLocaleString(i18n.language),
            format: track.source.toUpperCase(),
          })}
          {gaps > 0 && ` ${t("flights:track.gaps", { count: gaps })}`}
        </p>
        <JitterNote jitterDropped={track.jitterDropped} />
        {comparison && (
          <p className="t-caption" data-testid="flight-track-comparison">
            {t("flights:track.versusGreatCircle", {
              flown: km(track.distanceKm),
              greatCircle: km(comparison.greatCircleKm),
              difference: `${comparison.differencePercent > 0 ? "+" : ""}${comparison.differencePercent}`,
            })}
          </p>
        )}
        {canUpload && <FlightTrackControls flightId={flightId} hasTrack onChanged={reload} />}
      </div>
    </DetailSection>
  );
}
