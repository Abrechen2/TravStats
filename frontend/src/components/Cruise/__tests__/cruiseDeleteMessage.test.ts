import { describe, it, expect } from "vitest";
import { cruiseDeleteMessage } from "../cruiseDeleteMessage";
import type { Cruise } from "../../../types";

/**
 * forgejo#250: the delete question names what goes (the port calls, the
 * originals filed with the cruise) and what stays (its trip, by name) — the
 * same sentence on the list and on the detail page.
 */
const t = (key: string, o?: Record<string, unknown>): string =>
  o
    ? `${key}(${Object.entries(o)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(",")})`
    : key;

const cruise = (extra: Partial<Cruise>): Cruise =>
  ({
    id: "c1",
    ship: null,
    shipNameOverride: "AIDAsol",
    tripId: null,
    trip: null,
    stops: [
      { isAtSea: false, portId: 1 },
      { isAtSea: true, portId: null },
      { isAtSea: false, portId: null, unresolvedPortName: "Colón" },
    ],
    ...extra,
  }) as unknown as Cruise;

describe("cruiseDeleteMessage", () => {
  it("counts the port calls, names the documents and the trip that stays", () => {
    const message = cruiseDeleteMessage(
      t,
      cruise({ tripId: "t1", trip: { id: "t1", name: "Norwegen 2026", color: "#fff" } }),
      2
    );
    const [what, documents, survivors] = message.split("\n");
    expect(what).toBe("cruise:detail.deleteConfirmMessage(name=AIDAsol,count=2)");
    expect(documents).toBe("documents:deleteCascadeNote(count=2)");
    expect(survivors).toBe(
      "common:delete.survivors(names=cruise:deleteSurvivors.trip(name=Norwegen 2026))"
    );
  });

  it("says nothing stays when the cruise is on no trip, and waits for the document count", () => {
    const message = cruiseDeleteMessage(t, cruise({ stops: [] }), null);
    expect(message).toBe("cruise:detail.deleteConfirmMessageNoStops(name=AIDAsol)");
  });

  it("still says a trip stays when only its id is known", () => {
    const message = cruiseDeleteMessage(t, cruise({ tripId: "t1", trip: null }), 0);
    expect(message.split("\n")[1]).toBe(
      "common:delete.survivors(names=cruise:deleteSurvivors.tripUnnamed)"
    );
  });
});
