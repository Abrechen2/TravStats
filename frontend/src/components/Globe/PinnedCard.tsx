// Pinned detail card shown when the user clicks a feature on the
// globe. Mounted by GlobeView into a MapLibre Popup via createPortal,
// so this component is purely the inner content — no positioning,
// no occlusion, no anchor logic. Just the 3-tier layout (heading →
// hero stat → metadata grid) plus an optional CTA.
//
// Phase B of the Globe pinned-card UX rework. Phase A (Popup anchor +
// occlusion) shipped in beta.12.

import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { GeoJSONFeature } from "../../types";
import type { Cruise } from "../../types/cruise";
import type { GlobePinned } from "./globeLayerTypes";
import {
  getAirportStats,
  getArcStats,
  getCruiseStats,
  getPortStats,
} from "./cardStats";

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
  const { t, i18n } = useTranslation(["map"]);
  const locale = i18n.language || "de";

  return (
    <div className="rounded-md p-3 text-xs" style={SURFACE}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <Heading pinned={pinned} />
        <button
          type="button"
          aria-label="close"
          onClick={onClose}
          className="cursor-pointer rounded px-1 text-[11px] leading-none opacity-70 hover:opacity-100"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          ✕
        </button>
      </div>

      {pinned.kind === "airport" && (
        <AirportBody
          pinned={pinned}
          flights={flights}
          locale={locale}
          t={t}
        />
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
        <div className="text-[12px] font-semibold">
          ✈ {pinned.data.departure.iata ?? "?"} ↔{" "}
          {pinned.data.arrival.iata ?? "?"}
        </div>
      );
    case "airport":
      return (
        <div className="text-[12px] font-semibold">✈ {pinned.data.iata}</div>
      );
    case "port":
      return (
        <div className="text-[12px] font-semibold">⚓ {pinned.data.name}</div>
      );
    case "cruise":
      return (
        <div className="text-[12px] font-semibold">
          🚢 {pinned.data.cruiseLabel}
        </div>
      );
  }
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
}: { pinned: Extract<GlobePinned, { kind: "airport" }>; flights: GeoJSONFeature[] } & BodyCommonProps): JSX.Element {
  const stats = getAirportStats(flights, pinned.data.iata);
  return (
    <>
      <SubHeading>{pinned.data.name}</SubHeading>
      <Hero color="#fbbf24">
        {stats.totalVisits}{" "}
        {t("map:globe.flight", { count: stats.totalVisits })}
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
          <Row
            label={t("map:globe.pinned.topAircraft")}
            value={stats.topAircraft}
          />
        )}
        {stats.lastVisitDate && (
          <Row
            label={t("map:tooltip.lastVisit")}
            value={formatDate(stats.lastVisitDate, locale)}
          />
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
}: { pinned: Extract<GlobePinned, { kind: "port" }>; cruises: Cruise[] } & BodyCommonProps): JSX.Element {
  const portKey = pinned.data.iata !== pinned.data.name ? pinned.data.iata : pinned.data.name;
  const stats = getPortStats(cruises, portKey);
  return (
    <>
      {pinned.data.iata !== pinned.data.name && (
        <SubHeading>{pinned.data.iata}</SubHeading>
      )}
      <Hero color="#7dd3fc">
        {stats.totalVisits} {t("map:airportMarkers.visits")}
      </Hero>
      <Grid>
        {stats.country && (
          <Row label={t("map:globe.pinned.country")} value={stats.country} />
        )}
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
          <Row
            label={t("map:tooltip.lastCall")}
            value={formatDate(stats.lastCallDate, locale)}
          />
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
      <SubHeading>
        {pinned.data.departure.name ?? pinned.data.departure.iata ?? "?"} →{" "}
        {pinned.data.arrival.name ?? pinned.data.arrival.iata ?? "?"}
      </SubHeading>
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
        {stats.aircraftTypes.length > 0 && (
          <Row
            label={t("map:globe.pinned.topAircraft")}
            value={stats.aircraftTypes.slice(0, 3).join(", ") + (stats.aircraftTypes.length > 3 ? "…" : "")}
          />
        )}
        {stats.topAirline && (
          <Row label={t("map:globe.pinned.topAirline")} value={stats.topAirline} />
        )}
      </Grid>
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
  if (!stats) {
    return (
      <div className="text-[11px] opacity-85">
        {t("map:visMode.tripRoutes")}
      </div>
    );
  }

  const dateRange =
    stats.startDate && stats.endDate
      ? `${formatDate(stats.startDate, locale)} – ${formatDate(stats.endDate, locale)}`
      : (stats.startDate ?? stats.endDate ?? "");

  return (
    <>
      {stats.line && <SubHeading>{stats.line}</SubHeading>}
      <Hero color="#7dd3fc">{dateRange}</Hero>
      <Grid>
        <Row label={t("map:globe.pinned.portsLabel")} value={String(stats.portCount)} />
        <Row label={t("map:globe.pinned.seaDaysLabel")} value={String(stats.seaDays)} />
        {stats.embarkPort && (
          <Row label={t("map:globe.pinned.embark")} value={stats.embarkPort} />
        )}
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
  return (
    <div className="mb-2 text-[11px] opacity-85">{children}</div>
  );
}

function Hero({
  children,
  color,
}: { children: React.ReactNode; color: string }): JSX.Element {
  return (
    <div
      className="mb-3 text-[13px]"
      style={{ color, fontWeight: 700 }}
    >
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

function Cta({
  label,
  onClick,
}: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 w-full cursor-pointer rounded px-2 py-1.5 text-[11px] font-medium transition-colors"
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

function formatDuration(
  minutes: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return t("map:globe.pinned.durationHours", { h, m });
}
