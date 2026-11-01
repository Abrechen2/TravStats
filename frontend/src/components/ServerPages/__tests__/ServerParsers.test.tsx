import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ServerParsers from "../ServerParsers";
import { httpError } from "./fixtures";

const api = vi.hoisted(() => ({
  getAdminParserSettings: vi.fn(),
  updateAdminParserSettings: vi.fn(),
  testOllamaConnection: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ adminApi: api }));
const services = vi.hoisted(() => ({ adminOverview: vi.fn() }));
vi.mock("../../../lib/api/externalServices", () => ({ externalServicesApi: services }));
vi.mock("../../../hooks/useHasLlm", () => ({ resetHasLlmCache: vi.fn() }));

const parser = (over = {}) => ({
  allowUserApiKeys: false,
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
  api.getAdminParserSettings.mockResolvedValue(parser());
  services.adminOverview.mockResolvedValue(overview);
});
afterEach(cleanup);

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
      "/settings/services#gemini"
    );
  });

  it("names an unreachable Ollama and a missing model, never the server's own text", async () => {
    renderIt();
    const check = await screen.findByRole("button", { name: "settingsRows:server.parsers.check" });
    api.testOllamaConnection.mockResolvedValueOnce({
      success: false,
      error: "ECONNREFUSED 10.0.0.5",
    });
    await userEvent.click(check);
    expect(
      await screen.findByText("settingsRows:server.parsers.test_unreachable")
    ).toBeInTheDocument();
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();

    api.testOllamaConnection.mockResolvedValueOnce({ success: true, warning: "model missing" });
    await userEvent.click(check);
    expect(await screen.findByText("settingsRows:server.parsers.testNoModel")).toBeInTheDocument();

    api.testOllamaConnection.mockRejectedValueOnce(httpError());
    await userEvent.click(check);
    expect(await screen.findByText("settingsRows:server.parsers.test_failed")).toBeInTheDocument();
  });

  it("locks the check with its reason while no Ollama is set up", async () => {
    api.getAdminParserSettings.mockResolvedValue(parser({ ollamaUrl: null, ollamaModel: null }));
    renderIt();
    expect(await screen.findByText("settingsRows:server.parsers.noOllama")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "settingsRows:server.parsers.check" })
    ).toBeDisabled();
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
});
