import type { Trip } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { differenceInDays } from "date-fns";

interface TripCardProps {
  trip: Trip;
  onEdit: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
  onShowOnMap: (trip: Trip) => void;
}

export default function TripCard({
  trip,
  onEdit,
  onDelete,
  onShowOnMap,
}: TripCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["trips"]);
  const { features } = useSettingsStore();

  // Sorted flights (shared by route chain + date range)
  const sorted = trip.flights
    ? [...trip.flights].sort(
        (a, b) =>
          (a.departureTime ? new Date(a.departureTime).getTime() : 0) -
          (b.departureTime ? new Date(b.departureTime).getTime() : 0)
      )
    : [];

  // Build IATA route chain from sorted flights
  const routeChain: string[] = [];
  if (sorted.length > 0) {
    sorted.forEach((f, i) => {
      if (i === 0 && f.depIata) routeChain.push(f.depIata);
      if (f.arrIata) routeChain.push(f.arrIata);
    });
  }

  // Date range (uses sorted)
  const firstFlight = sorted[0];
  const lastFlight = sorted[sorted.length - 1];
  const startDate = firstFlight?.departureTime ? new Date(firstFlight.departureTime) : null;
  const endDate = lastFlight?.arrivalTime ? new Date(lastFlight.arrivalTime) : null;
  const nights = startDate && endDate ? differenceInDays(endDate, startDate) : null;

  const dateRangeStr =
    startDate && endDate
      ? `${startDate.toLocaleDateString(i18n.language, {
          day: "2-digit",
          month: "short",
        })} – ${endDate.toLocaleDateString(i18n.language, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}`
      : null;

  // Cost from bookings
  const totalCost = trip.bookings?.reduce((sum, b) => sum + (b.price ?? 0), 0) ?? 0;
  const currency = (trip.bookings?.find((b) => b.currency)?.currency ?? "EUR") as
    | "EUR"
    | "USD"
    | "GBP"
    | "CHF";

  const flightCount = trip._count?.flights ?? trip.flights?.length ?? 0;

  const formattedCost = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(totalCost);

  return (
    <div
      className="rounded-xl overflow-hidden flex flex-col transition-all hover:-translate-y-0.5 hover:shadow-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      {/* Accent bar */}
      <div
        className="h-1"
        style={{ background: `linear-gradient(90deg, ${trip.color}, ${trip.color}88)` }}
      />

      <div className="p-4 flex-1">
        <h3 className="font-bold text-base leading-tight" style={{ color: "var(--text-primary)" }}>
          {trip.name}
        </h3>
        {dateRangeStr && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {dateRangeStr}
            {nights !== null && nights > 0 && <> · {t("trips:nights", { count: nights })}</>}
          </p>
        )}

        {/* Route chain */}
        {routeChain.length > 0 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {routeChain.map((iata, i) => (
              <span key={`${iata}-${i}`} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    →
                  </span>
                )}
                <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                  {iata}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* PNR badges */}
        {trip.bookings && trip.bookings.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-2">
            {trip.bookings.map(
              (b) =>
                b.pnr && (
                  <span
                    key={b.id}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                    style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
                  >
                    {b.pnr}
                  </span>
                )
            )}
          </div>
        )}

        <hr className="my-3" style={{ borderColor: "var(--color-border)" }} />

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("trips:flightCount", { count: flightCount })}
            </div>
          </div>
          {features.enableCostTracking && totalCost > 0 && (
            <div>
              <div
                className="text-sm font-semibold"
                style={{ color: "var(--color-success, #4ade80)" }}
              >
                {formattedCost}
              </div>
              <div
                className="text-[10px] uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {t("trips:totalCost")}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer buttons */}
      <div
        className="flex gap-2 px-4 py-2.5"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        <button
          onClick={() => onShowOnMap(trip)}
          className="px-2.5 py-1 rounded text-xs font-medium"
          style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
        >
          🗺 {t("trips:showOnMap")}
        </button>
        <button
          onClick={() => onEdit(trip)}
          className="px-2.5 py-1 rounded text-xs font-medium"
          style={{ background: "var(--bg-muted)", color: "var(--color-success, #4ade80)" }}
        >
          ✏ {t("trips:editTrip")}
        </button>
        <button
          onClick={() => onDelete(trip)}
          className="px-2.5 py-1 rounded text-xs font-medium ml-auto"
          style={{ background: "var(--bg-muted)", color: "var(--color-error, #f87171)" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
