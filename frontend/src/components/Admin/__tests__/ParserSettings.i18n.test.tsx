import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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
vi.mock("../../../lib/api", () => ({
  adminApi: { listOllamaModels: vi.fn().mockResolvedValue({ success: true, models: [] }) },
}));

// The cloud chain loads the services' status; it has its own tests.
vi.mock("../LlmProviderSettings", () => ({
  default: () => <div data-testid="llm-provider-settings" />,
}));

import ParserSettings from "../ParserSettings";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

/**
 * Acceptance 2026-09-26: the admin page, in German, said "User Permissions"
 * and "Allow users to add their own flight data API keys …" — the one block
 * of ParserSettings that never went through the translation.
 */
describe("ParserSettings — copy", () => {
  // The permission block is an expert row of the parser settings.
  beforeEach(() => useSettingsLevelStore.setState({ level: "expert" }));
  afterEach(() => {
    cleanup();
    act(() => useSettingsLevelStore.setState({ level: null }));
  });

  it("speaks German in the German UI", () => {
    render(
      <ParserSettings
        parserSettings={{
          allowUserApiKeys: true,
          fxCdnFallbackEnabled: false,
          ollamaUrl: null,
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
    // The block moved to Externe Dienste; nothing of it may linger in English.
    expect(screen.queryByText(adminDe.parserSettings.userPermissions.title)).toBeNull();
    expect(screen.queryByText(/Allow users to add/)).toBeNull();
  });

  // Browser acceptance 2026-09-26: the built-in parser cards said "Boarding
  // pass image parsing" and "Email booking parsing" on the German page.
  it("describes the built-in parsers in German", () => {
    render(
      <ParserSettings
        parserSettings={{
          allowUserApiKeys: true,
          fxCdnFallbackEnabled: false,
          ollamaUrl: null,
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
    expect(screen.getByText(adminDe.parserSettings.builtin.ocrHint)).toBeInTheDocument();
    expect(screen.getByText(adminDe.parserSettings.builtin.templatesHint)).toBeInTheDocument();
    expect(screen.queryByText(/image parsing|booking parsing|Regex Templates/)).toBeNull();
  });
});
