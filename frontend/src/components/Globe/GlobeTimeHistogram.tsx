// Activity histogram that replaces the old three-mode time slider.
//
// One compact strip that IS both the filter and the playback control:
//   • bars per month — flights (amber) stacked with cruises (blue), so you
//     see WHEN you travelled, not a blank slider.
//   • drag across the bars → a [start,end] filter (store mode "filter").
//   • ▶ play → the playhead sweeps the range (store mode "live"); bars light
//     up as it passes.
//   • reset (✕) → show everything (store mode "off").
//
// State still lives in `useTimeSliderStore`; this component only drives it,
// so GlobeView's visibility logic is unchanged.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useTimeSliderStore, type TimeSliderSpeed } from "../../store/timeSliderStore";
import type { MonthBucket } from "./timeSliderUtils";

const SPEED_OPTIONS: TimeSliderSpeed[] = [7, 30, 90, 365];
const AMBER = "240,169,71";
const CRUISE = "111,160,214";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface Props {
  buckets: MonthBucket[];
  visibleFlights: number;
  visibleCruises: number;
  disabled?: boolean;
}

const fmt = (d: Date | null, locale: string): string =>
  d
    ? d.toLocaleDateString(locale, { year: "numeric", month: "short" })
    : "—";

export const GlobeTimeHistogram = ({
  buckets,
  visibleFlights,
  visibleCruises,
  disabled = false,
}: Props): JSX.Element => {
  const { t, i18n } = useTranslation(["map"]);
  const locale = i18n.language || "de";

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
  const setPlaying = useTimeSliderStore((s) => s.setPlaying);
  const togglePlaying = useTimeSliderStore((s) => s.togglePlaying);
  const setSpeed = useTimeSliderStore((s) => s.setSpeed);
  const setFilterRange = useTimeSliderStore((s) => s.setFilterRange);
  const reset = useTimeSliderStore((s) => s.reset);

  // ── Live-mode playback loop (wall-clock rate; ~10 Hz store commits) ──
  const lastTickRef = useRef<number | null>(null);
  const lastCommitRef = useRef<number>(0);
  const playheadRef = useRef<Date | null>(null);
  useEffect(() => {
    if (mode !== "live" || !isPlaying || !rangeMin || !rangeMax) {
      lastTickRef.current = null;
      lastCommitRef.current = 0;
      playheadRef.current = null;
      return;
    }
    let raf = 0;
    playheadRef.current =
      playheadRef.current ?? useTimeSliderStore.getState().currentDate ?? rangeMin;
    const tick = (now: number): void => {
      const last = lastTickRef.current ?? now;
      const dt = (now - last) / 1000;
      lastTickRef.current = now;
      const cur = playheadRef.current ?? rangeMin;
      const next = new Date(cur.getTime() + speed * dt * ONE_DAY_MS);
      if (next.getTime() >= rangeMax.getTime()) {
        setCurrentDate(rangeMax);
        setPlaying(false);
        playheadRef.current = null;
        return;
      }
      playheadRef.current = next;
      if (now - lastCommitRef.current >= 100) {
        lastCommitRef.current = now;
        setCurrentDate(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, isPlaying, speed, rangeMin, rangeMax, setCurrentDate, setPlaying]);

  // ── Brush drag over the bars ────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number | null>(null); // fraction 0..1
  const [dragRange, setDragRange] = useState<[number, number] | null>(null);

  const fracAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const dateAtFrac = (frac: number): Date => {
    if (!rangeMin || !rangeMax) return new Date();
    return new Date(rangeMin.getTime() + frac * (rangeMax.getTime() - rangeMin.getTime()));
  };
  const fracOfDate = (d: Date): number => {
    if (!rangeMin || !rangeMax) return 0;
    const span = rangeMax.getTime() - rangeMin.getTime();
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, (d.getTime() - rangeMin.getTime()) / span));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || !rangeMin || !rangeMax) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = fracAt(e.clientX);
    dragStartRef.current = f;
    setDragRange([f, f]);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragStartRef.current === null) return;
    const f = fracAt(e.clientX);
    setDragRange([dragStartRef.current, f]);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragStartRef.current === null) return;
    const startF = dragStartRef.current;
    const endF = fracAt(e.clientX);
    dragStartRef.current = null;
    setDragRange(null);
    // A tiny drag reads as a click → clear the filter (show everything).
    if (Math.abs(endF - startF) < 0.012) {
      if (mode !== "off") reset();
      return;
    }
    const [lo, hi] = startF <= endF ? [startF, endF] : [endF, startF];
    setMode("filter");
    setFilterRange(dateAtFrac(lo), dateAtFrac(hi));
  };

  const onPlay = (): void => {
    if (disabled) return;
    if (mode !== "live") setMode("live");
    togglePlaying();
  };

  if (!rangeMin || !rangeMax || buckets.length === 0) {
    return (
      <div className="rounded-xl border px-3 py-2 text-xs" style={panelStyle}>
        <span style={{ color: "rgba(241,245,249,0.5)" }}>{t("map:globe.timeSlider.noData")}</span>
      </div>
    );
  }

  const maxTotal = Math.max(1, ...buckets.map((b) => b.flights + b.cruises));
  const inFilter = mode === "filter" && filterStart && filterEnd;
  const filterLo = inFilter ? fracOfDate(filterStart) : 0;
  const filterHi = inFilter ? fracOfDate(filterEnd) : 1;
  const playFrac = mode === "live" && currentDate ? fracOfDate(currentDate) : null;

  // Which bar (index) the playhead is over — highlighted while playing.
  const barFrac = (i: number): [number, number] => [i / buckets.length, (i + 1) / buckets.length];
  const playBar =
    playFrac === null ? -1 : Math.min(buckets.length - 1, Math.floor(playFrac * buckets.length));

  const activeDrag = dragRange
    ? [Math.min(dragRange[0], dragRange[1]), Math.max(dragRange[0], dragRange[1])]
    : null;

  // Readout: range (filter) / current date (live) / all.
  const readout =
    mode === "filter" && filterStart && filterEnd
      ? `${fmt(filterStart, locale)} – ${fmt(filterEnd, locale)}`
      : mode === "live" && currentDate
        ? fmt(currentDate, locale)
        : t("map:globe.timeSlider.allTime");

  return (
    <div
      className="flex items-stretch gap-3 rounded-xl border p-3"
      style={{ ...panelStyle, minWidth: 460, maxWidth: 720 }}
    >
      {/* Play + speed */}
      <div className="flex flex-col items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={onPlay}
          disabled={disabled}
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm text-[#0a0d13] transition-opacity hover:opacity-90"
          style={{ background: `rgb(${AMBER})`, boxShadow: `0 3px 10px rgba(${AMBER},0.35)` }}
          aria-label={t(`map:globe.timeSlider.${isPlaying ? "pause" : "play"}`)}
          title={t(`map:globe.timeSlider.${isPlaying ? "pause" : "play"}`)}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <div className="flex gap-0.5">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className="rounded px-1 py-0.5 text-[9px] tabular-nums transition-colors"
              style={
                speed === s
                  ? { color: `rgb(${AMBER})`, background: `rgba(${AMBER},0.15)` }
                  : { color: "rgba(241,245,249,0.4)" }
              }
              title={t("map:globe.timeSlider.daysPerSec", { n: s })}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Histogram + readout + axis */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span
            className="flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: "rgba(241,245,249,0.62)" }}
          >
            📊 {t("map:globe.timeSlider.title")}
          </span>
          <span className="flex items-center gap-2 text-[12px] font-semibold tabular-nums">
            <span>{readout}</span>
            <span style={{ color: "rgba(241,245,249,0.55)", fontWeight: 500 }}>
              · {visibleFlights} {t("map:globe.timeSlider.flights")} · {visibleCruises}{" "}
              {t("map:globe.timeSlider.cruises")}
            </span>
            {mode !== "off" && (
              <button
                type="button"
                onClick={() => reset()}
                className="ml-1 rounded px-1.5 text-[11px] leading-none"
                style={{ color: "rgba(241,245,249,0.6)", background: "rgba(255,255,255,0.06)" }}
                title={t("map:globe.timeSlider.reset")}
              >
                ✕
              </button>
            )}
          </span>
        </div>

        {/* the bars */}
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative flex h-[64px] cursor-crosshair touch-none items-end gap-[2px] px-[1px]"
        >
          {buckets.map((b, i) => {
            const total = b.flights + b.cruises;
            const h = total === 0 ? 3 : 6 + (total / maxTotal) * 94;
            const [bf0, bf1] = barFrac(i);
            const outside = inFilter && (bf1 <= filterLo || bf0 >= filterHi);
            const isPlay = i === playBar;
            const fShare = total ? (b.flights / total) * 100 : 0;
            return (
              <div
                key={i}
                className="flex min-w-0 flex-1 flex-col-reverse overflow-hidden rounded-t-[2px]"
                style={{
                  height: `${h}%`,
                  opacity: outside ? 0.28 : 0.9,
                  boxShadow: isPlay ? `0 0 8px rgba(${AMBER},0.6)` : undefined,
                }}
              >
                <div style={{ height: `${fShare}%`, background: `rgb(${AMBER})` }} />
                <div style={{ height: `${100 - fShare}%`, background: `rgb(${CRUISE})` }} />
              </div>
            );
          })}

          {/* brush (committed filter) */}
          {inFilter && !activeDrag && (
            <div
              className="pointer-events-none absolute -top-1 -bottom-1 rounded-md"
              style={{
                left: `${filterLo * 100}%`,
                right: `${(1 - filterHi) * 100}%`,
                border: `1.5px solid rgba(${AMBER},0.7)`,
                background: `rgba(${AMBER},0.08)`,
              }}
            />
          )}
          {/* live drag preview */}
          {activeDrag && (
            <div
              className="pointer-events-none absolute -top-1 -bottom-1 rounded-md"
              style={{
                left: `${activeDrag[0] * 100}%`,
                right: `${(1 - activeDrag[1]) * 100}%`,
                border: `1.5px solid rgba(${AMBER},0.8)`,
                background: `rgba(${AMBER},0.1)`,
              }}
            />
          )}
          {/* playhead */}
          {playFrac !== null && (
            <div
              className="pointer-events-none absolute -top-1 -bottom-1 w-[2px]"
              style={{ left: `${playFrac * 100}%`, background: "#fff", boxShadow: "0 0 8px rgba(255,255,255,0.7)" }}
            />
          )}
        </div>

        {/* year axis */}
        <div
          className="flex justify-between px-[2px] text-[9.5px] tabular-nums"
          style={{ color: "rgba(241,245,249,0.4)" }}
        >
          <span>{rangeMin.getUTCFullYear()}</span>
          <span>{rangeMax.getUTCFullYear()}</span>
        </div>
      </div>
    </div>
  );
};

const panelStyle: React.CSSProperties = {
  background: "rgba(13,17,23,0.86)",
  backdropFilter: "blur(16px)",
  borderColor: "rgba(255,255,255,0.14)",
  color: "rgba(241,245,249,0.95)",
  fontFamily: "'Inter', sans-serif",
  boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
};
