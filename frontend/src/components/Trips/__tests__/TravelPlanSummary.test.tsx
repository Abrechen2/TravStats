import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { planFixture } from "../../../pages/TravPlan/__tests__/planFixture";

const mocks = vi.hoisted(() => ({ get: vi.fn(), capabilities: vi.fn() }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: { get: mocks.get, capabilities: mocks.capabilities },
}));
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "u1" } }),
}));
vi.unmock("../../../store/settingsStore");

import { TravelPlanSummary } from "../TravelPlanSummary";
import { useSettingsStore } from "../../../store/settingsStore";

function renderSummary() {
  return render(
    <MemoryRouter>
      <TravelPlanSummary tripId="trip-one" />
    </MemoryRouter>
  );
}

/** The trip page linked into `/plan/...` for everyone, gate or no gate. */
describe("TravelPlanSummary", () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(planFixture("trip-one"));
    mocks.capabilities.mockReset().mockResolvedValue({ enabled: true });
  });

  it("links into the plan while the TravPlan beta switch is on", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    renderSummary();
    expect(await screen.findByRole("link", { name: "continue" })).toHaveAttribute(
      "href",
      "/plan/trip-one/overview"
    );
  });

  it("draws nothing and asks for nothing while the switch is off", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    const { container } = renderSummary();
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  // Owner, 2026-10-27: an account that switched TravPlan off sees no way into it.
  it("draws nothing and asks for no plan while the account has TravPlan off", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    mocks.capabilities.mockResolvedValue({
      enabled: false,
      instanceEnabled: true,
      userEnabled: false,
    });
    const { container } = renderSummary();
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
