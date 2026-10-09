import { describe, expect, it } from "vitest";
import { germanT } from "../../../__tests__/helpers/germanT";
import { busDeleteMessage } from "../busDeleteMessage";

/** forgejo#250 — the bus delete question names what goes and what stays, in the real German copy. */
const t = germanT as unknown as (key: string, options?: Record<string, unknown>) => string;

const ride = {
  depStationName: "Seoul Express",
  arrStationName: "Sokcho",
  companions: [] as string[],
  trip: null as { id: string; name: string; color: string } | null,
};

describe("busDeleteMessage", () => {
  it("names the ride by its route, and nothing else for a lone ride", () => {
    expect(busDeleteMessage(t, ride, 0)).toBe(
      "Die Busfahrt Seoul Express → Sokcho wirklich löschen? Das lässt sich nicht rückgängig machen."
    );
  });

  it("adds the originals that go with it once counted, and says nothing while uncounted", () => {
    expect(busDeleteMessage(t, ride, 2)).toContain("Dazu 2 Dokumente, die mit gelöscht werden.");
    expect(busDeleteMessage(t, ride, null)).not.toContain("Dokument");
  });

  it("says the trip and the travel companions stay", () => {
    const message = busDeleteMessage(
      t,
      {
        ...ride,
        trip: { id: "t1", name: "Korea 2026", color: "#fff" },
        companions: ["Mina", "Jae"],
      },
      null
    );
    expect(message.split("\n").pop()).toBe("Erhalten bleiben: Reise „Korea 2026“, 2 Mitreisende");
  });

  it("names one companion in the singular", () => {
    expect(busDeleteMessage(t, { ...ride, companions: ["Mina"] }, null)).toContain(
      "Erhalten bleiben: 1 mitreisende Person"
    );
  });
});
