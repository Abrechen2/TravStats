import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatTime } from "../../lib/format";
import { logger } from "../../lib/logger";
import { trackErrorKey, type TravTrackDay } from "../../lib/api/travtrack";
import { daySourcesApi, type DaySourceChoice } from "../../lib/api/travtrackDaySources";
import { Select } from "../../components/ui/Field";
import Button from "../../components/ui/Button";
import { token } from "../../components/ui/tokens";
import { kindOf, nameOf, sourceLabel } from "./trackDaySources";

interface Props {
  day: TravTrackDay;
  /** The choice was stored: read the day again. */
  onChanged: () => void;
}

const AUTO = "";

/**
 * Which source the day is drawn and counted from (best source per day): the
 * source in use — or the hand-off within the day — a switch to choose another
 * for the whole day, the outliers left out and the estimated stretches. Shown
 * only when there is something to say: more than one source, an outlier, an
 * estimated stretch, a clock offset, or a day not yet resolved.
 */
export default function TrackDaySources({ day, onChanged }: Props): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = day.sources;
  if (!s) return null;
  const estimated = day.estimated?.length ?? 0;
  const bridges = day.bridgeLines?.length ?? 0;
  const worth =
    !s.scored ||
    s.sources.length > 1 ||
    s.outliers.count > 0 ||
    estimated > 0 ||
    bridges > 0 ||
    s.clockOffset !== null;
  if (!worth) return null;

  const choose = async (choice: DaySourceChoice): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await daySourcesApi.choose(day.date, choice);
      onChanged();
    } catch (err) {
      logger.warn("TravTrack day source choice failed", err);
      setError(trackErrorKey(err));
    } finally {
      setBusy(false);
    }
  };
  const clock = (ms: number) => formatTime(ms, { timeZone: day.zone });
  const label = (source: string) =>
    sourceLabel(t, source, kindOf(day, source), nameOf(day, source));
  const used =
    s.segments.length > 1
      ? s.segments
          .map((g) =>
            t("track:daySources.segment", { source: label(g.source), from: clock(g.fromMs) })
          )
          .join(" · ")
      : s.segments[0]
        ? label(s.segments[0].source)
        : t("track:daySources.none");

  return (
    <section
      className="flex flex-wrap items-center gap-3 px-3 py-2"
      aria-label={t("track:daySources.title")}
      data-testid="track-day-sources"
      style={{ borderBottom: `1px solid ${token("border")}` }}
    >
      {!s.scored ? (
        <span className="t-caption">{t("track:daySources.notScored")}</span>
      ) : (
        <>
          <span className="t-body" data-testid="track-day-sources-used">
            {t(s.override ? "track:daySources.usedChosen" : "track:daySources.used", {
              source: used,
            })}
          </span>
          {s.sources.length > 1 && (
            <label className="t-caption flex max-w-full min-w-0 flex-wrap items-center gap-2">
              {t("track:daySources.choose")}
              {/* The shared control is width 100%, which inside this row's wrapping
                  flex label squeezed it to a sliver: it sizes to its longest option
                  now, never wider than the row. */}
              <Select
                style={{ width: "auto", maxWidth: "100%", minWidth: "14rem" }}
                value={s.override ?? AUTO}
                disabled={busy}
                onChange={(e) =>
                  void choose({ overrideSource: e.target.value === AUTO ? null : e.target.value })
                }
                data-testid="track-day-sources-select"
              >
                <option value={AUTO}>{t("track:daySources.auto")}</option>
                {s.sources.map((src) => (
                  <option key={src.source} value={src.source}>
                    {t("track:daySources.option", {
                      source: sourceLabel(t, src.source, src.kind, src.name),
                      score: Math.round(src.score * 100),
                      count: src.points,
                    })}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {s.outliers.count > 0 && (
            <span className="t-caption flex items-center gap-2" data-testid="track-day-outliers">
              {t(
                s.outliers.decision === "keep"
                  ? "track:daySources.outliersKept"
                  : "track:daySources.outliers",
                { count: s.outliers.count }
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  void choose({
                    outlierDecision: s.outliers.decision === "keep" ? null : "keep",
                  })
                }
              >
                {t(
                  s.outliers.decision === "keep"
                    ? "track:daySources.outliersHide"
                    : "track:daySources.outliersShow"
                )}
              </Button>
            </span>
          )}
        </>
      )}
      {estimated > 0 && (
        <span className="t-caption" data-testid="track-day-estimated">
          {t("track:daySources.estimated", { count: estimated })}
        </span>
      )}
      {bridges > 0 && (
        <span className="t-caption">{t("track:daySources.bridged", { count: bridges })}</span>
      )}
      {s.clockOffset && (
        <span className="t-caption" role="note" data-testid="track-day-clock-offset">
          {t("track:daySources.clockOffset", {
            source: label(s.clockOffset.source),
            minutes: Math.round(s.clockOffset.offsetS / 60),
          })}
        </span>
      )}
      {error && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(error)}
        </p>
      )}
    </section>
  );
}
