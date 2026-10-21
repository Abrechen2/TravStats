import { describe, expect, it } from "vitest";
import deMap from "../../../../../i18n/resources/de/map.json";
import enMap from "../../../../../i18n/resources/en/map.json";
import deRail from "../../../../../i18n/resources/de/rail.json";
import enRail from "../../../../../i18n/resources/en/rail.json";
import deFerry from "../../../../../i18n/resources/de/ferry.json";
import enFerry from "../../../../../i18n/resources/en/ferry.json";
import deBus from "../../../../../i18n/resources/de/bus.json";
import enBus from "../../../../../i18n/resources/en/bus.json";
import deRental from "../../../../../i18n/resources/de/rental.json";
import enRental from "../../../../../i18n/resources/en/rental.json";
import deOpenData from "../../../../../i18n/resources/de/openData.json";
import enOpenData from "../../../../../i18n/resources/en/openData.json";
import {
  journeyFromBus,
  journeyFromFerry,
  journeyFromRail,
  journeyFromRental,
} from "../journeyNormalize";
import { journeyRouteProfile, type JourneyRouteHover } from "../journeyLayerCards";
import { journeyRouteHoverHtml, journeyStopHoverHtml } from "../journeyHoverHtml";
import type { MapJourney } from "../journeyTypes";
import type { TimeValue } from "../../../../../shared/time";

/**
 * The hover profile of a route and a station (owner, 2026-10-21): ends and
 * count as before, plus distance with its source, average duration, last
 * date, and the slots for the operator's logo and the picture — per domain,
 * from the REAL bundles in both languages.
 */

const BUNDLES = {
  de: {
    map: deMap,
    rail: deRail,
    ferry: deFerry,
    bus: deBus,
    rental: deRental,
    openData: deOpenData,
  },
  en: {
    map: enMap,
    rail: enRail,
    ferry: enFerry,
    bus: enBus,
    rental: enRental,
    openData: enOpenData,
  },
} as const;

function tFor(lang: "de" | "en") {
  return (key: string, opts?: Record<string, unknown>): string => {
    const [ns, path] = key.includes(":") ? key.split(":") : ["map", key];
    const bundle = (BUNDLES[lang] as Record<string, unknown>)[ns];
    const walk = (p: string): unknown =>
      p
        .split(".")
        .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], bundle);
    let value = walk(path);
    if (value === undefined && opts && "count" in opts) {
      value = walk(`${path}_${opts.count === 1 ? "one" : "other"}`);
    }
    if (typeof value !== "string") return `MISSING(${key})`;
    return value.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts?.[k] ?? ""));
  };
}

function tv(utc: string): TimeValue {
  const local = new Date(Date.parse(utc) + 2 * 3_600_000).toISOString().slice(0, 19);
  return { utc, zone: "Europe/Berlin", offset: "+02:00", local, precision: "minute" };
}

const ENDS = {
  depStationName: "Kiel",
  depLat: 54.32,
  depLon: 10.14,
  depCountry: "DE",
  arrStationName: "Oslo",
  arrLat: 59.9,
  arrLon: 10.75,
  arrCountry: "NO",
};
const TIMES = {
  departure: tv("2024-08-10T12:00:00Z"),
  arrival: tv("2024-08-11T08:00:00Z"),
  actualDeparture: null,
  actualArrival: null,
};

function hover(journeys: MapJourney[]): JourneyRouteHover {
  return {
    domain: journeys[0].domain,
    dep: journeys[0].dep,
    arr: journeys[0].arr,
    travelled: journeys.length,
    planned: 0,
    color: [86, 134, 184],
    profile: journeyRouteProfile(journeys),
  };
}

const ferry = journeyFromFerry({
  id: "f",
  status: "completed",
  ...ENDS,
  operator: "Color Line",
  vesselName: 'Color "Fantasy"',
  distanceKm: 684,
  distanceSource: "sea_route",
  times: TIMES,
} as Parameters<typeof journeyFromFerry>[0]);

describe("route hover profile", () => {
  it.each(["de", "en"] as const)("prints the ferry's profile in %s, none missing", (l) => {
    const html = journeyRouteHoverHtml(hover([ferry]), { t: tFor(l) });
    expect(html).not.toContain("MISSING(");
    // One crossing's length and what it measures — not the sum of every crossing.
    expect(html).toContain(
      l === "de" ? "684 km · Seeweg (Schätzung)" : "684 km · Sea route (estimate)"
    );
    expect(html).toContain("Ø 20 h 0 min");
    // The overnight crossing names both days.
    expect(html).toMatch(/→/);
    expect(html).toContain('data-hover-operator data-domain="ferry" data-name="Color Line"');
    // A name is an attribute value, escaped — never markup.
    expect(html).toContain('data-kind="vessel" data-name="Color &quot;Fantasy&quot;"');
  });

  it("asks for the train category's picture on a rail route", () => {
    const rail = journeyFromRail({
      id: "r",
      status: "completed",
      ...ENDS,
      trainCategory: "ICE",
      trainNumber: "123",
    } as Parameters<typeof journeyFromRail>[0]);
    expect(journeyRouteHoverHtml(hover([rail]), { t: tFor("de") })).toContain(
      'data-kind="train" data-name="ICE"'
    );
  });

  it("asks for the car model, not its class, on a rental", () => {
    const rental = journeyFromRental({
      id: "c",
      status: "completed",
      provider: "Sixt",
      pickupStationName: "Faro",
      returnStationName: "Lisboa",
      pickupLat: 37,
      pickupLon: -8,
      returnLat: 38.7,
      returnLon: -9.1,
      vehicleClass: "Compact",
      vehicleExample: "VW Golf oder ähnlich",
    } as Parameters<typeof journeyFromRental>[0]);
    const html = journeyRouteHoverHtml(hover([rental]), { t: tFor("de") });
    expect(html).toContain('data-kind="vehicle" data-name="VW Golf oder ähnlich"');
  });

  it("asks for no picture on a bus route — no coach type is recorded", () => {
    const bus = journeyFromBus({
      id: "b",
      status: "completed",
      ...ENDS,
      operator: "FlixBus",
    } as Parameters<typeof journeyFromBus>[0]);
    const html = journeyRouteHoverHtml(hover([bus]), { t: tFor("de") });
    expect(html).not.toContain("data-hover-subject");
    expect(html).toContain("data-hover-operator");
  });

  it("leaves out every figure that cannot be derived", () => {
    const bare = journeyFromBus({
      id: "b",
      status: "completed",
      ...ENDS,
    } as Parameters<typeof journeyFromBus>[0]);
    const html = journeyRouteHoverHtml(hover([bare]), { t: tFor("de") });
    expect(html).not.toContain("hover-profile");
    expect(html).not.toContain(" 0 km");
    expect(html).not.toContain("Ø");
  });
});

describe("station hover profile", () => {
  it.each(["de", "en"] as const)(
    "prints departures, destinations and the last visit in %s",
    (l) => {
      const html = journeyStopHoverHtml(
        {
          domain: "ferry",
          stop: ferry.dep,
          travelled: 2,
          planned: 0,
          color: [86, 134, 184],
          departures: 2,
          destinations: [{ name: "Oslo", count: 2 }],
          lastVisit: tv("2024-08-10T12:00:00Z"),
        },
        { t: tFor(l) }
      );
      expect(html).not.toContain("MISSING(");
      expect(html).toContain(l === "de" ? "2 Abfahrten" : "2 departures");
      expect(html).toContain("→ Oslo 2×");
      expect(html).toContain(l === "de" ? "Zuletzt hier" : "Last here");
      expect(html).toContain('data-hover-stop data-domain="ferry" data-name="Kiel"');
    }
  );
});
