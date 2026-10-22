import { beforeEach, describe, expect, it, vi } from "vitest";

const listAll = vi.fn();
const update = vi.fn();
const railListAll = vi.fn();
vi.mock("../../api/rail", () => ({
  railApi: { listAll: (...a: unknown[]) => railListAll(...a) },
}));
vi.mock("../../api/bus", () => ({
  busApi: {
    listAll: (...a: unknown[]) => listAll(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));

import { ATTACHABLE_DOMAINS, attachEntry, loadAttachableEntries } from "../attachableEntries";
import type { BusJourney } from "../../../types/bus";

const ride = {
  id: "b-1",
  operator: "FlixBus",
  lineName: "N17",
  depStationName: "Tallinn Bus Terminal",
  arrStationName: "Riga Coach Terminal",
  departureTime: "2026-08-03T07:30:00.000Z",
  depTimezone: "Europe/Tallinn",
  arrivalTime: null,
  arrTimezone: "Europe/Riga",
  tripId: "trip-1",
} as BusJourney;

beforeEach(() => vi.clearAllMocks());

describe("bus in the add-existing picker", () => {
  it("offers the bus domain", () => {
    expect(ATTACHABLE_DOMAINS).toContain("bus");
  });

  it("maps a ride to an entry: terminals as title, operator and line as subtitle, the local day", async () => {
    listAll.mockResolvedValue([ride]);
    const load = await loadAttachableEntries("bus", (n) => `Zug ${n}`);
    expect(load.unlinkable).toBe(0);
    expect(load.entries).toEqual([
      {
        domain: "bus",
        id: "b-1",
        title: "Tallinn Bus Terminal → Riga Coach Terminal",
        subtitle: "FlixBus · N17",
        day: "2026-08-03",
        endDay: null,
        tripId: "trip-1",
      },
    ]);
  });

  it("files a ride in a trip through the bus write, with the trip and nothing else", async () => {
    update.mockResolvedValue(ride);
    await attachEntry("trip-9", {
      domain: "bus",
      id: "b-1",
      title: "x",
      subtitle: null,
      day: null,
      endDay: null,
      tripId: null,
    });
    expect(update).toHaveBeenCalledWith("b-1", { tripId: "trip-9" });
  });
});

describe("rail in the add-existing picker", () => {
  // Browser test of the bahn.de bookmarklet on 2.7.0-beta.24: a train bahn.de
  // names by number alone read as a bare "57031".
  it("names a train known by its number alone as a train", async () => {
    railListAll.mockResolvedValue([
      {
        id: "r-1",
        operator: "DB Regio",
        trainCategory: null,
        trainNumber: "57031",
        depStationName: "Augsburg Hbf",
        arrStationName: "München Hbf",
        departureTime: "2026-08-03T06:08:00.000Z",
        depTimezone: "Europe/Berlin",
        tripId: null,
      },
    ]);
    const load = await loadAttachableEntries("rail", (n) => `Zug ${n}`);
    expect(load.entries[0].subtitle).toBe("DB Regio · Zug 57031");
  });
});
