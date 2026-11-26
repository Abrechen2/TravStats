import { useEffect, useMemo, useState } from "react";
import { formatNumber } from "../lib/units";
import { useParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import { statsApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";
import type { AircraftProfileResponse } from "../types";
import { formatDate as formatUserDate } from "../lib/displayFormat";
import BackLink from "../components/navigation/BackLink";
import { Table, TableRow, type TableColumn } from "../components/ui/Table";
import { useSort } from "../hooks/useSort";

type FlightSortKey = "date" | "flightNumber" | "route" | "distance";

function formatDate(iso: string | null, _locale: string): string {
  return iso ? formatUserDate(iso) || "—" : "—";
}

export default function AircraftPage(): JSX.Element {
  const { registration } = useParams<{ registration: string }>();
  const { t, i18n } = useTranslation(["aircraft", "common"]);
  const [profile, setProfile] = useState<AircraftProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const flights = profile?.flights;
  const accessors = useMemo(
    () => ({
      date: (f: AircraftProfileResponse["flights"][number]) => f.departureTime,
      flightNumber: (f: AircraftProfileResponse["flights"][number]) => f.flightNumber,
      route: (f: AircraftProfileResponse["flights"][number]) =>
        f.depIata && f.arrIata ? `${f.depIata} ${f.arrIata}` : null,
      distance: (f: AircraftProfileResponse["flights"][number]) => f.distanceKm,
    }),
    []
  );
  const sort = useSort<AircraftProfileResponse["flights"][number], FlightSortKey>({
    tableKey: "aircraft-flights",
    rows: flights ?? [],
    accessors,
    defaultBy: "date",
    defaultOrder: "desc",
    descendingFirst: ["date", "distance"],
    locale: i18n.language,
  });

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
    <AppShell>
      <div>
        <BackLink
          to="/stats"
          className="ts-back-link mb-4 inline-block text-sm text-(--text-muted)"
        >
          ← {t("aircraft:backToStats")}
        </BackLink>
        {loading && <p className="text-sm text-gray-500">{t("common:loading.default")}</p>}
        {!loading && notFound && (
          <div className="bg-(--bg-elevated) rounded-xl shadow-sm p-6">
            <h1 className="t-screen-title mb-2">{registration}</h1>
            <p className="text-sm text-gray-500">{t("aircraft:notFound")}</p>
          </div>
        )}
        {!loading && profile && (
          <>
            <div className="bg-(--bg-elevated) rounded-xl shadow-sm p-6 mb-6">
              <h1 className="t-screen-title mb-1">{profile.registration}</h1>
              <p className="text-(--text-secondary)">
                {profile.aircraft || t("aircraft:unknownType")}
                {profile.airline && <span className="text-gray-500"> · {profile.airline}</span>}
              </p>
              {profile.modeS && (
                <p className="text-xs text-gray-400 mt-1 font-mono">Mode-S: {profile.modeS}</p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                <Stat label={t("aircraft:stats.flights")} value={profile.flightCount.toString()} />
                <Stat
                  label={t("aircraft:stats.distance")}
                  value={`${formatNumber(Math.round(profile.totalDistanceKm), undefined, i18n.language)} km`}
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
              <FlightsTable flights={sort.rows} sort={sort} />
            </div>
          </>
        )}
      </div>
    </AppShell>
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

function FlightsTable({
  flights,
  sort,
}: {
  flights: AircraftProfileResponse["flights"];
  sort: ReturnType<typeof useSort<AircraftProfileResponse["flights"][number], FlightSortKey>>;
}): JSX.Element {
  const { t, i18n } = useTranslation(["aircraft", "common"]);
  const column = (key: FlightSortKey, label: string): Pick<TableColumn, "label" | "sort"> => ({
    label,
    sort: sort.columnSort(key, t("common:ui.sortBy", { column: label })),
  });
  const columns: TableColumn[] = [
    { key: "date", min: 110, onNarrow: "subtitle", ...column("date", t("aircraft:flights.date")) },
    {
      key: "flightNumber",
      min: 110,
      mono: true,
      onNarrow: "title",
      ...column("flightNumber", t("aircraft:flights.flightNumber")),
    },
    {
      key: "route",
      min: 130,
      grow: 1,
      onNarrow: "subtitle",
      ...column("route", t("aircraft:flights.route")),
    },
    {
      key: "distance",
      min: 100,
      align: "end",
      onNarrow: "trailing",
      ...column("distance", t("aircraft:flights.distance")),
    },
  ];
  return (
    <Table columns={columns} label={t("aircraft:flights.title")}>
      {flights.map((flight) => (
        <TableRow
          key={flight.id}
          columns={columns}
          dense
          cells={[
            formatDate(flight.departureTime, i18n.language),
            flight.flightNumber || "—",
            `${flight.depIata || "?"} → ${flight.arrIata || "?"}`,
            `${formatNumber(Math.round(flight.distanceKm), undefined, i18n.language)} km`,
          ]}
        />
      ))}
    </Table>
  );
}
