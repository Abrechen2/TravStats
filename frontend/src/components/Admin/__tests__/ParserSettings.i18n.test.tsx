import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

import ParserSettings from "../ParserSettings";

/**
 * Acceptance 2026-09-26: the admin page, in German, said "User Permissions"
 * and "Allow users to add their own flight data API keys …" — the one block
 * of ParserSettings that never went through the translation.
 */
describe("ParserSettings — user permission block", () => {
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
      />
    );
    expect(screen.getByText(adminDe.parserSettings.userPermissions.title)).toBeInTheDocument();
    expect(
      screen.getByLabelText(adminDe.parserSettings.userPermissions.allowUserApiKeys)
    ).toBeChecked();
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
      />
    );
    expect(screen.getByText(adminDe.parserSettings.builtin.ocrHint)).toBeInTheDocument();
    expect(screen.getByText(adminDe.parserSettings.builtin.templatesHint)).toBeInTheDocument();
    expect(screen.queryByText(/image parsing|booking parsing|Regex Templates/)).toBeNull();
  });
});
