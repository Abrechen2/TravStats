import type { JSX } from "react";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatDayLong } from "../../../shared/time/calendar";
import type { DayResult } from "./trackRange";
import type { RangeReadState } from "./useRangeRead";

type Failed = Extract<DayResult, { kind: "failed" }>;
type Loaded = Extract<DayResult, { kind: "loaded" }>;

/**
 * What the reads said beyond the drawing: a day that failed, by name, with a
 * retry; a range still arriving in parts, with how far it got; a range part
 * that failed, keeping what arrived; and what was left out or simplified.
 * Nothing that failed is ever shown as an empty map.
 */
export default function TrackMapNotices({
  long,
  dayResults,
  range,
  onRetry,
  onResume,
}: {
  long: boolean;
  dayResults: readonly DayResult[];
  range: RangeReadState | null;
  onRetry: () => void;
  onResume: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const failed = dayResults.filter((r): r is Failed => r.kind === "failed");
  const truncated = dayResults.filter((r): r is Loaded => r.kind === "loaded" && r.day.truncated);
  const parts = range?.parts ?? [];
  const simplified = parts.some((p) => p.simplified);
  const omitted = parts.reduce((n, p) => n + p.omittedSegments, 0);
  const warn = { color: token("warn") };
  return (
    <>
      {failed.length > 0 && (
        <div role="alert" className="flex flex-col gap-1" data-testid="track-failed-days">
          {failed.map((f) => (
            <p key={f.date} className="t-body" style={{ color: token("bad") }}>
              {t("track:map.dayFailed", {
                day: formatDayLong(f.date, i18n.language),
                reason: t(f.key),
              })}
            </p>
          ))}
          <button type="button" className="self-start underline" onClick={onRetry}>
            {t("track:map.retry")}
          </button>
        </div>
      )}
      {range?.kind === "loading" && (
        <div className="flex flex-col gap-1" role="status" data-testid="track-range-progress">
          <p className="t-caption">
            {t("track:map.rangeLoading", {
              parts: parts.length,
              percent: Math.round(range.progress * 100),
            })}
          </p>
          <progress
            value={Math.round(range.progress * 100)}
            max={100}
            aria-label={t("track:map.rangeProgress")}
            style={{ width: "100%", accentColor: token("live") }}
          />
        </div>
      )}
      {range?.kind === "failed" && (
        <div role="alert" className="flex flex-col gap-1" data-testid="track-range-failed">
          <p className="t-body" style={{ color: token("bad") }}>
            {parts.length > 0
              ? t("track:map.rangePartFailed", {
                  percent: Math.round(range.progress * 100),
                  reason: t(range.key),
                })
              : t(range.key)}
          </p>
          <button type="button" className="self-start underline" onClick={onResume}>
            {t(parts.length > 0 ? "track:map.rangeResume" : "track:map.retry")}
          </button>
        </div>
      )}
      {!long &&
        truncated.map((r) => (
          <p key={r.date} className="t-caption" role="status" style={warn}>
            {dayResults.length > 1 ? `${formatDayLong(r.date, i18n.language)}: ` : ""}
            {t("track:day.truncated")}
          </p>
        ))}
      {long && simplified && (
        <p className="t-caption" data-testid="track-range-simplified">
          {t("track:map.rangeSimplified")}
        </p>
      )}
      {long && omitted > 0 && (
        <p className="t-caption" role="status" style={warn}>
          {t("track:map.rangeOmitted", { count: omitted })}
        </p>
      )}
    </>
  );
}
