import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { planFixture } from "../../../pages/TravPlan/__tests__/planFixture";

const mocks = vi.hoisted(() => ({ get: vi.fn(), capabilities: vi.fn(), create: vi.fn() }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: { get: mocks.get, capabilities: mocks.capabilities, create: mocks.create },
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

  describe("a trip without a plan", () => {
    beforeEach(() => useSettingsStore.setState({ betaFeaturesEnabled: true }));

    it("offers 'plan this trip' and creates the plan on that very trip", async () => {
      mocks.get.mockRejectedValueOnce({
        response: { status: 404, data: { code: "PLAN_NOT_FOUND" } },
      });
      mocks.create.mockResolvedValueOnce(planFixture("trip-one"));
      render(
        <MemoryRouter initialEntries={["/trips/trip-one"]}>
          <Routes>
            <Route path="/trips/:id" element={<TravelPlanSummary tripId="trip-one" />} />
            <Route path="/plan/:id/overview" element={<p>plan page</p>} />
          </Routes>
        </MemoryRouter>
      );
      await userEvent.click(await screen.findByRole("button", { name: "planThis.action" }));
      expect(mocks.create).toHaveBeenCalledWith("newTrip", {}, "trip-one");
      expect(await screen.findByText("plan page")).toBeInTheDocument();
    });

    it("offers nothing when the plan could not be read for another reason", async () => {
      mocks.get.mockRejectedValueOnce({ response: { status: 500, data: {} } });
      const { container } = renderSummary();
      await act(async () => undefined);
      expect(container).toBeEmptyDOMElement();
    });

    it("says why creating the plan failed and stays on the trip", async () => {
      mocks.get.mockRejectedValueOnce({
        response: { status: 404, data: { code: "PLAN_NOT_FOUND" } },
      });
      mocks.create.mockRejectedValueOnce({
        response: { status: 403, data: { code: "PLAN_DISABLED" } },
      });
      renderSummary();
      await userEvent.click(await screen.findByRole("button", { name: "planThis.action" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("errors.PLAN_DISABLED");
    });
  });
});
