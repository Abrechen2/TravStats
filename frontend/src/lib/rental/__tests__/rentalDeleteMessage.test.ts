import { describe, expect, it } from "vitest";
import { rentalDeleteMessage } from "../rentalDeleteMessage";
import { makeRental } from "../../../components/rental/__tests__/rentalFixture";

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}${JSON.stringify(options)}` : key;

describe("rentalDeleteMessage", () => {
  it("names the rental by provider and station, and says nothing more when nothing else is involved", () => {
    expect(rentalDeleteMessage(t, makeRental(), 0)).toBe(
      'rental:deleteConfirmNamed{"provider":"Testcar","where":"Frankfurt Flughafen"}'
    );
  });

  it("names both stations of a one-way rental", () => {
    const message = rentalDeleteMessage(
      t,
      makeRental({ oneWay: true, returnStationName: "München Flughafen" }),
      null
    );
    expect(message).toContain("Frankfurt Flughafen → München Flughafen");
  });

  it("adds the documents that go and the trip, roadtrip and companions that stay", () => {
    const message = rentalDeleteMessage(
      t,
      makeRental({
        trip: { id: "t", name: "Bayern", color: "#fff" },
        route: { id: "r", name: null },
        companions: ["A", "B"],
      }),
      3
    );
    const [, documents, survivors] = message.split("\n");
    expect(documents).toBe('documents:deleteCascadeNote{"count":3}');
    expect(survivors).toContain("rental:deleteSurvivors.trip");
    expect(survivors).toContain("rental:detail.roadtripUnnamed");
    expect(survivors).toContain('rental:deleteSurvivors.companions{\\"count\\":2}');
  });

  it("does not guess documents while their count is unknown", () => {
    expect(rentalDeleteMessage(t, makeRental(), null)).not.toContain("documents:");
  });
});
