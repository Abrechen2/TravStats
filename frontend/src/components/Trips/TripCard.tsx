import { formatCurrency } from "../../lib/units";
import { differenceInCalendarDays } from "date-fns";
import type { Trip } from "../../types";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useTranslation } from "../../hooks/useTranslation";
import { sumByCurrency, tripCostSources } from "../../lib/bookingCost";
import { formatDateInTimezone } from "../../lib/dateUtils";
import { statusPillStyle } from "../table/statusPillStyle";
import { Icon, type IconName } from "../ui/Icon";

interface TripCardProps {
  trip: Trip;
  onOpen: (trip: Trip) => void;
}

/** Trip status → the shared status palette (planned reads as scheduled). */
const STATUS_TONE: Record<Trip["status"], string> = {
  planned: "scheduled",
  in_progress: "in_progress",
  completed: "completed",
};

/**
 * When a trip starts and ends: its own dates, else its first departure and
 * last arrival. The list groups by the start year, so this is shared.
 */
export function tripSpan(trip: Trip): { start: Date | null; end: Date | null } {
  return {
    start: trip.startDate ? new Date(trip.startDate) : firstFlightDate(trip),
    end: trip.endDate ? new Date(trip.endDate) : lastFlightDate(trip),
  };
}

/** Calendar days including both ends, or null when a date is missing. */
export function tripDays(trip: Trip): number | null {
  const { start, end } = tripSpan(trip);
  return start && end ? Math.max(0, differenceInCalendarDays(end, start)) + 1 : null;
}

/**
 * Trip-list card, round 4 ("Reisen"): a quiet cover in the trip's colour with
 * the areas the trip touches and its status, then the name, the dates and one
 * mono line of figures. The whole card opens the trip.
 *
 * It replaces a saturated gradient cover, a four-tile statistics grid and a
 * footer of three buttons (open, edit, delete) on every card. Edit and delete
 * live on the trip page, where the head carries them for every detail page;
 * a destructive button repeated down a grid of cards was the easiest thing on
 * the page to hit by accident. Kilometres and cost stay, as figures — both
 * were fixed to count every area (forgejo#86 and the cruise totals).
 */
export default function TripCard({ trip, onOpen }: TripCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["trips"]);

  const { start, end } = tripSpan(trip);
  const days = tripDays(trip);
  const dateRange = [start, end]
    .filter((d): d is Date => d !== null)
    .map((d) => formatDateInTimezone(d, "UTC"))
    .filter((d, i, all) => all.indexOf(d) === i)
    .join(" – ");

  // Domain-gating: with the cruise domain disabled the card must not
  // advertise cruise segments — not as an icon, not inside the km or cost.
  const { isEnabled } = useEnabledDomains();
  const cruiseEnabled = isEnabled("cruise");
  const lodgingEnabled = isEnabled("lodging");
  const flightCount = trip._count?.flights ?? trip.flights?.length ?? 0;
  const cruiseCount = cruiseEnabled ? (trip._count?.cruises ?? trip.cruises?.length ?? 0) : 0;
  const stayCount = lodgingEnabled
    ? (trip._count?.lodgingStays ?? trip.lodgingStays?.length ?? 0)
    : 0;
  const cruises = cruiseEnabled ? (trip.cruises ?? []) : [];
  const stays = lodgingEnabled ? (trip.lodgingStays ?? []) : [];

  // Same sources as the trip detail page: bookings PLUS any flight, cruise or
  // stay carrying its own price and no booking. Summing bookings alone made a
  // hand-entered flight price vanish from the card while the detail page
  // counted it, and left a cruise- or hotel-only trip at "—" on both.
  // NOT gated on features.enableCostTracking: since #192 that toggle gates the
  // taxes/fees breakdown, not whether a price is visible at all.
  const costTotals = sumByCurrency(
    tripCostSources(trip.bookings ?? [], trip.flights ?? [], cruises, stays)
  );
  const distanceKm = estimateTripDistanceKm(trip.flights ?? [], cruises);
  const entries = flightCount + cruiseCount + stayCount;

  const areas: IconName[] = [
    ...(flightCount > 0 ? (["plane"] as const) : []),
    ...(cruiseCount > 0 ? (["ship"] as const) : []),
    ...(stayCount > 0 ? (["bed"] as const) : []),
  ];

  const mono = { fontFamily: "var(--ts-font-mono)" } as const;
  const figure = { color: "var(--ts-text-bright)" } as const;

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
      className="flex h-full cursor-pointer flex-col overflow-hidden transition-colors hover:border-[var(--ts-muted)]"
      style={{
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
      }}
    >
      <div
        className="relative h-[110px]"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${trip.color} 22%, var(--ts-surface2)), var(--ts-surface2))`,
        }}
      >
        {trip.coverImageUrl && (
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${trip.coverImageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: 0.35,
            }}
          />
        )}
        <span className="absolute right-3 top-3">
          <span className="ts-status-pill" style={statusPillStyle(STATUS_TONE[trip.status])}>
            {t(`trips:status.${trip.status}`)}
          </span>
        </span>
        {areas.length > 0 && (
          <span className="absolute bottom-3 left-3 flex gap-1.5" aria-hidden="true">
            {areas.map((name) => (
              <span
                key={name}
                className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{ background: "var(--ts-bg)", color: "var(--ts-accent)" }}
              >
                <Icon name={name} size={14} />
              </span>
            ))}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 px-4 py-3.5">
        <h3
          className="truncate"
          style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
        >
          {trip.icon && (
            <span aria-hidden="true" className="mr-1.5">
              {trip.icon}
            </span>
          )}
          {trip.name}
        </h3>
        {(dateRange || trip.destinationLabel) && (
          <p className="t-caption truncate">
            {[dateRange, trip.destinationLabel].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="t-caption mt-auto flex flex-wrap gap-x-3 pt-2" style={mono}>
          {days !== null && (
            <span>
              <span style={figure}>{days}</span> {t("trips:card.days", { count: days })}
            </span>
          )}
          <span>
            <span style={figure}>
              {trip.countries.length > 0 ? trip.countries.length : entries > 0 ? "?" : "—"}
            </span>{" "}
            {t("trips:card.countries", { count: trip.countries.length })}
          </span>
          <span>
            <span style={figure}>{entries}</span> {t("trips:card.entries", { count: entries })}
          </span>
        </p>
        <p className="t-caption flex flex-wrap gap-x-3" style={mono}>
          <span>
            <span style={figure}>{distanceKm > 0 ? formatDistance(distanceKm) : "—"}</span> km
          </span>
          <span style={figure}>
            {costTotals.length > 0
              ? costTotals
                  .map((c) =>
                    formatCurrency(c.total, c.currency, { compact: true, language: i18n.language })
                  )
                  .join(" + ")
              : "—"}
          </span>
        </p>
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
