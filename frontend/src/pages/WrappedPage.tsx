import { useCallback, useEffect, useState } from "react";

import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import { Select } from "../components/ui/Field";
import StatCard from "../components/Stats/StatCard";
import { useTranslation } from "../hooks/useTranslation";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { statsApi } from "../lib/api";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { formatDistance, localeForLanguage } from "../lib/units";
import { logger } from "../lib/logger";
import { useSettingsStore } from "../store/settingsStore";
import type { Wrapped } from "../types/wrapped";

/**
 * Dein Jahr — the year in review (forgejo#42, shown since forgejo#53).
 *
 * Every figure comes from `GET /stats/wrapped` and none is recomputed here.
 * The Companion tells the same story from the same endpoint; a second
 * derivation on this side is the drift the endpoint exists to prevent.
 *
 * THE FIRST LOAD ASKS FOR NO YEAR. Without `?year=` the server answers about
 * the latest year that HAS anything in it, read off the data and never off the
 * wall clock — so the page tells the same story on New Year's Eve and the
 * morning after. Only once the reader picks a year does one get sent.
 *
 * Three absences, all inherited from the passport's scars and from #53's
 * "do not build" list: no percentage of the world's countries (nobody has
 * picked a denominator), no flags (the ISO code is the glyph — and this page
 * shows no country list at all), and no favourite the year cannot support.
 * `topAirline` and `topRoute` arrive null when the year cannot name one, and a
 * null draws NO card rather than a card reading "—": the server abstained, and
 * repeating the abstention as content would undo it.
 *
 * `topRoute` is a PAIR, not a direction — the server sorts the two codes and
 * counts both ways together, the same rule `/stats/routes` follows. So it is
 * written "FRA – JFK" with a dash. An arrow would claim a direction the number
 * does not describe.
 */

export default function WrappedPage(): JSX.Element {
  const { t, i18n } = useTranslation(["stats", "common"]);
  const { isEnabled } = useEnabledDomains();
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);

  // `null` is not "this year" — it is "whichever year the data says", which is
  // a question only the server can answer.
  const [year, setYear] = useState<number | null>(null);
  const [wrapped, setWrapped] = useState<Wrapped | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  const flightsOn = isEnabled("flight");
  const cruisesOn = isEnabled("cruise");
  const locale = localeForLanguage(i18n.language);
  const count = (value: number): string => value.toLocaleString(locale);

  const load = useCallback(
    (requested: number | null): void => {
      if (!flightsOn) return;
      setLoading(true);
      setFailure(null);
      statsApi
        .getWrapped(requested ?? undefined)
        .then(setWrapped)
        .catch((err) => {
          // A 404 is the server saying there is no story at all, which is a
          // different sentence from "I could not ask".
          setFailure(classifyLoadFailure(err));
          logger.error("Failed to load the year in review:", err);
        })
        .finally(() => setLoading(false));
    },
    [flightsOn]
  );

  useEffect(() => {
    load(year);
  }, [load, year]);

  if (!flightsOn) {
    return (
      <AppShell width="reading">
        <PageHeader title={t("stats:wrapped.title")} />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("stats:wrapped.needsFlights")}
        </p>
      </AppShell>
    );
  }

  const yearPicker =
    wrapped !== null && wrapped.availableYears.length > 1 ? (
      <label className="flex items-center gap-2 text-sm">
        <span style={{ color: "var(--text-muted)" }}>{t("stats:wrapped.yearLabel")}</span>
        <Select
          value={String(wrapped.year)}
          aria-label={t("stats:wrapped.yearLabel")}
          onChange={(event): void => setYear(Number(event.target.value))}
        >
          {/* Only years the server says have something in them — the picker
              can therefore never lead to an empty story by accident. */}
          {[...wrapped.availableYears].reverse().map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </label>
    ) : null;

  const rankLine =
    wrapped === null
      ? null
      : wrapped.rank === "top"
        ? t("stats:wrapped.rankTop")
        : wrapped.rank === "second" && wrapped.comparisonYear !== null
          ? t("stats:wrapped.rankSecond", { year: wrapped.comparisonYear })
          : null;

  return (
    <AppShell width="list">
      <PageHeader
        title={t("stats:wrapped.title")}
        meta={wrapped ? t("stats:wrapped.intro", { year: wrapped.year }) : undefined}
        actions={yearPicker}
      />

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("common:loading.default")}
        </p>
      )}

      {/* There is no story yet — the account has no countable activity in any
          year. Said in words, because a grid of zeros would pretend there is. */}
      {!loading && failure === "notFound" && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("stats:wrapped.nothingYet")}
        </p>
      )}

      {!loading && failure === "loadError" && (
        <div
          className="rounded-lg p-4"
          role="alert"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--danger)",
            color: "var(--danger)",
          }}
        >
          <p className="text-sm">
            {t("stats:wrapped.loadError")}{" "}
            <button
              type="button"
              onClick={(): void => load(year)}
              style={{
                marginLeft: 8,
                background: "transparent",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {t("stats:page.retry")}
            </button>
          </p>
        </div>
      )}

      {!loading && failure === null && wrapped !== null && (
        <>
          {rankLine !== null && (
            <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
              {rankLine}
            </p>
          )}

          {/* A year the reader asked for that holds nothing is answered, not
              redirected: "you flew nothing in 2019" is true, and picking a
              different year would not be. */}
          {wrapped.flights === 0 && wrapped.cruises === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:wrapped.emptyYear", { year: wrapped.year })}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              <StatCard
                title={t("stats:wrapped.flights")}
                value={count(wrapped.flights)}
                description={t("stats:wrapped.flightsDesc", { year: wrapped.year })}
              />
              <StatCard
                title={t("stats:wrapped.distance")}
                value={formatDistance(wrapped.distanceKm, distanceUnit, t, i18n.language)}
                description={
                  // Below a tenth of a lap the figure rounds to 0.0, and "0×
                  // around the Earth" is a sentence about nothing.
                  wrapped.earthFactor >= 0.1
                    ? t("stats:wrapped.distanceDesc", {
                        factor: wrapped.earthFactor.toLocaleString(locale, {
                          maximumFractionDigits: 1,
                        }),
                      })
                    : t("stats:wrapped.distanceDescShort")
                }
              />
              <StatCard
                title={t("stats:wrapped.newCountries")}
                value={count(wrapped.newCountries)}
                description={t("stats:wrapped.newCountriesDesc")}
              />
              {/* Only where the reader has cruises at all: a zero on an
                  account that does not sail is noise, not a figure. */}
              {cruisesOn && (
                <StatCard
                  title={t("stats:wrapped.cruises")}
                  value={count(wrapped.cruises)}
                  description={t("stats:wrapped.cruisesDesc")}
                />
              )}
              {wrapped.topAirline !== null && (
                <StatCard
                  valueSize="md"
                  title={t("stats:wrapped.topAirline")}
                  value={wrapped.topAirline.name}
                  description={t("stats:wrapped.topAirlineDesc", {
                    count: wrapped.topAirline.flights,
                  })}
                  footnote={wrapped.topAirline.code}
                />
              )}
              {wrapped.topRoute !== null && (
                <StatCard
                  valueSize="md"
                  title={t("stats:wrapped.topRoute")}
                  value={`${wrapped.topRoute.from} – ${wrapped.topRoute.to}`}
                  description={t("stats:wrapped.topRouteDesc", {
                    count: wrapped.topRoute.flights,
                  })}
                />
              )}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
