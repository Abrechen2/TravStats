import { useCallback, useEffect, useRef, useState } from "react";

import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import { Select } from "../components/ui/Field";
import StatCard from "../components/Stats/StatCard";
import StatsSectionsLoadError from "../components/Stats/StatsSectionsLoadError";
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

  /**
   * Which request the page is still interested in.
   *
   * Switching years quickly starts a second request before the first has
   * answered, and nothing makes the server answer in the order it was asked:
   * a slow 2019 followed by a fast 2024 would paint 2024 and then overwrite it
   * with 2019, under a picker reading 2024. A ticket per request, and only the
   * newest one may touch state.
   */
  const latestRequest = useRef(0);

  const load = useCallback(
    (requested: number | null): void => {
      if (!flightsOn) return;
      const ticket = latestRequest.current + 1;
      latestRequest.current = ticket;
      setLoading(true);
      setFailure(null);
      statsApi
        .getWrapped(requested ?? undefined)
        .then((next) => {
          if (ticket !== latestRequest.current) return;
          setWrapped(next);
        })
        .catch((err) => {
          if (ticket !== latestRequest.current) return;
          // A 404 is the server saying there is no story at all, which is a
          // different sentence from "I could not ask".
          setFailure(classifyLoadFailure(err));
          logger.error("Failed to load the year in review:", err);
        })
        .finally(() => {
          if (ticket !== latestRequest.current) return;
          setLoading(false);
        });
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

  /**
   * The year the page is TALKING about, which is the reader's choice as soon
   * as they have made one — not the year of the last payload.
   *
   * Driving the picker off `wrapped.year` snapped it back to the old year the
   * moment a switch failed, so the reader watched their own choice undone by
   * an error and had nothing to retry from.
   */
  const shownYear = year ?? wrapped?.year ?? null;

  const yearPicker =
    wrapped !== null && wrapped.availableYears.length > 1 ? (
      <label className="flex items-center gap-2 text-sm">
        <span style={{ color: "var(--text-muted)" }}>{t("stats:wrapped.yearLabel")}</span>
        <Select
          value={String(shownYear ?? wrapped.year)}
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
        meta={shownYear !== null ? t("stats:wrapped.intro", { year: shownYear }) : undefined}
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

      {/* The statistics page's own failure box, not a second one that only
          looks like it. It names the YEAR that failed where there is one —
          "could not be loaded" beside a year picker leaves the reader
          guessing which year that was, and the retry re-asks for exactly the
          year the picker still shows. */}
      {!loading && failure === "loadError" && (
        <StatsSectionsLoadError
          onRetry={(): void => load(year)}
          message={
            year === null
              ? t("stats:wrapped.loadError")
              : t("stats:wrapped.loadErrorYear", { year })
          }
        />
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
              different year would not be.

              "Holds nothing" has to mean "holds nothing THIS READER CAN SEE",
              which is why the cruise count only counts when the cruise card is
              drawn. With cruises switched off, a year with three cruises and
              no flights used to fail this test and draw a grid reading
              "Flüge 0 / Strecke 0 km" — every figure on screen a zero, and the
              one number that was not zero hidden. */}
          {(cruisesOn ? wrapped.flights === 0 && wrapped.cruises === 0 : wrapped.flights === 0) ? (
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
