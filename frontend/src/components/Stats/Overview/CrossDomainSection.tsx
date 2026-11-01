import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";

import { statsApi } from "../../../lib/api/stats";
import { logger } from "../../../lib/logger";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatCurrency, formatNumber } from "../../../lib/units";
import type { CrossDomainStats, PhotoTop, UnseenEntry } from "../../../types/crossDomainStats";
import CountingHelp from "../counting/CountingHelp";
import StatCard, { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";

/**
 * Cheap cross-domain statistics (forgejo#399): streaks, time zones crossed,
 * Schengen days, when and where the reader travels, last visits, price per
 * kilometre, nights per country, photos.
 *
 * The server decides everything that is derivation. A block it sends as null
 * could not be derived and draws NO card (never a zero); a block it names in
 * `unavailable` failed to load and is named in one line, so a failure does not
 * look like an empty logbook. A failed request says so as well.
 */

function ListCard({
  title,
  children,
  footnote,
  testId,
}: {
  title: string;
  children: ReactNode;
  footnote?: ReactNode;
  testId?: string;
}): JSX.Element {
  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE} data-testid={testId}>
      <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <div className="space-y-1 text-sm">{children}</div>
      {footnote && <p className="mt-2 text-xs opacity-60">{footnote}</p>}
    </div>
  );
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const SEASONS = ["winter", "spring", "summer", "autumn"] as const;

export default function CrossDomainSection(): JSX.Element | null {
  const { t, i18n } = useTranslation(["stats"]);
  const [data, setData] = useState<CrossDomainStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    statsApi
      .getCrossDomainStats()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err: unknown) => {
        logger.error("CrossDomainSection: fetch failed", err);
        if (!cancelled) setFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const heading = (
    <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
      {t("stats:crossDomain.title")}
    </h2>
  );
  if (failed) {
    return (
      <section className="mt-8" data-testid="cross-domain">
        {heading}
        <p className="text-sm opacity-75" role="alert">
          {t("stats:crossDomain.loadFailed")}
        </p>
      </section>
    );
  }
  if (data === null) return null;

  const lang = i18n.language;
  const num = (n: number, digits = 0): string =>
    formatNumber(n, { maximumFractionDigits: digits }, lang);
  const regions =
    typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([lang], { type: "region" })
      : null;
  const country = (code: string): string => regions?.of(code) ?? code;
  const domainName = (d: string): string => t(`stats:crossDomain.domains.${d}`);
  const { streaks, timeShift, schengen, rhythm, unseen, pricePerKm, nightsByCountry, photos } =
    data;

  const cards: JSX.Element[] = [];

  if (streaks?.longestDayStreak) {
    const run = streaks.longestDayStreak;
    const live = streaks.currentDayStreak;
    cards.push(
      <StatCard
        key="streak"
        title={t("stats:crossDomain.streak.title")}
        value={t("stats:crossDomain.streak.value", { count: run.days })}
        description={t("stats:crossDomain.streak.range", { from: run.from, to: run.to })}
        footnote={
          live
            ? t("stats:crossDomain.streak.current", { count: live.days, from: live.from })
            : t("stats:crossDomain.streak.none")
        }
      />
    );
  }
  if (streaks?.longestMonthStreak) {
    const run = streaks.longestMonthStreak;
    const live = streaks.currentMonthStreak;
    cards.push(
      <StatCard
        key="months"
        title={t("stats:crossDomain.months.title")}
        value={t("stats:crossDomain.months.value", { count: run.months })}
        description={t("stats:crossDomain.months.range", { from: run.from, to: run.to })}
        footnote={live ? t("stats:crossDomain.months.current", { count: live.months }) : undefined}
      />
    );
  }
  if (timeShift) {
    const jump = timeShift.biggestJump;
    const route = jump?.from && jump.to ? ` (${jump.from} → ${jump.to})` : "";
    cards.push(
      <StatCard
        key="timeShift"
        title={t("stats:crossDomain.timeShift.title")}
        value={t("stats:crossDomain.timeShift.value", { hours: num(timeShift.hoursShifted, 1) })}
        description={
          <>
            {jump &&
              t("stats:crossDomain.timeShift.biggest", {
                hours: num(Math.abs(jump.hours), 1),
                direction: t(`stats:crossDomain.timeShift.${jump.hours > 0 ? "east" : "west"}`),
                route,
              })}{" "}
            {timeShift.jetLagDays > 0 &&
              t("stats:crossDomain.timeShift.jetLag", {
                days: num(timeShift.jetLagDays, 1),
                min: timeShift.jetLagRule.minHours,
              })}
          </>
        }
        footnote={
          timeShift.unmeasured > 0
            ? t("stats:crossDomain.timeShift.unmeasured", { count: timeShift.unmeasured })
            : undefined
        }
      />
    );
  }
  if (schengen) {
    cards.push(
      <StatCard
        key="schengen"
        title={t("stats:crossDomain.schengen.title")}
        value={t("stats:crossDomain.schengen.value", {
          used: schengen.daysUsed,
          allowed: schengen.allowedDays,
        })}
        description={t("stats:crossDomain.schengen.left", {
          remaining: schengen.daysRemaining,
          window: schengen.windowDays,
          from: schengen.windowFrom,
        })}
        footnote={t("stats:crossDomain.schengen.note")}
      />
    );
  }
  if (rhythm) {
    const o = rhythm.overall;
    cards.push(
      <ListCard
        key="rhythm"
        testId="cross-domain-rhythm"
        title={t("stats:crossDomain.rhythm.title")}
        footnote={t("stats:crossDomain.rhythm.note")}
      >
        <p>
          {SEASONS.map(
            (s) => `${t(`stats:crossDomain.rhythm.seasons.${s}`)} ${o.bySeason[s]}`
          ).join(" · ")}
        </p>
        <p>
          {WEEKDAY_KEYS.map(
            (k, i) => `${t(`stats:crossDomain.rhythm.weekdays.${k}`)} ${o.byWeekday[i]}`
          ).join(" · ")}
        </p>
      </ListCard>
    );
  }
  if (pricePerKm) {
    cards.push(
      <ListCard
        key="pricePerKm"
        testId="cross-domain-price-per-km"
        title={t("stats:crossDomain.pricePerKm.title")}
        footnote={
          <>
            {t("stats:crossDomain.pricePerKm.note")}
            {pricePerKm.bookedRides > 0 &&
              ` ${t("stats:crossDomain.pricePerKm.booked", { count: pricePerKm.bookedRides })}`}
          </>
        }
      >
        {pricePerKm.blocks.map((b) => {
          const domain = domainName(b.domain);
          const spend = formatCurrency(b.spend, b.currency, { language: lang });
          return (
            <p key={`${b.domain}-${b.currency}`}>
              {b.pricePerKm === null || b.km === null
                ? t("stats:crossDomain.pricePerKm.noKm", { domain, currency: b.currency, spend })
                : t("stats:crossDomain.pricePerKm.row", {
                    domain,
                    currency: b.currency,
                    spend: formatCurrency(b.spendWithKm, b.currency, { language: lang }),
                    perKm: formatCurrency(b.pricePerKm, b.currency, { language: lang }),
                    km: num(b.km),
                  })}
            </p>
          );
        })}
      </ListCard>
    );
  }
  if (nightsByCountry && nightsByCountry.countries.length > 0) {
    const un = nightsByCountry.unattributed;
    const unattributed = un.hotel + un.sea + un.rail + un.bus + un.air;
    cards.push(
      <ListCard
        key="nights"
        testId="cross-domain-nights"
        title={t("stats:crossDomain.nights.title")}
        footnote={
          <>
            {unattributed > 0 &&
              `${t("stats:crossDomain.nights.unattributed", { count: unattributed })} `}
            {t("stats:crossDomain.nights.note")}
          </>
        }
      >
        {nightsByCountry.countries.slice(0, 8).map((c) => (
          <p key={c.country}>
            {t("stats:crossDomain.nights.row", {
              country: country(c.country),
              total: c.total,
              hotel: c.hotel,
              rail: c.rail,
              bus: c.bus,
            })}
          </p>
        ))}
      </ListCard>
    );
  }
  if (unseen) {
    const kinds = ["country", "airport", "place"] as const;
    const label = (kind: (typeof kinds)[number], e: UnseenEntry): string =>
      t("stats:crossDomain.unseen.item", {
        label: kind === "country" ? country(e.key) : e.label,
        years: e.yearsAgo,
        date: e.lastVisit,
      });
    cards.push(
      <ListCard
        key="unseen"
        testId="cross-domain-unseen"
        title={t("stats:crossDomain.unseen.title")}
      >
        {kinds.map((kind) => {
          const list = unseen[kind];
          return (
            <div key={kind}>
              <p className="font-medium">{t(`stats:crossDomain.unseen.${kind}`)}</p>
              {list === null ? (
                <p className="opacity-60">{t("stats:crossDomain.unseen.unknown")}</p>
              ) : list.length === 0 ? (
                <p className="opacity-60">{t("stats:crossDomain.unseen.none")}</p>
              ) : (
                list.slice(0, 5).map((e) => (
                  <p key={e.key} className="opacity-80">
                    {label(kind, e)}
                  </p>
                ))
              )}
            </div>
          );
        })}
      </ListCard>
    );
  }
  if (photos) {
    const rows = (title: string, list: PhotoTop[], named?: (key: string) => string): ReactNode =>
      list.length > 0 && (
        <div>
          <p className="font-medium">{title}</p>
          {list.map((p) => (
            <p key={p.key} className="opacity-80">
              {named ? named(p.key) : p.label} · {p.count}
            </p>
          ))}
        </div>
      );
    cards.push(
      <ListCard
        key="photos"
        testId="cross-domain-photos"
        title={t("stats:crossDomain.photos.title")}
        footnote={t("stats:crossDomain.photos.left", {
          noDate: photos.withoutDate,
          noCountry: photos.withoutCountry,
        })}
      >
        <p className="text-lg font-bold">
          {t("stats:crossDomain.photos.value", { count: photos.photos })}
        </p>
        {photos.busiestDay && (
          <p>
            {t("stats:crossDomain.photos.busiest", {
              day: photos.busiestDay.day,
              count: photos.busiestDay.count,
            })}
          </p>
        )}
        {rows(t("stats:crossDomain.photos.trips"), photos.topTrips)}
        {rows(t("stats:crossDomain.photos.countries"), photos.topCountries, country)}
        {rows(t("stats:crossDomain.photos.places"), photos.topPlaces)}
      </ListCard>
    );
  }

  if (cards.length === 0 && data.unavailable.length === 0) return null;
  return (
    <section className="mt-8" data-testid="cross-domain">
      {heading}
      {data.unavailable.length > 0 && (
        <p className="mb-3 text-sm opacity-75" role="alert">
          {t("stats:crossDomain.unavailable", {
            blocks: data.unavailable.map((b) => t(`stats:crossDomain.blocks.${b}`)).join(", "),
          })}
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{cards}</div>
      <CountingHelp
        testId="cross-domain-help"
        entries={[{ term: t("stats:crossDomain.title"), helpKey: "stats:crossDomain.help" }]}
      />
    </section>
  );
}
