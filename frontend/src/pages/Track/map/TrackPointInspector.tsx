import { useState } from "react";
import type { JSX } from "react";
import { token } from "../../../components/ui/tokens";
import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import { useTranslation } from "../../../hooks/useTranslation";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { travTrackViewsApi } from "../../../lib/api/travtrackViews";
import { formatDate, formatTime } from "../../../lib/displayFormat";
import { logger } from "../../../lib/logger";
import { DASH, makeNumber } from "./trackLegFormat";
import { TRACK_COLOR, type MapPoint } from "./trackMapLayers";

const buttonStyle = {
  minHeight: 40,
  padding: "0 12px",
  borderRadius: 8,
  border: `1px solid ${token("border-button")}`,
  background: "transparent",
  color: token("text"),
  cursor: "pointer",
} as const;

/**
 * One clicked position (TravTrack plan T5.2, T5.3): its time on the profile's
 * clock, its coordinates and accuracy, the phone's speed, altitude and motion
 * where the read carries them (spec 2026-11-03-travtrack-legs; a reading the
 * phone did not give is a dash, never 0, and an older server's read shows none
 * of the three), and „Punkt löschen" — exactly this stored point, after a
 * confirmation, final (no source brings it back). A failed delete says why and
 * keeps the point.
 */
export default function TrackPointInspector({
  point,
  onClose,
  onDeleted,
}: {
  point: MapPoint;
  onClose: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track", "common"]);
  const { confirmDelete, confirmDialog } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [ms, lat, lon, accuracy] = point.point;
  const pointId = point.id;
  const detail = point.detail ?? null;
  const number = makeNumber(i18n.language);

  const remove = async () => {
    if (!pointId) return;
    if (!(await confirmDelete(t("track:map.point.deleteConfirm")))) return;
    setBusy(true);
    setFailure(null);
    try {
      await travTrackViewsApi.deletePoint(pointId);
      onDeleted();
    } catch (err: unknown) {
      logger.warn("TravTrack point could not be deleted", err);
      setFailure(trackErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

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
        background: token("surface2"),
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
      {detail && (
        <dl className="grid grid-cols-3 gap-2" data-testid="track-point-details">
          <div data-detail="speed">
            <dt className="t-caption">{t("track:map.point.speed")}</dt>
            <dd className="tabular-nums">
              {detail.speedMps === null
                ? DASH
                : t("track:map.totals.kmh", { kmh: number(detail.speedMps * 3.6, 0) })}
            </dd>
          </div>
          <div data-detail="altitude">
            <dt className="t-caption">{t("track:map.point.altitude")}</dt>
            <dd className="tabular-nums">
              {detail.altitudeM === null
                ? DASH
                : t("track:legs.metres", { m: number(detail.altitudeM, 0) })}
            </dd>
          </div>
          <div data-detail="motion">
            <dt className="t-caption">{t("track:map.point.motion")}</dt>
            <dd>
              {detail.motion === null
                ? DASH
                : t(`track:map.point.motionClass.${detail.motion}`, {
                    defaultValue: t("track:map.point.motionClass.unknown"),
                  })}
            </dd>
          </div>
        </dl>
      )}
      {failure && (
        <span className="t-caption" role="alert" style={{ color: token("bad") }}>
          {t(failure)}
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        {pointId && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            style={{
              ...buttonStyle,
              color: token("warn"),
              borderColor: `color-mix(in srgb, ${token("warn")} 50%, transparent)`,
            }}
          >
            {t(busy ? "track:map.point.deleting" : "track:map.point.delete")}
          </button>
        )}
        <button type="button" onClick={onClose} style={buttonStyle}>
          {t("track:map.point.close")}
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}
