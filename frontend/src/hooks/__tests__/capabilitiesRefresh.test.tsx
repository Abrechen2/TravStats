import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const plan = vi.hoisted(() => ({
  capabilities: vi.fn(),
  config: vi.fn(),
  setConfig: vi.fn(),
}));
vi.mock("../../lib/api/travplan", async (original) => ({
  ...(await original<typeof import("../../lib/api/travplan")>()),
  travplanApi: plan,
}));
const track = vi.hoisted(() => ({
  capabilities: vi.fn(),
  config: vi.fn(),
  setConfig: vi.fn(),
}));
vi.mock("../../lib/api/travtrack", async (original) => ({
  ...(await original<typeof import("../../lib/api/travtrack")>()),
  travTrackApi: track,
}));

const admin = vi.hoisted(() => ({
  getInstanceSettings: vi.fn(),
  updateInstanceSettings: vi.fn(),
  getImportMode: vi.fn(),
  getUsers: vi.fn(),
}));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof import("../../lib/api")>()),
  adminApi: admin,
}));
vi.mock("../../components/Admin/BetaFeatureList", () => ({ default: () => null }));

const authState = { user: { id: "a1", isAdmin: true } };
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));
vi.unmock("../../store/settingsStore");

import { useTravPlanVisible } from "../useTravPlanVisible";
import { useTravTrackVisible } from "../useTravTrackVisible";
import ServerOffers from "../../components/ServerPages/ServerOffers";
import { resetInstanceStore } from "../../components/ServerPages/instanceStore";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Codex P2 (2026-10-26): flipping a switch in Server › Was der Server anbietet updated only the
 * card. The navigation kept the capabilities it had read at mount, so the
 * TravPlan / TravTrack entry stayed wrong until a reload. A saved switch now
 * makes every capabilities reader ask again — tested here with the nav hook
 * and the switch mounted side by side, and nothing remounted.
 */
function PlanProbe() {
  return <span data-testid="nav">{useTravPlanVisible() ? "shown" : "hidden"}</span>;
}
function TrackProbe() {
  return <span data-testid="nav">{useTravTrackVisible() ? "shown" : "hidden"}</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetInstanceStore();
  useSettingsStore.setState({ betaFeaturesEnabled: true });
  admin.getInstanceSettings.mockResolvedValue({
    settings: { betaFeaturesEnabled: true, countryThreshold: "transited" },
    passkeyStatus: null,
  });
  admin.getImportMode.mockResolvedValue({ until: null, userId: null, hours: 24 });
  admin.getUsers.mockResolvedValue({ users: [] });
  plan.config.mockResolvedValue({ enabled: false, aiDailyLimit: 10, weatherDailyLimit: 20 });
  track.config.mockResolvedValue({ enabled: false });
});

describe("a saved instance switch reaches the navigation without a reload", () => {
  it("TravPlan: the entry appears and disappears as the switch is flipped", async () => {
    let on = false;
    plan.capabilities.mockImplementation(async () => ({ enabled: on }));
    plan.setConfig.mockImplementation(async (body: { enabled: boolean }) => {
      on = body.enabled;
      return { enabled: on, aiDailyLimit: 10, weatherDailyLimit: 20 };
    });
    render(
      <MemoryRouter>
        <PlanProbe />
        <ServerOffers />
      </MemoryRouter>
    );
    await waitFor(() => expect(plan.capabilities).toHaveBeenCalled());
    expect(screen.getByTestId("nav")).toHaveTextContent("hidden");

    const planSwitch = await screen.findByRole("switch", { name: "settingsRows:server.tpoffer.t" });
    await userEvent.click(planSwitch);
    await waitFor(() => expect(screen.getByTestId("nav")).toHaveTextContent("shown"));

    await userEvent.click(planSwitch);
    await waitFor(() => expect(screen.getByTestId("nav")).toHaveTextContent("hidden"));
  });

  it("TravTrack: the entry follows the switch the same way", async () => {
    let on = false;
    track.capabilities.mockImplementation(async () => ({
      enabled: on,
      active: true,
      hasData: true,
    }));
    track.setConfig.mockImplementation(async (body: { enabled: boolean }) => {
      on = body.enabled;
      return { enabled: on };
    });
    render(
      <MemoryRouter>
        <TrackProbe />
        <ServerOffers />
      </MemoryRouter>
    );
    await waitFor(() => expect(track.capabilities).toHaveBeenCalled());
    expect(screen.getByTestId("nav")).toHaveTextContent("hidden");

    await userEvent.click(
      await screen.findByRole("switch", { name: "settingsRows:server.ttoffer.t" })
    );
    await waitFor(() => expect(screen.getByTestId("nav")).toHaveTextContent("shown"));
  });
});
