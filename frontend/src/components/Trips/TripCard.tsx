import { formatCurrency } from "../../lib/units";
import { differenceInCalendarDays } from "date-fns";
import type { Trip, TripCategory, TripStatus } from "../../types";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useTranslation } from "../../hooks/useTranslation";
import { sumByCurrency, tripCostSources } from "../../lib/bookingCost";

interface TripCardProps {
  trip: Trip;
  onOpen: (trip: Trip) => void;
  onEdit: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
}

const STATUS_PILL: Record<TripStatus, { bg: string; color: string }> = {
  planned: { bg: "rgba(96,165,250,0.22)", color: "#93c5fd" },
  in_progress: { bg: "rgba(240,169,71,0.22)", color: "#f0a947" },
  completed: { bg: "rgba(74,222,128,0.16)", color: "#86efac" },
};

const CATEGORY_ICON: Record<TripCategory, string> = {
  vacation: "🏖",
  business: "💼",
  weekend: "🎒",
  family: "👨‍👩‍👧",
  other: "🗺",
};

/**
 * Trip-list card (Phase-1 iteration 2). Driven by the trip's own
 * metadata fields (`startDate`, `endDate`, `status`, `category`, `tags`,
 * `companions`, `coverImageUrl`, `color`) instead of the legacy
 * "derive everything from linked flights" logic. Fields that are still
 * empty fall back gracefully — the card never breaks for a half-filled
 * trip. Whole card is clickable; the footer buttons stop propagation
 * to remain individually addressable.
 */
export default function TripCard({ trip, onOpen, onEdit, onDelete }: TripCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["trips"]);

  const start = trip.startDate ? new Date(trip.startDate) : firstFlightDate(trip);
  const end = trip.endDate ? new Date(trip.endDate) : lastFlightDate(trip);
  const dateRange = formatDateRange(start, end, i18n.language);
  const nights = start && end ? Math.max(0, differenceInCalendarDays(end, start)) : null;

  // Domain-gating: with the cruise domain disabled the card must not
  // advertise cruise segments — count them as absent.
  const { isEnabled } = useEnabledDomains();
  const cruiseEnabled = isEnabled("cruise");
  const lodgingEnabled = isEnabled("lodging");
  const flightCount = trip._count?.flights ?? trip.flights?.length ?? 0;
  const cruiseCount = cruiseEnabled ? (trip._count?.cruises ?? trip.cruises?.length ?? 0) : 0;

  // With the cruise domain switched off the card must not advertise cruises in
  // any tile — not as a count, and not hidden inside the km or cost totals.
  const cruises = cruiseEnabled ? (trip.cruises ?? []) : [];
  const stays = lodgingEnabled ? (trip.lodgingStays ?? []) : [];

  // Same sources as the trip detail page: bookings PLUS any flight, cruise or
  // stay carrying its own price and no booking. Summing bookings alone made a
  // hand-entered flight price vanish from the card while the detail page
  // counted it, and left a cruise- or hotel-only trip at "—" on both.
  const costTotals = sumByCurrency(
    tripCostSources(trip.bookings ?? [], trip.flights ?? [], cruises, stays)
  );

  const distanceKm = estimateTripDistanceKm(trip.flights ?? [], cruises);

  const routeChain = buildRouteChain(trip);

  const status = trip.status;
  const statusStyle = STATUS_PILL[status];
  const categoryIcon = trip.category ? CATEGORY_ICON[trip.category] : null;

  const cover = trip.coverImageUrl
    ? {
        backgroundImage: `url(${trip.coverImageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { background: `linear-gradient(135deg, ${trip.color}, ${trip.color}33 70%, var(--bg-base))` };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => onOpen(trip)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(trip);
        }
      }}
      className="rounded-xl overflow-hidden flex flex-col cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      {/* Cover */}
      <div className="relative h-32" style={cover}>
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(to bottom, transparent 35%, rgba(13,17,23,0.85) 100%)",
          }}
        />
        <span
          className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide"
          style={{
            background: statusStyle.bg,
            color: statusStyle.color,
            backdropFilter: "blur(8px)",
          }}
        >
          {t(`trips:status.${status}`)}
        </span>
        {categoryIcon && (
          <span
            className="absolute top-2.5 right-2.5 w-7 h-7 rounded-lg flex items-center justify-center text-sm"
            style={{
              background: "rgba(13,17,23,0.6)",
              backdropFilter: "blur(8px)",
            }}
          >
            {categoryIcon}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col">
        <h3
          className="font-display font-semibold text-base leading-tight truncate"
          style={{ color: "var(--text-primary)" }}
        >
          {trip.name}
        </h3>
        {(dateRange || nights !== null) && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {dateRange}
            {nights !== null && nights > 0 && (
              <>
                {dateRange && " · "}
                {t("trips:nights", { count: nights })}
              </>
            )}
          </p>
        )}

        {trip.destinationLabel && (
          <p
            className="text-xs mt-1.5 truncate"
            style={{ color: "var(--text-primary)", opacity: 0.85 }}
          >
            📍 {trip.destinationLabel}
          </p>
        )}

        {routeChain.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-2">
            {routeChain.slice(0, 6).map((iata, i) => (
              <span key={`${iata}-${i}`} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    →
                  </span>
                )}
                <span className="font-mono text-xs font-semibold">{iata}</span>
              </span>
            ))}
            {routeChain.length > 6 && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                +{routeChain.length - 6}
              </span>
            )}
          </div>
        )}

        {trip.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {trip.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full text-[10px]"
                style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
              >
                {tag}
              </span>
            ))}
            {trip.tags.length > 4 && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                +{trip.tags.length - 4}
              </span>
            )}
          </div>
        )}

        <div
          className="grid grid-cols-4 gap-1 mt-auto pt-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <Stat
            value={cruiseCount > 0 ? `${flightCount} · ${cruiseCount}` : `${flightCount}`}
            label={
              cruiseCount > 0
                ? "Fl · Kr"
                : t("trips:flightCount", { count: flightCount }).split(" ").slice(-1)[0]
            }
          />
          <Stat value={distanceKm > 0 ? formatDistance(distanceKm) : "—"} label="km" />
          <Stat
            value={
              trip.countries.length > 0
                ? trip.countries.length
                : flightCount > 0 || cruiseCount > 0
                  ? "?"
                  : "—"
            }
            label={t("trips:detail.stats.countries")}
          />
          {/* NOT gated on features.enableCostTracking. Since #192 that toggle
              gates the taxes/fees breakdown and the business statistics, not
              whether a price is visible at all — and the trip DETAIL page has
              always rendered this total ungated. With the gate here, the same
              trip read "EUR 2832" on its detail page and "—" on its card. */}
          <Stat
            value={
              costTotals.length > 0
                ? costTotals
                    .map((c) => formatCurrency(c.total, c.currency, { compact: true, language: i18n.language }))
                    .join(" + ")
                : "—"
            }
            label={t("trips:totalCost")}
          />
        </div>
      </div>

      {/* Action footer */}
      <div
        className="flex gap-2 px-4 py-2.5"
        style={{ borderTop: "1px solid var(--color-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => onOpen(trip)}
          className="px-2.5 py-1 rounded-sm text-xs font-medium"
          style={{ background: "var(--bg-muted)", color: "var(--accent)" }}
        >
          → {t("trips:openTrip")}
        </button>
        <button
          onClick={() => onEdit(trip)}
          className="px-2.5 py-1 rounded-sm text-xs font-medium"
          style={{ background: "var(--bg-muted)", color: "var(--color-success, #4ade80)" }}
          aria-label={t("trips:editTrip")}
          title={t("trips:editTrip")}
        >
          ✏
        </button>
        <button
          onClick={() => onDelete(trip)}
          className="px-2.5 py-1 rounded-sm text-xs font-medium ml-auto"
          style={{ background: "var(--bg-muted)", color: "var(--color-error, #f87171)" }}
          aria-label={t("trips:deleteTrip")}
          title={t("trips:deleteTrip")}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string | number; label: string }): JSX.Element {
  return (
    <div className="text-center">
      <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
    </div>
  );
}

function firstFlightDate(trip: Trip): Date | null {
  const sorted = [...(trip.flights ?? [])].sort(
    (a, b) =>
      (a.departureTime ? new Date(a.departureTime).getTime() : 0) -
      (b.departureTime ? new Date(b.departureTime).getTime() : 0)
  );
  const first = sorted.find((f) => f.departureTime);
  return first?.departureTime ? new Date(first.departureTime) : null;
}

function lastFlightDate(trip: Trip): Date | null {
  const sorted = [...(trip.flights ?? [])].sort(
    (a, b) =>
      (a.arrivalTime ? new Date(a.arrivalTime).getTime() : 0) -
      (b.arrivalTime ? new Date(b.arrivalTime).getTime() : 0)
  );
  const last = [...sorted].reverse().find((f) => f.arrivalTime);
  return last?.arrivalTime ? new Date(last.arrivalTime) : null;
}

function buildRouteChain(trip: Trip): string[] {
  const sorted = [...(trip.flights ?? [])].sort(
    (a, b) =>
      (a.departureTime ? new Date(a.departureTime).getTime() : 0) -
      (b.departureTime ? new Date(b.departureTime).getTime() : 0)
  );
  const chain: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    if (i === 0 && f.depIata) chain.push(f.depIata);
    if (f.arrIata && f.arrIata !== chain[chain.length - 1]) chain.push(f.arrIata);
  }
  return chain;
}

/**
 * Kilometres travelled on this trip, across every domain it contains.
 *
 * Flights are estimated great-circle from the endpoint coordinates; cruises
 * bring the distance the sea router already computed leg by leg, which the list
 * endpoint ships pre-summed as `distanceKm`. A cruise whose legs were never
 * computed contributes 0 rather than a straight-line guess between ports — a
 * chord through land would be a worse answer than none.
 */
function estimateTripDistanceKm(
  flights: NonNullable<Trip["flights"]>,
  cruises: NonNullable<Trip["cruises"]>
): number {
  let sum = 0;
  for (const f of flights) {
    if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) {
      continue;
    }
    sum += haversineKm(f.depLat, f.depLon, f.arrLat, f.arrLon);
  }
  for (const c of cruises) {
    if (c.distanceKm != null && c.distanceKm > 0) sum += c.distanceKm;
  }
  return Math.round(sum);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function formatDistance(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k`;
  return String(km);
}

function formatDateRange(start: Date | null, end: Date | null, locale: string): string | null {
  if (!start && !end) return null;
  const fmtShort = (d: Date): string =>
    d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
  const fmtLong = (d: Date): string =>
    d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  if (start && end) {
    return start.getFullYear() === end.getFullYear()
      ? `${fmtShort(start)} – ${fmtLong(end)}`
      : `${fmtLong(start)} – ${fmtLong(end)}`;
  }
  return fmtLong((start ?? end) as Date);
}
