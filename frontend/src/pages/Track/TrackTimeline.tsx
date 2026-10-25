import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { formatTime } from "../../lib/displayFormat";
import type { TravTrackDay } from "../../lib/api/travtrack";
import { contextLabel } from "./trackContextLabel";
import { pillStyle } from "./map/trackMapStyle";
import type { SelectedFlight } from "./flight/TrackFlightPanel";

/**
 * The day as the logbook tells it (TravTrack plan T6, every domain since
 * E10): the entries TravStats holds — rides, nights, visits, flights — the
 * trips spanning it and the stretches at home, each linked to its page; the
 * day's open TravTrack questions, linked to their inbox card; and the moving
 * stretches nothing covers, "Unterwegs, ohne Eintrag". The server reads all
 * of it from TravStats' records and links; this list only words it.
 */

interface Props {
  day: TravTrackDay;
  /** A logbook flight picked for the flight panel (T5.3); absent, no flight is pickable. */
  onFlight?: (flight: SelectedFlight) => void;
  selectedFlightId?: string | null;
}

export default function TrackTimeline({ day, onFlight, selectedFlightId }: Props): JSX.Element {
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
            const label = contextLabel(item, t);
            const when =
              item.untilMs === item.fromMs
                ? t("track:timeline.at", { at: clock(item.fromMs) })
                : t("track:timeline.span", { from: clock(item.fromMs), to: until(item.untilMs) });
            return (
              <li
                key={`${item.kind}-${item.id ?? ""}-${item.fromMs}`}
                className="flex flex-wrap items-center gap-3 t-body"
              >
                <span className="t-caption tabular-nums">{when}</span>
                {item.href ? (
                  <Link to={item.href}>{label}</Link>
                ) : (
                  <span className={item.unlabelled ? "t-caption italic" : undefined}>{label}</span>
                )}
                {onFlight && item.kind === "flight" && item.id && (
                  <button
                    type="button"
                    aria-pressed={selectedFlightId === item.id}
                    onClick={() =>
                      onFlight({ id: item.id as string, label: item.label, href: item.href })
                    }
                    style={{ ...pillStyle(selectedFlightId === item.id), minHeight: 32 }}
                  >
                    {t("track:flight.show")}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
