import { useEffect, useRef } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  useTimeSliderStore,
  type TimeSliderMode,
  type TimeSliderSpeed,
} from "../../store/timeSliderStore";

/**
 * Bottom-center control bar for the Globe view. Three exclusive modes
 * (Off / Live / Filter) drive the visibility logic in GlobeView.tsx
 * via the shared `useTimeSliderStore`. The bar is hidden entirely when
 * the dataset has no usable dates (computed by the parent and signalled
 * via `disabled`).
 */

interface GlobeTimeSliderProps {
  /** Number of flights/cruises currently visible in the active mode.
   * Shown next to the scrubber so the user can correlate position to
   * outcome ("ahh, in 2018 I'd done 14 flights"). */
  visibleFlights: number;
  visibleCruises: number;
  /** When true the panel only shows the title and a "no dated trips"
   * hint. Mode toggles stay clickable but won't change anything. */
  disabled?: boolean;
}

const MODE_OPTIONS: TimeSliderMode[] = ["off", "live", "filter"];
const SPEED_OPTIONS: TimeSliderSpeed[] = [7, 30, 90, 365];

const formatDate = (d: Date | null): string => {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

const dateToPercent = (d: Date, min: Date, max: Date): number => {
  const span = max.getTime() - min.getTime();
  if (span <= 0) return 0;
  return ((d.getTime() - min.getTime()) / span) * 100;
};

const percentToDate = (p: number, min: Date, max: Date): Date => {
  const span = max.getTime() - min.getTime();
  return new Date(min.getTime() + (p / 100) * span);
};

export const GlobeTimeSlider = ({
  visibleFlights,
  visibleCruises,
  disabled = false,
}: GlobeTimeSliderProps): JSX.Element => {
  const { t } = useTranslation(["map"]);
  const mode = useTimeSliderStore((s) => s.mode);
  const rangeMin = useTimeSliderStore((s) => s.rangeMin);
  const rangeMax = useTimeSliderStore((s) => s.rangeMax);
  const currentDate = useTimeSliderStore((s) => s.currentDate);
  const isPlaying = useTimeSliderStore((s) => s.isPlaying);
  const speed = useTimeSliderStore((s) => s.speed);
  const filterStart = useTimeSliderStore((s) => s.filterStart);
  const filterEnd = useTimeSliderStore((s) => s.filterEnd);
  const setMode = useTimeSliderStore((s) => s.setMode);
  const setCurrentDate = useTimeSliderStore((s) => s.setCurrentDate);
  const togglePlaying = useTimeSliderStore((s) => s.togglePlaying);
  const setPlaying = useTimeSliderStore((s) => s.setPlaying);
  const setSpeed = useTimeSliderStore((s) => s.setSpeed);
  const setFilterRange = useTimeSliderStore((s) => s.setFilterRange);

  // requestAnimationFrame loop for live-mode playback. Uses deltaT so
  // the rate is wall-clock (speed = days per real-time second), not
  // frames per second. When the cursor reaches rangeMax we stop —
  // looping forever was the first instinct but felt cheap, like a
  // weather radar.
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (mode !== "live" || !isPlaying || !rangeMin || !rangeMax) {
      lastTickRef.current = null;
      return;
    }
    let raf = 0;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const tick = (now: number): void => {
      const last = lastTickRef.current ?? now;
      const dt = (now - last) / 1000;
      lastTickRef.current = now;
      const cur = useTimeSliderStore.getState().currentDate;
      const next = new Date((cur ?? rangeMin).getTime() + speed * dt * ONE_DAY_MS);
      if (next.getTime() >= rangeMax.getTime()) {
        setCurrentDate(rangeMax);
        setPlaying(false);
        return;
      }
      setCurrentDate(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, isPlaying, speed, rangeMin, rangeMax, setCurrentDate, setPlaying]);

  if (!rangeMin || !rangeMax) {
    return (
      <div className="bg-[var(--bg-surface)]/95 backdrop-blur rounded-lg shadow-lg px-3 py-2 border border-[var(--color-border)] text-xs text-[var(--text-muted)]">
        {t("map:globe.timeSlider.noData")}
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-surface)]/95 backdrop-blur rounded-lg shadow-lg p-3 border border-[var(--color-border)] flex flex-col gap-2 min-w-[420px] max-w-[640px]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          <span>📅</span>
          <span>{t("map:globe.timeSlider.title")}</span>
        </div>
        <div className="flex bg-[var(--bg-base)] rounded-md p-0.5 border border-[var(--color-border)]">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              disabled={disabled}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                mode === m
                  ? "bg-[var(--color-primary)] text-white font-medium"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t(
                `map:globe.timeSlider.${
                  m === "off" ? "modeOff" : m === "live" ? "modeLive" : "modeFilter"
                }`
              )}
            </button>
          ))}
        </div>
      </div>

      {mode === "live" && (
        <LiveControls
          rangeMin={rangeMin}
          rangeMax={rangeMax}
          currentDate={currentDate ?? rangeMin}
          isPlaying={isPlaying}
          speed={speed}
          onScrub={(d) => {
            setPlaying(false);
            setCurrentDate(d);
          }}
          onTogglePlay={togglePlaying}
          onSpeedChange={setSpeed}
          visibleFlights={visibleFlights}
          visibleCruises={visibleCruises}
          t={t}
        />
      )}

      {mode === "filter" && (
        <FilterControls
          rangeMin={rangeMin}
          rangeMax={rangeMax}
          start={filterStart ?? rangeMin}
          end={filterEnd ?? rangeMax}
          onChange={setFilterRange}
          visibleFlights={visibleFlights}
          visibleCruises={visibleCruises}
          t={t}
        />
      )}
    </div>
  );
};

/* ----------------------- Live mode subcomponent ----------------------- */

interface LiveControlsProps {
  rangeMin: Date;
  rangeMax: Date;
  currentDate: Date;
  isPlaying: boolean;
  speed: TimeSliderSpeed;
  onScrub: (d: Date) => void;
  onTogglePlay: () => void;
  onSpeedChange: (s: TimeSliderSpeed) => void;
  visibleFlights: number;
  visibleCruises: number;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

const LiveControls = ({
  rangeMin,
  rangeMax,
  currentDate,
  isPlaying,
  speed,
  onScrub,
  onTogglePlay,
  onSpeedChange,
  visibleFlights,
  visibleCruises,
  t,
}: LiveControlsProps): JSX.Element => (
  <>
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onTogglePlay}
        className="w-9 h-9 rounded-full bg-[var(--color-primary)] text-white text-sm flex items-center justify-center hover:opacity-90 transition-opacity"
        title={t(`map:globe.timeSlider.${isPlaying ? "pause" : "play"}`)}
        aria-label={t(`map:globe.timeSlider.${isPlaying ? "pause" : "play"}`)}
      >
        {isPlaying ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(dateToPercent(currentDate, rangeMin, rangeMax) * 10)}
        onChange={(e) => onScrub(percentToDate(Number(e.target.value) / 10, rangeMin, rangeMax))}
        className="flex-1 accent-[var(--color-primary)]"
        aria-label={t("map:globe.timeSlider.title")}
      />
      <div className="text-xs font-medium text-[var(--text-primary)] tabular-nums min-w-[88px] text-right">
        {formatDate(currentDate)}
      </div>
    </div>
    <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-1.5">
        <span>{t("map:globe.timeSlider.speed")}:</span>
        <div className="flex gap-1">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              className={`px-1.5 py-0.5 rounded text-[10px] tabular-nums transition-colors ${
                speed === s
                  ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] font-medium"
                  : "hover:text-[var(--text-primary)]"
              }`}
            >
              {t("map:globe.timeSlider.daysPerSec", { n: s })}
            </button>
          ))}
        </div>
      </div>
      <VisibleCounter visibleFlights={visibleFlights} visibleCruises={visibleCruises} t={t} />
    </div>
  </>
);

/* ----------------------- Filter mode subcomponent ----------------------- */

interface FilterControlsProps {
  rangeMin: Date;
  rangeMax: Date;
  start: Date;
  end: Date;
  onChange: (start: Date, end: Date) => void;
  visibleFlights: number;
  visibleCruises: number;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

const FilterControls = ({
  rangeMin,
  rangeMax,
  start,
  end,
  onChange,
  visibleFlights,
  visibleCruises,
  t,
}: FilterControlsProps): JSX.Element => (
  <>
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] w-7">
        {t("map:globe.timeSlider.rangeStart")}
      </span>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(dateToPercent(start, rangeMin, rangeMax) * 10)}
        onChange={(e) =>
          onChange(percentToDate(Number(e.target.value) / 10, rangeMin, rangeMax), end)
        }
        className="flex-1 accent-[var(--color-primary)]"
      />
      <div className="text-xs font-medium text-[var(--text-primary)] tabular-nums min-w-[88px] text-right">
        {formatDate(start)}
      </div>
    </div>
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] w-7">
        {t("map:globe.timeSlider.rangeEnd")}
      </span>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(dateToPercent(end, rangeMin, rangeMax) * 10)}
        onChange={(e) =>
          onChange(start, percentToDate(Number(e.target.value) / 10, rangeMin, rangeMax))
        }
        className="flex-1 accent-[var(--color-primary)]"
      />
      <div className="text-xs font-medium text-[var(--text-primary)] tabular-nums min-w-[88px] text-right">
        {formatDate(end)}
      </div>
    </div>
    <div className="flex justify-end">
      <VisibleCounter visibleFlights={visibleFlights} visibleCruises={visibleCruises} t={t} />
    </div>
  </>
);

const VisibleCounter = ({
  visibleFlights,
  visibleCruises,
  t,
}: {
  visibleFlights: number;
  visibleCruises: number;
  t: (key: string, vars?: Record<string, unknown>) => string;
}): JSX.Element => (
  <div className="text-[10px] tabular-nums">
    {t("map:globe.timeSlider.visible")}:{" "}
    <span className="text-[var(--text-primary)] font-medium">{visibleFlights}</span>{" "}
    {t("map:globe.timeSlider.flights")} /{" "}
    <span className="text-[var(--text-primary)] font-medium">{visibleCruises}</span>{" "}
    {t("map:globe.timeSlider.cruises")}
  </div>
);
