import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import EmailImportTab from "../EmailImportTab";
import { llmProviderOfResult } from "../../../lib/llmProviderCopy";
import deImport from "../../../i18n/resources/de/import.json";

/**
 * beta.17: the import screen says where a document goes BEFORE it is sent —
 * a cloud provider by host — and names the refusals a provider choice can
 * cause, each as its own sentence.
 */
const capabilities = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

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

describe("EmailImportTab — the AI provider", () => {
  beforeEach(() => {
    capabilities.current = {};
  });

  it("tells the user a cloud provider will read what no template knows", async () => {
    capabilities.current = {
      hasLlm: true,
      llmDisabledByAdmin: false,
      llmRefusal: null,
      llmProvider: {
        kind: "openai_compatible",
        model: "gpt-4o-mini",
        isCloud: true,
        host: "api.openai.com",
      },
    };
    await renderTab();
    expect(screen.getByTestId("llm-provider-disclosure").textContent).toBe(
      "import:email.provider.cloud"
    );
    expect(deImport.email.provider.cloud).toMatch(/schickt TravStats zum Lesen an \{\{host\}\}/);
  });

  it("a LAN model is disclosed without a host", async () => {
    capabilities.current = {
      hasLlm: true,
      llmRefusal: null,
      llmProvider: { kind: "ollama", model: "gemma3:12b", isCloud: false, host: null },
    };
    await renderTab();
    expect(screen.getByTestId("llm-provider-disclosure").textContent).toBe(
      "import:email.provider.local"
    );
  });

  it("a cloud provider without consent is its own notice, not 'none configured'", async () => {
    capabilities.current = { hasLlm: false, llmRefusal: "cloud_not_consented", llmProvider: null };
    await renderTab();
    expect(screen.getByTestId("llm-provider-refusal").textContent).toContain(
      "import:email.cloudNotConsented.title"
    );
    expect(screen.queryByText("import:email.regexWarning.title")).toBeNull();
  });

  it("an incomplete provider setup is its own notice", async () => {
    capabilities.current = { hasLlm: false, llmRefusal: "provider_incomplete", llmProvider: null };
    await renderTab();
    expect(screen.getByTestId("llm-provider-refusal").textContent).toContain(
      "import:email.providerIncomplete.title"
    );
  });
});

describe("llmProviderOfResult", () => {
  const provider = { kind: "openai_compatible", model: "m", isCloud: true, host: "h.example" };

  it("names the provider only when the model read the document", () => {
    expect(llmProviderOfResult({ parserUsed: "ollama", llmProvider: provider })).toEqual(provider);
    expect(llmProviderOfResult({ parserUsed: "template", llmProvider: provider })).toBeNull();
  });

  it("ignores a malformed field instead of rendering it", () => {
    expect(llmProviderOfResult({ parserUsed: "ollama", llmProvider: { kind: "x" } })).toBeNull();
  });
});
