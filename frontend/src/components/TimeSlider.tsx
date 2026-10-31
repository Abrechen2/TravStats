import { useEffect, useRef } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { formatDate } from "../lib/displayFormat";

const FRAME_MS = 1000 / 60;
/** ~30 Hz: a commit rebuilds the trips layers. A frame slightly under 33 ms still commits. */
const MIN_COMMIT_INTERVAL_MS = 30;
/** A stalled tab must not leap across the whole range when it wakes. */
const MAX_STEP_MS = 100;

interface TimeSliderProps {
  min: number;
  max: number;
  current: number;
  onChange: (value: number | ((prev: number) => number)) => void;
  playing: boolean;
  onTogglePlay: () => void;
}

export function TimeSlider({
  min,
  max,
  current,
  onChange,
  playing,
  onTogglePlay,
}: TimeSliderProps): JSX.Element {
  const { t } = useTranslation(["common"]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    // One full pass takes 3600 frames at 60 Hz, i.e. a minute. Commits are
    // throttled to ~30 Hz (each one rebuilds the map's trips layers) and the
    // step scales with the time since the last commit, so the speed is unchanged.
    const stepPerMs = (max - min) / 3600 / FRAME_MS;
    let lastCommit: number | null = null;

    const tick = (now: number): void => {
      rafRef.current = requestAnimationFrame(tick);
      if (lastCommit === null) {
        lastCommit = now;
        return;
      }
      const elapsed = now - lastCommit;
      if (elapsed < MIN_COMMIT_INTERVAL_MS) return;
      lastCommit = now;
      const step = stepPerMs * Math.min(elapsed, MAX_STEP_MS);
      onChange((prev) => {
        const next = prev + step;
        return next > max ? min : next;
      });
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, min, max, onChange]);

  const displayDate = formatDate(current * 1000);

  return (
    <div
      style={{ background: "rgba(22,27,34,0.85)" }}
      className="flex items-center gap-3 px-4 py-2 rounded-lg border border-(--border-default) text-sm"
    >
      <button
        aria-label={playing ? t("common:accessibility.pause") : t("common:accessibility.play")}
        onClick={onTogglePlay}
        className="p-1 rounded-sm hover:bg-(--bg-elevated)"
      >
        {playing ? "⏸" : "▶"}
      </button>
      <input
        role="slider"
        type="range"
        min={min}
        max={max}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-48 accent-(--accent-primary)"
      />
      <span className="text-(--text-muted) min-w-[90px]">{displayDate}</span>
    </div>
  );
}
