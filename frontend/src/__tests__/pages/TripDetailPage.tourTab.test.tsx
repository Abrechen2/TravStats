import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { TabBar } from "../../pages/TripDetailPage";

/**
 * Auditor 3, 2026-09-19: the trip page's "Touren" tab still carried a
 * hard-coded "Beta" pill, as the dashboard tab strip did. `config/betaFeatures.ts`
 * holds exactly one key (`devicePairing`), and the 2.7.0 announcement tells
 * readers that tours have shipped — so the badge contradicted both the
 * registry and the release notes.
 *
 * The registry is the list: a badge written into a component instead is a
 * badge no un-gating can ever remove, because nothing knows it is there.
 */
const mockToursVisible = vi.hoisted(() => vi.fn(() => true));
// Tours sit behind the roadtrips beta key since 2026-09-24; this suite is
// about what the component does once they are visible.
vi.mock("../../hooks/useToursVisible", () => ({
  useToursVisible: () => mockToursVisible(),
  useToursAccess: () => (mockToursVisible() ? "allowed" : "denied"),
}));

describe("the trip page's tab strip", () => {
  it("draws no Beta badge on the Touren tab", () => {
    render(
      <MemoryRouter>
        <TabBar tab="overview" onChange={vi.fn()} t={(key: string) => key} />
      </MemoryRouter>
    );

    expect(screen.getByRole("tab", { name: "trips:detail.tabs.tours" })).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("offers no Touren tab while tours are behind the closed beta switch (2026-09-24)", () => {
    mockToursVisible.mockReturnValue(false);
    render(
      <MemoryRouter>
        <TabBar tab="overview" onChange={vi.fn()} t={(key: string) => key} />
      </MemoryRouter>
    );

    expect(screen.queryByRole("tab", { name: "trips:detail.tabs.tours" })).toBeNull();
    mockToursVisible.mockReturnValue(true);
  });
});
