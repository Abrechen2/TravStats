import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The "Alle" map's domain chips offer rail only where rail is shown at all:
 * its beta switch AND the user's domain (owner rule 2026-09-25). The chips
 * moved out of the map panel onto the map (tester 2026-09-26), the rule with them.
 */
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging", "poi", "rail"],
    isEnabled: () => true,
  }),
}));
const railVisible = vi.hoisted(() => ({ value: true }));
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => railVisible.value }));

import DomainFilterChips from "../DomainFilterChips";

describe("DomainFilterChips: the rail chip", () => {
  beforeEach(() => {
    railVisible.value = true;
  });

  it("is offered where rail is visible", () => {
    render(<DomainFilterChips />);
    expect(screen.getByRole("button", { name: "common:domain.rail" })).toBeInTheDocument();
  });

  it("is not offered while rail sits behind its beta switch", () => {
    railVisible.value = false;
    render(<DomainFilterChips />);
    expect(screen.queryByRole("button", { name: "common:domain.rail" })).toBeNull();
    expect(screen.getByRole("button", { name: "common:domain.flight" })).toBeInTheDocument();
  });
});
