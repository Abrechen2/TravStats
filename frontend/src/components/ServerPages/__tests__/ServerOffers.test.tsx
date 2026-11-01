import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServerOffers from "../ServerOffers";
import { resetInstanceStore } from "../instanceStore";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { httpError, instance } from "./fixtures";

const api = vi.hoisted(() => ({
  getInstanceSettings: vi.fn(),
  updateInstanceSettings: vi.fn(),
  getImportMode: vi.fn(),
  setImportMode: vi.fn(),
  getUsers: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ adminApi: api }));
const plan = vi.hoisted(() => ({ config: vi.fn(), setConfig: vi.fn() }));
vi.mock("../../../lib/api/travplan", () => ({ travplanApi: plan }));
const track = vi.hoisted(() => ({ config: vi.fn(), setConfig: vi.fn() }));
vi.mock("../../../lib/api/travtrack", () => ({ travTrackApi: track }));
vi.mock("../../Admin/BetaFeatureList", () => ({ default: () => null }));
vi.unmock("../../../store/settingsStore");

const status = { usable: false, reason: null };
const answer = (over = {}) => ({ settings: instance(over), passkeyStatus: status });

beforeEach(() => {
  vi.clearAllMocks();
  resetInstanceStore();
  useSettingsLevelStore.setState({ level: "expert" });
  useSettingsStore.setState({ betaFeaturesEnabled: true });
  api.getInstanceSettings.mockResolvedValue(answer({ betaFeaturesEnabled: true }));
  api.getImportMode.mockResolvedValue({ until: null, userId: null, hours: 24 });
  api.getUsers.mockResolvedValue({ users: [{ id: "u1", username: "jonas", isActive: true }] });
  track.config.mockResolvedValue({ enabled: false });
  plan.config.mockResolvedValue({ enabled: true, aiDailyLimit: 10, weatherDailyLimit: 20 });
});
afterEach(() => {
  cleanup();
  useSettingsLevelStore.setState({ level: null });
});

describe("Server › Was der Server anbietet", () => {
  it("keeps the choice and offers a retry when the beta switch cannot be saved", async () => {
    api.updateInstanceSettings.mockRejectedValue(httpError());
    render(<ServerOffers />);
    const beta = await screen.findByRole("switch", { name: "settingsRows:server.beta.t" });
    expect(beta).toHaveAttribute("aria-checked", "true");
    await userEvent.click(beta);
    expect(beta).toHaveAttribute("aria-checked", "false");
    await waitFor(
      () => expect(screen.getByText(/settings:blocks.save.failed/)).toBeInTheDocument(),
      { timeout: 3000 }
    );
    // The user's choice is still on screen after the failure.
    expect(beta).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "settings:blocks.save.retry" })).toBeInTheDocument();
  });

  it("locks TravTrack with the reason and a jump while the beta switch is off", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    api.getInstanceSettings.mockResolvedValue(answer({ betaFeaturesEnabled: false }));
    render(<ServerOffers />);
    const track = await screen.findByRole("switch", { name: "settingsRows:server.ttoffer.t" });
    expect(track).toBeDisabled();
    expect(track).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText("settingsRows:server.deps.needsBeta").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /needsBetaJump/ }).length).toBeGreaterThan(0);
  });

  it("refuses planning limits above the maximum with a number, and keeps Speichern off", async () => {
    render(<ServerOffers />);
    const ai = await screen.findByLabelText("settingsRows:server.limit.ai");
    await userEvent.clear(ai);
    await userEvent.type(ai, "500");
    expect(screen.getByText("settingsRows:server.errors.limit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" })).toBeDisabled();
  });

  it("keeps the typed limit and says so when the planning limits are refused", async () => {
    plan.setConfig.mockRejectedValue(httpError(500));
    render(<ServerOffers />);
    const ai = await screen.findByLabelText("settingsRows:server.limit.ai");
    await userEvent.clear(ai);
    await userEvent.type(ai, "40");
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(document.querySelector('[data-group-state="failed"]')).toHaveTextContent(
        "settings:blocks.save.failed"
      )
    );
    expect(ai).toHaveValue(40);
  });

  it("says the module switches could not be read, instead of drawing them off", async () => {
    track.config.mockRejectedValue(httpError());
    render(<ServerOffers />);
    expect(await screen.findByText("settingsRows:server.offersLoadFailed")).toBeInTheDocument();
  });

  it("reports a refused import mode and leaves it off", async () => {
    api.setImportMode.mockRejectedValue(httpError(500));
    render(<ServerOffers />);
    await userEvent.click(
      await screen.findByRole("radio", { name: "settingsRows:server.importMode.all" })
    );
    expect(await screen.findByText("admin:importMode.saveFailed")).toBeInTheDocument();
  });
});
