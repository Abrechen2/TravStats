import { useEffect, useRef } from "react";

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
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const step = (max - min) / 3600;

    const tick = (): void => {
      onChange((prev) => {
        const next = prev + step;
        return next > max ? min : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, min, max, onChange]);

  const displayDate = new Date(current * 1000).toLocaleDateString();

  return (
    <div
      style={{ background: "rgba(22,27,34,0.85)" }}
      className="flex items-center gap-3 px-4 py-2 rounded-lg border border-(--border-default) text-sm"
    >
      <button
        aria-label={playing ? "Pause" : "Play"}
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
