// The map's click card — one component for both renderers.
//
// It started as the globe's pinned popup (Phase B of the Globe pinned-card UX
// rework). On 2026-09-20 the owner put the globe card and the flat map's five
// ad-hoc tooltips side by side and ruled that this one is the map card:
// "Globus soll überall genutzt werden". So it moved out of `Globe/` into the
// shared map chrome, gained the flat map's two missing selections (a trip
// group and a Sonder-Flug) and the "Bearbeiten" action the flat map had and
// the globe lacked — which the globe now gets too, because one card means one
// action row.
//
// Purely the inner content: no positioning, no occlusion, no anchor logic.
// Each renderer mounts it wherever its own projection says the anchor is.

import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  FlagImg,
  countryName,
  countryFromUnlocode,
  resolveCountryCode,
} from "../../../lib/countryFlag";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import { tokens } from "../../../theme/tokens";
import type { CruiseCardDatum, MapPinned, MarkerCardDatum, RouteCardDatum } from "./pinnedTypes";
import { getAirportStats, getArcStats, getCruiseStats, getPortStats } from "./cardStats";
import {
  Actions,
  Grid,
  Hero,
  IcaoPill,
  Place,
  Row,
  SubHeading,
  SURFACE,
  capitalize,
  formatDate,
  formatDuration,
  formatKm,
  formatKmNumber,
  type TFn,
} from "./cardChrome";
import { CardFlights } from "./CardFlights";
import {
  LodgingBody,
  PlaceBody,
  SpecialFlightBody,
  TripBody,
  type BodyCommonProps,
} from "./cardBodies";

interface PinnedCardProps {
  pinned: MapPinned;
  flights: readonly GeoJSONFeature[];
  cruises: Cruise[];
  onClose: () => void;
  /** Fires when the "Open (last) flight" action is used. */
  onFlightOpen?: (flightId: string) => void;
  /** Fires when the "Bearbeiten" action is used — the flat map's edit modal. */
  onFlightEdit?: (flightId: string) => void;
  /** Fires when the "Open cruise" action is used. */
  onCruiseOpen?: (cruiseId: string) => void;
  /** Fires when a trip group's "Details" action is used. */
  onTripDetails?: () => void;
  /** Fires when the lodging card's "Unterkunft öffnen" action is used. */
  onLodgingOpen?: (lodgingId: string) => void;
  /** Fires when the place card's "Ort öffnen" action is used. */
  onPlaceOpen?: (placeId: string) => void;
  /**
   * `"single"` when the selection IS one flight rather than the whole route,
   * which is what the flat map's single-flight click means. Only changes the
   * primary action's wording — the card still shows the route, because a
   * flight without its route reads like a fragment.
   */
  selectionScope?: "route" | "single";
}

export function PinnedCard({
  pinned,
  flights,
  cruises,
  onClose,
  onFlightOpen,
  onFlightEdit,
  onCruiseOpen,
  onTripDetails,
  onLodgingOpen,
  onPlaceOpen,
  selectionScope = "route",
}: PinnedCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["map", "common", "lodging", "places", "specialFlights"]);
  const locale = i18n.language || "de";

  // Subtle entrance: fade + lift on mount (each pin remounts this card).
  // Pure transition — no keyframes — and it collapses to nothing under
  // prefers-reduced-motion because the initial + final states are one frame
  // apart when transitions are disabled.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="rounded-md p-3 text-xs"
      style={{
        ...SURFACE,
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0) scale(1)" : "translateY(6px) scale(0.98)",
        transition:
          "opacity .26s cubic-bezier(0.16,1,0.3,1), transform .26s cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <Heading pinned={pinned} t={t} />
        <button
          type="button"
          aria-label={t("common:accessibility.close")}
          onClick={onClose}
          className="cursor-pointer rounded-sm px-1 text-[11px] leading-none opacity-70 hover:opacity-100"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          ✕
        </button>
      </div>

      {pinned.kind === "airport" && (
        <AirportBody data={pinned.data} flights={flights} locale={locale} t={t} />
      )}
      {pinned.kind === "port" && (
        <PortBody data={pinned.data} cruises={cruises} locale={locale} t={t} />
      )}
      {pinned.kind === "arc" && (
        <ArcBody
          data={pinned.data}
          flights={flights}
          locale={locale}
          t={t}
          onFlightOpen={onFlightOpen}
          onFlightEdit={onFlightEdit}
          selectionScope={selectionScope}
        />
      )}
      {pinned.kind === "cruise" && (
        <CruiseBody
          data={pinned.data}
          cruises={cruises}
          locale={locale}
          t={t}
          onCruiseOpen={onCruiseOpen}
        />
      )}
      {pinned.kind === "trip" && (
        <TripBody
          data={pinned.data}
          flights={flights}
          locale={locale}
          t={t}
          onTripDetails={onTripDetails}
        />
      )}
      {pinned.kind === "specialFlight" && (
        <SpecialFlightBody
          data={pinned.data}
          locale={locale}
          t={t}
          onFlightOpen={onFlightOpen}
          onFlightEdit={onFlightEdit}
        />
      )}
      {pinned.kind === "lodging" && (
        <LodgingBody data={pinned.data} locale={locale} t={t} onLodgingOpen={onLodgingOpen} />
      )}
      {pinned.kind === "place" && (
        <PlaceBody data={pinned.data} locale={locale} t={t} onPlaceOpen={onPlaceOpen} />
      )}
    </div>
  );
}

// ─── Heading (Tier 1) ─────────────────────────────────────────────

function Heading({ pinned, t }: { pinned: MapPinned; t: TFn }): JSX.Element {
  switch (pinned.kind) {
    case "arc":
      return (
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          {pinned.data.departure.country ? (
            <FlagImg country={pinned.data.departure.country} height={18} />
          ) : (
            <span>✈</span>
          )}
          <span>{pinned.data.departure.iata ?? "?"}</span>
          <span className="opacity-50">↔</span>
          <FlagImg country={pinned.data.arrival.country} height={18} />
          <span>{pinned.data.arrival.iata ?? "?"}</span>
        </div>
      );
    case "airport":
      return (
        <div className="flex items-center gap-2 text-[16px] font-semibold">
          {pinned.data.country ? (
            <FlagImg country={pinned.data.country} height={22} />
          ) : (
            <span>✈</span>
          )}
          <span>{pinned.data.iata}</span>
          <IcaoPill icao={pinned.data.icao} />
        </div>
      );
    case "port":
      return (
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          {pinned.data.country ? (
            <FlagImg country={pinned.data.country} height={20} />
          ) : (
            <span>⚓</span>
          )}
          <span>{pinned.data.name}</span>
        </div>
      );
    case "cruise":
      return <div className="text-[13px] font-semibold">🚢 {pinned.data.cruiseLabel}</div>;
    case "trip":
      return (
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <span>✈</span>
          <span>
            {pinned.data.flightIds.length}{" "}
            {t("map:globe.flight", { count: pinned.data.flightIds.length })}
          </span>
        </div>
      );
    // `Lodging.country` / `Place.country` are FREE TEXT — an ISO code or a
    // full country name, in German or English. `FlagImg` needs a strict
    // two-letter code and renders nothing otherwise, so both resolve first,
    // exactly as the flat map's tooltip does (markerTooltip.ts).
    case "lodging":
      return (
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          {resolveCountryCode(pinned.data.country) ? (
            <FlagImg country={resolveCountryCode(pinned.data.country)} height={20} />
          ) : (
            <span>🏨</span>
          )}
          <span>{pinned.data.name}</span>
        </div>
      );
    case "place":
      return (
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          {resolveCountryCode(pinned.data.country) ? (
            <FlagImg country={resolveCountryCode(pinned.data.country)} height={20} />
          ) : (
            <span>📍</span>
          )}
          <span>{pinned.data.name}</span>
        </div>
      );
    case "specialFlight":
      return (
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <span aria-hidden>{pinned.data.icon}</span>
          <span
            style={{
              color: `rgb(${pinned.data.color[0]},${pinned.data.color[1]},${pinned.data.color[2]})`,
            }}
          >
            {t(`specialFlights:specialType.${pinned.data.specialType}`)}
          </span>
        </div>
      );
  }
}

/** Row of the unique country flags a cruise visits, in itinerary order.
 *  One country → a single big flag; several → a small-flag row (each country
 *  shown once). Codes come from the ports' UN/LOCODE prefixes. */
function CruiseFlags({ cruise }: { cruise: Cruise }): JSX.Element | null {
  const codes: string[] = [];
  const seen = new Set<string>();
  const add = (unlocode?: string | null): void => {
    const cc = countryFromUnlocode(unlocode);
    if (cc && !seen.has(cc)) {
      seen.add(cc);
      codes.push(cc);
    }
  };
  add(cruise.departurePort?.unlocode);
  for (const stop of cruise.stops) add(stop.port?.unlocode);
  add(cruise.arrivalPort?.unlocode);

  if (codes.length === 0) return null;
  if (codes.length === 1) {
    return (
      <div className="mb-2">
        <FlagImg country={codes[0]} height={26} />
      </div>
    );
  }
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      {codes.map((cc) => (
        <FlagImg key={cc} country={cc} height={14} />
      ))}
    </div>
  );
}

// ─── Airport body ─────────────────────────────────────────────────

function AirportBody({
  data,
  flights,
  locale,
  t,
}: { data: MarkerCardDatum; flights: readonly GeoJSONFeature[] } & BodyCommonProps): JSX.Element {
  const stats = getAirportStats(flights, data.iata);
  return (
    <>
      <SubHeading>{data.name}</SubHeading>
      <Place city={data.city} country={data.country} locale={locale} />
      <Hero color={tokens.domainColor.flight}>
        {stats.totalVisits} {t("map:globe.flight", { count: stats.totalVisits })}
      </Hero>
      <Grid>
        {stats.totalKm > 0 && (
          <Row label={t("map:globe.pinned.distance")} value={formatKm(stats.totalKm)} />
        )}
        {stats.longestRoute && (
          <Row
            label={t("map:globe.pinned.longestRoute")}
            value={`→ ${stats.longestRoute.iata} · ${formatKm(stats.longestRoute.km)}`}
          />
        )}
        {stats.topAirline && (
          <Row label={t("map:globe.pinned.topAirline")} value={stats.topAirline} />
        )}
        {stats.topAircraft && (
          <Row label={t("map:globe.pinned.topAircraft")} value={stats.topAircraft} />
        )}
        {stats.lastVisitDate && (
          <Row label={t("map:tooltip.lastVisit")} value={formatDate(stats.lastVisitDate, locale)} />
        )}
      </Grid>
    </>
  );
}

// ─── Port body ────────────────────────────────────────────────────

function PortBody({
  data,
  cruises,
  locale,
  t,
}: { data: MarkerCardDatum; cruises: Cruise[] } & BodyCommonProps): JSX.Element {
  const portKey = data.iata !== data.name ? data.iata : data.name;
  const stats = getPortStats(cruises, portKey);
  return (
    <>
      {data.iata !== data.name && <SubHeading>{data.iata}</SubHeading>}
      <Place city={data.city} country={data.country} locale={locale} />
      <Hero color={tokens.domainColor.cruise}>
        {stats.totalVisits} {t("map:airportMarkers.visits")}
      </Hero>
      <Grid>
        {stats.country && <Row label={t("map:globe.pinned.country")} value={stats.country} />}
        {stats.region && (
          <Row label={t("map:globe.pinned.region")} value={capitalize(stats.region)} />
        )}
        {stats.ships.length > 0 && (
          <Row
            label={t("map:globe.pinned.ships")}
            value={stats.ships.slice(0, 3).join(", ") + (stats.ships.length > 3 ? "…" : "")}
          />
        )}
        {stats.longestPortCallMinutes !== null && (
          <Row
            label={t("map:globe.pinned.longestPortCall")}
            value={formatDuration(stats.longestPortCallMinutes, t)}
          />
        )}
        {stats.lastCallDate && (
          <Row label={t("map:tooltip.lastCall")} value={formatDate(stats.lastCallDate, locale)} />
        )}
      </Grid>
    </>
  );
}

// ─── Route body ───────────────────────────────────────────────────

function ArcBody({
  data,
  flights,
  locale,
  t,
  onFlightOpen,
  onFlightEdit,
  selectionScope,
}: {
  data: RouteCardDatum;
  flights: readonly GeoJSONFeature[];
  onFlightOpen?: (flightId: string) => void;
  onFlightEdit?: (flightId: string) => void;
  selectionScope: "route" | "single";
} & BodyCommonProps): JSX.Element {
  const stats = getArcStats(flights, data.flightIds);
  const colorRgb = `rgb(${data.color[0]},${data.color[1]},${data.color[2]})`;
  const target = data.flightIds[data.flightIds.length - 1];
  return (
    <>
      <div className="mb-2.5 space-y-1.5">
        {[data.departure, data.arrival].map((ep, i) => {
          const place = [ep.city, countryName(ep.country, locale)]
            .filter((s): s is string => !!s)
            .join(", ");
          return (
            <div key={i} className="text-[11px]">
              <div className="text-[12px] font-medium" style={{ color: tokens.color.text }}>
                {ep.iata ?? "?"} · {ep.name ?? ""}
              </div>
              {place && <div style={{ color: tokens.color.faint }}>{place}</div>}
            </div>
          );
        })}
      </div>
      <Hero color={colorRgb}>
        {t("map:globe.pinned.totalKm", {
          count: data.count,
          km: formatKmNumber(stats.totalKm),
        })}
      </Hero>
      <Grid>
        {stats.lastFlightDate && (
          <Row
            label={t("map:globe.pinned.lastFlight")}
            value={formatDate(stats.lastFlightDate, locale)}
          />
        )}
        {stats.topAircraft && (
          <Row label={t("map:globe.pinned.topAircraft")} value={stats.topAircraft} />
        )}
        {stats.topAirline && (
          <Row label={t("map:globe.pinned.topAirline")} value={stats.topAirline} />
        )}
      </Grid>
      <CardFlights flights={flights} flightIds={data.flightIds} locale={locale} t={t} />
      <Actions
        primary={
          onFlightOpen && target
            ? {
                label:
                  selectionScope === "single"
                    ? t("map:globe.pinned.openFlight")
                    : t("map:globe.openLastFlight"),
                onClick: () => onFlightOpen(target),
              }
            : undefined
        }
        secondary={
          onFlightEdit && target
            ? { label: t("common:buttons.edit"), onClick: () => onFlightEdit(target) }
            : undefined
        }
      />
    </>
  );
}

// ─── Cruise body ──────────────────────────────────────────────────

function CruiseBody({
  data,
  cruises,
  locale,
  t,
  onCruiseOpen,
}: {
  data: CruiseCardDatum;
  cruises: Cruise[];
  onCruiseOpen?: (cruiseId: string) => void;
} & BodyCommonProps): JSX.Element {
  const stats = getCruiseStats(cruises, data.cruiseId);
  const cruise = cruises.find((c) => c.id === data.cruiseId);
  if (!stats) {
    return <div className="text-[11px] opacity-85">{t("map:visMode.tripRoutes")}</div>;
  }

  const dateRange =
    stats.startDate && stats.endDate
      ? `${formatDate(stats.startDate, locale)} – ${formatDate(stats.endDate, locale)}`
      : (stats.startDate ?? stats.endDate ?? "");

  return (
    <>
      {stats.line && <SubHeading>{stats.line}</SubHeading>}
      {cruise && <CruiseFlags cruise={cruise} />}
      <Hero color={tokens.domainColor.cruise}>{dateRange}</Hero>
      <Grid>
        <Row label={t("map:globe.pinned.portsLabel")} value={String(stats.portCount)} />
        <Row label={t("map:globe.pinned.seaDaysLabel")} value={String(stats.seaDays)} />
        {stats.embarkPort && <Row label={t("map:globe.pinned.embark")} value={stats.embarkPort} />}
        {stats.debarkPort && stats.debarkPort !== stats.embarkPort && (
          <Row label={t("map:globe.pinned.debark")} value={stats.debarkPort} />
        )}
      </Grid>
      <Actions
        primary={
          onCruiseOpen
            ? {
                label: t("map:globe.pinned.openCruise"),
                onClick: () => onCruiseOpen(data.cruiseId),
              }
            : undefined
        }
      />
    </>
  );
}
