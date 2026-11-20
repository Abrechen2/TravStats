import type { JSX } from "react";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import type { TravTrackStop } from "../../../lib/api/travtrackLegs";
import { durationText, spanText } from "./trackLegFormat";
import { TRACK_COLOR } from "./trackMapLayers";

/**
 * Which part of a stay the phone measured and which is assumed. A stay joined across a
 * silence never proves the phone stayed: the gap is drawn dashed and greyed, and its time
 * is "angenommen", never "gemessen". Renders nothing for a stop without a silence.
 */
export default function TrackStopCoverage({
  stop,
  zone,
}: {
  stop: TravTrackStop;
  zone: string;
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const c = stop.coverage;
  if (!c || c.gaps.length === 0) return null;
  const total = Math.max(1, stop.untilMs - stop.fromMs);
  const pct = (ms: number) => `${((ms / total) * 100).toFixed(2)}%`;
  return (
    <div className="flex flex-col gap-1" data-testid="track-stop-coverage">
      <p className="t-caption tabular-nums" data-testid="track-stop-coverage-figures">
        {t("track:stop.coverage.figures", {
          observed: durationText(c.observedMs, t),
          inferred: durationText(c.inferredMs, t),
        })}
      </p>
      <div
        role="img"
        aria-label={t("track:stop.coverage.barLabel", {
          gaps: c.gaps.map((g) => spanText(g.fromMs, g.untilMs, zone, t)).join(", "),
        })}
        data-testid="track-stop-coverage-bar"
        style={{
          position: "relative",
          height: 10,
          borderRadius: 5,
          background: TRACK_COLOR,
          overflow: "hidden",
        }}
      >
        {c.gaps.map((g) => (
          <span
            key={g.fromMs}
            data-testid="track-stop-gap"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: pct(g.fromMs - stop.fromMs),
              width: pct(g.untilMs - g.fromMs),
              background: `repeating-linear-gradient(135deg, ${token("surface")} 0 3px, ${token("border")} 3px 6px)`,
              borderLeft: `1px dashed ${token("muted")}`,
              borderRight: `1px dashed ${token("muted")}`,
            }}
          />
        ))}
      </div>
      <p className="t-caption">{t("track:stop.coverage.note")}</p>
    </div>
  );
}
