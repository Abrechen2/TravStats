import type { JSX } from "react";
import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { rgbCss } from "../../../lib/flightColor";
import { TOUR_MODE_RGB, type TourPathDatum } from "../../layers/tourPathsLayer";
import { LEG_MODES, type LegMode } from "../../../types/tour";

// Split out of AllTab.tsx purely to keep that file under its 800-line
// ceiling — everything here is AllTab-specific (dashboard-wide tour
// sections on the "Alle" map) and has exactly one caller.

/**
 * Reuses the SAME mode labels the tour route editor already shows
 * (`trips:tours.mode.*`) rather than a second copy in dashboard.json — one
 * German word for "ferry" is enough, and the tour editor's copy is the
 * established one.
 */
export const TOUR_LEGEND_LABEL_KEY: Record<LegMode, string> = {
  road: "trips:tours.mode.road",
  ferry: "trips:tours.mode.ferry",
  rail: "trips:tours.mode.rail",
  foot: "trips:tours.mode.foot",
  bike: "trips:tours.mode.bike",
};

export interface TourLegendRow {
  mode: LegMode;
  color: [number, number, number];
}

/**
 * One row per known leg mode, coloured straight from `TOUR_MODE_RGB` — the
 * SAME constant `buildTourPaths` resolves the line colour through, so this
 * can never drift into a second colour source for the same mode (the exact
 * defect this branch already had to fix once for a shared constant).
 */
export function buildTourLegend(): TourLegendRow[] {
  return LEG_MODES.map((mode) => ({ mode, color: TOUR_MODE_RGB[mode] }));
}

export interface TourLegendState {
  /** Whether the map/legend has a settled, non-empty answer to show. */
  hasData: boolean;
  rows: JSX.Element[];
}

/** The slice of `UseDashboardToursResult` this file actually needs — kept
 *  narrow so this module does not import the hook just for its type. */
export interface TourFetchState {
  toursLoading: boolean;
  toursLoadError: boolean;
  tours: readonly unknown[];
}

/**
 * Resolves the tour legend's rows AND whether they should render at all —
 * one place for `AllTab.tsx` to call, since the "shown only once there is
 * at least one tour to describe" rule (see `TourStatusOverlay` above)
 * needs both. `legendRow` is the caller's own swatch-row builder, passed
 * through rather than duplicated here — the same "shape, colour, label"
 * contract every other AllTab legend row already uses.
 */
export function buildTourLegendRows(
  showTours: boolean,
  fetch: TourFetchState,
  t: (key: string) => string,
  legendRow: (background: string, label: string, key: string) => JSX.Element
): TourLegendState {
  const hasData =
    showTours && !fetch.toursLoading && !fetch.toursLoadError && fetch.tours.length > 0;
  const rows = hasData
    ? buildTourLegend().map((row) =>
        legendRow(rgbCss(row.color), t(TOUR_LEGEND_LABEL_KEY[row.mode]), `tour-${row.mode}`)
      )
    : [];
  return { hasData, rows };
}

/**
 * Turns `buildTourPaths`' output into the deck.gl layer(s) the dashboard
 * map renders via `MapContainer3D`'s `extraLayers` prop. Numbers match
 * `TripMap.tsx`'s own tour-path layer exactly (see its doc comment
 * ~line 401): alpha 170/2px for a `straight` placeholder chord, 255/3.5px
 * for real geometry, `widthMinPixels: 2` as the floor. Measured in a
 * browser against this dark basemap — alpha 70 at 1.5px drew ZERO pixels,
 * not merely "subtle". Do not lower these again.
 */
export function buildTourDeckLayers(pathData: readonly TourPathDatum[]): Layer[] {
  if (pathData.length === 0) return [];
  return [
    new PathLayer<TourPathDatum>({
      id: "dashboard-tour-paths",
      data: pathData,
      getPath: (d) => d.path,
      getColor: (d) =>
        [...d.color, d.isPlaceholder ? 170 : 255] as [number, number, number, number],
      getWidth: (d) => (d.isPlaceholder ? 2 : 3.5),
      widthUnits: "pixels",
      widthMinPixels: 2,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
    }),
  ];
}

export interface TourStatusOverlayProps {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  t: (key: string) => string;
}

/**
 * Top-center banner for the two tour-fetch states that are NOT a settled
 * "no data" answer — the same slot `AllTab`'s `journeySelector` uses in
 * journey mode (mutually exclusive with this: the caller never renders it
 * there). Loading and error are the states that matter here; a genuinely
 * empty, successful load renders nothing at all, same as every other
 * domain's zero-item state — rendering NOTHING is how it stays visibly
 * different from this banner's two states, not by having a banner of its
 * own.
 *
 * Error is styled in `var(--danger)` and offers a retry, matching the same
 * three-state contract `PoiTab`'s `loading`/`loadError`/`retry` overlay
 * already established for places — a legend that goes quiet after a
 * failed request reads exactly like "you have no tours", the shipped
 * defect this feature's own briefs already name.
 */
export function TourStatusOverlay({
  loading,
  error,
  onRetry,
  t,
}: TourStatusOverlayProps): JSX.Element | null {
  if (!loading && !error) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
        padding: "6px 14px",
        borderRadius: 10,
        background: "rgba(22,27,34,0.85)",
        color: error ? "var(--danger)" : "var(--text-muted)",
        border: "1px solid var(--color-border)",
        fontSize: 13,
      }}
    >
      {loading ? t("dashboard:tours.loading") : t("dashboard:tours.loadError")}
      {error && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginLeft: 8,
            background: "transparent",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {t("dashboard:tours.retry")}
        </button>
      )}
    </div>
  );
}
