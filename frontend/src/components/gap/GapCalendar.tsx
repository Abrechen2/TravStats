import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../ui/Button";
import { alpha, token } from "../ui/tokens";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useTodayZone } from "../../hooks/useTodayZone";
import { useTranslation } from "../../hooks/useTranslation";
import {
  gapCalendarApi,
  GAP_STATES,
  type GapCalendar,
  type GapState,
} from "../../lib/api/gapCalendar";
import { trackErrorKey } from "../../lib/api/travtrack";
import {
  GAP_CREATE_TARGETS,
  gapCreateUrl,
  gapMonths,
  unknownStretches,
} from "../../lib/gapCalendar";
import { logger } from "../../lib/logger";
import { appLocale } from "../../lib/units";
import { daysBetween, formatDayLong } from "../../shared/time/calendar";
import { todayIn } from "../../shared/time/clock";
import { TRACK_COLOR } from "../../pages/Track/map/trackMapLayers";

type State =
  { kind: "loading" } | { kind: "failed"; key: string } | { kind: "loaded"; data: GapCalendar };

const CELL = 22;

/** States only TravTrack's fixes can produce: not drawn in the legend where TravTrack is not offered. */
const TRACK_ONLY: ReadonlySet<GapState> = new Set([
  "home",
  "place",
  "track",
  "privacyZone",
  "implausible",
]);

const hatch = (color: string) =>
  `repeating-linear-gradient(45deg, ${alpha(color, 55)} 0 3px, transparent 3px 6px)`;

/** One fill per state; colour is never the only signal (hatching and the legend say the rest). */
function cellStyle(
  state: GapState,
  inferred = false
): { background: string; border: string; opacity?: number } {
  // Inferred from a silence, not recorded: the hatch (not the colour) says so, dashed edge too.
  if (inferred && (state === "home" || state === "place")) {
    return { background: hatch(token("good")), border: `1px dashed ${token("good")}` };
  }
  switch (state) {
    case "entry":
      return { background: token("good"), border: `1px solid ${token("good")}` };
    case "home":
      return { background: alpha(token("good"), 40), border: `1px solid ${token("good")}` };
    case "place":
      return { background: alpha(token("good"), 40), border: `1px solid ${token("good")}` };
    case "track":
      return { background: TRACK_COLOR, border: `1px solid ${TRACK_COLOR}` };
    case "privacyZone":
      return { background: hatch(token("info")), border: `1px solid ${token("info")}` };
    case "implausible":
      return { background: hatch(token("warn")), border: `1px solid ${token("warn")}` };
    case "unknown":
      return { background: alpha(token("bad"), 22), border: `1px dashed ${token("bad")}` };
    default:
      return { background: "transparent", border: `1px solid ${token("border")}`, opacity: 0.35 };
  }
}

/**
 * The gap calendar (spec 2026-11-22-gap-calendar), a tab on `/track`: a year of
 * days coloured by what explains them — a logbook entry, home, a recorded day,
 * a privacy zone, an implausible fix — and, in the foreground, the days nothing
 * explains. Each unknown stretch offers to fill it in (where a form can take the
 * dates) and to look at the day in the track. A privacy-zone day says only that
 * it is hidden.
 */
export default function GapCalendar({ withTrack }: { withTrack: boolean }): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const navigate = useNavigate();
  const { isEnabled } = useEnabledDomains();
  const thisYear = Number(todayIn(useTodayZone()).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    gapCalendarApi
      .year(year)
      .then((data) => {
        if (!live) return;
        setState({ kind: "loaded", data });
        setMonth(null);
      })
      .catch((err: unknown) => {
        logger.warn("The gap calendar could not be loaded", err);
        if (live) setState({ kind: "failed", key: trackErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [year, reload]);

  const data = state.kind === "loaded" ? state.data : null;
  const months = useMemo(() => (data ? gapMonths(data) : []), [data]);
  const lang = i18n.language;
  const monthName = new Intl.DateTimeFormat(appLocale(lang), { month: "long", timeZone: "UTC" });
  const shown =
    month ??
    months.find((m) => data && unknownStretches(data, m.month).length > 0)?.month ??
    `${year}-01`;
  const stretches = data ? unknownStretches(data, shown) : [];
  const years = data && data.years.length > 0 ? data.years : [thisYear];
  const dayLabel = (day: string, s: GapState, inferred = false) =>
    t("track:gaps.cell", {
      day: formatDayLong(day, lang, { day: "numeric", month: "long" }),
      state: t(
        `track:gaps.state.${inferred && (s === "home" || s === "place") ? `${s}Inferred` : s}`
      ),
    });
  const hasInferred = (data?.runs ?? []).some((r) => r.inferred && r.state === "home");

  return (
    <section className="flex flex-col gap-3" data-testid="gap-calendar">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="t-card-title">{t("track:gaps.title", { year })}</h2>
        <label className="flex items-center gap-2 t-caption">
          {t("track:gaps.year")}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            data-testid="gaps-year"
            className="t-body"
            style={{ minHeight: 44 }}
          >
            {[...new Set([...years, year])]
              .sort((a, b) => b - a)
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </select>
        </label>
      </header>
      <p className="t-caption">{t("track:gaps.intro")}</p>
      {!withTrack && (
        <p className="t-caption" data-testid="gaps-no-track">
          {t("track:gaps.noTrack")}
        </p>
      )}
      {state.kind === "loading" && <p className="t-caption">{t("track:gaps.loading")}</p>}
      {state.kind === "failed" && (
        <div role="alert" className="flex flex-col gap-2">
          <p className="t-body" style={{ color: token("bad") }}>
            {t(state.key)}
          </p>
          <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
            {t("track:gaps.retry")}
          </Button>
        </div>
      )}
      {data && data.firstDay === null && (
        <p className="t-body" data-testid="gaps-empty">
          {t("track:gaps.nothingYet")}
        </p>
      )}
      {data && data.firstDay !== null && (
        <>
          <p className="t-body" data-testid="gaps-summary">
            {t("track:gaps.summary", { count: data.counts.unknown })}
          </p>
          <div className="flex flex-col gap-1" style={{ overflowX: "auto" }}>
            {months.map((m) => (
              <div
                key={m.month}
                className="flex items-center gap-2"
                data-testid={`gaps-${m.month}`}
              >
                <button
                  type="button"
                  className="t-caption"
                  aria-pressed={shown === m.month}
                  onClick={() => setMonth(m.month)}
                  style={{
                    width: 96,
                    minHeight: 44,
                    flex: "none",
                    textAlign: "left",
                    fontWeight: shown === m.month ? 700 : 400,
                  }}
                >
                  {monthName.format(new Date(`${m.month}-01T00:00:00Z`))}
                </button>
                <div className="flex gap-[2px]" style={{ flex: "none" }}>
                  {m.cells.map((cell) => {
                    const label = dayLabel(cell.day, cell.state, cell.inferred === true);
                    const style = cellStyle(cell.state, cell.inferred === true);
                    return (
                      <button
                        key={cell.day}
                        type="button"
                        title={label}
                        aria-label={label}
                        data-state={cell.state}
                        data-inferred={cell.inferred ? "true" : undefined}
                        disabled={cell.state === "outside"}
                        onClick={() => navigate(`/track/${cell.day}`)}
                        style={{ width: CELL, height: CELL, padding: 0, borderRadius: 3, ...style }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <ul className="flex flex-wrap gap-3 t-caption" data-testid="gaps-legend">
            {GAP_STATES.filter(
              (s) => withTrack || !TRACK_ONLY.has(s) || (data?.counts[s] ?? 0) > 0
            ).map((s) => (
              <li key={s} className="flex items-center gap-1">
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    display: "inline-block",
                    ...cellStyle(s),
                  }}
                />
                {t(`track:gaps.state.${s}`)}
              </li>
            ))}
            {hasInferred && (
              <li className="flex items-center gap-1" data-testid="gaps-legend-inferred">
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    display: "inline-block",
                    ...cellStyle("home", true),
                  }}
                />
                {t("track:gaps.state.homeInferred")}
              </li>
            )}
          </ul>
          <section className="flex flex-col gap-2" data-testid="gaps-month">
            <h3 className="t-card-title">
              {monthName.format(new Date(`${shown}-01T00:00:00Z`))} {year}
            </h3>
            {stretches.length === 0 && <p className="t-body">{t("track:gaps.monthComplete")}</p>}
            <ul className="flex flex-col gap-2">
              {stretches.map((s) => {
                const days = daysBetween(s.from, s.to) + 1;
                return (
                  <li
                    key={s.from}
                    className="flex flex-wrap items-center gap-3"
                    data-testid="gaps-stretch"
                  >
                    <span className="t-body">
                      {s.from === s.to
                        ? formatDayLong(s.from, lang, { day: "numeric", month: "long" })
                        : t("track:gaps.range", {
                            from: formatDayLong(s.from, lang, { day: "numeric", month: "long" }),
                            to: formatDayLong(s.to, lang, { day: "numeric", month: "long" }),
                          })}
                      {" · "}
                      {t("track:gaps.days", { count: days })}
                    </span>
                    {GAP_CREATE_TARGETS.filter(
                      (target) => target.domain === null || isEnabled(target.domain)
                    ).map((target) => (
                      <Link
                        key={target.id}
                        to={gapCreateUrl(target.path, s)}
                        className="t-body"
                        style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}
                      >
                        {t(target.label)}
                      </Link>
                    ))}
                    <Link
                      to={`/track/${s.from}`}
                      className="t-body"
                      style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}
                    >
                      {t("track:gaps.openDay")}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
