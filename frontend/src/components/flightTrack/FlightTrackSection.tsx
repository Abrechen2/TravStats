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
import TrackOriginNote from "../tracks/TrackOriginNote";
import TrackSourceError from "../tracks/TrackSourceError";
import { apiErrorMachineCode } from "../../lib/apiError";
import { NO_ORIGIN_INFO, type TrackOrigin, type TrackOriginInfo } from "../../lib/api/trackOrigin";
import { formatTimeValueShown } from "../../lib/displayFormat";
import type { TimeValue } from "../../shared/time";
import WebGLGuard from "../map/WebGLGuard";

type TrackState =
  | { kind: "loading" }
  | { kind: "none"; info: TrackOriginInfo }
  | { kind: "failed"; code: string | null }
  | { kind: "loaded"; track: FlightTrack; info: TrackOriginInfo };

interface Props {
  flightId: string;
  /** The airports' positions, for the flown-vs-great-circle line (forgejo#312). */
  departure?: AirportPosition | null;
  arrival?: AirportPosition | null;
  /** The flight's own departure and arrival, shown where the recording names no time. */
  scheduled?: { departure: TimeValue | null; arrival: TimeValue | null };
}

/**
 * When the recording ran. An end a privacy zone cut away has no time
 * (TravTrack plan T5); there the flight's own departure or arrival stands in
 * — owner, 2026-10-25: show the flight's times and say nothing of what is
 * hidden. Null when either side is still unknown.
 */
export function shownTrackSpan(
  times: FlightTrack["times"],
  scheduled: Props["scheduled"]
): { from: TimeValue; to: TimeValue } | null {
  const from = times.startedAt ?? scheduled?.departure ?? null;
  const to = times.endedAt ?? scheduled?.arrival ?? null;
  return from && to ? { from, to } : null;
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
 *
 * Since TravTrack (plan T5) the line may come from the account's location
 * provider; the section names its origin, says when Dawarich answered short or
 * not at all, and offers another source only when one holds something. Upload,
 * replace and delete act on the own recording only.
 */
export default function FlightTrackSection({
  flightId,
  departure,
  arrival,
  scheduled,
}: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["flights", "stats"]);
  const { isFeatureVisible } = useBetaFeatures();
  const canUpload = isFeatureVisible("flightTrackUpload");
  const distanceUnit = useSettingsStore((state) => state.units.distanceUnit);
  const [state, setState] = useState<TrackState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [source, setSource] = useState<TrackOrigin | null>(null);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const { track, info } = await flightsApi.getTrackView(flightId, source);
        if (!cancelled) setState(track ? { kind: "loaded", track, info } : { kind: "none", info });
      } catch (err: unknown) {
        logger.warn({ err }, "FlightTrackSection: recording could not be loaded");
        if (!cancelled) setState({ kind: "failed", code: apiErrorMachineCode(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flightId, reloadKey, source]);

  if (state.kind === "loading") return null;
  const info = state.kind === "failed" ? NO_ORIGIN_INFO : state.info;
  const pick = (next: TrackOrigin): void => setSource(next === info.origin ? null : next);
  const note = <TrackOriginNote info={info} onPick={pick} />;
  const ownOrNone = info.origin === null || info.origin === "travstats";
  if (state.kind === "none" && !canUpload && info.alternatives.length === 0) {
    if (info.coverage !== "unreachable") return null;
  }
  if (state.kind === "failed" && source !== null) {
    return (
      <DetailSection title={t("flights:track.title")}>
        <TrackSourceError source={source} code={state.code} onBack={() => setSource(null)} />
      </DetailSection>
    );
  }
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
          {note}
          {canUpload && ownOrNone && (
            <>
              <p className="t-caption">{t("flights:track.uploadIntro")}</p>
              <FlightTrackControls flightId={flightId} hasTrack={false} onChanged={reload} />
            </>
          )}
        </div>
      </DetailSection>
    );
  }

  const { track } = state;
  const gaps = Math.max(0, new Set(track.segmentStarts).size - 1);
  const captionKey =
    track.source === "companion" || track.source === "travtrack" || track.source === "dawarich"
      ? "flights:track.caption"
      : "flights:track.captionFile";
  // A recording with holes measures only its recorded stretches, so set beside
  // the great circle it would read as a shorter flight ("−60 %"); say nothing.
  const comparison =
    canUpload && gaps === 0 ? flownVsGreatCircle(track.distanceKm, departure, arrival) : null;
  const span = shownTrackSpan(track.times, scheduled);

  return (
    <DetailSection title={t("flights:track.title")}>
      <div className="flex flex-col gap-2">
        <WebGLGuard>
          <FlightTrackMap
            geometry={track.geometry}
            segmentStarts={track.segmentStarts}
            departure={departure}
            arrival={arrival}
          />
        </WebGLGuard>
        <p className="t-caption" data-testid="flight-track-caption">
          {t(captionKey, {
            distance: km(track.distanceKm),
            points: track.pointCount.toLocaleString(i18n.language),
            format: track.source.toUpperCase(),
          })}
          {gaps > 0 && ` ${t("flights:track.gaps", { count: gaps })}`}
        </p>
        {span && (
          <p className="t-caption" data-testid="flight-track-span">
            {t("flights:track.span", {
              from: formatTimeValueShown(span.from),
              to: formatTimeValueShown(span.to),
            })}
          </p>
        )}
        <JitterNote jitterDropped={track.jitterDropped} />
        {note}
        {comparison && (
          <p className="t-caption" data-testid="flight-track-comparison">
            {t("flights:track.versusGreatCircle", {
              flown: km(track.distanceKm),
              greatCircle: km(comparison.greatCircleKm),
              difference: `${comparison.differencePercent > 0 ? "+" : ""}${comparison.differencePercent}`,
            })}
          </p>
        )}
        {canUpload && ownOrNone && (
          <FlightTrackControls flightId={flightId} hasTrack onChanged={reload} />
        )}
      </div>
    </DetailSection>
  );
}
