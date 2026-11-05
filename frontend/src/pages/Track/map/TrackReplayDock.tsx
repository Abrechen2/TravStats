import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { floatingStyle } from "./TrackFloatingCard";
import TrackReplayBar from "./TrackReplayBar";
import { TRACK_COLOR } from "./trackMapLayers";
import { pillStyle } from "./trackMapStyle";
import type { Replay } from "./useReplay";

/**
 * „Wiedergabe" at the bottom of the map: folded to one button „Tag abspielen",
 * unfolded the replay bar. A replay that is running (a leg played from its
 * card, a scrubbed moment) keeps the bar open whatever the button last said.
 */
export default function TrackReplayDock({
  replay,
  zone,
  multiDay,
}: {
  replay: Replay;
  zone: string;
  multiDay: boolean;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const [opened, setOpened] = useState(false);
  // A replay that started (a leg played from its card) opens the bar and keeps it for the reset.
  useEffect(() => {
    if (replay.t !== null) setOpened(true);
  }, [replay.t]);
  const open = opened || replay.t !== null;
  if (!open) {
    return (
      <button
        type="button"
        data-testid="track-replay-open"
        onClick={() => setOpened(true)}
        style={{
          ...floatingStyle,
          ...pillStyle(false, coarse ? 44 : 40),
          background: floatingStyle.background,
          color: TRACK_COLOR,
          fontWeight: 600,
          padding: "0 16px",
        }}
      >
        ▶ {t("track:map.replay.open")}
      </button>
    );
  }
  return (
    <div className="flex w-full items-center gap-2" style={{ maxWidth: 720 }}>
      <div className="min-w-0 flex-1">
        <TrackReplayBar replay={replay} zone={zone} multiDay={multiDay} />
      </div>
      <button
        type="button"
        data-testid="track-replay-close"
        aria-label={t("track:map.replay.close")}
        title={t("track:map.replay.close")}
        onClick={() => {
          replay.reset();
          setOpened(false);
        }}
        style={{ ...floatingStyle, ...pillStyle(false, coarse ? 44 : 40), width: coarse ? 44 : 40 }}
      >
        ✕
      </button>
    </div>
  );
}
