import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

import ParserSettings, { type ParserSettingsData } from "../ParserSettings";
import deAdmin from "../../../i18n/resources/de/admin.json";
import enAdmin from "../../../i18n/resources/en/admin.json";

const api = vi.hoisted(() => ({
  testLlmProvider: vi.fn(),
  listOllamaModels: vi.fn(async () => ({ success: true, models: [] })),
  pullOllamaModel: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ adminApi: api }));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * The provider choice (beta.17). Every external call is mocked — the test
 * button's answer is what the user sees, so each failure kind must come out as
 * its own sentence, never as the server's detail line.
 */
const base: ParserSettingsData = {
  allowUserApiKeys: true,
  fxCdnFallbackEnabled: true,
  ollamaUrl: null,
  ollamaModel: null,
};

const openAi: ParserSettingsData = {
  ...base,
  llmProvider: "openai_compatible",
  openaiCompatBaseUrl: "https://api.openai.com/v1",
  openaiCompatModel: "gpt-4o-mini",
  openaiCompatApiKey: "sk-a****wxyz",
};

function renderWith(settings: ParserSettingsData, onChange = vi.fn()) {
  render(
    <ParserSettings
      parserSettings={settings}
      savingParsers={false}
      onSave={vi.fn()}
      onParserSettingsChange={onChange}
      onTestOllama={vi.fn()}
      ollamaTestState={{ status: "idle" }}
    />
  );
  return onChange;
}

describe("LlmProviderSettings", () => {
  beforeEach(() => {
    api.testLlmProvider.mockClear();
  });

  it("keeps Ollama the default and its card visible", () => {
    renderWith(base);
    expect(screen.getByTestId("llm-provider-ollama")).toBeChecked();
    expect(screen.getByText("admin:parserSettings.ollama.title")).toBeInTheDocument();
    expect(screen.queryByLabelText("admin:parserSettings.provider.baseUrlLabel")).toBeNull();
  });

  it("switching to OpenAI-compatible hands the choice to the save path", () => {
    const onChange = renderWith(base);
    fireEvent.click(screen.getByTestId("llm-provider-openai_compatible"));
    expect(onChange).toHaveBeenCalledWith({ ...base, llmProvider: "openai_compatible" });
  });

  it("shows URL, model and the masked key — and hides the Ollama card", () => {
    renderWith(openAi);
    expect(screen.getByLabelText("admin:parserSettings.provider.baseUrlLabel")).toHaveValue(
      "https://api.openai.com/v1"
    );
    expect(screen.getByLabelText("admin:parserSettings.provider.keyLabel")).toHaveValue(
      "sk-a****wxyz"
    );
    expect(screen.getByLabelText("admin:parserSettings.provider.keyLabel")).toHaveAttribute(
      "type",
      "password"
    );
    expect(screen.queryByText("admin:parserSettings.ollama.title")).toBeNull();
  });

  it("the cloud consent is off by default and names what is sent — DE first, EN mirrored", () => {
    renderWith(openAi);
    expect(screen.getByTestId("llm-cloud-opt-in")).not.toBeChecked();
    expect(screen.getByText("admin:parserSettings.provider.cloud.warning")).toBeInTheDocument();
    const de = deAdmin.parserSettings.provider.cloud.warning;
    expect(de).toMatch(/Text der E-Mail oder des PDFs/);
    expect(de).toMatch(/Namen, Buchungsnummern, Reisedaten und Preisen/);
    expect(de).toMatch(/Spaltennamen und drei Beispielzeilen/);
    expect(enAdmin.parserSettings.provider.cloud.warning).toMatch(
      /names, booking numbers, travel dates and prices/
    );
  });

  it("says the parser stays off while a saved cloud provider has no consent", () => {
    renderWith({ ...openAi, openaiCompatIsCloud: true, llmCloudOptIn: false });
    expect(screen.getByText("admin:parserSettings.provider.cloud.inactive")).toBeInTheDocument();
  });

  it("a rejected key reads as a rejected key, not as the server's status line", async () => {
    api.testLlmProvider.mockResolvedValue({
      ok: false,
      errorCode: "auth",
      detail: "OpenAI-compatible availability check returned HTTP 401",
    });
    renderWith(openAi);
    await act(async () => {
      fireEvent.click(screen.getByText("admin:parserSettings.provider.testButton"));
    });
    expect(api.testLlmProvider).toHaveBeenCalledWith({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-a****wxyz",
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "admin:parserSettings.provider.test.errors.auth"
    );
    expect(screen.queryByText(/HTTP 401/)).toBeNull();
    expect(deAdmin.parserSettings.provider.test.errors.auth).toBe(
      "Der Anbieter hat den API-Schlüssel abgelehnt."
    );
  });

  it("a failed request is a failure, not silence", async () => {
    api.testLlmProvider.mockRejectedValue(new Error("Network Error"));
    renderWith(openAi);
    fireEvent.click(screen.getByText("admin:parserSettings.provider.testButton"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "admin:parserSettings.provider.test.errors.failed"
      )
    );
  });

  it("a missing model is said, not reported as a plain success", async () => {
    api.testLlmProvider.mockResolvedValue({
      ok: true,
      isCloud: true,
      modelCount: 12,
      modelFound: false,
    });
    renderWith(openAi);
    await act(async () => {
      fireEvent.click(screen.getByText("admin:parserSettings.provider.testButton"));
    });
    expect(screen.getByRole("status").textContent).toContain(
      "admin:parserSettings.provider.test.okModelMissing"
    );
    expect(screen.getByRole("status").textContent).toContain(
      "admin:parserSettings.provider.test.cloud"
    );
  });
});
