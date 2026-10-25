import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { alpha, token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { useTodayZone } from "../../../hooks/useTodayZone";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { travTrackViewsApi, type TravTrackCalendar } from "../../../lib/api/travtrackViews";
import { logger } from "../../../lib/logger";
import { appLocale, formatDistance } from "../../../lib/units";
import { formatDayLong } from "../../../shared/time/calendar";
import { todayIn } from "../../../shared/time/clock";
import { useSettingsStore } from "../../../store/settingsStore";
import { TRACK_COLOR } from "../map/trackMapLayers";
import { calendarMonths, KM_STEPS, kmStep, type CalendarCell } from "./calendarCells";

type State =
  | { kind: "loading" }
  | { kind: "failed"; key: string }
  | { kind: "loaded"; data: TravTrackCalendar };

/** Ramp share per step: light for a short day, full for a long one. */
const SHARES = [18, 36, 56, 78, 100];

function cellFill(cell: CalendarCell): string {
  switch (cell.state) {
    case "recorded":
      return alpha(TRACK_COLOR, SHARES[kmStep(cell.km ?? 0)]);
    case "pending":
    case "unavailable":
      return `repeating-linear-gradient(45deg, ${token("surface2")} 0 3px, transparent 3px 6px)`;
    default:
      return "transparent";
  }
}

const CELL = 14;

/**
 * Statistik's daily calendar (board „Track-Karte", TravTrack plan T5.3): one
 * cell per day, coloured by the ground kilometres; a click opens the day on
 * the map. A month still being prepared, or one whose days are not known, is
 * hatched and named as such — never shown as days without data.
 */
export default function TrackCalendar({ year }: { year: number }): JSX.Element {
  const { t, i18n } = useTranslation(["track", "stats"]);
  const navigate = useNavigate();
  const { units } = useSettingsStore();
  const today = todayIn(useTodayZone());
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    travTrackViewsApi
      .calendar(year)
      .then((data) => live && setState({ kind: "loaded", data }))
      .catch((err: unknown) => {
        logger.warn("TravTrack calendar could not be loaded", err);
        if (live) setState({ kind: "failed", key: trackErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [year]);

  const lang = i18n.language;
  const monthName = new Intl.DateTimeFormat(appLocale(lang), { month: "short", timeZone: "UTC" });
  const describe = (cell: CalendarCell) => {
    const day = formatDayLong(cell.day, lang, { day: "numeric", month: "long" });
    if (cell.state === "recorded") {
      return t("track:calendar.cellKm", {
        day,
        km: formatDistance(cell.km ?? 0, units.distanceUnit, t, lang),
      });
    }
    return t(`track:calendar.cell.${cell.state}`, { day });
  };

  return (
    <section className="flex flex-col gap-2" data-testid="track-calendar">
      <h2 className="t-card-title">{t("track:calendar.title", { year })}</h2>
      <p className="t-caption">{t("track:calendar.intro")}</p>
      {state.kind === "loading" && <p className="t-caption">{t("track:calendar.loading")}</p>}
      {state.kind === "failed" && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(state.key)}
        </p>
      )}
      {state.kind === "loaded" && (
        <div className="flex flex-col gap-1" style={{ overflowX: "auto" }}>
          {calendarMonths(state.data, today).map((m) => (
            <div
              key={m.month}
              className="flex items-center gap-2"
              data-testid={`track-calendar-${m.month}`}
            >
              <span className="t-caption" style={{ width: 40, flex: "none" }}>
                {monthName.format(new Date(`${m.month}-01T00:00:00Z`))}
              </span>
              <div className="flex gap-[2px]" style={{ flex: "none" }}>
                {m.cells.map((cell) => {
                  const label = describe(cell);
                  const clickable = cell.state === "recorded" || cell.state === "none";
                  return (
                    <button
                      key={cell.day}
                      type="button"
                      title={label}
                      aria-label={label}
                      data-state={cell.state}
                      disabled={!clickable}
                      onClick={() => navigate(`/track/${cell.day}`)}
                      style={{
                        width: CELL,
                        height: CELL,
                        padding: 0,
                        borderRadius: 3,
                        border: `1px solid ${token("border")}`,
                        background: cellFill(cell),
                        opacity: cell.state === "future" ? 0.35 : 1,
                        cursor: clickable ? "pointer" : "default",
                      }}
                    />
                  );
                })}
              </div>
              {m.state !== "settled" && (
                <span className="t-caption" style={{ color: token("warn") }}>
                  {t(`track:calendar.month.${m.state}`)}
                </span>
              )}
            </div>
          ))}
          <div
            className="flex flex-wrap items-center gap-2 t-caption"
            data-testid="track-calendar-legend"
          >
            <span>{t("track:calendar.legendLess")}</span>
            {KM_STEPS.map((km, i) => (
              <span
                key={km}
                title={t("track:calendar.legendStep", { km })}
                style={{
                  width: CELL,
                  height: CELL,
                  borderRadius: 3,
                  border: `1px solid ${token("border")}`,
                  background: alpha(TRACK_COLOR, SHARES[i]),
                }}
              />
            ))}
            <span>{t("track:calendar.legendMore")}</span>
            <span>· {t("track:calendar.legendNone")}</span>
          </div>
          <p className="t-caption">{t("track:calendar.utc")}</p>
        </div>
      )}
    </section>
  );
}
