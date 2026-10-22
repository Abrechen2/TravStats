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
};
const dana: CompanionTogether = {
  id: "d1",
  name: "Dana",
  entries: 1,
  perKind: { flight: 0, trip: 1, rail: 0, cruise: 0 },
  days: 8,
  countries: null,
  lastTogether: "2025-05-08",
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
});
