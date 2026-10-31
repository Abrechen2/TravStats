import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import adminDe from "../../../i18n/resources/de/admin.json";

function resolve(bundle: unknown, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const raw = resolve(adminDe, key.replace(/^admin:/, ""));
      return typeof raw === "string" ? raw : key;
    },
  }),
}));
// The cloud chain loads the services' status; it has its own tests.
vi.mock("../LlmProviderSettings", () => ({ default: () => null }));
vi.mock("../../Settings/frame/useExpertRows", () => ({ useExpertRows: () => true }));
const api = vi.hoisted(() => ({ listOllamaModels: vi.fn(), pullOllamaModel: vi.fn() }));
vi.mock("../../../lib/api", () => ({ adminApi: api }));

import ParserSettings from "../ParserSettings";

/**
 * The Ollama model placeholders, the loading line and the model download
 * (button, progress, outcome) were English literals in the German UI.
 */
const renderParser = () =>
  render(
    <ParserSettings
      parserSettings={{
        allowUserApiKeys: true,
        fxCdnFallbackEnabled: true,
        ollamaUrl: "http://ollama.lan:11434",
        ollamaModel: null,
      }}
      savingParsers={false}
      onSave={vi.fn()}
      onParserSettingsChange={vi.fn()}
      onTestOllama={vi.fn()}
      ollamaTestState={{ status: "idle" }}
    />,
    { wrapper: MemoryRouter }
  );

describe("ParserSettings — Ollama model copy", () => {
  it("speaks German for the empty model list and the download block", async () => {
    api.listOllamaModels.mockResolvedValue({ success: true, models: [] });
    renderParser();
    const o = adminDe.parserSettings.ollama;
    await waitFor(() =>
      expect(screen.getByPlaceholderText(o.noModelsPlaceholder)).toBeInTheDocument()
    );
    expect(screen.getByText(o.pull.title)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(o.pull.placeholder)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: o.pull.action })).toBeDisabled();
    expect(screen.queryByText("Download a model")).not.toBeInTheDocument();
    expect(screen.queryByText("Pull")).not.toBeInTheDocument();
  });

  it("says in German that a download failed to connect, not 'Connection failed'", async () => {
    api.listOllamaModels.mockResolvedValue({ success: true, models: [] });
    api.pullOllamaModel.mockRejectedValue(new Error("ECONNREFUSED"));
    renderParser();
    const o = adminDe.parserSettings.ollama;
    fireEvent.change(await screen.findByPlaceholderText(o.pull.placeholder), {
      target: { value: "gemma3:12b" },
    });
    fireEvent.click(screen.getByRole("button", { name: o.pull.action }));
    expect(await screen.findByText(o.pull.connectionFailed)).toBeInTheDocument();
    expect(screen.queryByText("Connection failed")).not.toBeInTheDocument();
  });
});
