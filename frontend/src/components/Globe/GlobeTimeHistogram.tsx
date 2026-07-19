// Activity histogram that replaces the old three-mode time slider.
//
// One compact strip that IS both the filter and the playback control:
//   • bars per month — flights (amber) stacked with cruises (blue), so you
//     see WHEN you travelled, not a blank slider.
//   • drag across the bars → a [start,end] filter (store mode "filter").
//   • grab the handle and drag → scrub time by hand (store mode "live").
//   • ▶ play → the handle sweeps the range on its own; bars light up as it
//     passes. Speed presets tune how fast.
//   • reset (✕) → show everything (store mode "off").
//
// Collapsed to a slim strip by default so it barely covers the map; it
// grows to the full control surface on hover (or while playing / dragging).
//
// State still lives in `useTimeSliderStore`; this component only drives it,
// so GlobeView's visibility logic is unchanged.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useTimeSliderStore } from "../../store/timeSliderStore";
import type { MonthBucket } from "./timeSliderUtils";

const AMBER = "240,169,71";
const CRUISE = "111,160,214";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Bar-row height in each state. The row animates between the two so the
// strip "unfolds" rather than snapping.
const BAR_H_COLLAPSED = 22;
const BAR_H_EXPANDED = 64;

interface Props {
  buckets: MonthBucket[];
  visibleFlights: number;
  visibleCruises: number;
  disabled?: boolean;
}

// "Nice" step sizes for a year axis, in ascending order — pick the smallest
// one that keeps the tick count at or under `maxTicks` so a wide range
// (say 2012–2026) doesn't print every single year.
const NICE_YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/**
 * Evenly-ish spaced year labels across [minYear, maxYear], not just the two
 * endpoints — a range spanning several years used to show only its start
 * and end, which reads as "the axis ends abruptly" rather than a real
 * timeline. Always includes both endpoints (even if that means the final
 * gap is shorter than `step`) so the actual range bounds stay visible.
 */
export function computeYearTicks(minYear: number, maxYear: number, maxTicks = 6): number[] {
  if (maxYear <= minYear) return [minYear];
  const span = maxYear - minYear;
  const step =
    NICE_YEAR_STEPS.find((s) => Math.floor(span / s) + 1 <= maxTicks) ??
    NICE_YEAR_STEPS[NICE_YEAR_STEPS.length - 1];
  const ticks: number[] = [];
  for (let y = minYear; y < maxYear; y += step) ticks.push(y);
  ticks.push(maxYear);
  return ticks;
}

const fmt = (d: Date | null, locale: string): string =>
  d ? d.toLocaleDateString(locale, { year: "numeric", month: "short" }) : "—";

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

  // ── Hover / interaction expansion ───────────────────────────────────
  const [hovered, setHovered] = useState(false);

  // ── Geometry helpers ────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const fracAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const dateAtFrac = (frac: number): Date => {
    if (!rangeMin || !rangeMax) return new Date(0);
    return new Date(rangeMin.getTime() + frac * (rangeMax.getTime() - rangeMin.getTime()));
  };
  const fracOfDate = (d: Date): number => {
    if (!rangeMin || !rangeMax) return 0;
    const span = rangeMax.getTime() - rangeMin.getTime();
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, (d.getTime() - rangeMin.getTime()) / span));
  };

  // ── Brush drag over the bars (→ filter window) ──────────────────────
  const dragStartRef = useRef<number | null>(null); // fraction 0..1
  const [dragRange, setDragRange] = useState<[number, number] | null>(null);

  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || !rangeMin || !rangeMax) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = fracAt(e.clientX);
    dragStartRef.current = f;
    setDragRange([f, f]);
  };
  const onTrackMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragStartRef.current === null) return;
    const f = fracAt(e.clientX);
    setDragRange([dragStartRef.current, f]);
  };
  const onTrackUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
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

  // ── Scrub handle drag (→ live cursor, by hand) ──────────────────────
  const scrubbingRef = useRef(false);
  const [scrubbing, setScrubbing] = useState(false);

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || !rangeMin || !rangeMax) return;
    e.stopPropagation(); // don't start a brush drag
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbingRef.current = true;
    setScrubbing(true);
    if (mode !== "live") setMode("live");
    setPlaying(false);
    setCurrentDate(dateAtFrac(fracAt(e.clientX)));
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!scrubbingRef.current) return;
    setCurrentDate(dateAtFrac(fracAt(e.clientX)));
  };
  const onHandleUp = (): void => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setScrubbing(false);
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

  const expanded = hovered || isPlaying || dragRange !== null || scrubbing;

  const maxTotal = Math.max(1, ...buckets.map((b) => b.flights + b.cruises));
  const inFilter = mode === "filter" && filterStart !== null && filterEnd !== null;
  const filterLo = inFilter ? fracOfDate(filterStart) : 0;
  const filterHi = inFilter ? fracOfDate(filterEnd) : 1;

  // Which bar the live cursor is over — highlighted while playing/scrubbing.
  const liveFrac = mode === "live" && currentDate ? fracOfDate(currentDate) : null;
  const playBar =
    liveFrac === null ? -1 : Math.min(buckets.length - 1, Math.floor(liveFrac * buckets.length));

  const activeDrag = dragRange
    ? [Math.min(dragRange[0], dragRange[1]), Math.max(dragRange[0], dragRange[1])]
    : null;

  // The scrub handle shows in every mode except filter (where the brush
  // owns the strip). In off mode it rests at the far right ("now") as a
  // hint that it can be grabbed; in live mode it tracks the cursor.
  const showHandle = mode !== "filter";
  const handleFrac = liveFrac ?? 1;
  const handleGhost = mode !== "live";

  // Readout: range (filter) / current date (live) / all.
  const readout =
    mode === "filter" && filterStart && filterEnd
      ? `${fmt(filterStart, locale)} – ${fmt(filterEnd, locale)}`
      : mode === "live" && currentDate
        ? fmt(currentDate, locale)
        : t("map:globe.timeSlider.allTime");

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="flex items-stretch gap-3 rounded-xl border"
      style={{
        ...panelStyle,
        padding: expanded ? 12 : "6px 10px",
        minWidth: expanded ? 460 : 300,
        maxWidth: 720,
        transition: "min-width 160ms ease, padding 160ms ease",
      }}
    >
      {/* Play — only when expanded. The per-speed (7/30/90/365 days/sec)
          selector that used to sit under this button was removed: it read
          as broken to users since its effect only shows up mid-playback and
          disappears again once the run finishes — playback now always runs
          at DEFAULT_SPEED (timeSliderStore.ts). */}
      {expanded && (
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
        </div>
      )}

      {/* Histogram + (expanded) readout + axis */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {expanded && (
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
                  className="ml-1 rounded-sm px-1.5 text-[11px] leading-none"
                  style={{ color: "rgba(241,245,249,0.6)", background: "rgba(255,255,255,0.06)" }}
                  title={t("map:globe.timeSlider.reset")}
                >
                  ✕
                </button>
              )}
            </span>
          </div>
        )}

        {/* the bars */}
        <div
          ref={trackRef}
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerUp={onTrackUp}
          className="relative flex cursor-crosshair touch-none items-end gap-[2px] px-px"
          style={{
            height: expanded ? BAR_H_EXPANDED : BAR_H_COLLAPSED,
            transition: "height 160ms ease",
          }}
        >
          {buckets.map((b, i) => {
            const total = b.flights + b.cruises;
            const h = total === 0 ? 3 : 6 + (total / maxTotal) * 94;
            const [bf0, bf1] = [i / buckets.length, (i + 1) / buckets.length];
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

          {/* draggable scrub handle (playhead). The vertical overhang past
              the bars (6px expanded) is fixed in absolute terms, so it has
              to shrink in the collapsed 22px-tall strip (2px) — otherwise it
              eats the entire collapsed padding and sits flush against the
              panel's rounded border instead of looking like a handle. */}
          {showHandle && (
            <div
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              className="group absolute z-10 flex touch-none justify-center"
              style={{
                left: `calc(${handleFrac * 100}% - 8px)`,
                top: expanded ? -6 : -2,
                bottom: expanded ? -6 : -2,
                width: 16,
                cursor: "ew-resize",
                opacity: handleGhost && !scrubbing ? 0.5 : 1,
              }}
              title={t("map:globe.timeSlider.scrubHint")}
              aria-label={t("map:globe.timeSlider.scrubHint")}
            >
              {/* the line */}
              <div
                className="w-[2px]"
                style={{ background: "#fff", boxShadow: "0 0 8px rgba(255,255,255,0.7)" }}
              />
              {/* the knob */}
              <div
                className="absolute top-0 h-3 w-3 rounded-full border transition-transform group-hover:scale-110"
                style={{
                  background: "#fff",
                  borderColor: `rgba(${AMBER},0.9)`,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                }}
              />
            </div>
          )}
        </div>

        {/* year axis — expanded only. Ticks sit at their real chronological
            position (via fracOfDate), not evenly spaced by index — the
            range rarely starts/ends on a year boundary, so a plain
            flex/justify-between row would misplace every intermediate
            label. */}
        {expanded && (
          <div className="relative h-[11px] text-[9.5px] tabular-nums" style={{ color: "rgba(241,245,249,0.4)" }}>
            {computeYearTicks(rangeMin.getUTCFullYear(), rangeMax.getUTCFullYear()).map((year, i, arr) => {
              const frac = fracOfDate(new Date(Date.UTC(year, 0, 1)));
              const isFirst = i === 0;
              const isLast = i === arr.length - 1;
              return (
                <span
                  key={year}
                  className="absolute px-[2px]"
                  style={{
                    left: `${frac * 100}%`,
                    transform: isFirst ? "none" : isLast ? "translateX(-100%)" : "translateX(-50%)",
                  }}
                >
                  {year}
                </span>
              );
            })}
          </div>
        )}
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
