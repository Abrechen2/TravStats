import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import { statsApi } from "../lib/api";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { useTranslation } from "../hooks/useTranslation";
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
 */

const monthStamp = (iso: string | null, locale: string): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { month: "short", year: "2-digit" });
};

const countryName = (code: string, locale: string): string => {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    // A locale the browser has no region names for. The code is still correct,
    // just terser — better than an empty cell.
    return code;
  }
};

export default function PassportPage(): JSX.Element {
  const { t, i18n } = useTranslation(["passport", "common"]);
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
            {passport && passport.summary.countries > 0 && (
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
              {passport.summary.countries === 0 ? (
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
                      {[
                        ["countries", passport.summary.countries],
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

                  {/* ── the full table, which is what a desktop adds ────── */}
                  <section
                    className="rounded-xl border overflow-hidden"
                    style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
                    aria-labelledby="countries-heading"
                  >
                    <h2 id="countries-heading" className="text-sm font-semibold px-6 pt-6 pb-3">
                      {t("passport:countries.title")}
                    </h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr
                            className="text-left text-[11px] uppercase tracking-wider"
                            style={{ color: "var(--text-muted)" }}
                          >
                            <th className="px-6 py-2 font-medium">
                              {t("passport:countries.country")}
                            </th>
                            <th className="px-3 py-2 font-medium text-right">
                              {t("passport:countries.entries")}
                            </th>
                            <th className="px-3 py-2 font-medium">
                              {t("passport:countries.period")}
                            </th>
                            <th className="px-6 py-2 font-medium">
                              {t("passport:countries.airports")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {passport.countries.map((row) => (
                            <tr
                              key={row.code}
                              className="border-t"
                              style={{ borderColor: "var(--border)" }}
                            >
                              <td className="px-6 py-2.5">
                                <span className="font-mono text-xs mr-2 opacity-70">
                                  {row.code}
                                </span>
                                {countryName(row.code, locale)}
                                {row.isHome && (
                                  <span
                                    className="ml-2 text-[10px] uppercase tracking-wide"
                                    style={{ color: "var(--text-muted)" }}
                                  >
                                    {t("passport:countries.home")}
                                  </span>
                                )}
                                {row.isNew && (
                                  <span
                                    className="ml-2 text-[10px] uppercase tracking-wide"
                                    style={{ color: "var(--accent)" }}
                                  >
                                    {t("passport:countries.new")}
                                  </span>
                                )}
                              </td>
                              <td
                                className="px-3 py-2.5 text-right"
                                style={{ fontVariantNumeric: "tabular-nums" }}
                              >
                                {row.entries}
                              </td>
                              <td
                                className="px-3 py-2.5 whitespace-nowrap"
                                style={{
                                  color: "var(--text-muted)",
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {row.firstYear === null
                                  ? "—"
                                  : row.firstYear === row.lastYear
                                    ? row.firstYear
                                    : `${row.firstYear}–${row.lastYear}`}
                              </td>
                              <td
                                className="px-6 py-2.5 font-mono text-xs"
                                style={{ color: "var(--text-secondary)" }}
                              >
                                {row.airports.join(" · ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
