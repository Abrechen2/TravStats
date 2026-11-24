import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { DOMAIN_KEYS, DOMAINS, type DomainKey } from "../../../shared/domains";
import type { YearCardData } from "../../../types/yearStats";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { useTranslation } from "../../../hooks/useTranslation";
import { useSettingsStore } from "../../../store/settingsStore";
import { needsOutline } from "../../../lib/domainColor";
import { formatDistance } from "../../../lib/units";
import { dashboardYearHref, domainListHref } from "../../../lib/stats/yearLinks";

const MONTH_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

const CHART_HEIGHT = 120;

/**
 * One year of the "Jahre" section: the year, a link to the map on that year, the year's logged
 * distance, and a bar per month stacked by domain in the domain's own colour.
 *
 * A month with no measured distance has NO bar (not a zero-height one), and a year with none
 * says "keine Strecken" instead of drawing an empty chart. TravTrack's recorded kilometres are
 * a separate line: a recording can contain the very ride that is logged, so the two are never
 * summed or stacked.
 *
 * A bar is a button (a finger on an iPad hits a column, not a segment); the month it selects
 * lists its domains below, each linking to that domain's logbook for the year (flights: the
 * month).
 */
export default function YearCard({ card }: { card: YearCardData }): JSX.Element {
  const { t, i18n } = useTranslation(["stats", "common"]);
  const { colorOf } = useDomainColors();
  const unit = useSettingsStore((s) => s.units.distanceUnit);
  const lang = i18n.language;
  const [selected, setSelected] = useState<number | null>(null);

  const km = (value: number): string => formatDistance(value, unit, t, lang);
  const max = Math.max(0, ...card.months.map((m) => m.loggedKm ?? 0));
  const domains = DOMAIN_KEYS.filter((d) => card.months.some((m) => (m.byDomain[d] ?? 0) > 0));
  const month = selected === null ? null : card.months[selected - 1];
  const monthName = (m: number): string => t(`stats:months.${MONTH_KEYS[m - 1]}`);

  return (
    <article
      className="rounded-lg p-5"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      data-testid={`year-card-${card.year}`}
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          {card.year}
        </h3>
        <Link
          to={dashboardYearHref(card.year)}
          className="text-sm underline"
          style={{ color: "var(--accent)" }}
          data-testid={`year-map-link-${card.year}`}
          aria-label={t("stats:years.mapLinkLabel", { year: card.year })}
        >
          {t("stats:years.mapLink")}
        </Link>
        <span
          className="ml-auto text-lg font-semibold"
          style={{ color: "var(--text-primary)" }}
          data-testid={`year-total-${card.year}`}
        >
          {card.loggedKm === null ? t("stats:years.noDistance") : km(card.loggedKm)}
        </span>
      </header>

      {card.recordedKm !== null && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("stats:years.recordedLine", { distance: km(card.recordedKm) })}
        </p>
      )}
      {/* A large import is derived over hours: say so rather than show nothing (D22). */}
      {card.recordedPending && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }} role="status">
          {t("stats:years.recordedPending")}
        </p>
      )}

      {card.loggedKm !== null && (
        <>
          <div
            className="mt-4 grid items-end gap-1.5"
            style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", height: CHART_HEIGHT }}
            role="group"
            aria-label={t("stats:years.chartLabel", { year: card.year })}
          >
            {card.months.map((m) => {
              const total = m.loggedKm;
              const isSelected = selected === m.month;
              return (
                <button
                  key={m.month}
                  type="button"
                  disabled={total === null}
                  onClick={(): void => setSelected(isSelected ? null : m.month)}
                  aria-pressed={isSelected}
                  aria-label={
                    total === null
                      ? t("stats:years.monthEmpty", { month: monthName(m.month) })
                      : t("stats:years.monthTotal", {
                          month: monthName(m.month),
                          distance: km(total),
                        })
                  }
                  className="flex h-full min-h-[44px] flex-col-reverse items-stretch"
                  style={{
                    outline: isSelected ? "2px solid var(--accent)" : "none",
                    outlineOffset: 2,
                    borderRadius: 2,
                    cursor: total === null ? "default" : "pointer",
                  }}
                  data-testid={`year-bar-${card.year}-${m.month}`}
                >
                  {total !== null &&
                    domains.map((d) => {
                      const v = m.byDomain[d];
                      if (!v) return null;
                      const color = colorOf(d);
                      return (
                        <span
                          key={d}
                          style={{
                            display: "block",
                            height: `${(v / max) * 100}%`,
                            background: color,
                            borderTop: "1px solid rgba(0,0,0,0.2)",
                            outline: needsOutline(color)
                              ? "1px solid rgba(255,255,255,0.28)"
                              : undefined,
                            outlineOffset: -1,
                          }}
                        />
                      );
                    })}
                </button>
              );
            })}
          </div>
          <div
            className="mt-1 grid gap-1.5 text-center text-[10px]"
            style={{
              gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
              color: "var(--text-muted)",
            }}
            aria-hidden="true"
          >
            {card.months.map((m) => (
              <span key={m.month}>{monthName(m.month)}</span>
            ))}
          </div>

          <ul
            className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs"
            aria-label={t("stats:years.legend")}
          >
            {domains.map((d) => (
              <li key={d} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  style={{ width: 10, height: 10, borderRadius: 2, background: colorOf(d) }}
                />
                {t(`common:${DOMAINS[d].i18nKey}`)}
              </li>
            ))}
          </ul>

          {month && month.loggedKm !== null && (
            <div
              className="mt-3 rounded-md p-3 text-sm"
              style={{ background: "var(--bg-elevated)" }}
              data-testid={`year-month-detail-${card.year}`}
            >
              <div className="mb-1 font-medium" style={{ color: "var(--text-primary)" }}>
                {monthName(month.month)} {card.year} · {km(month.loggedKm)}
              </div>
              <ul className="space-y-1">
                {domains.map((d: DomainKey) => {
                  const v = month.byDomain[d];
                  if (!v) return null;
                  return (
                    <li key={d} className="flex items-baseline justify-between gap-3">
                      <Link
                        to={domainListHref(d, card.year, month.month)}
                        className="underline"
                        style={{ color: "var(--accent)" }}
                        data-testid={`year-month-link-${d}`}
                      >
                        {t(`common:${DOMAINS[d].i18nKey}`)}
                      </Link>
                      <span>{km(v)}</span>
                    </li>
                  );
                })}
              </ul>
              {month.recordedKm !== null && (
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("stats:years.recordedLine", { distance: km(month.recordedKm) })}
                </p>
              )}
              {month.recordedPending && (
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("stats:years.recordedPending")}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}
