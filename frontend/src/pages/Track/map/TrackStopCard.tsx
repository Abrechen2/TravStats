import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { token } from "../../../components/ui/tokens";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { dawarichStaysApi } from "../../../lib/api/dawarichStays";
import type { TravTrackStop } from "../../../lib/api/travtrackLegs";
import { logger } from "../../../lib/logger";
import { stayInboxHref, stayStatusColor } from "../TrackStays";
import TrackStopPlace from "./TrackStopPlace";
import { durationText, spanText } from "./trackLegFormat";
import { panelStyle, pillStyle } from "./trackMapStyle";

/**
 * One stop (a dwell between legs) opened from its marker: its time span and
 * length, and — where the server tied it to a stay — that stay's status with
 * the actions the stays page has: an open one is reviewed (accepted) in its
 * inbox card, which asks for the name and place, or declined right here; a
 * failed decline says why and keeps the stay open.
 */
export default function TrackStopCard({
  stop,
  zone,
  onClose,
  onChanged,
}: {
  stop: TravTrackStop;
  zone: string;
  onClose: () => void;
  /** Reads the day again after the stay was declined. */
  onChanged: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const stay = stop.stayRef;

  const decline = async () => {
    if (!stay) return;
    setBusy(true);
    setFailure(null);
    try {
      await dawarichStaysApi.reject(stay.id);
    } catch (err: unknown) {
      logger.warn("TravTrack stay could not be declined", err);
      setFailure(trackErrorKey(err));
      setBusy(false);
      return;
    }
    try {
      await onChanged();
    } catch (err: unknown) {
      logger.warn("TravTrack day could not be read after declining a stay", err);
      setFailure("track:legs.reloadFailed");
    } finally {
      setBusy(false);
    }
  };

  const status = stay?.status;
  const title = t(stay ? "track:stop.titleStay" : "track:stop.title");
  return (
    <div
      role="dialog"
      aria-label={title}
      data-testid="track-stop-card"
      className="flex flex-col gap-2"
      style={{ ...panelStyle, padding: 14, width: 320, maxWidth: "100%" }}
    >
      <h3 className="t-card-title">{title}</h3>
      <p className="t-body tabular-nums" data-testid="track-stop-span">
        {spanText(stop.fromMs, stop.untilMs, zone, t)}
        {" · "}
        {durationText(stop.untilMs - stop.fromMs, t)}
      </p>
      <TrackStopPlace stop={stop} onChanged={() => void onChanged()} />
      {stay ? (
        <p
          className="t-caption"
          data-testid="track-stop-status"
          style={{ fontWeight: 600, color: stayStatusColor(status) }}
        >
          {t(`track:stays.state.${status}`, { defaultValue: t("track:stop.stateOther") })}
        </p>
      ) : (
        <p className="t-caption" data-testid="track-stop-nostay">
          {t("track:stop.noStay")}
        </p>
      )}
      {failure && (
        <p className="t-caption" role="alert" style={{ color: token("bad") }}>
          {t(failure)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {stay && status === "pending" && (
          <>
            <Link
              to={stayInboxHref(stay.id)}
              data-testid="track-stop-review"
              style={{
                ...pillStyle(true, coarse ? 44 : 36),
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {t("track:stays.review")}
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decline()}
              data-testid="track-stop-reject"
              style={pillStyle(false, coarse ? 44 : 36)}
            >
              {t(busy ? "track:stop.rejecting" : "track:stop.reject")}
            </button>
          </>
        )}
        <button
          type="button"
          className="underline"
          onClick={onClose}
          style={{ minHeight: coarse ? 44 : 32 }}
        >
          {t("track:legs.wholeDay")}
        </button>
      </div>
    </div>
  );
}
