import { describe, it, expect } from "vitest";
import { createCruisePortsLayer } from "./cruisePortsLayer";
import type { Cruise } from "../../types";

function makeStop(
  dayNumber: number,
  port: { id: number; lat: number; lon: number; name: string; country: string | null; city: string | null }
): Cruise["stops"][number] {
  const base = {
    id: `s${dayNumber}`,
    cruiseId: "c1",
    portId: port.id,
    port: {
      id: port.id,
      name: port.name,
      city: port.city,
      country: port.country,
      unlocode: null,
      lat: port.lat,
      lon: port.lon,
      timezone: null,
      region: null,
      isUserAdded: false,
    },
    dayNumber,
    isAtSea: false,
    arrivalTime: null,
    departureTime: null,
    excursionNote: null,
  };
  return base as Cruise["stops"][number];
}

function makeCruise(stops: Cruise["stops"]): Cruise {
  return {
    id: "c1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA Cruises",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: null,
    endDate: null,
    status: "scheduled",
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
    stops,
    createdAt: "",
    updatedAt: "",
  };
}

describe("createCruisePortsLayer", () => {
  it("carries country/city onto the port dot layer data", () => {
    const cruise = makeCruise([
      makeStop(1, { id: 1, lat: 41.9, lon: 12.45, name: "Civitavecchia", country: "IT", city: "Civitavecchia" }),
      makeStop(2, { id: 2, lat: 37.98, lon: 23.72, name: "Piraeus", country: "GR", city: "Athens" }),
    ]);
    const layers = createCruisePortsLayer([cruise]);
    expect(layers).not.toBeNull();
    const dotLayer = layers!.find((l) => l.id === "cruise-ports");
    expect(dotLayer).toBeDefined();
    const data = (dotLayer as { props: { data: unknown } }).props.data as Array<{
      name: string;
      country: string | null;
      city: string | null;
    }>;
    const civitavecchia = data.find((d) => d.name === "Civitavecchia");
    expect(civitavecchia).toMatchObject({ country: "IT", city: "Civitavecchia" });
  });
});
