import { useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatDateInTimezone } from "../../../lib/dateUtils";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";

type Kind = "flight" | "cruise";

interface ActivityItem {
  id: string;
  kind: Kind;
  label: string;
  sublabel: string | null;
  /** ISO-sortable date string "YYYY-MM-DD" — empty means unknown */
  sortDate: string;
  /** human-readable date shown in the UI */
  displayDate: string;
  /** Stable key pointing back to the source object — flight id or cruise. */
  payload: { flightId: string } | { cruise: Cruise };
}

interface UnifiedActivityPanelProps {
  flights: GeoJSONFeature[];
  cruises: Cruise[];
  isOpen: boolean;
  onClose(): void;
  /** Single click on a flight row — called with the GeoJSON feature id. */
  onFlightSelect?(flightId: string): void;
  /** Details button on a flight row — opens the edit modal. */
  onFlightDetails?(flightId: string): void;
  /** Single click on a cruise row — selects the cruise on the map. */
  onCruiseSelect?(cruise: Cruise): void;
  /** Details button on a cruise row — navigates to the detail page. */
  onCruiseDetails?(cruise: Cruise): void;
}

function readProp<T>(obj: Record<string, unknown>, key: string): T | undefined {
  return obj[key] as T | undefined;
}

function flightToItem(feature: GeoJSONFeature, index: number): ActivityItem {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const dep = readProp<{ iata?: string }>(props, "departureAirport");
  const arr = readProp<{ iata?: string }>(props, "arrivalAirport");
  const airline = readProp<string>(props, "airline") ?? "";
  const flightNumber = readProp<string>(props, "flightNumber") ?? "";
  const flightId = readProp<string>(props, "id") ?? "";
  // Flights store an ISO timestamp on departureTime; historical entries
  // can have it null, in which case we leave sortDate empty so the date
  // filter doesn't silently drop the flight from the list.
  const departureTime = readProp<string | null>(props, "departureTime") ?? "";
  const sortDate = typeof departureTime === "string" ? departureTime.slice(0, 10) : "";
  const displayDate = sortDate ? formatDateInTimezone(departureTime, "UTC") : "—";

  return {
    id: `f-${flightId || index}`,
    kind: "flight",
    label: `${dep?.iata ?? "?"} → ${arr?.iata ?? "?"}`,
    sublabel: `${airline} ${flightNumber}`.trim() || null,
    sortDate,
    displayDate,
    payload: { flightId },
  };
}

function cruiseToItem(cruise: Cruise): ActivityItem {
  const startIso = cruise.startDate ?? "";
  const sortDate = typeof startIso === "string" ? startIso.slice(0, 10) : "";
  const displayDate = sortDate ? formatDateInTimezone(startIso, "UTC") : "—";
  return {
    id: `c-${cruise.id}`,
    kind: "cruise",
    label: cruise.ship?.name ?? cruise.shipNameOverride ?? cruise.cruiseLine ?? "Cruise",
    sublabel: cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? null,
    sortDate,
    displayDate,
    payload: { cruise },
  };
}

export function UnifiedActivityPanel({
  flights,
  cruises,
  isOpen,
  onClose,
  onFlightSelect,
  onFlightDetails,
  onCruiseSelect,
  onCruiseDetails,
}: UnifiedActivityPanelProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard", "common"]);
  const [filter, setFilter] = useState<"all" | Kind>("all");

  const handleItemClick = (item: ActivityItem): void => {
    if ("flightId" in item.payload) {
      onFlightSelect?.(item.payload.flightId);
    } else {
      onCruiseSelect?.(item.payload.cruise);
    }
  };

  const handleItemDetails = (item: ActivityItem): void => {
    if ("flightId" in item.payload) {
      onFlightDetails?.(item.payload.flightId);
    } else {
      onCruiseDetails?.(item.payload.cruise);
    }
  };

  const allItems = useMemo<ActivityItem[]>(() => {
    const flightItems = flights.map(flightToItem);
    const cruiseItems = cruises.map(cruiseToItem);
    // Sort descending by date. Items with no date land at the bottom so
    // they don't dominate the first screenful of the panel.
    return [...flightItems, ...cruiseItems].sort((a, b) => {
      if (a.sortDate === b.sortDate) return 0;
      if (a.sortDate === "") return 1;
      if (b.sortDate === "") return -1;
      return a.sortDate < b.sortDate ? 1 : -1;
    });
  }, [flights, cruises]);

  const visible = useMemo(
    () => (filter === "all" ? allItems : allItems.filter((item) => item.kind === filter)),
    [allItems, filter]
  );

  const counts = useMemo(
    () => ({
      all: allItems.length,
      flight: allItems.filter((i) => i.kind === "flight").length,
      cruise: allItems.filter((i) => i.kind === "cruise").length,
    }),
    [allItems]
  );

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width: 320,
        background: "rgba(22,27,34,0.95)",
        borderRight: "1px solid var(--color-border)",
        zIndex: 20,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <strong>{t("dashboard:sidebar.activity")}</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          style={{
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontSize: 18,
          }}
        >
          ×
        </button>
      </div>

      <div
        role="tablist"
        aria-label={t("dashboard:sidebar.activity")}
        style={{
          display: "flex",
          gap: 6,
          padding: "8px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        {(
          [
            ["all", t("dashboard:sidebar.filters.all"), counts.all],
            ["flight", `✈ ${t("dashboard:sidebar.filters.flight")}`, counts.flight],
            ["cruise", `⚓ ${t("dashboard:sidebar.filters.cruise")}`, counts.cruise],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: filter === key ? "var(--bg-muted)" : "transparent",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {label} <span style={{ color: "var(--text-muted)" }}>{count}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p style={{ padding: 16, color: "var(--text-muted)" }}>
          {t("dashboard:sidebar.emptyActivity")}
        </p>
      ) : (
        visible.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => handleItemClick(item)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleItemClick(item);
              }
            }}
            className="activity-row hover:bg-white/4"
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden>{item.kind === "flight" ? "✈" : "⚓"}</span>
              <strong style={{ flex: 1 }}>{item.label}</strong>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{item.displayDate}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleItemDetails(item);
                }}
                aria-label={t("common:buttons.details", { defaultValue: "Details" })}
                title={t("common:buttons.details", { defaultValue: "Details" })}
                style={{
                  background: "none",
                  border: "1px solid var(--color-border)",
                  borderRadius: 4,
                  padding: "2px 6px",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1,
                }}
              >
                →
              </button>
            </div>
            {item.sublabel !== null && (
              <div
                style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2, marginLeft: 20 }}
              >
                {item.sublabel}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
