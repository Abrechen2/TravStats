import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ServerParsers from "../ServerParsers";
import { httpError } from "./fixtures";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";

const api = vi.hoisted(() => ({
  getAdminParserSettings: vi.fn(),
  updateAdminParserSettings: vi.fn(),
  updateGlobalApiKeys: vi.fn(),
  testOllamaConnection: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ adminApi: api }));
const services = vi.hoisted(() => ({ adminOverview: vi.fn() }));
vi.mock("../../../lib/api/externalServices", () => ({ externalServicesApi: services }));
vi.mock("../../../hooks/useHasLlm", () => ({ resetHasLlmCache: vi.fn() }));

const parser = (over = {}) => ({
  allowUserApiKeys: false,
  allowUserFlightApiKeys: false,
  fxCdnFallbackEnabled: false,
  parserOrder: "template_first",
  llmEnabled: true,
  ollamaUrl: "http://ollama:11434",
  ollamaModel: "gemma3:12b",
  llmProviderOrder: ["openai", "anthropic", "google", "custom"],
  ...over,
});
const overview = {
  categories: [
    {
      id: "ai",
      services: [
        { id: "openai", enabled: true, configured: true },
        { id: "anthropic", enabled: true, configured: false },
        { id: "gemini", enabled: false, configured: false },
      ],
    },
  ],
};

const renderIt = () =>
  render(
    <MemoryRouter>
      <ServerParsers />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  // The order, the cloud order, the accounts' keys and the check are the expert rows.
  useSettingsLevelStore.setState({ level: "expert" });
  api.getAdminParserSettings.mockResolvedValue(parser());
  services.adminOverview.mockResolvedValue(overview);
});
afterEach(() => {
  cleanup();
  // A write the last test left open would keep showing its choice in the next.
  resetWriteQueue();
  useSettingsLevelStore.setState({ level: null });
});

describe("Server › Buchungen lesen", () => {
  it("saves the order, the switch and the cloud order as one group and re-reads what is stored", async () => {
    api.updateAdminParserSettings.mockResolvedValue({});
    renderIt();
    await userEvent.click(
      await screen.findByRole("radio", { name: "settingsRows:server.parsers.llmFirst" })
    );
    await userEvent.click((await screen.findAllByRole("button", { name: /server.cloud.down/ }))[0]);
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(api.updateAdminParserSettings).toHaveBeenCalledWith({
        parserOrder: "llm_first",
        llmEnabled: true,
        llmProviderOrder: ["anthropic", "openai", "google", "custom"],
      })
    );
    expect(api.getAdminParserSettings).toHaveBeenCalledTimes(2);
  });

  it("keeps the choice and says the save failed when the server refuses it", async () => {
    api.updateAdminParserSettings.mockRejectedValue(httpError(500));
    renderIt();
    await userEvent.click(
      await screen.findByRole("radio", { name: "settingsRows:server.parsers.llmFirst" })
    );
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(document.querySelector('[data-group-state="failed"]')).toHaveTextContent(
        "settings:blocks.save.failed"
      )
    );
    expect(
      screen.getByRole("radio", { name: "settingsRows:server.parsers.llmFirst" })
    ).toBeChecked();
  });

  it("says when the providers cannot be read, with a retry, instead of an empty chain", async () => {
    services.adminOverview.mockRejectedValueOnce(httpError());
    renderIt();
    expect(await screen.findByText("settingsRows:server.cloud.loadFailed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:server.retry" }));
    expect(await screen.findByTestId("llm-slot-openai")).toBeInTheDocument();
  });

  it("tells a missing key apart from a ready one and points the others to Dienste", async () => {
    renderIt();
    expect(await screen.findByTestId("llm-slot-status-openai")).toHaveTextContent(
      "server.cloud.ready"
    );
    expect(screen.getByTestId("llm-slot-status-anthropic")).toHaveTextContent(
      "server.cloud.missing"
    );
    expect(within(screen.getByTestId("llm-slot-off-google")).getByRole("link")).toHaveAttribute(
      "href",
      "/settings/dienste#gemini"
    );
  });

  it("has no Ollama check of its own: the card's test button on the services page does it (S6)", async () => {
    renderIt();
    await screen.findByText("settingsRows:server.parsers.builtin");
    expect(screen.queryByRole("button", { name: "settingsRows:server.parsers.check" })).toBeNull();
    expect(api.testOllamaConnection).not.toHaveBeenCalled();
  });

  it("offers a retry when the settings cannot be loaded", async () => {
    api.getAdminParserSettings.mockRejectedValueOnce(httpError());
    renderIt();
    expect(await screen.findByText("settingsRows:server.loadFailed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:server.retry" }));
    expect(
      await screen.findByRole("radio", { name: "settingsRows:server.parsers.llmFirst" })
    ).toBeInTheDocument();
  });

  it("shows the known templates and the AI switch at the standard level, the tuning only at expert", async () => {
    useSettingsLevelStore.setState({ level: "standard" });
    renderIt();
    expect(await screen.findByLabelText("settingsRows:server.kiaktiv.t")).toBeInTheDocument();
    expect(screen.getByText("settingsRows:server.builtin.t")).toBeInTheDocument();
    for (const name of ["leserfolge", "cloudorder", "userkeys", "olltest"]) {
      expect(screen.queryByText(`settingsRows:server.${name}.t`), name).toBeNull();
    }
  });

  it("hides the order rows while no AI reads bookings, and brings them back with the switch", async () => {
    api.getAdminParserSettings.mockResolvedValue(parser({ llmEnabled: false }));
    renderIt();
    expect(await screen.findByLabelText("settingsRows:server.kiaktiv.t")).not.toBeChecked();
    expect(screen.queryByText("settingsRows:server.leserfolge.t")).toBeNull();
    await userEvent.click(screen.getByLabelText("settingsRows:server.kiaktiv.t"));
    expect(await screen.findByText("settingsRows:server.leserfolge.t")).toBeInTheDocument();
  });

  describe("Konten dürfen eigene Schlüssel nutzen", () => {
    const switchRow = async () => screen.findByLabelText("settingsRows:server.userkeys.t");

    it("writes the AI half and the flight-data half with ONE switch", async () => {
      api.updateAdminParserSettings.mockResolvedValue({});
      api.updateGlobalApiKeys.mockResolvedValue({});
      api.getAdminParserSettings.mockResolvedValueOnce(parser());
      renderIt();
      await userEvent.click(await switchRow());
      await waitFor(() => {
        expect(api.updateAdminParserSettings).toHaveBeenCalledWith({ allowUserApiKeys: true });
        expect(api.updateGlobalApiKeys).toHaveBeenCalledWith({ allowUserFlightApiKeys: true });
      });
    });

    it("reads as on when either half is on, and says which, so there is always a way to withdraw both", async () => {
      api.getAdminParserSettings.mockResolvedValue(
        parser({ allowUserApiKeys: true, allowUserFlightApiKeys: false })
      );
      api.updateAdminParserSettings.mockResolvedValue({});
      api.updateGlobalApiKeys.mockResolvedValue({});
      renderIt();
      const row = await switchRow();
      expect(row).toHaveAttribute("aria-checked", "true");
      expect(document.querySelector("[data-keys-mixed]")).toHaveTextContent(
        "settingsRows:server.userkeys.mixed"
      );
      // One press withdraws what is still on, in both columns.
      await userEvent.click(row);
      await waitFor(() => {
        expect(api.updateAdminParserSettings).toHaveBeenCalledWith({ allowUserApiKeys: false });
        expect(api.updateGlobalApiKeys).toHaveBeenCalledWith({ allowUserFlightApiKeys: false });
      });
    });

    it("says nothing about halves when both agree", async () => {
      api.getAdminParserSettings.mockResolvedValue(
        parser({ allowUserApiKeys: true, allowUserFlightApiKeys: true })
      );
      renderIt();
      expect(await switchRow()).toHaveAttribute("aria-checked", "true");
      expect(document.querySelector("[data-keys-mixed]")).toBeNull();
      cleanup();
      api.getAdminParserSettings.mockResolvedValue(
        parser({ allowUserApiKeys: false, allowUserFlightApiKeys: false })
      );
      renderIt();
      expect(await switchRow()).toHaveAttribute("aria-checked", "false");
      expect(document.querySelector("[data-keys-mixed]")).toBeNull();
    });

    it("takes the AI half back when the flight-data half is refused, so the switch never governs half", async () => {
      api.updateAdminParserSettings.mockResolvedValue({});
      api.updateGlobalApiKeys.mockRejectedValue(httpError(500));
      renderIt();
      await userEvent.click(await switchRow());
      await waitFor(() =>
        expect(api.updateAdminParserSettings).toHaveBeenLastCalledWith({ allowUserApiKeys: false })
      );
      expect(api.updateAdminParserSettings).toHaveBeenCalledTimes(2);
    });
  });
});
