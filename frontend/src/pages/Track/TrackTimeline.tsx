import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { formatTime } from "../../lib/displayFormat";
import type { TravTrackDay } from "../../lib/api/travtrack";

/**
 * The day as TravStats knows it (TravTrack plan T6): its flights, the trips
 * spanning it and the stretches at home, in time order, each linked to its
 * entry. TravTrack suggests nothing here yet (phase 3); these are labels.
 */

interface Props {
  day: TravTrackDay;
}

const pathOf = (kind: "flight" | "trip" | "home", id: string | null): string | null =>
  id === null
    ? null
    : kind === "flight"
      ? `/flights/${id}`
      : kind === "trip"
        ? `/trips/${id}`
        : null;

export default function TrackTimeline({ day }: Props): JSX.Element {
  const { t } = useTranslation(["track"]);
  const clock = (ms: number) => formatTime(ms, { timeZone: day.zone });
  // A span running to the end of the day ends at 24:00, not at the next day's 00:00.
  const dayEnd = day.coverage[day.coverage.length - 1]?.untilMs;
  const until = (ms: number) => (ms === dayEnd ? t("track:timeline.endOfDay") : clock(ms));
  return (
    <section className="flex flex-col gap-2" aria-label={t("track:timeline.title")}>
      <h2 className="t-card-title">{t("track:timeline.title")}</h2>
      {day.context.length === 0 ? (
        <p className="t-caption">{t("track:timeline.none")}</p>
      ) : (
        <ol className="flex flex-col gap-1" data-testid="track-timeline">
          {day.context.map((item) => {
            const label = t(`track:timeline.${item.kind}`, { label: item.label });
            const path = pathOf(item.kind, item.id);
            return (
              <li
                key={`${item.kind}-${item.id ?? ""}-${item.fromMs}`}
                className="flex gap-3 t-body"
              >
                <span className="t-caption tabular-nums">
                  {t("track:timeline.span", { from: clock(item.fromMs), to: until(item.untilMs) })}
                </span>
                {path ? <Link to={path}>{label}</Link> : <span>{label}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
