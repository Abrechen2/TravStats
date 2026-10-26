import { describe, expect, it } from "vitest";
import type { PickingInfo } from "@deck.gl/core";
import deMap from "../../../../../i18n/resources/de/map.json";
import enMap from "../../../../../i18n/resources/en/map.json";
import {
  cruiseLegHoverHtml,
  indexCruiseLegs,
  journeysFromCruise,
  withCruiseLegHover,
  type CruiseLegSource,
} from "../cruiseLegJourneys";
import { journeyPath } from "../journeyCardParts";
import { createCruiseArcsLayer } from "../../../../layers/cruiseArcsLayer";
import { createMarkerTooltip } from "../../../markerTooltip";
import type { Cruise, Port } from "../../../../../types/cruise";

/**
 * forgejo#323: a cruise leg's hover said only the line's name, while a flight
 * route names both airports and "3× geflogen · 1× geplant". A leg now speaks
 * the journey hover every other domain speaks: both ports with their flags,
 * how often the leg was sailed and is planned, the line, the last sailing —
 * on the flat dashboard, the globe and the trip map, from the real bundles.
 */

const BUNDLES = { de: { map: deMap }, en: { map: enMap } } as const;

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

const port = (id: number, name: string, country: string, lat: number, lon: number): Port => ({
  id,
  name,
  city: name,
  country,
  unlocode: null,
  lat,
  lon,
  timezone: null,
  region: null,
  isUserAdded: false,
});

const KIEL = port(1, "Kiel", "DE", 54.32, 10.14);
const OSLO = port(2, "Oslo", "NO", 59.9, 10.75);
const BERGEN = port(3, "Bergen", "NO", 60.39, 5.32);

function cruise(
  id: string,
  status: Cruise["status"],
  startDate: string,
  ports: Port[],
  over: Partial<Cruise> = {}
): Cruise {
  const [first, ...rest] = ports;
  const last = rest.pop() ?? first;
  return {
    id,
    userId: "u",
    shipId: null,
    ship: null,
    shipNameOverride: "AIDAperla",
    cruiseLine: "AIDA Cruises",
    routeName: null,
    departurePortId: first.id,
    departurePort: first,
    arrivalPortId: last.id,
    arrivalPort: last,
    startDate,
    endDate: null,
    status,
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: rest.map((p, i) => ({
      id: `${id}-s${i}`,
      cruiseId: id,
      portId: p.id,
      port: p,
      dayNumber: i + 2,
      date: null,
      isAtSea: false,
      arrivalTime: null,
      departureTime: null,
      excursionNote: null,
      unresolvedPortName: null,
    })),
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

// Kiel → Oslo → Kiel twice sailed, Kiel → Oslo → Bergen once booked.
const SAILED = cruise("c1", "completed", "2023-05-01T00:00:00.000Z", [KIEL, OSLO, KIEL]);
const SAILED_AGAIN = cruise("c2", "completed", "2024-06-10T00:00:00.000Z", [KIEL, OSLO, KIEL]);
const BOOKED = cruise("c3", "scheduled", "2027-07-01T00:00:00.000Z", [KIEL, OSLO, BERGEN]);
const CANCELLED = cruise("c4", "cancelled", "2025-01-01T00:00:00.000Z", [KIEL, OSLO, KIEL]);
const ALL = [SAILED, SAILED_AGAIN, BOOKED, CANCELLED];

describe("journeysFromCruise", () => {
  it("reads one journey per leg, between the itinerary's ports, dated by the cruise day", () => {
    const legs = journeysFromCruise(BOOKED);
    expect(legs.map((j) => `${j.dep.name}→${j.arr.name}`)).toEqual(["Kiel→Oslo", "Oslo→Bergen"]);
    expect(legs[1].dep).toMatchObject({ name: "Oslo", country: "NO", lat: 59.9, lon: 10.75 });
    expect(legs[0].departure?.local.slice(0, 10)).toBe("2027-07-01");
    expect(legs[1].departure?.local.slice(0, 10)).toBe("2027-07-02");
    expect(legs[0]).toMatchObject({
      domain: "cruise",
      operator: "AIDA Cruises",
      travelled: false,
      planned: true,
      // Abstain: a leg's sea distance is not on the list row.
      distanceKm: null,
      facts: { vesselName: "AIDAperla" },
    });
  });

  it("counts a leg as sailed by the cruise counting rule, a cancelled one as neither", () => {
    expect(journeysFromCruise(SAILED).every((j) => j.travelled && !j.planned)).toBe(true);
    expect(journeysFromCruise(CANCELLED).some((j) => j.travelled || j.planned)).toBe(false);
  });

  it("deep-links a leg to its cruise's page (C2)", () => {
    expect(journeyPath(journeysFromCruise(SAILED)[0])).toBe("/cruises/c1");
  });

  it("skips a night in port, which is no leg", () => {
    const stay = cruise("c5", "completed", "2023-05-01", [KIEL, OSLO, OSLO, BERGEN]);
    expect(journeysFromCruise(stay).map((j) => `${j.dep.name}→${j.arr.name}`)).toEqual([
      "Kiel→Oslo",
      "Oslo→Bergen",
    ]);
  });
});

describe("withCruiseLegHover", () => {
  const COLOR: [number, number, number] = [10, 120, 200];
  const index = indexCruiseLegs(ALL);

  it("tallies every cruise sailing the leg, either way, and paints it in the leg's own colour", () => {
    const [d] = withCruiseLegHover([{ fromPortId: 2, toPortId: 1, color: COLOR }], index);
    expect(d.journeyRoute).toMatchObject({
      domain: "cruise",
      dep: { name: "Oslo" },
      arr: { name: "Kiel" },
      // c1 and c2 sail Oslo → Kiel; c1, c2 sail Kiel → Oslo too, c3 is booked.
      travelled: 4,
      planned: 1,
      color: COLOR,
    });
    expect(d.journeyRoute?.profile?.operator).toBe("AIDA Cruises");
    expect(d.journeyRoute?.profile?.last?.departure?.local.slice(0, 10)).toBe("2024-06-11");
  });

  it("leaves a leg it cannot name as it was", () => {
    const datum = { fromPortId: 7, toPortId: 8, color: COLOR };
    expect(withCruiseLegHover([datum], index)[0]).toBe(datum);
  });
});

describe("the hover a cruise leg shows", () => {
  const arcs = createCruiseArcsLayer([SAILED, BOOKED]);
  const data = (arcs?.props.data ?? []) as Array<Record<string, unknown>>;
  const kielOslo = data.find(
    (d) => (d.fromPortId === 1 && d.toPortId === 2) || (d.fromPortId === 2 && d.toPortId === 1)
  );

  it("names both ports and the tally on the flat dashboard, in German", () => {
    const tooltip = createMarkerTooltip(
      tFor("de"),
      "de"
    )({
      layer: arcs,
      object: kielOslo,
    } as unknown as PickingInfo);
    expect(tooltip?.html).toContain("Kiel");
    expect(tooltip?.html).toContain("Oslo");
    expect(tooltip?.html).toContain("2× gesegelt · 1× geplant");
    expect(tooltip?.html).toContain("Kreuzfahrt");
  });

  it("speaks English with the English bundle", () => {
    const tooltip = createMarkerTooltip(
      tFor("en"),
      "en"
    )({
      layer: arcs,
      object: kielOslo,
    } as unknown as PickingInfo);
    expect(tooltip?.html).toContain("2× sailed · Planned 1×");
    expect(tooltip?.html).toContain("Cruise");
  });

  it("uses the same hover on the globe and the trip map, falling back to the name", () => {
    const [decorated] = withCruiseLegHover(
      [{ fromPortId: 1, toPortId: 2, color: [1, 2, 3] as [number, number, number] }],
      indexCruiseLegs([SAILED])
    );
    const html = cruiseLegHoverHtml(decorated, "AIDAperla", tFor("de"));
    // Out and back: Kiel → Oslo and Oslo → Kiel are the same leg, sailed twice.
    expect(html).toContain("2× gesegelt");
    expect(html).toContain("Oslo");
    expect(cruiseLegHoverHtml({}, "AIDAperla", tFor("de"))).toContain("AIDAperla");
    expect(cruiseLegHoverHtml({}, "AIDAperla", tFor("de"))).not.toContain("gesegelt");
  });
});

describe("a cruise leg's hover names ports, not UN/LOCODEs", () => {
  const coded = (id: number, name: string, unlocode: string, lat: number, lon: number): Port => ({
    ...port(id, name, unlocode.slice(0, 2), lat, lon),
    unlocode,
  });
  const leg = (dep: Port, arr: Port) =>
    journeysFromCruise({
      id: "cx",
      cruiseLine: "AIDA",
      startDate: "2025-06-01",
      status: "completed",
      departurePort: dep,
      arrivalPort: arr,
      stops: [],
    } as CruiseLegSource)[0];

  it("shows Copenhagen → Kiel, with no DKCPH / DEKEL beside them", () => {
    const j = leg(
      coded(1, "Copenhagen", "DKCPH", 55.68, 12.6),
      coded(2, "Kiel", "DEKEL", 54.3, 10.1)
    );
    expect(j.dep).toMatchObject({ name: "Copenhagen", code: null });
    expect(j.arr).toMatchObject({ name: "Kiel", code: null });
  });

  it("falls back to the code only where the port has no name", () => {
    const j = leg(coded(1, " ", "DKCPH", 55.68, 12.6), coded(2, "Kiel", "DEKEL", 54.3, 10.1));
    expect(j.dep.name).toBe("DKCPH");
  });
});
