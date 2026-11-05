import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";
import { LastSeenLine } from "../../../components/Dashboard/LastSeenCard";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { addDays, dayParts, formatDayLong } from "../../../shared/time/calendar";
import {
  activeSpanPreset,
  atPresent,
  customSpan,
  type SpanPreset,
  type TrackSpan,
} from "./trackSpan";
import { pillStyle, panelStyle } from "./trackMapStyle";

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
      style={{ ...panelStyle, padding: 10 }}
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

/** Where the TravTrack settings open with the shown range, for export and delete. */
export function settingsHref(span: TrackSpan): string {
  return `/settings/travtrack?from=${span.fromDay}&until=${span.toDay}`;
}

/**
 * The time bar under the app header (web redesign 2026-11-05): ‹ › step by the
 * span's own size, the day picker, the presets Tag, Gestern, 7 Tage, Monat, Jahr
 * and Eigener (two days in a popover, applied together), the day's coverage
 * strip (`strip`), „Zuletzt gesehen" and the gear to the TravTrack settings,
 * which now hold export and delete of the shown range.
 */
export default function TrackRangeBar({
  span,
  today,
  strip,
  onStep,
  onPreset,
  onSpan,
}: {
  span: TrackSpan;
  today: string;
  /** The coverage of a single day; null for a span of several. */
  strip: ReactNode | null;
  onStep: (direction: -1 | 1) => void;
  onPreset: (preset: SpanPreset) => void;
  onSpan: (span: TrackSpan) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const min = coarse ? 44 : 40;
  const preset = activeSpanPreset(span, today);
  const [picking, setPicking] = useState(span.kind === "custom");
  const stepStyle = { ...pillStyle(false, min), width: min, padding: 0, fontSize: 18 };
  const end = atPresent(span, today);
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
      data-testid="track-range-bar"
      style={{
        background: "var(--ts-surface)",
        borderBottom: "1px solid var(--ts-border)",
        padding: "6px 16px",
      }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t("track:map.range.previous")}
          onClick={() => onStep(-1)}
          style={stepStyle}
        >
          ‹
        </button>
        <span
          style={{ minWidth: 150, fontSize: 16, fontWeight: 700 }}
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
        <input
          type="date"
          aria-label={t("track:day.label")}
          value={span.toDay}
          max={today}
          onChange={(e) =>
            DAY.test(e.target.value) &&
            onSpan({ kind: "day", fromDay: e.target.value, toDay: e.target.value })
          }
          style={{ ...dateStyle, minHeight: min }}
        />
      </div>
      <div className="relative flex flex-wrap gap-1">
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
            style={pillStyle(p === "custom" ? picking || preset === p : preset === p, min)}
          >
            {t(`track:map.range.preset.${p}`)}
          </button>
        ))}
        {picking && (
          <div className="absolute left-0 top-full z-20 mt-1" style={{ minWidth: 300 }}>
            <CustomPicker span={span} today={today} onSpan={onSpan} />
          </div>
        )}
      </div>
      {strip && <div style={{ flex: "1 1 200px", minWidth: 160, maxWidth: 420 }}>{strip}</div>}
      <span className="flex-1" />
      <LastSeenLine />
      <Link
        to={settingsHref(span)}
        aria-label={t("track:map.range.settings")}
        title={t("track:map.range.settings")}
        data-testid="track-settings-link"
        style={{
          ...pillStyle(false, min),
          width: min,
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
        }}
      >
        <span aria-hidden>⚙</span>
      </Link>
    </div>
  );
}
