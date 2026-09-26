import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import EmailImportTab from "../EmailImportTab";

/**
 * Silent-failure review 2026-09-26: the drop zone printed the server's English
 * prose — "Invalid PDF", raw exception text — into a German page. It maps the
 * server's stable code to the reader's language and never prints the prose.
 */
const parseApi = vi.hoisted(() => ({
  parseEmailFile: vi.fn(),
  parseEmail: vi.fn(),
  parsePdf: vi.fn(),
}));
vi.mock("../../../lib/api/parse", () => ({ parseApi }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: Object.assign(Object.create(Object.getPrototypeOf(actual.api)), actual.api, {
      get: vi.fn().mockResolvedValue({ data: { hasLlm: true } }),
    }),
  };
});

const failWith = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

const pasteAndParse = async (onError: (m: string) => void): Promise<void> => {
  await act(async () => {
    render(
      <EmailImportTab
        domain="flight"
        acceptedExtensions={[".eml", ".txt"]}
        onEmailResult={vi.fn()}
        onPdfResult={vi.fn()}
        onError={onError}
      />
    );
  });
  fireEvent.change(screen.getByPlaceholderText("import:email.textPlaceholder"), {
    target: { value: "Ihre Buchung LH400" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "import:email.parse" }));
  });
};

describe("EmailImportTab — a failed parse speaks the reader's language", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names an unreachable AI parser by its code", async () => {
    parseApi.parseEmail.mockRejectedValue(
      failWith(503, {
        error: "Email parsing failed",
        message: "The LLM parser is currently unreachable.",
        code: "LLM_UNREACHABLE",
      })
    );
    const onError = vi.fn();
    await pasteAndParse(onError);
    expect(onError).toHaveBeenCalledWith("import:errors.llmUnreachable");
  });

  it("falls back to its own sentence, never the server's prose", async () => {
    parseApi.parseEmail.mockRejectedValue(
      failWith(500, {
        error: "Email parsing failed",
        message: "Cannot read properties of undefined",
      })
    );
    const onError = vi.fn();
    await pasteAndParse(onError);
    expect(onError).toHaveBeenCalledWith("import:email.parseError");
  });
});
