import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { planFixture } from "../../../pages/TravPlan/__tests__/planFixture";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/travplan", () => ({ travplanApi: { get: mocks.get } }));
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
});
