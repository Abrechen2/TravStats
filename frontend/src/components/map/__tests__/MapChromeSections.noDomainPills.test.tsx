import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The map-options panel offers no domain pills (owner, 2026-09-28). Domain
 * visibility has one owner — the "Domänen · x/y" filter on the map — and a
 * second control here could contradict it. This used to check that the rail
 * pill hid behind its beta switch; the pill is gone, so the claim worth
 * guarding is that none of them comes back.
 */
vi.mock("../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "all", mode: "globe", setTab: vi.fn(), setMode: vi.fn() }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging", "poi", "rail"],
    isEnabled: () => true,
  }),
}));
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => true }));

import { MapChromeSections } from "../MapChromeSections";

describe("MapChromeSections: no domain pills", () => {
  it("renders no domain button, not even with every domain enabled and rail visible", () => {
    render(<MapChromeSections />);
    const domainButtons = screen
      .queryAllByRole("button")
      .filter((button) => /common:domain\./.test(button.textContent ?? ""));
    expect(domainButtons).toHaveLength(0);
  });

  it("still renders the year filter the panel kept", () => {
    render(<MapChromeSections />);
    expect(screen.getByText("dashboard:filter.allYears")).toBeInTheDocument();
  });
});
