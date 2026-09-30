import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import EmailImportTab from "../EmailImportTab";

/**
 * The admin switch "KI-Parser aus" (2026-09-25): with the model switched off,
 * every parse is templates-only by decision. The import screen used to know one
 * absence — "no LLM configured", a warning that sends the reader off to set one
 * up. Shown for a model an admin turned off on purpose, that sentence is wrong;
 * this one says it was switched off and what that means for the import.
 */
const capabilities = vi.hoisted(() => ({
  current: { hasLlm: false, llmDisabledByAdmin: true } as {
    hasLlm: boolean;
    llmDisabledByAdmin?: boolean;
  },
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: Object.assign(Object.create(Object.getPrototypeOf(actual.api)), actual.api, {
      get: vi.fn(async () => ({ data: capabilities.current })),
    }),
  };
});

vi.mock("../../../lib/api/parse", () => ({
  parseApi: { parseEmailFile: vi.fn(), parseEmail: vi.fn(), parsePdf: vi.fn() },
}));

const renderTab = async (): Promise<void> => {
  await act(async () => {
    render(
      <EmailImportTab
        domain="lodging"
        acceptedExtensions={[".eml"]}
        onEmailResult={vi.fn()}
        onError={vi.fn()}
      />
    );
  });
};

describe("EmailImportTab — the model is switched off by the admin", () => {
  beforeEach(() => {
    capabilities.current = { hasLlm: false, llmDisabledByAdmin: true };
  });

  it("says the parser was switched off, not that none is configured", async () => {
    await renderTab();
    expect(screen.getByTestId("llm-disabled-notice").textContent).toContain(
      "import:email.llmDisabled.title"
    );
    expect(screen.queryByText("import:email.regexWarning.title")).toBeNull();
  });

  it("keeps the 'none configured' warning for an instance without a model", async () => {
    capabilities.current = { hasLlm: false, llmDisabledByAdmin: false };
    await renderTab();
    expect(screen.queryByTestId("llm-disabled-notice")).toBeNull();
    expect(screen.getByText("import:email.regexWarning.title")).toBeInTheDocument();
  });
});
