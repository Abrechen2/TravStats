import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { CompanionTogether } from "../../../../lib/api/companions";

const { together } = vi.hoisted(() => ({ together: vi.fn() }));
vi.mock("../../../../lib/api/companions", () => ({ companionsApi: { together } }));

import CompanionsTogetherSection from "../CompanionsTogetherSection";
import { evidenceOpenedBy } from "../../__tests__/evidenceKeysOpened";
import { expectNoNestedTriggers } from "../../__tests__/noNestedTriggers";

const ben: CompanionTogether = {
  id: "b1",
  name: "Ben",
  entries: 4,
  perKind: { flight: 2, trip: 1, rail: 1, cruise: 0 },
  days: 8,
  countries: 1,
  lastTogether: "2025-05-08",
  flightKm: 3400,
  firstJourney: { day: "2025-05-01", kind: "flight", id: "f1", href: "/flights/f1" },
  lastJourney: { day: "2025-05-08", kind: "flight", id: "f2", href: "/flights/f2" },
};
const dana: CompanionTogether = {
  id: "d1",
  name: "Dana",
  entries: 1,
  perKind: { flight: 0, trip: 1, rail: 0, cruise: 0 },
  days: 8,
  countries: null,
  lastTogether: "2025-05-08",
  flightKm: null,
  firstJourney: { day: "2025-05-01", kind: "trip", id: "t1", href: null },
  lastJourney: { day: "2025-05-08", kind: "trip", id: "t1", href: null },
};
const answer = { companions: [ben, dana], kinds: ["flight", "trip", "cruise", "rail"] };

/**
 * "Mit wem unterwegs": every figure opens its own evidence, all time; a
 * country count the server could not derive is said in words, never as 0;
 * a failed load says so.
 */
describe("CompanionsTogetherSection", () => {
  it("opens each figure's evidence, keyed by figure and companion, lifetime-scoped", async () => {
    together.mockResolvedValueOnce(answer);
    const { opened, container } = await evidenceOpenedBy(<CompanionsTogetherSection />, () =>
      screen.findByTestId("companion-together-b1")
    );
    expect(opened.map((o) => o.key)).toEqual([
      "companion:days:b1",
      "companion:entries:b1",
      "companion:flight:b1",
      "companion:trip:b1",
      "companion:rail:b1",
      "companion:countries:b1",
      "companion:days:d1",
      "companion:entries:d1",
      "companion:trip:d1",
    ]);
    for (const o of opened) expect(o.scope).toEqual({ period: "allTime" });
    expectNoNestedTriggers(container);
  });

  it("says a country count it could not derive in words instead of a zero", async () => {
    together.mockResolvedValueOnce(answer);
    render(
      <MemoryRouter>
        <CompanionsTogetherSection />
      </MemoryRouter>
    );
    const row = await screen.findByTestId("companion-together-d1");
    expect(row.textContent).toContain("stats:companionsTogether.countriesUnknown");
  });

  it("says when the figures could not be loaded", async () => {
    together.mockRejectedValueOnce(new Error("down"));
    render(
      <MemoryRouter>
        <CompanionsTogetherSection />
      </MemoryRouter>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "stats:companionsTogether.loadFailed"
    );
  });

  it("shows km and links the first and last journey to their records; no distance says so, not 0", async () => {
    together.mockResolvedValueOnce(answer);
    render(
      <MemoryRouter>
        <CompanionsTogetherSection />
      </MemoryRouter>
    );
    const benRow = await screen.findByTestId("companion-together-b1");
    expect(screen.getByTestId("companion-km-b1").textContent).toContain(
      "companionsTogether.flightKm"
    );
    const links = benRow.querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual(["/flights/f1", "/flights/f2"]);

    const danaRow = screen.getByTestId("companion-together-d1");
    expect(screen.queryByTestId("companion-km-d1")).toBeNull();
    expect(danaRow.textContent).toContain("stats:companionsTogether.flightKmUnknown");
    // A journey with no page of its own is text, not a dead link.
    expect(danaRow.querySelectorAll("a")).toHaveLength(0);
  });

  it("shows the empty state when nobody has a shared entry", async () => {
    together.mockResolvedValueOnce({ companions: [], kinds: ["flight"] });
    render(
      <MemoryRouter>
        <CompanionsTogetherSection />
      </MemoryRouter>
    );
    expect(await screen.findByText("stats:companionsTogether.empty")).toBeTruthy();
  });
});
