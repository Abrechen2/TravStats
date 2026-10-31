import { describe, it, expect, vi } from "vitest";
import { buildEditFormData } from "../editFormModel";
import type { Flight } from "../../../types";

// A favourite airline IS set; the edit model must not look at it.
vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: Object.assign(
    <T>(select: (s: unknown) => T): T => select({ defaults: { favoriteAirline: "Condor" } }),
    { getState: () => ({ defaults: { favoriteAirline: "Condor" } }) }
  ),
}));

/**
 * forgejo#389: the favourite airline prefills a NEW flight only. Editing a
 * stored flight must show what is stored, a blank airline included.
 */
describe("edit form ignores the favourite airline default", () => {
  const flight = (airline: string | null): Flight =>
    ({
      id: "f1",
      airline,
      status: "flown",
      depIata: "FRA",
      arrIata: "JFK",
      departureTime: "2026-07-01T10:00:00.000Z",
      arrivalTime: "2026-07-01T18:00:00.000Z",
    }) as unknown as Flight;

  it("keeps a blank stored airline blank", () => {
    expect(buildEditFormData(flight(null)).airline).toBe("");
    expect(buildEditFormData(flight("")).airline).toBe("");
  });

  it("shows the stored airline, not the favourite", () => {
    expect(buildEditFormData(flight("Lufthansa")).airline).toBe("Lufthansa");
  });
});
