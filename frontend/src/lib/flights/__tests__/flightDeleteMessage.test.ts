import { describe, it, expect } from "vitest";
import { flightDeleteMessage } from "../flightDeleteMessage";

const t = (k: string, o?: Record<string, unknown>): string => (o ? `${k} ${JSON.stringify(o)}` : k);

/** forgejo#250 — what goes and what stays, by name. */
describe("flightDeleteMessage", () => {
  it("names only the flight when nothing hangs off it", () => {
    expect(flightDeleteMessage(t, { name: "LH1", tripName: null, booking: null }, 0)).toBe(
      'flights:table.deleteConfirm.message {"name":"LH1"}'
    );
  });

  it("counts the documents that go, and names the trip and booking that stay", () => {
    const message = flightDeleteMessage(
      t,
      { name: "LH1", tripName: "Herbst", booking: { pnr: "ABC123", otherFlights: 2 } },
      3
    );
    const lines = message.split("\n");
    expect(lines[0]).toBe('flights:table.deleteConfirm.message {"name":"LH1"}');
    expect(lines[1]).toBe('documents:deleteCascadeNote {"count":3}');
    expect(lines[2]).toContain("common:delete.survivors");
    expect(lines[2]).toContain('flights:deleteSurvivors.trip {\\"name\\":\\"Herbst\\"}');
    expect(lines[2]).toContain(
      'flights:deleteSurvivors.bookingWithFlights {\\"pnr\\":\\"ABC123\\",\\"count\\":2}'
    );
  });

  it("does not claim other flights it has not counted", () => {
    const message = flightDeleteMessage(
      t,
      { name: "LH1", tripName: "", booking: { pnr: null, otherFlights: null } },
      null
    );
    expect(message).toContain("flights:deleteSurvivors.tripUnnamed");
    expect(message).toContain("flights:deleteSurvivors.bookingMaybe");
    expect(message).not.toContain("documents:deleteCascadeNote");
  });
});
