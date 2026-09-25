import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ParserSettings, { type ParserSettingsData } from "../ParserSettings";

vi.mock("../../../lib/api", () => ({
  adminApi: { listOllamaModels: vi.fn(), pullOllamaModel: vi.fn() },
}));

/**
 * The "KI-Parser aus" switch (owner decision 2026-09-25). A setting only an SQL
 * client can change is not a setting, so the admin page has to draw it, read
 * an older backend's missing field as "on", and hand a flip to the save path.
 */
const base: ParserSettingsData = {
  allowUserApiKeys: true,
  fxCdnFallbackEnabled: true,
  ollamaUrl: null,
  ollamaModel: null,
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

describe("ParserSettings — the AI model switch", () => {
  it("reads a backend without the field as on", () => {
    renderWith(base);
    expect(screen.getByTestId("llm-enabled-toggle")).toBeChecked();
  });

  it("shows a switched-off model as off", () => {
    renderWith({ ...base, llmEnabled: false });
    expect(screen.getByTestId("llm-enabled-toggle")).not.toBeChecked();
  });

  it("hands the flip to the save path", () => {
    const onChange = renderWith({ ...base, llmEnabled: true });
    fireEvent.click(screen.getByTestId("llm-enabled-toggle"));
    expect(onChange).toHaveBeenCalledWith({ ...base, llmEnabled: false });
  });
});
