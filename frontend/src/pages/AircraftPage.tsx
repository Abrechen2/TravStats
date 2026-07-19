import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import { statsApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";
import type { AircraftProfileResponse } from "../types";

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export default function AircraftPage(): JSX.Element {
  const { registration } = useParams<{ registration: string }>();
  const { t, i18n } = useTranslation(["aircraft", "common"]);
  const [profile, setProfile] = useState<AircraftProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!registration) return;
    setLoading(true);
    setNotFound(false);
    statsApi
      .getAircraftProfile(registration)
      .then(setProfile)
      .catch((err) => {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 404) {
          setNotFound(true);
        } else {
          logger.error("Failed to load aircraft profile:", err);
        }
      })
      .finally(() => setLoading(false));
  }, [registration]);

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="max-w-5xl mx-auto px-4 py-6">
          <Link
            to="/stats"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
          >
            ← {t("aircraft:backToStats")}
          </Link>
          {loading && <p className="text-sm text-gray-500">{t("common:loading.default")}</p>}
          {!loading && notFound && (
            <div className="bg-(--bg-elevated) rounded-xl shadow-sm p-6">
              <h1 className="text-2xl font-bold mb-2">{registration}</h1>
              <p className="text-sm text-gray-500">{t("aircraft:notFound")}</p>
            </div>
          )}
          {!loading && profile && (
            <>
              <div className="bg-(--bg-elevated) rounded-xl shadow-sm p-6 mb-6">
                <h1 className="text-3xl font-bold font-mono mb-1">{profile.registration}</h1>
                <p className="text-gray-600 dark:text-gray-300">
                  {profile.aircraft || t("aircraft:unknownType")}
                  {profile.airline && <span className="text-gray-500"> · {profile.airline}</span>}
                </p>
                {profile.modeS && (
                  <p className="text-xs text-gray-400 mt-1 font-mono">Mode-S: {profile.modeS}</p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  <Stat
                    label={t("aircraft:stats.flights")}
                    value={profile.flightCount.toString()}
                  />
                  <Stat
                    label={t("aircraft:stats.distance")}
                    value={`${Math.round(profile.totalDistanceKm).toLocaleString()} km`}
                  />
                  <Stat
                    label={t("aircraft:stats.airports")}
                    value={profile.uniqueAirports.toString()}
                  />
                  <Stat
                    label={t("aircraft:stats.firstSeen")}
                    value={formatDate(profile.firstFlightDate, i18n.language)}
                  />
                </div>
              </div>

              <div className="bg-(--bg-elevated) rounded-xl shadow-sm p-6">
                <h2 className="text-xl font-semibold mb-4">{t("aircraft:flights.title")}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                        <th className="py-2 pr-4">{t("aircraft:flights.date")}</th>
                        <th className="py-2 pr-4">{t("aircraft:flights.flightNumber")}</th>
                        <th className="py-2 pr-4">{t("aircraft:flights.route")}</th>
                        <th className="py-2 pr-4 text-right">{t("aircraft:flights.distance")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.flights.map((flight) => (
                        <tr
                          key={flight.id}
                          className="border-b border-gray-100 dark:border-gray-700/50"
                        >
                          <td className="py-2 pr-4">
                            {formatDate(flight.departureTime, i18n.language)}
                          </td>
                          <td className="py-2 pr-4 font-mono">{flight.flightNumber || "—"}</td>
                          <td className="py-2 pr-4">
                            {flight.depIata || "?"} → {flight.arrIata || "?"}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            {Math.round(flight.distanceKm).toLocaleString()} km
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
