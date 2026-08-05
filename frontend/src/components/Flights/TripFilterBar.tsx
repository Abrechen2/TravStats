import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { Trip } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

export type TripFilterValue = "all" | "with" | "without" | string;

interface TripFilterBarProps {
  trips: Trip[];
  value: TripFilterValue;
  onChange(next: TripFilterValue): void;
}

/** How many trips appear inline as quick chips before the rest moves
 *  into the searchable popover. */
const QUICK_CHIP_COUNT = 5;

const BASE_FILTERS = ["all", "with", "without"] as const;

function tripSortKey(trip: Trip): number {
  return new Date(trip.startDate ?? trip.createdAt).getTime();
}

/**
 * Trip filter for the flight table. Replaces the old one-chip-per-trip
 * row (unusable beyond ~10 trips): base chips + the newest few trips as
 * quick chips + a "filter by trip" popover with search and year groups.
 */
export function TripFilterBar({ trips, value, onChange }: TripFilterBarProps): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const sortedTrips = useMemo(
    () => [...trips].sort((a, b) => tripSortKey(b) - tripSortKey(a)),
    [trips]
  );

  // Newest trips inline; the actively selected trip always gets a chip
  // even when it lives further down the list.
  const quickTrips = useMemo(() => {
    const quick = sortedTrips.slice(0, QUICK_CHIP_COUNT);
    if (value !== "all" && value !== "with" && value !== "without") {
      const selected = sortedTrips.find((trip) => trip.id === value);
      if (selected && !quick.some((trip) => trip.id === selected.id)) {
        return [selected, ...quick.slice(0, QUICK_CHIP_COUNT - 1)];
      }
    }
    return quick;
  }, [sortedTrips, value]);

  // Popover list: search filter, then grouped by start year (newest
  // first; trips without a date sort last under their own label).
  const groupedTrips = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching =
      q.length === 0
        ? sortedTrips
        : sortedTrips.filter((trip) => trip.name.toLowerCase().includes(q));
    const groups = new Map<string, Trip[]>();
    for (const trip of matching) {
      const key = trip.startDate
        ? String(new Date(trip.startDate).getFullYear())
        : t("trips:filter.undated");
      const list = groups.get(key) ?? [];
      list.push(trip);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [sortedTrips, search, t]);

  const selectTrip = (tripId: string): void => {
    onChange(value === tripId ? "all" : tripId);
    setOpen(false);
    setSearch("");
  };

  return (
    <div
      ref={containerRef}
      className="relative flex flex-wrap gap-2 px-4 py-2"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      {BASE_FILTERS.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={`px-3 py-1 rounded-full text-xs border transition-colors ${
            value === f
              ? "bg-(--accent)/20 border-(--accent)/50 text-(--accent)"
              : "border-border text-(--text-muted)"
          }`}
        >
          {t(`trips:filter.${f}`)}
        </button>
      ))}

      {quickTrips.map((trip) => (
        <button
          key={trip.id}
          onClick={() => selectTrip(trip.id)}
          className="px-3 py-1 rounded-full text-xs border transition-colors"
          style={{
            background: value === trip.id ? `${trip.color}22` : "transparent",
            borderColor: value === trip.id ? trip.color : `${trip.color}55`,
            color: trip.color,
          }}
        >
          ● {trip.name}
        </button>
      ))}

      {sortedTrips.length > QUICK_CHIP_COUNT && (
        <button
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="px-3 py-1 rounded-full text-xs border transition-colors border-border text-(--text-muted) hover:text-(--text-primary)"
        >
          🏷 {t("trips:filter.pick")} ▾
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={t("trips:filter.pick")}
          className="absolute left-4 top-full mt-1 z-30 w-80 rounded-xl shadow-2xl"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="p-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("trips:filter.search")}
              className="w-full rounded-lg px-3 py-1.5 text-xs"
              style={{
                background: "var(--bg-base)",
                border: "1px solid var(--color-border)",
                color: "var(--text-primary)",
              }}
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {groupedTrips.length === 0 ? (
              <div className="px-3 py-4 text-xs text-center" style={{ color: "var(--text-muted)" }}>
                {t("trips:filter.noResults")}
              </div>
            ) : (
              groupedTrips.map(([year, yearTrips]) => (
                <div key={year}>
                  <div
                    className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest font-semibold"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {year}
                  </div>
                  {yearTrips.map((trip) => (
                    <button
                      key={trip.id}
                      onClick={() => selectTrip(trip.id)}
                      className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-(--bg-muted)"
                      style={{
                        color: value === trip.id ? "var(--accent)" : "var(--text-primary)",
                      }}
                    >
                      <span
                        aria-hidden
                        className="inline-block rounded-full shrink-0"
                        style={{ width: 8, height: 8, background: trip.color }}
                      />
                      <span className="truncate">{trip.name}</span>
                      {value === trip.id && <span className="ml-auto">✓</span>}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
