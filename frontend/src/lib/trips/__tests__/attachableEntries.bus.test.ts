import { beforeEach, describe, expect, it, vi } from "vitest";

const listAll = vi.fn();
const update = vi.fn();
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
    const load = await loadAttachableEntries("bus");
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
