import type { JSX } from "react";
import { alpha, token } from "../../components/ui/tokens";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useTranslation } from "../../hooks/useTranslation";
import type { TravTrackLeg, TravTrackStop } from "../../lib/api/travtrackLegs";
import { formatTime } from "../../lib/displayFormat";
import { durationText, legModeLabel, makeNumber } from "./map/trackLegFormat";
import type { TrackSelection } from "./map/trackLegs";
import { TRACK_COLOR } from "./map/trackMapLayers";

/**
 * The day's journeys between its dwells (spec 2026-11-03-travtrack-legs, W1):
 * a leg row says mode, distance, length and time, a stop row its span. A row
 * selects its leg or stop on the map; the pressed row is the selected one.
 */
export default function TrackLegList({
  date,
  zone,
  legs,
  stops,
  selection,
  onSelect,
}: {
  date: string;
  zone: string;
  legs: readonly TravTrackLeg[];
  stops: readonly TravTrackStop[];
  selection: TrackSelection | null;
  onSelect: (selection: TrackSelection | null) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const number = makeNumber(i18n.language);
  const clock = (ms: number) => formatTime(ms, { timeZone: zone });
  const rows = [
    ...legs.map((leg) => ({ kind: "leg" as const, at: leg.fromMs, leg })),
    ...stops.map((stop) => ({ kind: "stop" as const, at: stop.fromMs, stop })),
  ].sort((a, b) => a.at - b.at);
  const here = selection?.date === date;
  const rowStyle = (on: boolean) => ({
    minHeight: coarse ? 44 : 36,
    textAlign: "left" as const,
    border: `1px solid ${on ? TRACK_COLOR : "transparent"}`,
    borderRadius: 8,
    padding: "4px 8px",
    background: on ? alpha(TRACK_COLOR, 14) : "transparent",
    color: token("text"),
    cursor: "pointer",
    opacity: here && !on ? 0.6 : 1,
  });
  return (
    <section className="flex flex-col gap-1" aria-label={t("track:legs.title")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="t-card-title">{t("track:legs.title")}</h2>
        {here && (
          <button
            type="button"
            className="underline"
            onClick={() => onSelect(null)}
            style={{ minHeight: coarse ? 44 : 32 }}
          >
            {t("track:legs.wholeDay")}
          </button>
        )}
      </div>
      <ol className="flex flex-col gap-1" data-testid="track-legs">
        {rows.map((row) => {
          if (row.kind === "stop") {
            const on = selection?.kind === "stop" && here && selection.fromMs === row.stop.fromMs;
            return (
              <li key={`stop-${row.stop.fromMs}`}>
                <button
                  type="button"
                  aria-pressed={on}
                  data-testid="track-stop-row"
                  onClick={() => onSelect({ kind: "stop", date, fromMs: row.stop.fromMs })}
                  className="flex w-full flex-wrap items-center gap-3 t-body"
                  style={rowStyle(on)}
                >
                  <span className="t-caption tabular-nums">
                    {t("track:timeline.span", {
                      from: clock(row.stop.fromMs),
                      to: clock(row.stop.untilMs),
                    })}
                  </span>
                  <span>{t("track:stop.row")}</span>
                  <span className="t-caption">
                    {durationText(row.stop.untilMs - row.stop.fromMs, t)}
                  </span>
                </button>
              </li>
            );
          }
          const { leg } = row;
          const on = selection?.kind === "leg" && here && selection.id === leg.id;
          return (
            <li key={leg.id}>
              <button
                type="button"
                aria-pressed={on}
                data-testid="track-leg-row"
                onClick={() => onSelect({ kind: "leg", date, id: leg.id })}
                className="flex w-full flex-wrap items-center gap-3 t-body"
                style={rowStyle(on)}
              >
                <span className="t-caption tabular-nums">
                  {t("track:timeline.span", { from: clock(leg.fromMs), to: clock(leg.untilMs) })}
                </span>
                <span style={{ fontWeight: 600 }}>{legModeLabel(leg, t)}</span>
                <span className="tabular-nums">
                  {t("track:map.totals.km", { km: number(leg.distanceM / 1000, 1) })}
                </span>
                <span className="t-caption">{durationText(leg.durationMs, t)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
