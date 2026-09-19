import type { JSX } from "react";
import type { Trip } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import ListFilterBar, { FilterField, PANEL_SELECT_CLASS } from "../table/ListFilterBar";
import { FLIGHT_STATUSES, MONTH_KEYS, type FlightStatusFilter } from "./flightColumns";
import { SPECIAL_TYPES, type SpecialTypeFilter } from "../specialFlights/specialTypeMeta";

/**
 * The flights filter bar — pulled out of `FlightsTablePage` (which was
 * bumping the 800-line file-size ratchet) rather than inlined there. This is
 * purely presentational: every value and every setter comes from the page,
 * which still owns all the filter state and the derived option lists (years,
 * airlines). Extracting it changes nothing about behaviour — it's the exact
 * `ListFilterBar` wiring that used to sit inline.
 */
export interface FlightsFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: FlightStatusFilter;
  onStatusChange: (value: FlightStatusFilter) => void;
  yearFilter: string;
  onYearChange: (value: string) => void;
  availableYears: readonly number[];
  monthFilter: string;
  onMonthChange: (value: string) => void;
  airlineFilter: string;
  onAirlineChange: (value: string) => void;
  availableAirlines: readonly { name: string; count: number }[];
  tripFilter: string;
  onTripChange: (value: string) => void;
  trips: readonly Trip[];
  specialFilter: SpecialTypeFilter;
  onSpecialChange: (value: SpecialTypeFilter) => void;
  extraActiveCount: number;
  hasActiveFilter: boolean;
  onReset: () => void;
  loading: boolean;
  loadError: boolean;
  /** The row count AFTER filtering — the "N angezeigt" label, not the total. */
  resultCount: number;
}

export function FlightsFilterBar({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  yearFilter,
  onYearChange,
  availableYears,
  monthFilter,
  onMonthChange,
  airlineFilter,
  onAirlineChange,
  availableAirlines,
  tripFilter,
  onTripChange,
  trips,
  specialFilter,
  onSpecialChange,
  extraActiveCount,
  hasActiveFilter,
  onReset,
  loading,
  loadError,
  resultCount,
}: FlightsFilterBarProps): JSX.Element {
  const { t } = useTranslation(["flights", "common", "specialFlights", "trips", "stats"]);

  return (
    <ListFilterBar
      search={{
        value: search,
        onChange: onSearchChange,
        placeholder: t("flights:filter.searchPlaceholder"),
      }}
      status={{
        label: t("flights:table.status"),
        value: statusFilter,
        onChange: (v): void => onStatusChange(v as FlightStatusFilter),
        allLabel: t("flights:filter.allStatuses"),
        options: FLIGHT_STATUSES.map((st) => ({
          value: st,
          label: t(`flights:status.${st}`),
        })),
      }}
      year={{
        label: t("flights:filter.year"),
        value: yearFilter,
        onChange: onYearChange,
        allLabel: t("flights:filter.allYears"),
        options: availableYears.map((y) => ({ value: String(y), label: String(y) })),
      }}
      extraActiveCount={extraActiveCount}
      extra={
        <>
          <FilterField label={t("flights:filter.month")}>
            <select
              value={monthFilter}
              onChange={(e): void => onMonthChange(e.target.value)}
              className={PANEL_SELECT_CLASS}
            >
              <option value="all">{t("flights:filter.allMonths")}</option>
              {MONTH_KEYS.map((key, i) => (
                <option key={key} value={String(i + 1)}>
                  {t(`stats:months.${key}`)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t("flights:table.airline")}>
            <select
              value={airlineFilter}
              onChange={(e): void => onAirlineChange(e.target.value)}
              className={PANEL_SELECT_CLASS}
            >
              <option value="all">{t("flights:filter.allAirlines")}</option>
              {availableAirlines.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name} ({a.count})
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t("trips:tab")}>
            <select
              value={tripFilter}
              onChange={(e): void => onTripChange(e.target.value)}
              className={PANEL_SELECT_CLASS}
            >
              <option value="all">{t("flights:filter.allTrips")}</option>
              <option value="with">{t("flights:filter.withTrip")}</option>
              <option value="without">{t("flights:filter.withoutTrip")}</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
          </FilterField>
          {/* Special flights used to be a row of pills above the table —
                the only place in the app where a filter was a pill. */}
          <FilterField label={t("specialFlights:filter.label")}>
            <select
              value={specialFilter}
              onChange={(e): void => onSpecialChange(e.target.value as SpecialTypeFilter)}
              className={PANEL_SELECT_CLASS}
            >
              <option value="all">{t("specialFlights:filter.all")}</option>
              <option value="standard">{t("specialFlights:filter.standardOnly")}</option>
              <option value="special">{t("specialFlights:filter.allSpecial")}</option>
              {SPECIAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`specialFlights:specialType.${type}`)}
                </option>
              ))}
            </select>
          </FilterField>
        </>
      }
      hasActiveFilter={hasActiveFilter}
      onReset={onReset}
      // Silent while nothing is known: "0 angezeigt" over a failed load is a
      // count of a list nobody could read.
      resultLabel={loading || loadError ? "" : t("common:filters.matching", { count: resultCount })}
    />
  );
}
