import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import Button from "../../components/ui/Button";
import TableScroll from "../../components/ui/TableScroll";
import { token } from "../../components/ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { useTodayZone } from "../../hooks/useTodayZone";
import { trackErrorKey } from "../../lib/api/travtrack";
import {
  travTrackMonthsApi,
  type TravTrackMonth,
  type TravTrackMonths,
} from "../../lib/api/travtrackMonths";
import { logger } from "../../lib/logger";
import { appLocale, formatDistance, formatShortDistance } from "../../lib/units";
import { todayIn } from "../../shared/time/clock";
import { countryName } from "../../shared/geo/countryCode";
import { useSettingsStore } from "../../store/settingsStore";
import TrackCalendar from "./stats/TrackCalendar";
import TrackKmChart from "./stats/TrackKmChart";

type State =
  { kind: "loading" } | { kind: "failed"; key: string } | { kind: "loaded"; data: TravTrackMonths };

/** One row: a month with values, or a month still being computed that has none yet. */
type Row = { month: string; values: TravTrackMonth | null; pending: boolean };

export function monthRows(data: TravTrackMonths): Row[] {
  const pending = new Set(data.pending);
  const byMonth = new Map<string, Row>(
    data.months.map((m) => [m.month, { month: m.month, values: m, pending: pending.has(m.month) }])
  );
  for (const month of data.pending) {
    if (!byMonth.has(month)) byMonth.set(month, { month, values: null, pending: true });
  }
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * The monthly values (TravTrack plan L3), a tab on `/track`: per month the
 * kilometres on the ground, the countries and the cities. A month without
 * positions is not listed — never a row of zeros; cities the lookup has not
 * determined read "nicht ermittelt", never an empty cell; a month being
 * recomputed says so.
 */
export default function TrackMonths(): JSX.Element {
  const { t, i18n } = useTranslation(["track", "stats"]);
  const units = useSettingsStore((s) => s.units);
  const thisYear = Number(todayIn(useTodayZone()).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    travTrackMonthsApi
      .months(year)
      .then((data) => {
        if (live) setState({ kind: "loaded", data });
      })
      .catch((err: unknown) => {
        logger.warn("TravTrack months could not be loaded", err);
        if (live) setState({ kind: "failed", key: trackErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [year]);

  const lang = i18n.language;
  const monthName = new Intl.DateTimeFormat(appLocale(lang), {
    month: "long",
    timeZone: "UTC",
  });
  const label = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`));
  const km = (value: number) =>
    value < 10
      ? formatShortDistance(value, units.distanceUnit, t, lang)
      : formatDistance(value, units.distanceUnit, t, lang);
  const country = (code: string) => countryName(code, lang) || code;
  const head = "px-2 py-1 text-left font-medium";
  const cell = "px-2 py-1 align-top";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setYear((y) => y - 1)}>{t("track:months.previous")}</Button>
        <span className="t-card-title" data-testid="track-months-year">
          {year}
        </span>
        <Button disabled={year >= thisYear} onClick={() => setYear((y) => y + 1)}>
          {t("track:months.next")}
        </Button>
      </div>

      {state.kind === "loading" && <p className="t-caption">{t("track:months.loading")}</p>}
      {state.kind === "failed" && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(state.key)}
        </p>
      )}
      {state.kind === "loaded" &&
        (() => {
          const rows = monthRows(state.data);
          if (rows.length === 0) {
            return (
              <p className="t-body" data-testid="track-months-empty">
                {t("track:months.empty", { year })}
              </p>
            );
          }
          const citiesOff = state.data.months.every((m) => m.cities === null);
          return (
            <>
              {state.data.pending.length > 0 && (
                <p className="t-caption" role="status" style={{ color: token("warn") }}>
                  {t("track:months.pending")}
                </p>
              )}
              <TrackKmChart data={state.data} year={year} />
              <h2 id="track-months-table" className="t-card-title">
                {t("track:months.table", { year })}
              </h2>
              <TableScroll labelledBy="track-months-table">
                <table className="w-full text-sm" aria-labelledby="track-months-table">
                  <thead style={{ color: "var(--text-muted)" }}>
                    <tr>
                      <th className={head}>{t("track:months.month")}</th>
                      <th className={`${head} text-right`}>{t("track:months.km")}</th>
                      <th className={`${head} text-right`}>{t("track:months.days")}</th>
                      <th className={head}>{t("track:months.countries")}</th>
                      <th className={head}>{t("track:months.cities")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.month} data-testid={`track-month-${row.month}`}>
                        <td className={cell}>
                          {label(row.month)}
                          {row.pending && (
                            <span className="t-caption block" style={{ color: token("warn") }}>
                              {t("track:months.pendingMonth")}
                            </span>
                          )}
                        </td>
                        {row.values === null ? (
                          <td className={cell} colSpan={4} />
                        ) : (
                          <MonthCells values={row.values} km={km} country={country} cell={cell} />
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <p className="t-caption">{t("track:months.legend")}</p>
              <p className="t-caption">{t("track:months.utc")}</p>
              {citiesOff && (
                <p className="t-caption">
                  <Link to="/settings/location">{t("track:months.citiesOff")}</Link>
                </p>
              )}
              <TrackCalendar year={year} />
            </>
          );
        })()}
    </section>
  );
}

function MonthCells({
  values,
  km,
  country,
  cell,
}: {
  values: TravTrackMonth;
  km: (value: number) => string;
  country: (code: string) => string;
  cell: string;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  return (
    <>
      <td className={`${cell} text-right tabular-nums`}>{km(values.kmGround)}</td>
      <td className={`${cell} text-right tabular-nums`}>
        {values.daysWithData}
        {values.daysPaused > 0 && (
          <span className="t-caption block">
            {t("track:months.pausedCount", { count: values.daysPaused })}
          </span>
        )}
      </td>
      <td className={cell}>
        {values.countries.length === 0
          ? t("track:months.noCountries")
          : values.countries.map(country).join(", ")}
      </td>
      <td className={cell} data-testid="track-month-cities">
        {values.cities === null ? (
          <span style={{ color: "var(--text-muted)" }}>{t("track:months.citiesUnknown")}</span>
        ) : values.cities.length === 0 ? (
          t("track:months.citiesNone")
        ) : (
          values.cities.map((c) => c.name).join(", ")
        )}
      </td>
    </>
  );
}
