import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { addDays, dayParts, formatDayLong } from "../../../shared/time/calendar";
import {
  activeSpanPreset,
  atPresent,
  customSpan,
  type SpanPreset,
  type TrackSpan,
} from "./trackSpan";
import { pillStyle } from "./trackMapStyle";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS: SpanPreset[] = ["today", "yesterday", "week", "month", "year", "custom"];

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** „Heute, 25. Oktober", „19. – 25. Oktober", „Oktober 2026", „2026", or the day in words. */
export function spanLabel(span: TrackSpan, today: string, language: string, t: Translate): string {
  const short = (day: string) => formatDayLong(day, language, { day: "numeric", month: "long" });
  const long = (day: string) =>
    formatDayLong(day, language, { day: "numeric", month: "long", year: "numeric" });
  switch (span.kind) {
    case "month":
      return formatDayLong(span.fromDay, language, { month: "long", year: "numeric" });
    case "year":
      return String(dayParts(span.fromDay).year);
    case "week":
      return t("track:map.range.span", { from: short(span.fromDay), to: short(span.toDay) });
    case "custom":
      return t("track:map.range.span", { from: long(span.fromDay), to: long(span.toDay) });
    case "day":
      if (span.toDay === today) return t("track:map.range.today", { day: short(span.toDay) });
      if (span.toDay === addDays(today, -1)) {
        return t("track:map.range.yesterday", { day: short(span.toDay) });
      }
      return formatDayLong(span.toDay, language);
  }
}

const dateStyle = { ...pillStyle(false), fontFamily: "var(--ts-font-mono)" };

/** The two days of a Zeitraum, applied together — one picked day alone is no span yet. */
function CustomPicker({
  span,
  today,
  onSpan,
}: {
  span: TrackSpan;
  today: string;
  onSpan: (span: TrackSpan) => void;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const [from, setFrom] = useState(span.fromDay);
  const [to, setTo] = useState(span.toDay);
  useEffect(() => {
    setFrom(span.fromDay);
    setTo(span.toDay);
  }, [span.fromDay, span.toDay]);
  const valid = DAY.test(from) && DAY.test(to);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      data-testid="track-custom-range"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSpan(customSpan(from, to, today));
      }}
    >
      <input
        type="date"
        aria-label={t("track:map.range.from")}
        value={from}
        max={today}
        onChange={(e) => setFrom(e.target.value)}
        style={dateStyle}
      />
      <span aria-hidden>–</span>
      <input
        type="date"
        aria-label={t("track:map.range.to")}
        value={to}
        max={today}
        onChange={(e) => setTo(e.target.value)}
        style={dateStyle}
      />
      <button type="submit" disabled={!valid} style={pillStyle(true)}>
        {t("track:map.range.apply")}
      </button>
    </form>
  );
}

/**
 * The range bar (TravTrack plan T5.2 + T5.3, board „Track-Karte"): ‹ › step
 * by the span's own size, the presets Heute, Gestern, 7 Tage, Monat, Jahr and
 * Zeitraum (two days, applied together), a day picker for a deep link by
 * hand, live follow, export and delete of the shown span.
 */
export default function TrackRangeBar({
  span,
  today,
  live,
  onStep,
  onPreset,
  onSpan,
  onLive,
  onExport,
  onDelete,
}: {
  span: TrackSpan;
  today: string;
  live: boolean;
  onStep: (direction: -1 | 1) => void;
  onPreset: (preset: SpanPreset) => void;
  onSpan: (span: TrackSpan) => void;
  onLive: () => void;
  onExport: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const preset = activeSpanPreset(span, today);
  const [picking, setPicking] = useState(span.kind === "custom");
  const stepStyle = { ...pillStyle(false), width: 44, minHeight: 44, padding: 0, fontSize: 18 };
  const end = atPresent(span, today);
  return (
    <div className="flex flex-col gap-2" data-testid="track-range-bar">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={t("track:map.range.previous")}
          onClick={() => onStep(-1)}
          style={stepStyle}
        >
          ‹
        </button>
        <span
          className="flex flex-col"
          style={{ minWidth: 200, fontSize: 17, fontWeight: 700 }}
          data-testid="track-range-label"
        >
          {spanLabel(span, today, i18n.language, t)}
        </span>
        <button
          type="button"
          aria-label={t("track:map.range.next")}
          onClick={() => onStep(1)}
          disabled={end}
          style={{ ...stepStyle, opacity: end ? 0.4 : 1 }}
        >
          ›
        </button>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === "custom" ? picking || preset === p : preset === p}
              onClick={() => {
                if (p === "custom") return setPicking((open) => !open);
                setPicking(false);
                onPreset(p);
              }}
              style={pillStyle(p === "custom" ? picking || preset === p : preset === p)}
            >
              {t(`track:map.range.preset.${p}`)}
            </button>
          ))}
        </div>
        {span.kind === "day" && (
          <input
            type="date"
            aria-label={t("track:day.label")}
            value={span.toDay}
            max={today}
            onChange={(e) =>
              DAY.test(e.target.value) &&
              onSpan({ kind: "day", fromDay: e.target.value, toDay: e.target.value })
            }
            style={dateStyle}
          />
        )}
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={live}
          onClick={onLive}
          style={{ ...pillStyle(live), minHeight: 44 }}
        >
          {t(live ? "track:map.live.on" : "track:map.live.off")}
        </button>
        <button type="button" onClick={onExport} style={{ ...pillStyle(false), minHeight: 44 }}>
          {t("track:actions.export")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          style={{
            ...pillStyle(false),
            minHeight: 44,
            color: "var(--ts-warn)",
            borderColor: "color-mix(in srgb, var(--ts-warn) 50%, transparent)",
          }}
        >
          {t("track:actions.delete")}
        </button>
      </div>
      {picking && <CustomPicker span={span} today={today} onSpan={onSpan} />}
    </div>
  );
}
