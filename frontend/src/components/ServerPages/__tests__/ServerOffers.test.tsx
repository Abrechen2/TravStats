import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
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

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
const renderOffers = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

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
  resetWriteQueue();
  useSettingsLevelStore.setState({ level: null });
});

describe("Server › Was der Server anbietet", () => {
  it("keeps the choice and offers a retry when the beta switch cannot be saved", async () => {
    api.updateInstanceSettings.mockRejectedValue(httpError());
    renderOffers(<ServerOffers />);
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
    renderOffers(<ServerOffers />);
    const track = await screen.findByRole("switch", { name: "settingsRows:server.ttoffer.t" });
    expect(track).toBeDisabled();
    expect(track).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText("settingsRows:server.deps.needsBeta").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /needsBetaJump/ }).length).toBeGreaterThan(0);
  });

  it("refuses planning limits above the maximum with a number, and keeps Speichern off", async () => {
    renderOffers(<ServerOffers />);
    const ai = await screen.findByLabelText("settingsRows:server.limit.ai");
    // The draft follows the loaded value one render after the field appears.
    await waitFor(() => expect(ai).toHaveValue(10));
    await userEvent.clear(ai);
    await userEvent.type(ai, "500");
    expect(screen.getByText("settingsRows:server.errors.limit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" })).toBeDisabled();
  });

  it("keeps the typed limit and says so when the planning limits are refused", async () => {
    plan.setConfig.mockRejectedValue(httpError(500));
    renderOffers(<ServerOffers />);
    const ai = await screen.findByLabelText("settingsRows:server.limit.ai");
    // The draft follows the loaded value one render after the field appears.
    await waitFor(() => expect(ai).toHaveValue(10));
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
    renderOffers(<ServerOffers />);
    expect(await screen.findByText("settingsRows:server.offersLoadFailed")).toBeInTheDocument();
  });

  it("lets an admin narrow an import mode that runs for everyone to one account", async () => {
    api.getImportMode.mockResolvedValue({ until: "2999-01-01T00:00:00Z", userId: null, hours: 24 });
    api.setImportMode.mockResolvedValue({ until: "2999-01-01T00:00:00Z", userId: "u1", hours: 24 });
    renderOffers(<ServerOffers />);
    await userEvent.click(
      await screen.findByRole("radio", { name: "settingsRows:server.importMode.one" })
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "admin:importMode.account" }),
      "u1"
    );
    await userEvent.click(screen.getByRole("button", { name: "admin:importMode.start" }));
    await waitFor(() =>
      expect(api.setImportMode).toHaveBeenCalledWith({ enabled: true, userId: "u1" })
    );
  });

  it("reports a refused import mode and leaves it off", async () => {
    api.setImportMode.mockRejectedValue(httpError(500));
    renderOffers(<ServerOffers />);
    await userEvent.click(
      await screen.findByRole("radio", { name: "settingsRows:server.importMode.all" })
    );
    expect(await screen.findByText("admin:importMode.saveFailed")).toBeInTheDocument();
  });
});

describe("Server › Bereitstellung pages (settings v3 S4)", () => {
  it("draws TravTrack's offer alone on its page, without the beta switch or the plan rows", async () => {
    renderOffers(<ServerOffers part="track" />);
    expect(
      await screen.findByRole("switch", { name: "settingsRows:server.ttoffer.t" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "settingsRows:server.beta.t" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "settingsRows:server.tpoffer.t" })).toBeNull();
    expect(screen.queryByLabelText("settingsRows:server.limit.ai")).toBeNull();
  });

  it("draws the plan offer with the AI and weather limits as two rows of their own", async () => {
    renderOffers(<ServerOffers part="plan" />);
    expect(
      await screen.findByRole("switch", { name: "settingsRows:server.tpoffer.t" })
    ).toBeInTheDocument();
    const ai = await screen.findByLabelText("settingsRows:server.limit.ai");
    const weather = await screen.findByLabelText("settingsRows:server.limit.weather");
    expect(ai.closest("[data-setting-row]")).not.toBe(weather.closest("[data-setting-row]"));
    expect(screen.queryByRole("switch", { name: "settingsRows:server.ttoffer.t" })).toBeNull();
  });

  it("leaves both offers off Funktionen, which keeps the beta switch, the country default and the import mode", async () => {
    renderOffers(<ServerOffers part="rest" />);
    expect(
      await screen.findByRole("switch", { name: "settingsRows:server.beta.t" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "settingsRows:server.ttoffer.t" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "settingsRows:server.tpoffer.t" })).toBeNull();
    expect(screen.queryByLabelText("settingsRows:server.limit.ai")).toBeNull();
    expect(await screen.findByText("settingsRows:server.importmodus.t")).toBeInTheDocument();
  });

  it("sends the lock's jump to the page that holds the beta switch, since the offer pages do not draw it", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    api.getInstanceSettings.mockResolvedValue(answer({ betaFeaturesEnabled: false }));
    renderOffers(<ServerOffers part="track" />);
    await userEvent.click(await screen.findByRole("button", { name: /needsBetaJump/ }));
    expect(navigate).toHaveBeenCalledWith("/settings/funktionen?match=beta", undefined);
  });
});
