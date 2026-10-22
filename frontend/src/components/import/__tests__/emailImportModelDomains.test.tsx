import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import EmailImportTab from "../EmailImportTab";
import { api } from "@/lib/api/client";
import type { ParseableImportDomain } from "../types";

/**
 * Board item rental-import-card-promises-llm: the rental card said "Was keine
 * Vorlage kennt, liest das KI-Modell …" while the rental path is
 * template-or-decline. A model notice appears only where the server asks one.
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

const renderTab = async (domain: ParseableImportDomain): Promise<void> => {
  await act(async () => {
    render(
      <EmailImportTab
        domain={domain}
        acceptedExtensions={[".eml"]}
        onEmailResult={vi.fn()}
        onError={vi.fn()}
      />
    );
  });
};

const localModel = {
  hasLlm: true,
  llmRefusal: null,
  llmProvider: { kind: "ollama", model: "gemma3:4b", isCloud: false, host: null },
};

describe("EmailImportTab — a model is promised only where one reads", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockClear();
  });

  it.each(["flight", "cruise", "lodging", "rail"] as const)(
    "%s discloses the model that reads what no template knows",
    async (domain) => {
      capabilities.current = localModel;
      await renderTab(domain);
      expect(screen.getByTestId("llm-provider-disclosure")).toBeInTheDocument();
    }
  );

  it.each(["rental", "package", "place"] as const)(
    "%s says nothing about a model, and does not ask for one",
    async (domain) => {
      capabilities.current = localModel;
      await renderTab(domain);
      expect(screen.queryByTestId("llm-provider-disclosure")).toBeNull();
      expect(api.get).not.toHaveBeenCalledWith("/parser-capabilities");
    }
  );

  it("a rental card shows no 'no model configured' warning either", async () => {
    capabilities.current = { hasLlm: false, llmRefusal: null, llmProvider: null };
    await renderTab("rental");
    expect(screen.queryByText("import:email.regexWarning.title")).toBeNull();
  });
});
