import { useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { DOMAINS } from "../../../shared/domains";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import {
  cruiseToItem,
  flightToItem,
  lodgingToItem,
  placeToItem,
  sortActivityItems,
  type ActivityItem,
  type ActivityKind,
} from "./activityItems";
import { useDomainColors } from "../../../hooks/useDomainColors";

interface UnifiedActivityPanelProps {
  flights?: GeoJSONFeature[];
  cruises?: Cruise[];
  lodgings?: readonly Lodging[];
  places?: readonly Place[];
  isOpen: boolean;
  onClose(): void;
  /**
   * Pins the list to one domain and hides the filter chips. A domain tab has
   * already made that choice in the tab strip above; offering it twice would
   * be two controls for one decision.
   */
  lockedKind?: ActivityKind;
  /** Row click — focus and highlight on the map. Never navigates. */
  onSelect?(item: ActivityItem): void;
  /** The row's arrow — opens the detail view for that entry. */
  onDetails?(item: ActivityItem): void;
  /** Heading; a domain tab passes its own. */
  title?: string;
}

const CHIP_ORDER: readonly ActivityKind[] = ["flight", "cruise", "lodging", "poi"];

/**
 * The dashboard's activity sidebar — one component for every tab.
 *
 * It used to know only flights and cruises, so lodgings and places had
 * bespoke sidebars of their own, sorted differently (or not at all) and the
 * lodging rows navigated away from the map instead of selecting on it. The
 * filter-by-kind machinery was already here; it simply never grew past two
 * domains. Everything domain-specific now lives in `activityItems.ts`.
 */
export function UnifiedActivityPanel({
  flights,
  cruises,
  lodgings,
  places,
  isOpen,
  onClose,
  lockedKind,
  onSelect,
  onDetails,
  title,
}: UnifiedActivityPanelProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard", "common"]);
  const { colorOf } = useDomainColors();
  const [filter, setFilter] = useState<"all" | ActivityKind>("all");

  const allItems = useMemo<ActivityItem[]>(
    () =>
      sortActivityItems([
        // Passed explicitly rather than point-free: `.map(flightToItem)` hands
        // the mapper the ARRAY INDEX as its next argument, which is exactly
        // where the translator sits now.
        ...(flights ?? []).map((f, i) => flightToItem(f, i, t)),
        ...(cruises ?? []).map((c) => cruiseToItem(c, t)),
        ...(lodgings ?? []).map((l) => lodgingToItem(l, t)),
        ...(places ?? []).map((pl) => placeToItem(pl, t)),
      ]),
    // `t` is referentially stable per language (see hooks/useTranslation), so
    // this recomputes on a language switch and on nothing else.
    [flights, cruises, lodgings, places, t]
  );

  const effectiveFilter: "all" | ActivityKind = lockedKind ?? filter;

  const visible = useMemo(
    () =>
      effectiveFilter === "all"
        ? allItems
        : allItems.filter((item) => item.kind === effectiveFilter),
    [allItems, effectiveFilter]
  );

  const counts = useMemo(() => {
    const byKind = { flight: 0, cruise: 0, lodging: 0, poi: 0 };
    for (const item of allItems) byKind[item.kind] += 1;
    return { all: allItems.length, ...byKind };
  }, [allItems]);

  if (!isOpen) return null;

  // Only offer a chip for a domain that actually has rows — a permanently
  // empty "0" chip is a control that can never do anything.
  const chips = CHIP_ORDER.filter((kind) => counts[kind] > 0);

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
        <strong>{title ?? t("dashboard:sidebar.activity")}</strong>
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

      {lockedKind === undefined && chips.length > 1 && (
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
          {(["all", ...chips] as const).map((key) => (
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
              {key === "all" ? t("dashboard:sidebar.filters.all") : DOMAINS[key].icon}{" "}
              <span style={{ color: "var(--text-muted)" }}>{counts[key]}</span>
            </button>
          ))}
        </div>
      )}

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
            onClick={() => onSelect?.(item)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(item);
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
              <span aria-hidden style={{ color: colorOf(item.kind) }}>
                {DOMAINS[item.kind].icon}
              </span>
              <strong style={{ flex: 1 }}>{item.label}</strong>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{item.displayDate}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDetails?.(item);
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
            {(item.sublabel !== null || item.meta !== null || !item.mappable) && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  color: "var(--text-muted)",
                  fontSize: 11,
                  marginTop: 2,
                  marginLeft: 20,
                }}
              >
                {item.sublabel !== null && <span style={{ flex: 1 }}>{item.sublabel}</span>}
                {item.meta !== null && <span>{item.meta}</span>}
                {!item.mappable && (
                  // The map cannot focus this row. Saying so beats a click that
                  // looks broken — the arrow still leads to where it gets fixed.
                  <span title={t("dashboard:sidebar.notOnMap")}>
                    ⌀
                  </span>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
