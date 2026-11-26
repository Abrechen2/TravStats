import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { formatTime } from "../../lib/format";
import type { TrackCoverageState, TravTrackDay } from "../../lib/api/travtrack";
import { alpha, token } from "../../components/ui/tokens";
import { contextLabel } from "./trackContextLabel";

/**
 * What the phone recorded over the day (TravTrack plan T6, prototype board
 * "Track-Tag"): the day as one bar, each piece recorded, without data, paused
 * by the phone or deleted by the owner. A privacy zone is no piece of its
 * own — the server never names one, so an hour inside one is "Keine Daten".
 * A silence the logbook explains (a flight, a train, a night) is an `entry`
 * piece: named after that entry and linking to it, not "Keine Daten".
 */

export const COVERAGE_STATES: readonly TrackCoverageState[] = [
  "recorded",
  "phonePaused",
  "deleted",
  "entry",
  "stationary",
  "noData",
];

const COLOUR: Record<TrackCoverageState, string> = {
  recorded: token("good"),
  phonePaused: token("warn"),
  deleted: token("bad"),
  noData: alpha(token("muted"), 35),
  entry: alpha(token("good"), 45),
  // Inferred, not recorded: the same hue as a recorded stretch, lighter.
  stationary: alpha(token("good"), 25),
};

interface Props {
  coverage: TravTrackDay["coverage"];
  zone: string;
  /** The day's labels; an `entry` piece is named from the one it points at. */
  context?: TravTrackDay["context"];
}

export default function TrackCoverageBar({
  coverage,
  zone,
  context = [],
}: Props): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const first = coverage[0];
  const last = coverage[coverage.length - 1];
  if (!first || !last) return null;
  const total = last.untilMs - first.fromMs;
  if (total <= 0) return null;
  const clock = (ms: number) => formatTime(ms, { timeZone: zone });
  const shown = new Set(coverage.map((c) => c.state));

  return (
    <section className="flex flex-col gap-2" aria-label={t("track:coverage.title")}>
      <h2 className="t-card-title">{t("track:coverage.title")}</h2>
      <div
        className="flex h-3 w-full overflow-hidden"
        style={{ borderRadius: token("radius-pill"), background: alpha(token("muted"), 15) }}
        data-testid="track-coverage-bar"
      >
        {coverage.map((piece) => {
          const entry =
            piece.state === "entry" && piece.entry
              ? context.find((c) => c.kind === piece.entry?.domain && c.id === piece.entry?.id)
              : undefined;
          const stateText = entry
            ? contextLabel(entry, t)
            : piece.state === "stationary" && piece.place
              ? t(
                  piece.place.kind === "home"
                    ? "track:timeline.stationaryHome"
                    : "track:timeline.stationary",
                  { label: piece.place.name }
                )
              : piece.state === "noData" && piece.why
                ? `${t("track:coverage.noData")} — ${t(`track:coverage.why.${piece.why}`)}`
                : t(`track:coverage.${piece.state}`);
          const label = t("track:coverage.piece", {
            state: stateText,
            from: clock(piece.fromMs),
            to: clock(piece.untilMs),
          });
          const style = {
            width: `${((piece.untilMs - piece.fromMs) / total) * 100}%`,
            background: COLOUR[piece.state],
          };
          return entry?.href ? (
            <Link
              key={piece.fromMs}
              to={entry.href}
              data-state={piece.state}
              aria-label={label}
              title={label}
              style={style}
            />
          ) : (
            <div
              key={piece.fromMs}
              data-state={piece.state}
              aria-label={label}
              role="img"
              style={style}
            />
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-3 t-caption">
        {COVERAGE_STATES.filter((s) => shown.has(s)).map((state) => (
          <li key={state} className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2"
              style={{ borderRadius: token("radius-pill"), background: COLOUR[state] }}
            />
            {t(`track:coverage.${state}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}
