import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatDate, formatTime } from "../../../lib/displayFormat";
import { TRACK_COLOR, type MapPoint } from "./trackMapLayers";

/**
 * One clicked position (TravTrack plan T5.2): its time on the profile's clock,
 * its coordinates and accuracy. The day read carries no speed or altitude, so
 * none is shown — a missing value is left out, not drawn as 0.
 */
export default function TrackPointInspector({
  point,
  onClose,
}: {
  point: MapPoint;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["track", "common"]);
  const [ms, lat, lon, accuracy] = point.point;
  return (
    <div
      role="dialog"
      aria-label={t("track:map.point.title")}
      data-testid="track-point-inspector"
      style={{
        position: "absolute",
        left: "50%",
        top: 40,
        transform: "translateX(-50%)",
        width: 280,
        background: "var(--ts-surface2)",
        border: `1px solid ${TRACK_COLOR}`,
        borderRadius: 12,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        zIndex: 2,
      }}
    >
      <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
        {formatTime(ms, { timeZone: point.zone })} · {formatDate(ms, { timeZone: point.zone })}
      </span>
      <span style={{ fontSize: 14, fontFamily: "var(--ts-font-mono)" }}>
        {lat.toFixed(5)}, {lon.toFixed(5)}
      </span>
      <span style={{ fontSize: 14 }}>
        {accuracy === null
          ? t("track:map.point.accuracyUnknown")
          : t("track:map.point.accuracy", { m: Math.round(accuracy) })}
      </span>
      <button
        type="button"
        onClick={onClose}
        style={{
          alignSelf: "flex-start",
          minHeight: 40,
          padding: "0 12px",
          borderRadius: 8,
          border: "1px solid var(--ts-border-button)",
          background: "transparent",
          color: "var(--ts-text)",
          cursor: "pointer",
        }}
      >
        {t("track:map.point.close")}
      </button>
    </div>
  );
}
