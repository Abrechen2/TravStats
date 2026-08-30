import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { PoiStatsDetail } from "../../../lib/stats/poiStatsDetail";
import StatCard from "../StatCard";

/**
 * The month and weekday key lists the flight statistics already use. Reusing
 * them rather than adding a `common:months` set keeps one vocabulary — and the
 * weekday order Sunday-first, which is what the flight page draws.
 */
const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

const WEEKDAY_KEYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

interface Props {
  detail: PoiStatsDetail;
  accent: string;
  /** For the one date this section shows — the month name has a language. */
  locale: string;
}

/**
 * When the visits happened — years, months, weekdays.
 *
 * Built from DATED visits only, and the section says so where it matters. An
 * undated visit still counts in the totals above; it simply has no day to be
 * drawn on, and a bar chart that quietly folded it into January would be
 * inventing one.
 */
export default function PoiRhythmSection({ detail, accent, locale }: Props): JSX.Element | null {
  const { t } = useTranslation(["places", "stats", "common"]);

  if (detail.visitsDated === 0) return null;

  const maxYear = Math.max(...detail.byYear.map((y) => y.visits), 1);
  const maxMonth = Math.max(...detail.byMonth, 1);
  const maxWeekday = Math.max(...detail.byWeekday, 1);

  const busiestMonth = detail.byMonth.indexOf(Math.max(...detail.byMonth));
  const busiestWeekday = detail.byWeekday.indexOf(Math.max(...detail.byWeekday));

  return (
    <section className="mt-8">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("places:stats.rhythm.title")}
      </h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("places:stats.rhythm.busiestMonth")}
          value={MONTH_KEYS.map((k) => t(`stats:months.${k}`))[busiestMonth]}
          description={t("places:stats.rhythm.visitsCount", {
            count: detail.byMonth[busiestMonth],
          })}
        />
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("places:stats.rhythm.busiestWeekday")}
          value={WEEKDAY_KEYS.map((k) => t(`stats:weekdays.${k}`))[busiestWeekday]}
          description={t("places:stats.rhythm.visitsCount", {
            count: detail.byWeekday[busiestWeekday],
          })}
        />
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("places:stats.rhythm.busiestDay")}
          value={detail.busiestDay ? String(detail.busiestDay.places) : "—"}
          description={
            detail.busiestDay
              ? t("places:stats.rhythm.busiestDayDesc", {
                    date: new Date(`${detail.busiestDay.date}T00:00:00Z`).toLocaleDateString(locale, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      timeZone: "UTC",
                    }),
                  })
              : t("places:stats.noVisitsYet")
          }
        />
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("places:stats.rhythm.streak")}
          value={detail.longestStreakDays ?? "—"}
          description={t("places:stats.rhythm.streakDesc")}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div
          className="rounded-lg border p-5"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--color-border)" }}
        >
          <h3 className="mb-4 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {t("places:stats.rhythm.byYear")}
          </h3>
          <div className="flex gap-1.5">
            {detail.byYear.map(({ year, visits }) => (
              <div key={year} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className="text-[10px] font-mono"
                  style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
                >
                  {visits}
                </span>
                {/* The plot area is its own box with a definite height. The
                    labels sit outside it — inside, they compete with the bar
                    for the same space and two different values end up the same
                    height, which is a chart that lies about its own numbers. */}
                <div className="flex w-full items-end" style={{ height: "7rem" }}>
                  <div
                    title={`${year}: ${visits}`}
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max((visits / maxYear) * 100, 4)}%`,
                      background: accent,
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                  {String(year).slice(2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-lg border p-5"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--color-border)" }}
        >
          <h3 className="mb-4 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {t("places:stats.rhythm.byMonth")}
          </h3>
          {/* All twelve months, always — a chart that only draws the months
              with data hides the quiet half of the year, which is the more
              interesting half of this particular question. */}
          <div className="flex gap-1">
            {detail.byMonth.map((visits, index) => (
              <div key={index} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end" style={{ height: "7rem" }}>
                  <div
                    title={`${t(`stats:months.${MONTH_KEYS[index]}`)}: ${visits}`}
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max((visits / maxMonth) * 100, 2)}%`,
                      background: visits > 0 ? accent : "var(--color-border)",
                    }}
                  />
                </div>
                <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                  {t(`stats:months.${MONTH_KEYS[index]}`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="mt-6 rounded-lg border p-5"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--color-border)" }}
      >
        <h3 className="mb-4 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {t("places:stats.rhythm.byWeekday")}
        </h3>
        <div className="flex gap-2">
          {detail.byWeekday.map((visits, index) => (
            <div key={index} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-end" style={{ height: "5rem" }}>
                <div
                  title={`${t(`stats:weekdays.${WEEKDAY_KEYS[index]}`)}: ${visits}`}
                  className="w-full rounded-t"
                  style={{
                    height: `${Math.max((visits / maxWeekday) * 100, 2)}%`,
                    background: visits > 0 ? accent : "var(--color-border)",
                  }}
                />
              </div>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {t(`stats:weekdays.${WEEKDAY_KEYS[index]}`).slice(0, 2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {detail.visitsUndated > 0 && (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("places:stats.rhythm.undatedNote", { count: detail.visitsUndated })}
        </p>
      )}
    </section>
  );
}
