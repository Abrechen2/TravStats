import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { addDays, formatDayLong } from "../../../shared/time/calendar";
import { activePreset, rangeDays, type RangePreset, type TrackRange } from "./trackRange";
import { pillStyle } from "./trackMapStyle";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS: RangePreset[] = ["today", "yesterday", "week"];

/** „Heute, 25. Oktober", „19. – 25. Oktober", or the day in words. */
export function rangeLabel(
  range: TrackRange,
  today: string,
  language: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const short = (day: string) => formatDayLong(day, language, { day: "numeric", month: "long" });
  if (range.length === 7) {
    const days = rangeDays(range);
    return t("track:map.range.span", { from: short(days[0]), to: short(days[days.length - 1]) });
  }
  if (range.end === today) return t("track:map.range.today", { day: short(range.end) });
  if (range.end === addDays(today, -1)) {
    return t("track:map.range.yesterday", { day: short(range.end) });
  }
  return formatDayLong(range.end, language);
}

/**
 * The range bar (TravTrack plan T5.2, board „Track-Karte"): ‹ › step by the
 * range's length, the presets Heute, Gestern, 7 Tage, a day picker for a deep
 * link by hand, live follow, export and delete of the shown span.
 */
export default function TrackRangeBar({
  range,
  today,
  live,
  onRange,
  onPreset,
  onPick,
  onLive,
  onExport,
  onDelete,
}: {
  range: TrackRange;
  today: string;
  live: boolean;
  onRange: (direction: -1 | 1) => void;
  onPreset: (preset: RangePreset) => void;
  onPick: (day: string) => void;
  onLive: () => void;
  onExport: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const preset = activePreset(range, today);
  const stepStyle = { ...pillStyle(false), width: 44, minHeight: 44, padding: 0, fontSize: 18 };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="track-range-bar">
      <button
        type="button"
        aria-label={t("track:map.range.previous")}
        onClick={() => onRange(-1)}
        style={stepStyle}
      >
        ‹
      </button>
      <span
        className="flex flex-col"
        style={{ minWidth: 200, fontSize: 17, fontWeight: 700 }}
        data-testid="track-range-label"
      >
        {rangeLabel(range, today, i18n.language, t)}
      </span>
      <button
        type="button"
        aria-label={t("track:map.range.next")}
        onClick={() => onRange(1)}
        disabled={range.end >= today}
        style={{ ...stepStyle, opacity: range.end >= today ? 0.4 : 1 }}
      >
        ›
      </button>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={preset === p}
            onClick={() => onPreset(p)}
            style={pillStyle(preset === p)}
          >
            {t(`track:map.range.preset.${p}`)}
          </button>
        ))}
      </div>
      <input
        type="date"
        aria-label={t("track:day.label")}
        value={range.end}
        max={today}
        onChange={(e) => DAY.test(e.target.value) && onPick(e.target.value)}
        style={{ ...pillStyle(false), fontFamily: "var(--ts-font-mono)" }}
      />
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
  );
}
