import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// The cloud chain loads the services' status; it has its own tests.
vi.mock("../LlmProviderSettings", () => ({
  default: () => <div data-testid="llm-provider-settings" />,
}));

import ParserSettings, { type ParserSettingsData } from "../ParserSettings";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { HiddenRowsContext } from "../../Settings/frame/useExpertRows";

vi.mock("../../../lib/api", () => ({
  adminApi: { listOllamaModels: vi.fn(), pullOllamaModel: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const base: ParserSettingsData = {
  allowUserApiKeys: true,
  fxCdnFallbackEnabled: true,
  ollamaUrl: null,
  ollamaModel: null,
};

function renderAt(level: "standard" | "expert") {
  useSettingsLevelStore.setState({ level });
  const spy = vi.fn();
  render(
    <HiddenRowsContext.Provider value={spy}>
      <ParserSettings
        parserSettings={base}
        savingParsers={false}
        onSave={vi.fn()}
        onParserSettingsChange={vi.fn()}
        onTestOllama={vi.fn()}
        ollamaTestState={{ status: "idle" }}
      />
    </HiddenRowsContext.Provider>,
    { wrapper: MemoryRouter }
  );
  return spy;
}

/**
 * forgejo#321: the standard level answers "who reads a booking" — the order,
 * the model switch, the cloud chain — and leaves the Ollama plumbing, the
 * user API-key permission and the FX CDN fallback to the expert view.
 */
describe("ParserSettings — standard and expert rows", () => {
  afterEach(() => {
    cleanup();
    act(() => useSettingsLevelStore.setState({ level: null }));
  });

  it("keeps who reads a booking at the standard level and hides the plumbing", () => {
    const spy = renderAt("standard");

    expect(screen.getByTestId("parser-order-select")).toBeInTheDocument();
    expect(screen.getByTestId("llm-enabled-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("llm-provider-settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "admin:saveSettings" })).toBeInTheDocument();

    expect(screen.queryByText("admin:parserSettings.ollama.title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("llm-ollama-remote-opt-in")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("admin:parserSettings.userPermissions.allowUserApiKeys")
    ).toBeNull();
    expect(screen.queryByLabelText("admin:fxCdn.label")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-moved-note")).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.any(String), 2);
  });

  it("draws the Ollama model card and links the moved service settings at the expert level", () => {
    const spy = renderAt("expert");

    expect(screen.getByText("admin:parserSettings.ollama.title")).toBeInTheDocument();
    // The address, the remote consent, the key permission and the FX fallback are
    // edited in Externe Dienste: a link stands where each form was (package 5).
    expect(screen.queryByTestId("llm-ollama-remote-opt-in")).toBeNull();
    expect(
      screen.queryByLabelText("admin:parserSettings.userPermissions.allowUserApiKeys")
    ).toBeNull();
    expect(screen.queryByLabelText("admin:fxCdn.label")).toBeNull();
    const links = screen
      .getAllByTestId("service-moved-note")
      .map((n) => n.getAttribute("data-service"));
    expect(links).toEqual(["ollama", "fx"]);
    expect(spy).toHaveBeenCalledWith(expect.any(String), 0);
  });
});
