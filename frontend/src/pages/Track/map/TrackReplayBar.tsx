import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatDate, formatTime } from "../../../lib/displayFormat";
import { REPLAY_RATES, type ReplayRate } from "./trackReplay";
import type { Replay } from "./useReplay";
import { pillStyle, panelStyle } from "./trackMapStyle";
import { TRACK_COLOR } from "./trackMapLayers";

/**
 * Play, pause, scrub and speed for the shown day(s) (TravTrack plan T5.2).
 * The scrubber snaps a moment in a gap to the next stretch: the replay skips
 * what was not recorded and invents nothing between two stretches.
 */
export default function TrackReplayBar({
  replay,
  zone,
  multiDay,
}: {
  replay: Replay;
  zone: string;
  multiDay: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const first = replay.spans[0];
  const last = replay.spans[replay.spans.length - 1];
  if (!first || !last) return null;
  const at = replay.t ?? first.fromMs;
  const clock = formatTime(at, { timeZone: zone });
  const when = multiDay ? `${formatDate(at, { timeZone: zone, omitYear: true })} ${clock}` : clock;

  return (
    <div
      className="flex flex-wrap items-center gap-3"
      style={{ ...panelStyle, padding: "10px 14px" }}
      data-testid="track-replay"
    >
      <button
        type="button"
        onClick={replay.toggle}
        aria-label={t(replay.playing ? "track:map.replay.pause" : "track:map.replay.play")}
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "none",
          background: TRACK_COLOR,
          color: "var(--ts-bg)",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {replay.playing ? "II" : "▶"}
      </button>
      <span className="t-caption tabular-nums" style={{ fontFamily: "var(--ts-font-mono)" }}>
        {when}
      </span>
      <input
        type="range"
        aria-label={t("track:map.replay.scrub")}
        min={first.fromMs}
        max={last.untilMs}
        step={1000}
        value={at}
        onChange={(e) => replay.seek(Number(e.target.value))}
        style={{ flex: "1 1 200px", accentColor: TRACK_COLOR }}
      />
      <div className="flex gap-1" role="group" aria-label={t("track:map.replay.rate")}>
        {(Object.keys(REPLAY_RATES) as ReplayRate[]).map((rate) => (
          <button
            key={rate}
            type="button"
            aria-pressed={replay.rate === rate}
            onClick={() => replay.setRate(rate)}
            style={pillStyle(replay.rate === rate)}
          >
            {rate}
          </button>
        ))}
      </div>
      {replay.t !== null && (
        <button type="button" onClick={replay.reset} style={pillStyle(false)}>
          {t("track:map.replay.reset")}
        </button>
      )}
      <span className="t-caption">{t("track:map.replay.gaps")}</span>
    </div>
  );
}
