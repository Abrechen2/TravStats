import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import EmailImportTab from "../EmailImportTab";

/**
 * forgejo#88 finding 8 — an action that cannot run says why.
 *
 * The audit clicked "Auswerten" on an empty box and nothing happened, which to
 * a beginner reads as a broken button. Since then the button became correctly
 * `disabled` on empty input, which ends the silent no-op — but an unexplained
 * disabled button is its own small dead end: nothing on the surface says what
 * is missing.
 *
 * Both halves are pinned, because they can regress independently: the button
 * must stay refused, and the reason must be on screen.
 */
vi.mock("../../../lib/api/parse", () => ({
  parseApi: { parseEmailFile: vi.fn(), parseEmail: vi.fn(), parsePdf: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The tab asks `/parser-capabilities` on mount through the axios client
// directly, so no api-module mock covers it (forgejo#110).
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: Object.assign(Object.create(Object.getPrototypeOf(actual.api)), actual.api, {
      get: vi.fn().mockResolvedValue({ data: { hasLlm: true } }),
    }),
  };
});

/**
 * Awaited render: the tab asks `/parser-capabilities` on mount and writes the
 * answer to state, so a bare `render` leaves that update outside act(...) —
 * which the suite's own guard fails on, correctly.
 */
const renderTab = async (): Promise<void> => {
  await act(async () => {
    render(
      <EmailImportTab
        domain="flight"
        acceptedExtensions={[".eml", ".txt"]}
        onEmailResult={vi.fn()}
        onPdfResult={vi.fn()}
        onError={vi.fn()}
      />
    );
  });
};

describe("EmailImportTab — the paste-text action explains itself when empty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says what is missing, and keeps the button refused", async () => {
    await renderTab();
    fireEvent.click(screen.getByText("import:email.textFallback"));

    expect(screen.getByText("import:email.pasteFirst")).toBeTruthy();
    expect(screen.getByRole("button", { name: "import:email.parse" })).toBeDisabled();
  });

  it("drops the hint once there is text to work with", async () => {
    await renderTab();
    fireEvent.click(screen.getByText("import:email.textFallback"));

    fireEvent.change(screen.getByPlaceholderText("import:email.textPlaceholder"), {
      target: { value: "Ihre Buchungsbestätigung" },
    });

    expect(screen.queryByText("import:email.pasteFirst")).toBeNull();
    expect(screen.getByRole("button", { name: "import:email.parse" })).not.toBeDisabled();
  });

  it("treats whitespace as empty — a stray newline is not an e-mail", async () => {
    await renderTab();
    fireEvent.click(screen.getByText("import:email.textFallback"));

    fireEvent.change(screen.getByPlaceholderText("import:email.textPlaceholder"), {
      target: { value: "   \n  " },
    });

    expect(screen.getByText("import:email.pasteFirst")).toBeTruthy();
    expect(screen.getByRole("button", { name: "import:email.parse" })).toBeDisabled();
  });
});
