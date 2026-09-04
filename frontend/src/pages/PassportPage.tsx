import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import CountryTable from "../components/Passport/CountryTable";
import EvidenceSummary from "../components/Passport/EvidenceSummary";
import { countryName } from "../components/Passport/countryName";
import { statsApi } from "../lib/api";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { useTranslation } from "../hooks/useTranslation";
import { useDismissedNotice } from "../hooks/useDismissedNotice";
import { useAuthStore } from "../store/authStore";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useBetaFeatureAccess } from "../hooks/useBetaFeatures";
import { logger } from "../lib/logger";
import type { Passport, PassportContinentGroup } from "../types/passport";

/**
 * The passport.
 *
 * Every number comes from GET /stats/passport and nothing is recomputed here.
 * The mobile app draws the same screen; a second derivation on this side is
 * exactly the drift the server endpoint exists to prevent.
 *
 * Two deliberate absences, both inherited from the app's own scars:
 *
 * NO PERCENTAGE OF THE WORLD. There is no agreed count of the world's
 * countries, so a percentage would put a made-up denominator under a real
 * numerator. The continent band says "9 of 51" against the catalogue instead.
 *
 * NO FLAGS. The ISO code is the glyph. Flags are political, go out of date,
 * and render differently on every platform.
 *
 * ONE NUMBER IS NOT THE WHOLE ANSWER. `summary.countries` applies a threshold
 * and `summary.countriesTotal` does not, and both are shown. The page is empty
 * only when the TOTAL is empty: a passport whose every country was reached on a
 * connection has three countries and a headline of zero, and showing "no
 * flights yet" over it would delete exactly the rows a reader needs to correct.
 */

const monthStamp = (iso: string | null, locale: string): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { month: "short", year: "2-digit" });
};

export default function PassportPage(): JSX.Element {
  const { t, i18n } = useTranslation(["passport", "common"]);
  // One dismissal per user, keyed to the change it explains.
  const userId = useAuthStore((s) => s.user?.id ?? "anonymous");
  const countingNotice = useDismissedNotice(`passport-counting-2026-09.${userId}`);
  const { isEnabled } = useEnabledDomains();
  const gate = useBetaFeatureAccess("passport");
  const [passport, setPassport] = useState<Passport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  // Only once the gate says yes. While it is still unknown there is nothing to
  // show the answer in yet, and a refused user should not be sending the
  // request at all — the endpoint being open is a deliberate property of the
  // gate, not an invitation to call it from a page that will not render it.
  useEffect(() => {
    if (gate !== "allowed" || !isEnabled("flight")) return;
    setLoading(true);
    setFailure(null);
    statsApi
      .getPassport()
      .then(setPassport)
      .catch((err) => {
        setFailure(classifyLoadFailure(err));
        logger.error("Failed to load passport:", err);
      })
      .finally(() => setLoading(false));
  }, [gate, isEnabled]);

  const quotaByGroup = useMemo(() => {
    if (!passport) return [];
    return passport.groups.map((group: PassportContinentGroup) => {
      const rows = passport.continents.filter((c) => group.continents.includes(c.continent));
      return {
        key: group.key,
        visited: rows.reduce((sum, r) => sum + r.visited, 0),
        total: rows.reduce((sum, r) => sum + r.total, 0),
      };
    });
  }, [passport]);

  /**
   * Does any country here carry track evidence? — spec §3.4c.
   *
   * An existence check on the payload, never a re-derivation of anything: the
   * `transited` rung and the `track` kind can only exist once a location
   * history has been swept, and a legend entry that is permanently zero reads
   * as a bug rather than as an empty set. Read off `kinds`, not off
   * `byEvidence.track`, which counts only the countries where a track is the
   * STRONGEST evidence — an account whose every track country also has a flight
   * would score zero there and still have tracks.
   */
  const hasTracks = useMemo(
    () => (passport?.countries ?? []).some((c) => c.kinds.includes("track")),
    [passport]
  );

  const locale = i18n.language === "de" ? "de-DE" : "en-GB";

  // While the instance flag is still unknown, wait rather than redirect: the
  // flag is not persisted, so a cold load on this URL — a bookmark, a refresh,
  // a link in a new tab — would otherwise bounce off a page the user asked for.
  if (gate === "pending") {
    return (
      <PageTransition>
        <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
          <NavigationBar />
          <div
            className="mx-auto max-w-5xl px-4 py-16 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("common:loading.default")}
          </div>
        </div>
      </PageTransition>
    );
  }

  // The nav entry is hidden behind the same gate; this closes the URL too, so
  // the gate is not merely cosmetic. The ENDPOINT stays open on purpose — the
  // Companion app is meant to read it whatever an instance's flag says.
  if (gate === "denied" || !isEnabled("flight")) {
    return (
      <PageTransition>
        <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
          <NavigationBar />
          <div className="max-w-5xl mx-auto px-4 py-10">
            <h1 className="text-2xl font-bold mb-2">{t("passport:title")}</h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("passport:needsFlights")}
            </p>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="max-w-5xl mx-auto px-4 py-6 print:max-w-none print:py-0">
          <div className="flex items-baseline justify-between mb-4 print:hidden">
            <Link to="/stats" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
              ← {t("passport:backToStats")}
            </Link>
            {passport && passport.summary.countriesTotal > 0 && (
              <button
                type="button"
                onClick={(): void => window.print()}
                className="text-sm px-3 py-1.5 rounded-lg border"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                {t("passport:print")}
              </button>
            )}
          </div>

          {loading && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("common:loading.default")}
            </p>
          )}

          {/* A failed load says so. It must never fall through to a card of
              zeros, which reads as "you have never travelled". */}
          {!loading && failure !== null && (
            <div
              className="rounded-xl p-6"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
            >
              <p className="text-sm mb-3">{t("passport:loadError")}</p>
              <button
                type="button"
                onClick={(): void => window.location.reload()}
                className="text-sm px-3 py-1.5 rounded-lg border"
                style={{ borderColor: "var(--border)" }}
              >
                {t("common:buttons.retry")}
              </button>
            </div>
          )}

          {!loading && failure === null && passport !== null && (
            <>
              {passport.summary.countriesTotal === 0 ? (
                <div
                  className="rounded-xl p-8 text-center"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  <h1 className="text-2xl font-bold mb-2">{t("passport:title")}</h1>
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {t("passport:empty")}
                  </p>
                </div>
              ) : (
                <>
                  {/* ── the paper card ─────────────────────────────────── */}
                  <section
                    className="rounded-xl p-6 mb-6 border"
                    style={{
                      background: "var(--bg-elevated)",
                      borderColor: "var(--border)",
                    }}
                    aria-labelledby="passport-heading"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
                      <h1 id="passport-heading" className="text-2xl font-bold tracking-wide">
                        {t("passport:title")}
                      </h1>
                      {passport.summary.firstStampYear !== null && (
                        <span
                          className="text-xs uppercase tracking-widest"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {t("passport:since", { year: passport.summary.firstStampYear })}
                        </span>
                      )}
                    </div>

                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                      {/* The headline and the total, side by side and labelled.
                          `airports` and `entries` count flights and are
                          deliberately untouched by any of this: a house proves
                          a country, it does not add an airport. */}
                      <div>
                        <dt
                          className="text-[11px] uppercase tracking-wider"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {t("passport:summary.countries")}
                        </dt>
                        <dd
                          className="text-2xl font-semibold"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {passport.summary.countries}
                          <span
                            className="text-base"
                            style={{ color: "var(--text-muted)" }}
                            title={t("passport:summary.countriesTotalExplained")}
                          >
                            {" / "}
                            {passport.summary.countriesTotal}
                          </span>
                        </dd>
                        <dd className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {t("passport:summary.countriesTotal")}
                        </dd>
                        {/* Design §5: every user's number moved when evidence tiers
                            arrived, and a number that changes without explanation
                            reads as data loss. Said once, with the real figures. */}
                        {passport.summary.legacyCountries !== passport.summary.countries &&
                          !countingNotice.dismissed && (
                            <dd
                              className="mt-2 rounded-md px-3 py-2 text-xs"
                              style={{
                                background: "var(--bg-elevated)",
                                border: "1px solid var(--color-border)",
                                color: "var(--text-primary)",
                              }}
                            >
                              <span>
                                {t("passport:countingChanged.text", {
                                  before: passport.summary.legacyCountries,
                                  after: passport.summary.countries,
                                })}
                              </span>
                              <span className="ml-2">
                                <a href="#passport-evidence" className="underline">
                                  {t("passport:countingChanged.what")}
                                </a>
                              </span>
                              <button
                                type="button"
                                onClick={countingNotice.dismiss}
                                className="ml-3 underline"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {t("passport:countingChanged.dismiss")}
                              </button>
                            </dd>
                          )}
                      </div>
                      {[
                        ["airports", passport.summary.airports],
                        ["entries", passport.summary.entries],
                      ].map(([key, value]) => (
                        <div key={key as string}>
                          <dt
                            className="text-[11px] uppercase tracking-wider"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {t(`passport:summary.${key as string}`)}
                          </dt>
                          <dd
                            className="text-2xl font-semibold"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {value as number}
                          </dd>
                        </div>
                      ))}
                      <div>
                        <dt
                          className="text-[11px] uppercase tracking-wider"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {t("passport:summary.continents")}
                        </dt>
                        <dd
                          className="text-2xl font-semibold"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {passport.summary.continentsVisited}
                          <span className="text-base" style={{ color: "var(--text-muted)" }}>
                            {" / "}
                            {passport.summary.continentsTotal}
                          </span>
                        </dd>
                      </div>
                    </dl>

                    {/* Why the headline is not the total — the rule, named. */}
                    <section id="passport-evidence">
                      <EvidenceSummary summary={passport.summary} hasTracks={hasTracks} />
                    </section>

                    <h2
                      className="text-[11px] uppercase tracking-wider mb-2"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {t("passport:stamps")}
                    </h2>
                    <ul className="flex flex-wrap gap-2">
                      {passport.stamps.map((stamp) => (
                        <li
                          key={stamp.iata}
                          className="px-2.5 py-1.5 rounded-md border font-mono text-center"
                          style={{ borderColor: "var(--border)" }}
                          title={stamp.country ? countryName(stamp.country, locale) : undefined}
                        >
                          <span className="block text-sm font-semibold tracking-wider">
                            {stamp.iata}
                          </span>
                          <span
                            className="block text-[10px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {monthStamp(stamp.date, locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  {/* ── the continent band ─────────────────────────────── */}
                  <section
                    className="rounded-xl p-6 mb-6 border"
                    style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
                    aria-labelledby="continents-heading"
                  >
                    <h2 id="continents-heading" className="text-sm font-semibold mb-1">
                      {t("passport:continents.title")}
                    </h2>
                    {/* The denominator is named, because an unnamed one is a
                        made-up number sitting next to a real one. */}
                    <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
                      {t("passport:continents.denominator")}
                    </p>
                    <ul className="space-y-2.5">
                      {quotaByGroup.map((row) => (
                        <li key={row.key} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 text-sm">
                            {t(`passport:continents.${row.key}`)}
                          </span>
                          <span
                            className="flex-1 h-2 rounded-full overflow-hidden"
                            style={{ background: "var(--bg-base)" }}
                          >
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${row.total > 0 ? (row.visited / row.total) * 100 : 0}%`,
                                background: "var(--accent)",
                              }}
                            />
                          </span>
                          <span
                            className="w-16 text-right text-xs"
                            style={{
                              color: "var(--text-muted)",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {row.visited} / {row.total}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  {/* ── the full table, which is what a desktop adds ──────
                      Every country with any evidence, including the ones the
                      headline does not count: those are greyed, never dropped. */}
                  <CountryTable countries={passport.countries} locale={locale} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
