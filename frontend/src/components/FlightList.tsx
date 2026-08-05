import { format } from "date-fns";
import type { Flight } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import { formatCurrency as formatCurrencyUtil } from "../lib/units";
import { resolveAirlineDisplay, resolveAirlineIata } from "../lib/airlineUtils";
import AirlineLogo from "./AirlineLogo";
import DataSourceBadges from "./DataSourceBadges";
import SpecialTypeBadge from "./specialFlights/SpecialTypeBadge";
import type { SpecialType } from "./specialFlights/specialTypeMeta";

interface FlightListProps {
  flights: Flight[];
  selectedFlightId?: string;
  onFlightClick: (flightId: string) => void;
  onEditFlight: (flight: Flight) => void;
  onDeleteFlight: (flightId: string) => void;
}

export default function FlightList({
  flights,
  selectedFlightId,
  onFlightClick,
  onEditFlight,
  onDeleteFlight,
}: FlightListProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);

  const getStatusBadge = (status: string): JSX.Element => {
    const colors = {
      scheduled: "border border-border text-(--text-muted)",
      flown: "text-(--success)",
      cancelled: "text-(--danger)",
    };
    const statusLabel = t(`flights:status.${status}`, { defaultValue: status });

    return (
      <span
        className={`px-2 py-1 rounded-sm text-xs font-medium ${colors[status as keyof typeof colors]}`}
      >
        {statusLabel}
      </span>
    );
  };

  const getCategoryBadge = (category?: string): JSX.Element | null => {
    if (!category) return null;
    const colors = {
      business: "text-(--accent)",
      private: "text-(--success)",
      vacation: "text-(--warning)",
    };
    const categoryKey = category as "business" | "private" | "vacation";
    return (
      <span className={`px-2 py-1 rounded-sm text-xs font-medium ${colors[categoryKey]}`}>
        {t(`flights:category.${categoryKey}`)}
      </span>
    );
  };

  const { units } = useSettingsStore();

  const formatCurrency = (value?: number, currency?: string): string => {
    if (value === undefined || value === null) return "";
    return formatCurrencyUtil(value, currency || units.currency);
  };

  if (flights.length === 0) {
    return (
      <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>
        {t("flights:list.noFlights")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {flights.map((flight) => {
        const costParts: string[] = [];
        if (flight.price != null) {
          costParts.push(
            `${t("common:labels.price")}: ${formatCurrency(flight.price, flight.currency)}`
          );
        }
        if (flight.taxes != null) {
          costParts.push(
            `${t("common:labels.taxes")}: ${formatCurrency(flight.taxes, flight.currency)}`
          );
        }
        if (flight.fees != null) {
          costParts.push(
            `${t("common:labels.fees")}: ${formatCurrency(flight.fees, flight.currency)}`
          );
        }

        return (
          <div
            key={flight.id}
            className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
              selectedFlightId === flight.id
                ? "border-(--accent) bg-(--bg-elevated)"
                : "border-border hover:border-(--text-muted) bg-(--bg-surface)"
            }`}
            onClick={() => onFlightClick(flight.id)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <AirlineLogo
                    iata={resolveAirlineIata(flight)}
                    flightNumber={flight.flightNumber}
                    size={28}
                  />
                  <h3 className="font-semibold text-lg" style={{ color: "var(--text-primary)" }}>
                    {resolveAirlineDisplay(flight) || flight.airline} {flight.flightNumber}
                  </h3>
                  {getStatusBadge(flight.status)}
                  {getCategoryBadge(flight.category)}
                  {flight.specialType && (
                    <SpecialTypeBadge type={flight.specialType as SpecialType} />
                  )}
                  {flight.delayMinutes != null && flight.delayMinutes !== 0 && (
                    <span
                      data-testid="delay-badge"
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        flight.delayMinutes > 0
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      }`}
                    >
                      {flight.delayMinutes > 0
                        ? t("flights:actualTimes.delayMinutes", { minutes: flight.delayMinutes })
                        : t("flights:actualTimes.earlyMinutes", {
                            minutes: Math.abs(flight.delayMinutes),
                          })}
                    </span>
                  )}
                  {flight.co2Kg != null && (
                    <span
                      data-testid="co2-chip"
                      className="px-2 py-0.5 rounded-sm text-xs font-medium"
                      style={{
                        background: "rgba(63,185,80,0.15)",
                        color: "var(--success)",
                      }}
                      title={t("flights:actualTimes.co2Label")}
                    >
                      {t("flights:actualTimes.co2Value", { kg: flight.co2Kg })}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {t("flights:list.from")}
                    </p>
                    <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                      {flight.depIata || flight.depIcao}
                      {flight.depName && (
                        <span className="ml-1" style={{ color: "var(--text-muted)" }}>
                          - {flight.depName}
                        </span>
                      )}
                    </p>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {flight.departureTime
                        ? format(new Date(flight.departureTime), "MMM dd, yyyy HH:mm")
                        : "—"}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {t("flights:list.to")}
                    </p>
                    <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                      {flight.arrIata || flight.arrIcao}
                      {flight.arrName && (
                        <span className="ml-1" style={{ color: "var(--text-muted)" }}>
                          - {flight.arrName}
                        </span>
                      )}
                    </p>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {flight.arrivalTime
                        ? format(new Date(flight.arrivalTime), "MMM dd, yyyy HH:mm")
                        : "—"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
                  {flight.category && (
                    <span
                      className="px-2 py-1 rounded-full"
                      style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
                    >
                      {t(`flights:category.${flight.category}`)}
                    </span>
                  )}
                  {flight.price != null && (
                    <span
                      className="px-2 py-1 rounded-full"
                      style={{ background: "var(--bg-elevated)", color: "var(--accent)" }}
                    >
                      {formatCurrency(flight.price, flight.currency || units.currency)}
                    </span>
                  )}
                  <DataSourceBadges flight={flight} />
                  {flight.tags && flight.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {flight.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-full"
                          style={{ background: "var(--bg-muted)", color: "var(--text-primary)" }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {flight.aircraft && (
                  <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
                    {t("flights:list.aircraft")}: {flight.aircraft}
                  </p>
                )}

                {costParts.length > 0 && (
                  <p className="text-sm mt-2" style={{ color: "var(--text-primary)" }}>
                    {costParts.join(" | ")}
                  </p>
                )}

                {flight.notes && (
                  <p className="text-sm mt-2 italic" style={{ color: "var(--text-muted)" }}>
                    {flight.notes}
                  </p>
                )}

                {flight.tags && flight.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {flight.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-1 text-xs rounded-full"
                        style={{ background: "var(--bg-muted)", color: "var(--text-primary)" }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 ml-4">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditFlight(flight);
                  }}
                  className="transition-colors"
                  style={{ color: "var(--accent)" }}
                  title={t("flights:list.edit")}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(t("flights:list.deleteConfirm"))) {
                      onDeleteFlight(flight.id);
                    }
                  }}
                  className="transition-colors"
                  style={{ color: "var(--danger)" }}
                  title={t("flights:list.delete")}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
