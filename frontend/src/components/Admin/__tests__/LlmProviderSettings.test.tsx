import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";

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
 * beta.18: four NAMED cloud provider slots (openai/anthropic/google/custom),
 * each with its own key/model/consent, tried in the admin's own order after
 * Ollama. Every external call is mocked — the test button's answer is what
 * the user sees, so each failure kind must come out as its own sentence,
 * never as the server's detail line, and a granted consent for one slot must
 * never bleed into another's checkbox state.
 */
const base: ParserSettingsData = {
  allowUserApiKeys: true,
  fxCdnFallbackEnabled: true,
  ollamaUrl: null,
  ollamaModel: null,
};

const openaiConfigured: ParserSettingsData = {
  ...base,
  llmOpenaiModel: "gpt-4o",
  llmOpenaiApiKey: "sk-a****wxyz",
  llmOpenaiOptIn: true,
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

describe("LlmProviderSettings — the cloud-slot chain", () => {
  beforeEach(() => {
    api.testLlmProvider.mockClear();
  });

  it("Ollama's own card is always visible — it is implicit in the chain, never a picked choice", () => {
    renderWith(base);
    expect(screen.getByText("admin:parserSettings.ollama.title")).toBeInTheDocument();
  });

  it("renders all four cloud slots, in the default registration order", () => {
    renderWith(base);
    expect(screen.getByTestId("llm-slot-openai")).toBeInTheDocument();
    expect(screen.getByTestId("llm-slot-anthropic")).toBeInTheDocument();
    expect(screen.getByTestId("llm-slot-google")).toBeInTheDocument();
    expect(screen.getByTestId("llm-slot-custom")).toBeInTheDocument();
    const cards = screen.getAllByTestId(/^llm-slot-/);
    expect(cards.map((c) => c.dataset.testid)).toEqual([
      "llm-slot-openai",
      "llm-slot-anthropic",
      "llm-slot-google",
      "llm-slot-custom",
    ]);
  });

  it("respects a saved order", () => {
    renderWith({ ...base, llmProviderOrder: ["anthropic", "custom", "openai", "google"] });
    const cards = screen.getAllByTestId(/^llm-slot-/);
    expect(cards.map((c) => c.dataset.testid)).toEqual([
      "llm-slot-anthropic",
      "llm-slot-custom",
      "llm-slot-openai",
      "llm-slot-google",
    ]);
  });

  it("moving a slot down swaps it with its neighbour and hands the new order to the save path", () => {
    const onChange = renderWith(base);
    const openaiCard = screen.getByTestId("llm-slot-openai");
    fireEvent.click(
      within(openaiCard).getByLabelText("admin:parserSettings.provider.chain.moveDown")
    );
    expect(onChange).toHaveBeenCalledWith({
      ...base,
      llmProviderOrder: ["anthropic", "openai", "google", "custom"],
    });
  });

  it("openai/anthropic/google show model + key only — no base-URL field", () => {
    renderWith(base);
    expect(screen.getByLabelText("admin:parserSettings.provider.baseUrlLabel")).toBeInTheDocument();
    // Only ONE base-URL field exists on the whole page — the custom slot's.
    expect(screen.getAllByLabelText("admin:parserSettings.provider.baseUrlLabel")).toHaveLength(1);
    expect(within(screen.getByTestId("llm-slot-openai")).queryByText(/baseUrlLabel/)).toBeNull();
  });

  it("each slot names its own company in its consent warning — DE first, EN mirrored", () => {
    renderWith(base);
    for (const kind of ["openai", "anthropic", "google"] as const) {
      const card = screen.getByTestId(`llm-slot-${kind}`);
      expect(
        within(card).getByText(`admin:parserSettings.provider.slots.${kind}.consent.warning`)
      ).toBeInTheDocument();
    }
    expect(deAdmin.parserSettings.provider.slots.openai.consent.warning).toMatch(/OpenAI-Server/);
    expect(deAdmin.parserSettings.provider.slots.anthropic.consent.warning).toMatch(
      /Anthropic-Server/
    );
    expect(deAdmin.parserSettings.provider.slots.google.consent.warning).toMatch(/Google-Server/);
    expect(enAdmin.parserSettings.provider.slots.openai.consent.warning).toMatch(
      /OpenAI's servers/
    );
    expect(enAdmin.parserSettings.provider.slots.anthropic.consent.warning).toMatch(
      /Anthropic's servers/
    );
    expect(enAdmin.parserSettings.provider.slots.google.consent.warning).toMatch(
      /Google's servers/
    );
  });

  it("granting OpenAI's consent does not touch Anthropic's checkbox", () => {
    const onChange = renderWith({ ...base, llmOpenaiOptIn: false, llmAnthropicOptIn: false });
    const openaiCard = screen.getByTestId("llm-slot-openai");
    fireEvent.click(within(openaiCard).getByTestId("llm-consent-checkbox-openai"));
    expect(onChange).toHaveBeenCalledWith({
      ...base,
      llmOpenaiOptIn: true,
      llmAnthropicOptIn: false,
    });
  });

  it("a configured-but-unconsented slot warns that it stays out of the chain", () => {
    renderWith({ ...base, llmOpenaiApiKey: "sk-test", llmOpenaiOptIn: false });
    const card = screen.getByTestId("llm-slot-openai");
    expect(
      within(card).getByText("admin:parserSettings.provider.slots.openai.consent.inactive")
    ).toBeInTheDocument();
  });

  it("no warning once consent is granted", () => {
    renderWith({ ...base, llmOpenaiApiKey: "sk-test", llmOpenaiOptIn: true });
    const card = screen.getByTestId("llm-slot-openai");
    expect(
      within(card).queryByText("admin:parserSettings.provider.slots.openai.consent.inactive")
    ).toBeNull();
  });

  it("'Verbindung testen' for OpenAI sends its kind and its own key, never a base URL", async () => {
    api.testLlmProvider.mockResolvedValue({
      ok: true,
      isCloud: true,
      modelCount: 3,
      modelFound: true,
    });
    renderWith(openaiConfigured);
    const card = screen.getByTestId("llm-slot-openai");
    await act(async () => {
      fireEvent.click(within(card).getByText("admin:parserSettings.provider.testButton"));
    });
    expect(api.testLlmProvider).toHaveBeenCalledWith({
      kind: "openai",
      model: "gpt-4o",
      apiKey: "sk-a****wxyz",
    });
  });

  it("'Verbindung testen' for the custom slot DOES send its base URL", async () => {
    api.testLlmProvider.mockResolvedValue({
      ok: true,
      isCloud: true,
      modelCount: 1,
      modelFound: true,
    });
    renderWith({
      ...base,
      openaiCompatBaseUrl: "https://openrouter.ai/api/v1",
      openaiCompatModel: "meta-llama/llama-3.1-70b",
      openaiCompatApiKey: "sk-c****wxyz",
    });
    const card = screen.getByTestId("llm-slot-custom");
    await act(async () => {
      fireEvent.click(within(card).getByText("admin:parserSettings.provider.testButton"));
    });
    expect(api.testLlmProvider).toHaveBeenCalledWith({
      kind: "custom",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "meta-llama/llama-3.1-70b",
      apiKey: "sk-c****wxyz",
    });
  });

  it("a rejected key reads as a rejected key, not as the server's status line", async () => {
    api.testLlmProvider.mockResolvedValue({
      ok: false,
      errorCode: "auth",
      detail: "OpenAI availability check returned HTTP 401",
    });
    renderWith(openaiConfigured);
    const card = screen.getByTestId("llm-slot-openai");
    await act(async () => {
      fireEvent.click(within(card).getByText("admin:parserSettings.provider.testButton"));
    });
    expect(within(card).getByRole("alert").textContent).toBe(
      "admin:parserSettings.provider.test.errors.auth"
    );
    expect(within(card).queryByText(/HTTP 401/)).toBeNull();
    expect(deAdmin.parserSettings.provider.test.errors.auth).toBe(
      "Der Anbieter hat den API-Schlüssel abgelehnt."
    );
  });

  it("a failed request is a failure, not silence", async () => {
    api.testLlmProvider.mockRejectedValue(new Error("Network Error"));
    renderWith(openaiConfigured);
    const card = screen.getByTestId("llm-slot-openai");
    fireEvent.click(within(card).getByText("admin:parserSettings.provider.testButton"));
    await waitFor(() =>
      expect(within(card).getByRole("alert").textContent).toBe(
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
    renderWith(openaiConfigured);
    const card = screen.getByTestId("llm-slot-openai");
    await act(async () => {
      fireEvent.click(within(card).getByText("admin:parserSettings.provider.testButton"));
    });
    expect(within(card).getByRole("status").textContent).toContain(
      "admin:parserSettings.provider.test.okModelMissing"
    );
    expect(within(card).getByRole("status").textContent).toContain(
      "admin:parserSettings.provider.test.cloud"
    );
  });
});
