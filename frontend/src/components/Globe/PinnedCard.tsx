// Pinned detail card shown when the user clicks a feature on the
// globe. Mounted by GlobeView into a MapLibre Popup via createPortal,
// so this component is purely the inner content — no positioning,
// no occlusion, no anchor logic. Just the 3-tier layout (heading →
// hero stat → metadata grid) plus an optional CTA.
//
// Phase B of the Globe pinned-card UX rework. Phase A (Popup anchor +
// occlusion) shipped in beta.12.

import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { FlagImg, countryName, countryFromUnlocode } from "../../lib/countryFlag";
import type { GeoJSONFeature } from "../../types";
import type { Cruise } from "../../types/cruise";
import type { GlobePinned } from "./globeLayerTypes";
import { getAirportStats, getArcStats, getCruiseStats, getPortStats } from "./cardStats";

interface PinnedCardProps {
  pinned: GlobePinned;
  flights: GeoJSONFeature[];
  cruises: Cruise[];
  onClose: () => void;
  /** Fires when the "Open last flight" CTA is clicked — should open the
      flight edit modal or navigate to a flight detail surface. */
  onFlightOpen?: (flightId: string) => void;
  /** Fires when the "Open cruise" CTA is clicked — should navigate to
      the cruise detail page. */
  onCruiseOpen?: (cruiseId: string) => void;
}

const SURFACE: React.CSSProperties = {
  background: "rgba(13, 17, 23, 0.92)",
  backdropFilter: "blur(12px)",
  border: "1px solid rgba(255,255,255,0.22)",
  color: "rgba(241,245,249,0.95)",
  fontFamily: "'Inter', sans-serif",
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  minWidth: 240,
  maxWidth: 300,
};

const LABEL_STYLE: React.CSSProperties = {
  color: "rgba(241,245,249,0.55)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const VALUE_STYLE: React.CSSProperties = {
  color: "rgba(241,245,249,0.95)",
  fontSize: 11,
};

export function PinnedCard({
  pinned,
  flights,
  cruises,
  onClose,
  onFlightOpen,
  onCruiseOpen,
}: PinnedCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["map", "common"]);
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
        <Heading pinned={pinned} />
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
        <AirportBody pinned={pinned} flights={flights} locale={locale} t={t} />
      )}
      {pinned.kind === "port" && (
        <PortBody pinned={pinned} cruises={cruises} locale={locale} t={t} />
      )}
      {pinned.kind === "arc" && (
        <ArcBody
          pinned={pinned}
          flights={flights}
          locale={locale}
          t={t}
          onFlightOpen={onFlightOpen}
        />
      )}
      {pinned.kind === "cruise" && (
        <CruiseBody
          pinned={pinned}
          cruises={cruises}
          locale={locale}
          t={t}
          onCruiseOpen={onCruiseOpen}
        />
      )}
    </div>
  );
}

// ─── Heading (Tier 1) ─────────────────────────────────────────────

function Heading({ pinned }: { pinned: GlobePinned }): JSX.Element {
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
  }
}

function IcaoPill({ icao }: { icao?: string }): JSX.Element | null {
  if (!icao) return null;
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
      style={{ color: "rgba(241,245,249,0.5)", background: "rgba(255,255,255,0.06)" }}
    >
      {icao}
    </span>
  );
}

/** "City, Country" line — country name derived from the ISO code. */
function Place({
  city,
  country,
  locale,
}: {
  city?: string | null;
  country?: string | null;
  locale: string;
}): JSX.Element | null {
  const parts = [city, countryName(country, locale)].filter((s): s is string => !!s);
  if (parts.length === 0) return null;
  return (
    <div className="mb-2 text-[11px]" style={{ color: "rgba(241,245,249,0.55)" }}>
      {parts.join(", ")}
    </div>
  );
}

const ARC_FLIGHTS_COLLAPSED = 2;

/** Compact flight list on the pinned route card — airline name + number +
 *  date. Shows the two most recent by default; a "Liste (+N)" button reveals
 *  the rest inline (scrollable), so the card never runs off-screen. */
function ArcFlights({
  flights,
  flightIds,
  locale,
  t,
}: {
  flights: GeoJSONFeature[];
  flightIds: string[];
  locale: string;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const ids = new Set(flightIds);
  const rows = flights
    .filter((f) => ids.has(f.properties.id))
    .sort((a, b) =>
      (b.properties.departureTime ?? "").localeCompare(a.properties.departureTime ?? "")
    );
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, ARC_FLIGHTS_COLLAPSED);
  const more = rows.length - ARC_FLIGHTS_COLLAPSED;

  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span style={LABEL_STYLE}>{t("map:globe.pinned.flightsOnRoute")}</span>
        {more > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="cursor-pointer text-[10px] font-medium"
            style={{ color: "rgb(240,169,71)" }}
          >
            {expanded
              ? t("map:globe.pinned.flightListHide")
              : t("map:globe.pinned.flightListShow", { count: more })}
          </button>
        )}
      </div>
      <div className="space-y-1 overflow-y-auto" style={{ maxHeight: expanded ? 132 : undefined }}>
        {shown.map((f) => (
          <div key={f.properties.id} className="flex items-center gap-2 text-[11px]">
            <span className="font-medium">{f.properties.airline ?? "—"}</span>
            <span className="font-mono opacity-50">{f.properties.flightNumber ?? ""}</span>
            <span className="ml-auto tabular-nums opacity-55">
              {f.properties.departureTime ? formatDate(f.properties.departureTime, locale) : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
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

interface BodyCommonProps {
  locale: string;
  t: ReturnType<typeof useTranslation>["t"];
}

function AirportBody({
  pinned,
  flights,
  locale,
  t,
}: {
  pinned: Extract<GlobePinned, { kind: "airport" }>;
  flights: GeoJSONFeature[];
} & BodyCommonProps): JSX.Element {
  const stats = getAirportStats(flights, pinned.data.iata);
  return (
    <>
      <SubHeading>{pinned.data.name}</SubHeading>
      <Place city={pinned.data.city} country={pinned.data.country} locale={locale} />
      <Hero color="#fbbf24">
        {stats.totalVisits} {t("map:globe.flight", { count: stats.totalVisits })}
      </Hero>
      <Grid>
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
  pinned,
  cruises,
  locale,
  t,
}: {
  pinned: Extract<GlobePinned, { kind: "port" }>;
  cruises: Cruise[];
} & BodyCommonProps): JSX.Element {
  const portKey = pinned.data.iata !== pinned.data.name ? pinned.data.iata : pinned.data.name;
  const stats = getPortStats(cruises, portKey);
  return (
    <>
      {pinned.data.iata !== pinned.data.name && <SubHeading>{pinned.data.iata}</SubHeading>}
      <Place city={pinned.data.city} country={pinned.data.country} locale={locale} />
      <Hero color="#7dd3fc">
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

// ─── Arc body ─────────────────────────────────────────────────────

function ArcBody({
  pinned,
  flights,
  locale,
  t,
  onFlightOpen,
}: {
  pinned: Extract<GlobePinned, { kind: "arc" }>;
  flights: GeoJSONFeature[];
  onFlightOpen?: (flightId: string) => void;
} & BodyCommonProps): JSX.Element {
  const stats = getArcStats(flights, pinned.data.flightIds);
  const colorRgb = `rgb(${pinned.data.color[0]},${pinned.data.color[1]},${pinned.data.color[2]})`;
  return (
    <>
      <div className="mb-2.5 space-y-1.5">
        {[pinned.data.departure, pinned.data.arrival].map((ep, i) => {
          const place = [ep.city, countryName(ep.country, locale)]
            .filter((s): s is string => !!s)
            .join(", ");
          return (
            <div key={i} className="text-[11px]">
              <div className="text-[12px] font-medium" style={{ color: "rgba(241,245,249,0.92)" }}>
                {ep.iata ?? "?"} · {ep.name ?? ""}
              </div>
              {place && <div style={{ color: "rgba(241,245,249,0.5)" }}>{place}</div>}
            </div>
          );
        })}
      </div>
      <Hero color={colorRgb}>
        {t("map:globe.pinned.totalKm", {
          count: pinned.data.count,
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
      <ArcFlights flights={flights} flightIds={pinned.data.flightIds} locale={locale} t={t} />
      {onFlightOpen && pinned.data.flightIds.length > 0 && (
        <Cta
          label={t("map:globe.openLastFlight")}
          onClick={() => {
            const last = pinned.data.flightIds[pinned.data.flightIds.length - 1];
            onFlightOpen(last);
          }}
        />
      )}
    </>
  );
}

// ─── Cruise body ──────────────────────────────────────────────────

function CruiseBody({
  pinned,
  cruises,
  locale,
  t,
  onCruiseOpen,
}: {
  pinned: Extract<GlobePinned, { kind: "cruise" }>;
  cruises: Cruise[];
  onCruiseOpen?: (cruiseId: string) => void;
} & BodyCommonProps): JSX.Element {
  const stats = getCruiseStats(cruises, pinned.data.cruiseId);
  const cruise = cruises.find((c) => c.id === pinned.data.cruiseId);
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
      <Hero color="#7dd3fc">{dateRange}</Hero>
      <Grid>
        <Row label={t("map:globe.pinned.portsLabel")} value={String(stats.portCount)} />
        <Row label={t("map:globe.pinned.seaDaysLabel")} value={String(stats.seaDays)} />
        {stats.embarkPort && <Row label={t("map:globe.pinned.embark")} value={stats.embarkPort} />}
        {stats.debarkPort && stats.debarkPort !== stats.embarkPort && (
          <Row label={t("map:globe.pinned.debark")} value={stats.debarkPort} />
        )}
      </Grid>
      {onCruiseOpen && (
        <Cta
          label={t("map:globe.pinned.openCruise")}
          onClick={() => onCruiseOpen(pinned.data.cruiseId)}
        />
      )}
    </>
  );
}

// ─── Tier-2/3 building blocks ─────────────────────────────────────

function SubHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mb-2 text-[11px] opacity-85">{children}</div>;
}

function Hero({ children, color }: { children: React.ReactNode; color: string }): JSX.Element {
  return (
    <div className="mb-3 text-[13px]" style={{ color, fontWeight: 700 }}>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="space-y-1.5">{children}</div>;
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span style={LABEL_STYLE}>{label}</span>
      <span style={VALUE_STYLE} className="text-right">
        {value}
      </span>
    </div>
  );
}

function Cta({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 w-full cursor-pointer rounded-sm px-2 py-1.5 text-[11px] font-medium transition-colors"
      style={{
        background: "rgba(240,169,71,0.18)",
        border: "1px solid rgba(240,169,71,0.45)",
        color: "rgba(255,205,128,1)",
      }}
    >
      {label}
    </button>
  );
}

// ─── Formatters ───────────────────────────────────────────────────

function formatKm(km: number): string {
  return `${formatKmNumber(km)} km`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatKmNumber(km: number): string {
  if (km < 1000) return Math.round(km).toString();
  return Math.round(km).toLocaleString("de-DE");
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatDuration(minutes: number, t: ReturnType<typeof useTranslation>["t"]): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return t("map:globe.pinned.durationHours", { h, m });
}
