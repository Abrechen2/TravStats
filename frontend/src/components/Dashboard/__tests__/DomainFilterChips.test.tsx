import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging", "roadtrip"],
    isEnabled: (k: string) => ["flight", "cruise", "lodging", "roadtrip"].includes(k),
  }),
}));
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => false }));

import DomainFilterChips from "../DomainFilterChips";
import { useDashboardFilterStore } from "../../../store/dashboardFilterStore";

/**
 * Tester 2026-09-26: on the "Alle" tab a domain can only be hidden from the
 * map through a switch buried in the collapsed map panel. The chips now sit
 * on the map itself, one per domain the viewer has, and remember the choice.
 */
describe("DomainFilterChips", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDashboardFilterStore.getState().reset();
  });

  it("offers one pressed chip per domain the viewer has, and no other", () => {
    render(<DomainFilterChips />);
    const group = screen.getByRole("group", { name: "dashboard:filter.domains" });
    const chips = [...group.querySelectorAll("button")];
    expect(chips.map((c) => c.textContent)).toEqual([
      "common:domain.flight",
      "common:domain.cruise",
      "common:domain.lodging",
      "common:domain.roadtrip",
    ]);
    for (const chip of chips) expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("hides a domain from the map on click, and keeps it hidden next visit", () => {
    render(<DomainFilterChips />);
    const cruise = screen.getByRole("button", { name: "common:domain.cruise" });
    fireEvent.click(cruise);
    expect(cruise).toHaveAttribute("aria-pressed", "false");
    expect(useDashboardFilterStore.getState().domains).not.toContain("cruise");
    expect(JSON.parse(window.localStorage.getItem("dashboard.hiddenDomains") ?? "[]")).toContain(
      "cruise"
    );
    fireEvent.click(cruise);
    expect(cruise).toHaveAttribute("aria-pressed", "true");
  });
});
