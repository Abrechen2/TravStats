import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  TRIP_MAP_CHROME,
  resolveTripCruiseColor,
  resolveTripFlightColor,
  resolveTripStopColor,
} from "../tripMapColors";
import { DEFAULT_FLIGHT_COLOR_CONFIG, HISTORICAL_ROUTE_COLOR } from "../../../lib/flightColor";
import { DEFAULT_CRUISE_COLOR_CONFIG, deriveCruiseColor } from "../../../lib/cruiseColor";
import { hexToRgb } from "../../../lib/domainColor";
import { BRAND_DOMAIN_COLORS } from "../../../lib/domainColor";
import { TOUR_COLOR } from "../../../shared/domains";

/**
 * Warden: `TripMap.tsx` decides no colour.
 *
 * It carried four of its own — FLIGHT_RGB, CRUISE_RGB, AIRPORT_RGB and an
 * eight-entry STOP_DOMAIN_RGB map — so a user who set flights to teal in the
 * map panel saw teal on the dashboard and amber on the trip, and the five
 * per-mode tour colours the owner abolished on 2026-09-05 were still alive
 * here. CLAUDE.md's standing rule is the shape of the fix: "Layers AND the
 * legend must resolve colours through these stores — never hardcode an arc
 * colour."
 *
 * This is a source scan, and a source scan ages: it sees `[240, 169, 71]` and
 * nothing else. That is deliberately narrow. What it catches is the exact way
 * this file went wrong four times — a literal typed where a resolver belongs —
 * and it catches the fifth on the day it is typed, which no unit test on the
 * resolvers can do.
 */
const TRIP_MAP_SRC = readFileSync(resolve(__dirname, "../TripMap.tsx"), "utf8");

// Three or four small integers in a bracket is a deck.gl colour and nothing
// else in this file: the only other numeric tuples it writes are two-element
// pixel offsets and lon/lat pairs built from named values.
const COLOUR_TUPLE = /\[\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*\d{1,3}\s*)?\]/g;

describe("warden: TripMap paints nothing of its own", () => {
  it("reads the file at all — otherwise the scan has drifted and passes silently", () => {
    expect(TRIP_MAP_SRC.length).toBeGreaterThan(1000);
    expect(TRIP_MAP_SRC).toContain("tripMapColors");
  });

  it("holds no raw colour tuple", () => {
    const offenders = TRIP_MAP_SRC.match(COLOUR_TUPLE) ?? [];
    expect(offenders, "resolve it through tripMapColors.ts instead").toEqual([]);
  });

  it("names none of the four constants it used to own", () => {
    for (const gone of ["FLIGHT_RGB", "CRUISE_RGB", "AIRPORT_RGB", "STOP_DOMAIN_RGB"]) {
      expect(TRIP_MAP_SRC, `${gone} is back`).not.toContain(gone);
    }
  });
});

describe("resolveTripFlightColor", () => {
  it("follows the user's flight-colour mode, not a constant", () => {
    const teal = DEFAULT_FLIGHT_COLOR_CONFIG.colors.past.map((c) => 255 - c) as [
      number,
      number,
      number,
    ];
    const cfg = {
      mode: "solid" as const,
      colors: { ...DEFAULT_FLIGHT_COLOR_CONFIG.colors, solid: teal },
    };
    expect(resolveTripFlightColor({ status: "flown" }, cfg)).toEqual(teal);
  });

  it("keeps a planned flight apart from a flown one in status mode", () => {
    const flown = resolveTripFlightColor({ status: "flown" }, DEFAULT_FLIGHT_COLOR_CONFIG);
    const planned = resolveTripFlightColor({ status: "scheduled" }, DEFAULT_FLIGHT_COLOR_CONFIG);
    expect(flown).toEqual(DEFAULT_FLIGHT_COLOR_CONFIG.colors.past);
    expect(planned).toEqual(DEFAULT_FLIGHT_COLOR_CONFIG.colors.upcoming);
    expect(planned).not.toEqual(flown);
  });

  it("hands frequency mode the base band, because one trip has no frequency", () => {
    // Tier 2 is the user's colour itself (`TIER_MIX[2] === 0`). A trip map
    // aggregates nothing, so there is no band to encode — showing the pick is
    // the only honest answer, and dimming to tier 0 would have claimed the
    // route was rare.
    const cfg = { ...DEFAULT_FLIGHT_COLOR_CONFIG, mode: "frequency" as const };
    expect(resolveTripFlightColor({ status: "flown" }, cfg)).toEqual(cfg.colors.frequency);
  });

  it("still greys a historical flight in frequency mode", () => {
    const cfg = { ...DEFAULT_FLIGHT_COLOR_CONFIG, mode: "frequency" as const };
    expect(resolveTripFlightColor({ status: "historical" }, cfg)).toEqual(HISTORICAL_ROUTE_COLOR);
  });
});

describe("resolveTripCruiseColor", () => {
  it("gives each cruise its own hue in perCruise mode", () => {
    const cfg = { ...DEFAULT_CRUISE_COLOR_CONFIG, mode: "perCruise" as const };
    expect(resolveTripCruiseColor({ id: "abc", status: "completed" }, cfg)).toEqual(
      deriveCruiseColor("abc")
    );
  });

  it("separates a scheduled cruise from a sailed one in status mode", () => {
    const sailed = resolveTripCruiseColor(
      { id: "a", status: "completed" },
      DEFAULT_CRUISE_COLOR_CONFIG
    );
    const planned = resolveTripCruiseColor(
      { id: "a", status: "scheduled" },
      DEFAULT_CRUISE_COLOR_CONFIG
    );
    expect(planned).not.toEqual(sailed);
  });
});

describe("resolveTripStopColor", () => {
  const colors = BRAND_DOMAIN_COLORS;

  it("paints a hotel stop the lodging colour and a POI stop the POI colour", () => {
    expect(resolveTripStopColor("hotel", colors)).toEqual(hexToRgb(colors.lodging));
    expect(resolveTripStopColor("poi", colors)).toEqual(hexToRgb(colors.poi));
  });

  it("gives every means of transport the ONE tour colour (owner, 2026-09-05)", () => {
    const tour = hexToRgb(TOUR_COLOR);
    for (const mode of ["train", "road", "ferry", "hike", "bike"]) {
      expect(resolveTripStopColor(mode, colors), `${mode} is not the tour colour`).toEqual(tour);
    }
  });

  it("treats an unknown or missing domain as a place, not as a fifth colour", () => {
    expect(resolveTripStopColor(null, colors)).toEqual(hexToRgb(colors.poi));
    expect(resolveTripStopColor("something-new", colors)).toEqual(hexToRgb(colors.poi));
  });

  it("follows a user override rather than the brand default", () => {
    const overridden = { ...colors, poi: "#123456" };
    expect(resolveTripStopColor("poi", overridden)).toEqual(hexToRgb("#123456"));
  });
});

describe("TRIP_MAP_CHROME", () => {
  it("carries the non-data colours so the component holds none", () => {
    expect(TRIP_MAP_CHROME.outline).toHaveLength(4);
    expect(TRIP_MAP_CHROME.highlight).toHaveLength(4);
    expect(TRIP_MAP_CHROME.labelText).toHaveLength(4);
  });
});
