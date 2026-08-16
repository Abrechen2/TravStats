import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { countryName } from "../../../lib/countryFlag";
import type { LodgingPlace, LodgingStats } from "../../../types/lodging";
import StatCard from "../StatCard";
import RankedBarList from "./RankedBarList";

const LODGING_ACCENT = "var(--domain-lodging, #d4778f)";
const LIST_LIMIT = 8;

interface Props {
  stats: LodgingStats;
}

/** "52.5164° N" — the hemisphere letter reads faster than a minus sign. */
function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}`;
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
}

function placeLabel(place: LodgingPlace): string {
  return place.city ? `${place.lodgingName} · ${place.city}` : place.lodgingName;
}

/**
 * Where the nights happened. The lodging rows have carried coordinates since
 * the geocoding backfill and produced nothing but map pins until now.
 *
 * `unlocatedStays` is stated rather than hidden: the extremes and the centre
 * describe only the located stays, and a screen that omits how many were left
 * out presents a partial answer as a complete one.
 */
export default function LodgingGeoSection({ stats }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["lodging"]);
  const { geo } = stats;
  const locale = i18n.language.startsWith("en") ? "en" : "de";

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("lodging:stats.geo.title")}
      </h2>
      {geo.unlocatedStays > 0 && (
        <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("lodging:stats.geo.unlocated", { count: geo.unlocatedStays })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.geo.continents")}
          value={geo.continentsCount}
          description={geo.continents.join(" · ") || t("lodging:stats.geo.noContinents")}
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.geo.northernmost")}
          value={geo.northernmost ? formatLat(geo.northernmost.lat) : "—"}
          description={
            geo.northernmost ? placeLabel(geo.northernmost) : t("lodging:stats.geo.noCoords")
          }
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.geo.southernmost")}
          value={geo.southernmost ? formatLat(geo.southernmost.lat) : "—"}
          description={
            geo.southernmost ? placeLabel(geo.southernmost) : t("lodging:stats.geo.noCoords")
          }
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="sm"
          title={t("lodging:stats.geo.centre")}
          value={
            geo.centreOfGravity
              ? `${formatLat(geo.centreOfGravity.lat)} · ${formatLon(geo.centreOfGravity.lon)}`
              : "—"
          }
          description={t("lodging:stats.geo.centreDesc")}
          footnote={t("lodging:stats.geo.centreFootnote")}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankedBarList
          title={t("lodging:stats.geo.topCities")}
          accent={LODGING_ACCENT}
          rows={geo.topCities.map((c) => ({
            key: c.key,
            label: c.key,
            weight: c.nights,
            value: t("lodging:stats.geo.nights", { count: c.nights }),
            hint: t("lodging:stats.geo.stays", { count: c.stays }),
          }))}
          emptyLabel={t("lodging:stats.geo.noPlaces")}
          limit={LIST_LIMIT}
          moreLabel={(hidden) => t("lodging:stats.more", { count: hidden })}
        />
        <RankedBarList
          title={t("lodging:stats.geo.topCountries")}
          accent={LODGING_ACCENT}
          rows={geo.topCountries.map((c) => ({
            key: c.key,
            label: countryName(c.key, locale) || c.key,
            weight: c.nights,
            value: t("lodging:stats.geo.nights", { count: c.nights }),
            hint: t("lodging:stats.geo.stays", { count: c.stays }),
          }))}
          emptyLabel={t("lodging:stats.geo.noPlaces")}
          limit={LIST_LIMIT}
          moreLabel={(hidden) => t("lodging:stats.more", { count: hidden })}
        />
      </div>
    </section>
  );
}
