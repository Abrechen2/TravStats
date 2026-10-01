import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type { Layer } from "@deck.gl/core";
import {
  RENTAL_GLOBE_ALTITUDE_M,
  buildRentalDeckLayers,
  buildRentalLinks,
  buildRentalPoints,
  type RentalMapSource,
} from "../../layers/rentalLayer";
import { hexToRgb } from "../../../lib/domainColor";
import { legendRow, type LegendRowFn } from "./allTabLegendRows";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { useDashboardFilterStore } from "../../../store/dashboardFilterStore";
import { rentalApi } from "../../../lib/api/rental";
import { logger } from "../../../lib/logger";

type Translate = (key: string) => string;

/**
 * The rental layer and its legend for the "Alle" map (spec
 * 2026-10-01-rental-domain-design §6, D1 a). Layer and legend take the SAME
 * colour from the domain colour store, so a repainted rental shows the new
 * colour on the map and in the key together (the map colour invariant).
 */
export function buildRentalMapLayers(
  rentals: readonly RentalMapSource[],
  colorHex: string,
  onGlobe: boolean,
  idPrefix = "dashboard-rental"
): Layer[] {
  return buildRentalDeckLayers(buildRentalPoints(rentals), buildRentalLinks(rentals), {
    color: hexToRgb(colorHex),
    altitudeM: onGlobe ? RENTAL_GLOBE_ALTITUDE_M : 0,
    idPrefix,
  });
}

/** One key per kind of mark actually on the map — never a key for a mark the map does not draw. */
export function buildRentalLegendRows(
  rentals: readonly RentalMapSource[],
  colorHex: string,
  t: Translate,
  row: LegendRowFn
): JSX.Element[] {
  const [r, g, b] = hexToRgb(colorHex);
  const points = buildRentalPoints(rentals);
  const rows: JSX.Element[] = [];
  if (points.some((p) => p.role === "same")) {
    rows.push(row(`rgb(${r},${g},${b})`, t("dashboard:legend.rentalSame"), "rental-same", "dot"));
  }
  if (points.some((p) => p.role !== "same")) {
    rows.push(row(`rgb(${r},${g},${b})`, t("dashboard:legend.rentalEnds"), "rental-ends", "dot"));
  }
  if (buildRentalLinks(rentals).length > 0) {
    const dash = `repeating-linear-gradient(90deg, rgb(${r},${g},${b}) 0 4px, transparent 4px 7px)`;
    rows.push(row(dash, t("dashboard:legend.rentalOneWay"), "rental-oneway", "line"));
  }
  return rows;
}

/** The logbook's page bound; the map reads pages until it has them all. */
const PAGE = 500;
const MAX_RENTALS = 5_000;

/**
 * Every rental the map draws, for one year or all. `enabled` gates the FETCH,
 * not just the drawing — a domain behind the beta switch or switched off by
 * the user never reaches the network. A failed load is logged and drawn as
 * nothing; the logbook page is where it is said out loud.
 */
export function useDashboardRentals(enabled: boolean, year: number | null): RentalMapSource[] {
  const [rentals, setRentals] = useState<RentalMapSource[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRentals([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const all: RentalMapSource[] = [];
        for (let offset = 0; offset < MAX_RENTALS; offset += PAGE) {
          const page = await rentalApi.list({ limit: PAGE, offset, year: year ?? undefined });
          all.push(...page.rentals);
          if (all.length >= page.total || page.rentals.length === 0) break;
        }
        if (!cancelled) setRentals(all);
      } catch (err: unknown) {
        logger.error("useDashboardRentals: failed to load rentals", err);
        if (!cancelled) setRentals([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, year]);
  return rentals;
}

export interface RentalOverlay {
  layers: Layer[];
  legendRows: JSX.Element[];
}

/** The rental layer of the "Alle" map as one hook, so that tab gains a line, not a block. */
export function useRentalOverlay(show: boolean, onGlobe: boolean, t: Translate): RentalOverlay {
  const year = useDashboardFilterStore((s) => s.year);
  const rentals = useDashboardRentals(show, year);
  const { colorOf } = useDomainColors();
  const color = colorOf("rental");
  const drawn = show ? rentals : EMPTY;
  const layers = useMemo(
    () => buildRentalMapLayers(drawn, color, onGlobe, "all-rental"),
    [drawn, color, onGlobe]
  );
  return { layers, legendRows: buildRentalLegendRows(drawn, color, t, legendRow) };
}

const EMPTY: readonly RentalMapSource[] = [];
