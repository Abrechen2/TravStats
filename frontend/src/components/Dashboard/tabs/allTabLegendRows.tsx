import type { JSX } from "react";
import {
  buildCruiseLegend,
  type CruiseColorConfig,
  type CruiseLegendRow,
} from "../../../lib/cruiseColor";
import {
  buildFlightLegend,
  rgbCss,
  type FlightColorConfig,
  type FlightLegendRow,
} from "../../../lib/flightColor";
import {
  buildLodgingLegend,
  type LodgingColorConfig,
  type LodgingLegendRow,
} from "../../../lib/lodgingColor";
import {
  buildPlaceLegend,
  type PlaceColorConfig,
  type PlaceLegendRow,
} from "../../../lib/placeColor";
import { PORT_RGB } from "../../layers/cruisePortsLayer";
import type { MapLayerColors } from "../../../types/mapTheme";

// The five per-domain legend-row builders `AllTab.tsx` used to inline —
// split out purely to keep that file under its 800-line ceiling (the same
// reason `tourMapOverlay.tsx` exists). Each mirrors `buildTourLegendRows`'s
// shape: pure functions of a colour config plus the caller's own `t` and
// `legendRow` (the swatch-JSX builder), with no state of their own. Moving
// them here changes nothing about WHAT they compute — same config in, same
// JSX out — only where the code that computes it lives.

type Translate = (key: string) => string;
export type LegendRowFn = (
  background: string,
  label: string,
  key: string,
  shape?: "line" | "ramp" | "dot"
) => JSX.Element;

/**
 * One colour-key row. The swatch takes the SHAPE of the thing it stands for:
 *
 *   "line"  a route — flights, cruises and tour legs are drawn as lines/arcs
 *   "ramp"  a route coloured by a gradient (flight frequency mode)
 *   "dot"   a place — a lodging or a POI is a pin, not a line (Alex,
 *           2026-08-09: "Da Unterkünfte keine 'Strecken' sind sollte hier
 *           auch in der Legende ein Kreis sein.")
 *
 * There was a "ring" shape for POIs while the pin layer drew a ringed mark.
 * The ring left the map on 2026-08-28 and the shape left with it: a key that
 * draws a mark the map does not is worse than no key.
 *
 * `background` takes any CSS colour OR gradient, so all three share one
 * renderer. Was inlined identically in both AllTab.tsx and TourTab.tsx
 * (found in the tour-dashboard-map fix-round review, 2026-08-30) — moved
 * here once there were two copies to keep in sync instead of one.
 */
export function legendRow(
  background: string,
  label: string,
  key: string,
  shape: "line" | "ramp" | "dot" = "line"
): JSX.Element {
  return (
    <span key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        aria-hidden
        style={{
          width: shape === "ramp" ? 24 : shape === "dot" ? 8 : 14,
          height: shape === "ramp" ? 4 : shape === "dot" ? 8 : 2,
          background,
          boxSizing: "border-box",
          borderRadius: shape === "dot" ? "50%" : 2,
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--text-primary)" }}>{label}</span>
    </span>
  );
}

// Legend row → i18n key. The COLOURS never appear here — they come from
// `buildFlightLegend`, i.e. the same function the map layers resolve through
// (see lib/flightColor.ts). Adding a 4th colour mode later means adding a
// label here, never a colour value.
const FLIGHT_LEGEND_LABEL_KEY: Record<FlightLegendRow["slot"], string> = {
  past: "dashboard:legend.flightPast",
  upcoming: "dashboard:legend.flightUpcoming",
  frequency: "dashboard:legend.flightFrequency",
  solid: "dashboard:legend.flightSolid",
};

// Flight rows are DERIVED from the active colour config — never hardcoded.
export function buildFlightLegendRows(
  config: FlightColorConfig,
  t: Translate,
  legendRow: LegendRowFn
): JSX.Element[] {
  return buildFlightLegend(config).map((row) => {
    const label = t(FLIGHT_LEGEND_LABEL_KEY[row.slot]);
    if (row.kind === "ramp") {
      // Frequency mode: one gradient bar from the rarest to the most-flown
      // tier, using the very stops the arcs are painted with.
      const gradient = `linear-gradient(90deg, ${row.stops.map(rgbCss).join(", ")})`;
      return legendRow(gradient, label, `flight-${row.slot}`, "ramp");
    }
    return legendRow(rgbCss(row.color), label, `flight-${row.slot}`);
  });
}

const CRUISE_LEGEND_LABEL_KEY: Record<CruiseLegendRow["slot"], string> = {
  past: "dashboard:legend.cruisePast",
  planned: "dashboard:legend.cruisePlanned",
  perCruise: "dashboard:legend.cruisePerCruise",
  solid: "dashboard:legend.cruiseSolid",
};

// Cruise rows, same contract: DERIVED from the active cruise colour config,
// never hardcoded. "perCruise" has no single colour, so it renders one honest
// multi-hue swatch (hard colour stops, not a blend) with a "one colour per
// cruise" label — enumerating every cruise would be a second sidebar.
export function buildCruiseLegendRows(
  config: CruiseColorConfig,
  t: Translate,
  legendRow: LegendRowFn
): JSX.Element[] {
  return buildCruiseLegend(config).map((row) => {
    const label = t(CRUISE_LEGEND_LABEL_KEY[row.slot]);
    if (row.kind === "multi") {
      const step = 100 / row.stops.length;
      const segments = row.stops
        .map((c, i) => `${rgbCss(c)} ${i * step}% ${(i + 1) * step}%`)
        .join(", ");
      return legendRow(`linear-gradient(90deg, ${segments})`, label, `cruise-${row.slot}`, "ramp");
    }
    return legendRow(rgbCss(row.color), label, `cruise-${row.slot}`);
  });
}

// Same contract on the cruise side (#reported-2.3.1): the legend used to
// hardcode rgb(74,144,217) / rgb(34,211,238) as string literals, so it kept
// claiming blue/cyan while the user's colours were already on the map.
const LODGING_LEGEND_LABEL_KEY: Record<LodgingLegendRow["slot"], string> = {
  solid: "dashboard:legend.lodging",
  hotel: "lodging:type.hotel",
  guesthouse: "lodging:type.guesthouse",
  apartment: "lodging:type.apartment",
  hostel: "lodging:type.hostel",
  campsite: "lodging:type.campsite",
  rated: "dashboard:legend.lodgingRated",
  unrated: "dashboard:legend.lodgingUnrated",
  chain: "dashboard:legend.lodgingChain",
  independent: "dashboard:legend.lodgingIndependent",
};

// Lodging rows are DERIVED from the same config `layers/lodgingPinsLayer.ts`
// resolves its pin colour through, so the dots on the map and the swatches in
// the legend can never disagree — including now that there is a mode, where a
// five-colour map beside a one-row legend would misdescribe what is on screen.
export function buildLodgingLegendRows(
  config: LodgingColorConfig,
  t: Translate,
  legendRow: LegendRowFn
): JSX.Element[] {
  return buildLodgingLegend(config).map((row) =>
    legendRow(
      rgbCss(row.color),
      t(LODGING_LEGEND_LABEL_KEY[row.slot]),
      `lodging-${row.slot}`,
      "dot"
    )
  );
}

// Place rows on this tab are always the mode's built-in slots — `list` mode's
// user-named rows are a POI-tab thing, where a list filter sits beside them.
const PLACE_LEGEND_LABEL_KEY: Record<string, string> = {
  solid: "dashboard:poi.legend.solid",
  visited: "dashboard:poi.legend.visited",
  wishlist: "dashboard:poi.legend.wishlist",
  unlisted: "dashboard:poi.legend.unlisted",
};

// POI rows come from the same `buildPlaceLegend` the pin layer resolves
// through, and are drawn as plain DOTS, because that is the mark on this map.
// They were rings until 2026-08-28, when the ring was removed from the pin
// layer by owner decision; the legend kept drawing one and so described a
// mark that is no longer there.
export function buildPoiLegendRows(
  config: PlaceColorConfig,
  t: Translate,
  legendRow: LegendRowFn
): JSX.Element[] {
  return buildPlaceLegend(config).map((row: PlaceLegendRow) =>
    legendRow(
      rgbCss(row.color),
      row.label ?? t(PLACE_LEGEND_LABEL_KEY[row.slot] ?? "dashboard:poi.legend.solid"),
      `poi-${row.slot}`,
      "dot"
    )
  );
}

// Airports and ports are the only marks on this map that are ONLY marks: an
// arc explains itself by connecting two places, a dot does not. They were
// drawn and never named, which is the one thing a legend exists for (Alex,
// 2026-08-09, same message as the lodging circle above).
//
// Both colours are READ from what the layers paint with — the airport dot
// from the active map theme (`routesLayer` falls back to exactly this value),
// the port from `cruisePortsLayer`'s own exported constant. Nothing is typed
// in twice, so switching the map theme cannot leave the key behind.
export function buildAirportPortLegendRows(
  flightsVisible: boolean,
  cruisesVisible: boolean,
  themeColors: MapLayerColors,
  t: Translate,
  legendRow: LegendRowFn
): JSX.Element[] {
  return [
    flightsVisible &&
      legendRow(
        rgbCss(themeColors.airportDot),
        t("dashboard:legend.airport"),
        "place-airport",
        "dot"
      ),
    cruisesVisible && legendRow(rgbCss(PORT_RGB), t("dashboard:legend.port"), "place-port", "dot"),
  ].filter((row): row is JSX.Element => row !== false);
}
