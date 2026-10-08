import { describe, expect, it } from "vitest";
import { railDeleteMessage } from "../railDeleteMessage";

/** forgejo#250 — the rail delete question names what goes and what stays. */
const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key} ${JSON.stringify(options)}` : key;

const ride = {
  depStationName: "Frankfurt",
  arrStationName: "Fulda",
  bookingId: null as string | null,
  trip: null as { name: string } | null,
};

describe("railDeleteMessage", () => {
  it("names the ride by its route, and nothing else for a lone ride", () => {
    expect(railDeleteMessage(t, ride, { documentCount: 0, otherLegs: null })).toBe(
      'rail:deleteConfirmNamed {"route":"Frankfurt → Fulda"}'
    );
  });

  it("adds the originals that go with it, once counted", () => {
    const message = railDeleteMessage(t, ride, { documentCount: 2, otherLegs: null });
    expect(message).toContain('documents:deleteCascadeNote {"count":2}');
    // Not counted yet: the base sentence, never "no documents".
    expect(railDeleteMessage(t, ride, { documentCount: null, otherLegs: null })).not.toContain(
      "deleteCascadeNote"
    );
  });

  it("says the trip and the booking's other trains stay, counted where known", () => {
    const message = railDeleteMessage(
      t,
      { ...ride, bookingId: "b1", trip: { name: "Rhön" } },
      { documentCount: null, otherLegs: 2 }
    );
    expect(message).toContain("common:delete.survivors");
    expect(message).toContain('rail:deleteSurvivors.trip {\\"name\\":\\"Rhön\\"}');
    expect(message).toContain('rail:deleteSurvivors.otherLegs {\\"count\\":2}');
  });

  it("names a booking's other trains in general terms where it cannot count them", () => {
    const message = railDeleteMessage(
      t,
      { ...ride, bookingId: "b1" },
      { documentCount: null, otherLegs: null }
    );
    expect(message).toContain("rail:deleteSurvivors.bookingLegs");
  });

  it("says nothing about other trains of a booking that has none left", () => {
    const message = railDeleteMessage(
      t,
      { ...ride, bookingId: "b1" },
      { documentCount: null, otherLegs: 0 }
    );
    expect(message).not.toContain("common:delete.survivors");
  });
});
