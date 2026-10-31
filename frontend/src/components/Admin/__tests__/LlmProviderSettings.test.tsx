import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import LlmProviderSettings, { moveAmongEnabled } from "../LlmProviderSettings";
import type { ParserSettingsData } from "../ParserSettings";
import { parserOwnFields } from "../parserOwnFields";
import deAdmin from "../../../i18n/resources/de/admin.json";
import enAdmin from "../../../i18n/resources/en/admin.json";

const api = vi.hoisted(() => ({ adminOverview: vi.fn() }));
vi.mock("../../../lib/api/externalServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/externalServices")>()),
  externalServicesApi: api,
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * The cloud chain's ORDER is parser behaviour; switching a provider on, its key
 * and consent live only in Externe Dienste. The chain lists the providers that
 * are on there, with their status and a link, and sends the others to where
 * they are switched on.
 */
const base: ParserSettingsData = {
  allowUserApiKeys: true,
  fxCdnFallbackEnabled: true,
  ollamaUrl: null,
  ollamaModel: null,
};

const svc = (id: string, enabled: boolean, configured: boolean) => ({
  id,
  enabled,
  configured,
});
function overview(...services: ReturnType<typeof svc>[]) {
  return { categories: [{ id: "ai", services }], connections: [] };
}

function renderChain(settings: ParserSettingsData, onChange = vi.fn()) {
  render(<LlmProviderSettings parserSettings={settings} onParserSettingsChange={onChange} />, {
    wrapper: MemoryRouter,
  });
  return onChange;
}

describe("LlmProviderSettings — the cloud chain order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.adminOverview.mockResolvedValue(
      overview(
        svc("openai", true, true),
        svc("anthropic", false, false),
        svc("gemini", true, false),
        svc("customLlm", false, false)
      )
    );
  });

  it("lists only the providers switched on in Externe Dienste, each with its status and a link", async () => {
    renderChain(base);
    await screen.findByTestId("llm-slot-openai");
    expect(screen.getByTestId("llm-slot-google")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-slot-anthropic")).toBeNull();
    expect(screen.queryByTestId("llm-slot-custom")).toBeNull();
    expect(screen.getByTestId("llm-slot-status-openai")).toHaveTextContent(
      /Bereit|Ready|status\.active/
    );
    const link = within(screen.getByTestId("llm-slot-openai")).getByRole("link");
    expect(link).toHaveAttribute("href", "/admin/externalServices?service=openai");
    // gemini is on but has no key yet
    expect(screen.getByTestId("llm-slot-status-google")).not.toHaveTextContent(
      screen.getByTestId("llm-slot-status-openai").textContent ?? ""
    );
  });

  it("shows a provider that is off with 'In Externe Dienste einschalten' instead of a chain entry", async () => {
    renderChain(base);
    const off = await screen.findByTestId("llm-slot-off-anthropic");
    expect(within(off).getByRole("link")).toHaveAttribute(
      "href",
      "/admin/externalServices?service=anthropic"
    );
    expect(screen.getByTestId("llm-slot-off-custom")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-slot-off-openai")).toBeNull();
  });

  it("has no key, model, consent or test control any more", async () => {
    renderChain(base);
    await screen.findByTestId("llm-slot-openai");
    expect(screen.queryByLabelText(/key|Schlüssel/i)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("moves a slot past the next ENABLED one, leaving the disabled ones where they are", async () => {
    const onChange = renderChain({
      ...base,
      llmProviderOrder: ["openai", "anthropic", "google", "custom"],
    });
    const openai = await screen.findByTestId("llm-slot-openai");
    fireEvent.click(within(openai).getByRole("button", { name: /moveDown|Nach unten|Move down/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ llmProviderOrder: ["google", "anthropic", "openai", "custom"] })
    );
  });

  it("says when the status cannot be loaded instead of drawing an empty chain", async () => {
    api.adminOverview.mockRejectedValue(new Error("down"));
    renderChain(base);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-chain-empty")).toBeNull();
  });

  it("moveAmongEnabled stops at the ends of the enabled list", () => {
    const enabled = new Set(["openai", "google"] as const);
    expect(
      moveAmongEnabled(["openai", "anthropic", "google", "custom"], enabled, "openai", -1)
    ).toEqual(["openai", "anthropic", "google", "custom"]);
  });

  it("speaks both languages for the new copy", () => {
    for (const bundle of [deAdmin, enAdmin]) {
      const p = bundle.parserSettings.provider;
      expect(p.enableInServices).toBeTruthy();
      expect(p.openInServices).toBeTruthy();
      expect(p.status.active).toBeTruthy();
      expect(p.status.missing).toBeTruthy();
    }
  });
});

describe("Parser save — a save after an External-services edit leaves the service fields alone", () => {
  it("sends only the parser's own fields, never the page's stale copy of address, keys or consent", () => {
    const stale: ParserSettingsData = {
      ...base,
      parserOrder: "template_first",
      llmEnabled: true,
      llmProviderOrder: ["google", "openai", "anthropic", "custom"],
      ollamaUrl: "http://old-address:11434",
      ollamaModel: "gemma3:12b",
      llmOllamaOptIn: false,
      llmOpenaiApiKey: "sk-a****wxyz",
      llmOpenaiOptIn: true,
      openaiCompatBaseUrl: "https://old.example",
      allowUserApiKeys: true,
      fxCdnFallbackEnabled: true,
    };
    expect(parserOwnFields(stale)).toEqual({
      parserOrder: "template_first",
      llmEnabled: true,
      llmProviderOrder: ["google", "openai", "anthropic", "custom"],
      ollamaModel: "gemma3:12b",
    });
    expect(Object.keys(parserOwnFields(stale))).not.toContain("ollamaUrl");
  });

  it("an External-services model edit survives a Parser save the user did not touch the model on", () => {
    const loaded: ParserSettingsData = {
      ...base,
      ollamaModel: "gemma3:12b",
      parserOrder: "template_first",
    };
    // The page still holds the model it loaded; only the order was changed here.
    const edited: ParserSettingsData = { ...loaded, parserOrder: "llm_first" };
    expect(parserOwnFields(edited, loaded)).not.toHaveProperty("ollamaModel");
    // A model picked on this page is sent.
    expect(parserOwnFields({ ...loaded, ollamaModel: "llama3.1:8b" }, loaded)).toHaveProperty(
      "ollamaModel",
      "llama3.1:8b"
    );
  });
});
