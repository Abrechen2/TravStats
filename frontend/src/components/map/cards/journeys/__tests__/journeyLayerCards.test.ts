import { beforeEach, describe, expect, it } from "vitest";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { buildRailMapLayers } from "../../../../Dashboard/tabs/railMapOverlay";
import { buildTerminalRideMapLayers } from "../../../../Dashboard/tabs/terminalRideMapOverlay";
import { buildRentalMapLayers } from "../../../../Dashboard/tabs/rentalMapOverlay";
import { buildBusLayers } from "../../../../Trips/tripBusLayer";
import { createMarkerTooltip } from "../../../markerTooltip";
import { useMapCardSelectionStore } from "../../../../../store/mapCardSelectionStore";
import type { RailJourney } from "../../../../../types/rail";
import type { FerryJourney } from "../../../../../types/ferry";
import type { RentalBooking } from "../../../../../types/rental";
import type { TripBusJourney } from "../../../../../types/bus";

/**
 * forgejo#323: rail, bus, ferry and rental lines drew well and said nothing.
 * These pin that every builder's lines and station dots are pickable, carry
 * the hover summary the tooltip prints, and open the shared map card on click.
 */

const t = (key: string, opts?: Record<string, unknown>): string =>
  opts && "count" in opts ? `${key}:${String(opts.count)}` : key;
const tooltip = createMarkerTooltip(t, "de");

const RIDE = {
  status: "completed",
  depStationName: "Kiel",
  depLat: 54.316,
  depLon: 10.135,
  depCountry: "DE",
  arrStationName: "Oslo",
  arrLat: 59.905,
  arrLon: 10.742,
  arrCountry: "NO",
  geometry: null,
  geometrySource: "straight",
  departureTime: "2024-07-01T12:00:00Z",
  operator: "Color Line",
  distanceKm: 670,
};

function byId(layers: Layer[], suffix: string): Layer {
  const layer = layers.find((l) => l.id.endsWith(suffix));
  if (!layer) throw new Error(`no layer ending in ${suffix}: ${layers.map((l) => l.id).join()}`);
  return layer;
}

function click(layer: Layer, object: unknown, coordinate = [10, 55]): void {
  const onClick = layer.props.onClick as (info: PickingInfo) => void;
  onClick({ object, coordinate, layer } as unknown as PickingInfo);
}

beforeEach(() => useMapCardSelectionStore.setState({ pinned: null, seq: 0 }));

describe('ferry lines and ports (owner: "bei Fähren fehlt es auch")', () => {
  const ferries = [
    { ...RIDE, id: "f1" },
    { ...RIDE, id: "f2", status: "scheduled", departureTime: "2030-07-01T12:00:00Z" },
  ] as unknown as FerryJourney[];
  const layers = buildTerminalRideMapLayers(ferries, "#5686b8", false, "all-ferry", "off", "ferry");

  it("draws pickable lines and a pickable dot per port", () => {
    expect(byId(layers, "-paths").props.pickable).toBe(true);
    const ports = byId(layers, "-terminals");
    expect(ports.props.pickable).toBe(true);
    expect((ports.props.data as unknown[]).length).toBe(2);
  });

  it("hovers both ports with their flags and the travelled/planned tally in the ferry colour", () => {
    const line = byId(layers, "-paths");
    const datum = (line.props.data as unknown[])[0];
    const tip = tooltip({ layer: line, object: datum } as unknown as PickingInfo);
    expect(tip?.html).toContain("Kiel");
    expect(tip?.html).toContain("Oslo");
    expect(tip?.html).toContain("flagcdn"); // both flags, as the airport tooltip has
    expect(tip?.html).toContain("map:journey.times.ferry:1");
    expect(tip?.html).toContain("map:globe.timesPlanned:1");
    expect(tip?.html).toContain('data-domain-icon="ship"');
    expect(tip?.html).toContain("rgb(86,134,184)");
  });

  it("opens the route card with every crossing of the route on click", () => {
    const line = byId(layers, "-paths");
    click(line, (line.props.data as unknown[])[0]);
    const pinned = useMapCardSelectionStore.getState().pinned;
    expect(pinned?.kind).toBe("journeyRoute");
    if (pinned?.kind !== "journeyRoute") return;
    expect(pinned.data.domain).toBe("ferry");
    expect(pinned.data.journeys.map((j) => j.id).sort()).toEqual(["f1", "f2"]);
    expect(pinned.data.color).toEqual([86, 134, 184]);
  });

  it("opens the port card on a port click", () => {
    const ports = byId(layers, "-terminals");
    click(ports, (ports.props.data as unknown[])[0]);
    const pinned = useMapCardSelectionStore.getState().pinned;
    expect(pinned?.kind).toBe("journeyStop");
  });
});

describe("rail", () => {
  it("decorates lines and stations and leaves the station names alone", () => {
    const layers = buildRailMapLayers(
      [{ ...RIDE, id: "r1" }] as unknown as RailJourney[],
      "#a597e8",
      false,
      "dashboard-rail"
    );
    const stations = byId(layers, "-stations");
    const datum = (stations.props.data as unknown[])[0];
    const tip = tooltip({ layer: stations, object: datum } as unknown as PickingInfo);
    expect(tip?.html).toContain("map:journey.stop.rail");
    expect(tip?.html).toContain('data-domain-icon="train-front"');
    expect(byId(layers, "-station-labels").props.onClick).toBeFalsy();
  });
});

describe("rental", () => {
  it("opens a branch card on a one-way rental's pick-up point", () => {
    const rental = {
      ...RIDE,
      id: "c1",
      provider: "Sixt",
      pickupStationName: "Kiel",
      pickupLat: 54.316,
      pickupLon: 10.135,
      returnStationName: "Oslo",
      returnLat: 59.905,
      returnLon: 10.742,
      oneWay: true,
      routeId: null,
    } as unknown as RentalBooking;
    const layers = buildRentalMapLayers([rental], "#d98cb3", false);
    const points = byId(layers, "-points");
    expect(points.props.pickable).toBe(true);
    click(points, (points.props.data as unknown[])[0]);
    expect(useMapCardSelectionStore.getState().pinned?.kind).toBe("journeyStop");
    const links = byId(layers, "-links");
    click(links, (links.props.data as unknown[])[0]);
    expect(useMapCardSelectionStore.getState().pinned?.kind).toBe("journeyRoute");
  });
});

describe("the trip map's bus rides", () => {
  it("were pickable:false and are now pickable, with terminals", () => {
    const layers = buildBusLayers(
      [{ ...RIDE, id: "b1" }] as unknown as TripBusJourney[],
      "#c49a6c"
    );
    expect(byId(layers, "trip-bus-rides").props.pickable).toBe(true);
    expect(byId(layers, "trip-bus-terminals").props.pickable).toBe(true);
  });
});
