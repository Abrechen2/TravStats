import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * A tour operator's PDF is KEPT when it is read as a package: the package
 * commit files it on the trip it becomes. Every other domain keeps its call
 * exactly as before.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/api/parse", () => ({
  parseApi: {
    parseEmailFile: vi.fn(),
    parseEmail: vi.fn(),
    parsePdf: vi.fn(async () => ({ domain: "package", package: null })),
  },
}));
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: Object.assign(Object.create(Object.getPrototypeOf(actual.api)), actual.api, {
      get: vi.fn().mockResolvedValue({ data: { hasLlm: false } }),
    }),
  };
});

import EmailImportTab from "../EmailImportTab";
import { parseApi } from "../../../lib/api/parse";

// jsdom's File has no arrayBuffer(); the tab reads the PDF through it.
const pdf = (): File =>
  Object.assign(new File(["%PDF"], "Rechnung.pdf", { type: "application/pdf" }), {
    arrayBuffer: async () => new TextEncoder().encode("%PDF").buffer,
  });

describe("EmailImportTab — package documents are kept", () => {
  it("asks the server to keep a PDF read as a package", async () => {
    render(
      <EmailImportTab
        domain="package"
        acceptedExtensions={[".pdf"]}
        onEmailResult={vi.fn()}
        onPdfResult={vi.fn()}
        onError={vi.fn()}
        initialDocument={{ kind: "file", file: pdf() }}
      />
    );
    await waitFor(() =>
      expect(parseApi.parsePdf).toHaveBeenCalledWith(expect.any(String), "package", {
        retain: true,
      })
    );
  });

  it("keeps a flight PDF's call unchanged", async () => {
    vi.mocked(parseApi.parsePdf).mockClear();
    render(
      <EmailImportTab
        domain="flight"
        acceptedExtensions={[".pdf"]}
        onEmailResult={vi.fn()}
        onPdfResult={vi.fn()}
        onError={vi.fn()}
        initialDocument={{ kind: "file", file: pdf() }}
      />
    );
    await waitFor(() =>
      expect(parseApi.parsePdf).toHaveBeenCalledWith(expect.any(String), "flight")
    );
  });
});
