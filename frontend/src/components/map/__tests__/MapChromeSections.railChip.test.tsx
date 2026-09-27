import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The "Alle" map's domain chips offer rail only where rail is shown at all:
 * its beta switch AND the user's domain (owner rule 2026-09-25).
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
const railVisible = vi.hoisted(() => ({ value: true }));
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => railVisible.value }));

import { MapChromeSections } from "../MapChromeSections";

describe("MapChromeSections: the rail chip", () => {
  beforeEach(() => {
    railVisible.value = true;
  });

  it("is offered where rail is visible", () => {
    render(<MapChromeSections />);
    expect(screen.getByRole("button", { name: "common:domain.rail" })).toBeInTheDocument();
  });

  it("is not offered while rail sits behind its beta switch", () => {
    railVisible.value = false;
    render(<MapChromeSections />);
    expect(screen.queryByRole("button", { name: "common:domain.rail" })).toBeNull();
    expect(screen.getByRole("button", { name: "common:domain.flight" })).toBeInTheDocument();
  });
});
