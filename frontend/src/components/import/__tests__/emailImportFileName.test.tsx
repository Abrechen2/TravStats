import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import EmailImportTab from "../EmailImportTab";
import { parseApi } from "../../../lib/api/parse";

/**
 * An import has to say which file it came from.
 *
 * Forgejo #19: the import log showed rows reading "Flüge · E-Mail · 30.8.2026 ·
 * 2 Flüge" and nothing else, because every email batch was created with
 * `fileName: null`. Import four mailboxes on one afternoon and they are
 * indistinguishable — so reverting the right one is guesswork, and reverting
 * the wrong one destroys work.
 *
 * The name was available the whole time: the drop zone has the `File`. It was
 * simply not passed on.
 *
 * Pasted text is asserted too, and separately: it has no source file, so the
 * row stays unnamed rather than being given something invented.
 */
vi.mock("../../../lib/api/parse", () => ({
  parseApi: {
    parseEmailFile: vi.fn(),
    parseEmail: vi.fn(),
    parsePdf: vi.fn(),
  },
}));
vi.mock("../../../lib/api/settings", () => ({
  settingsApi: { getParserCapabilities: vi.fn().mockResolvedValue({ data: { hasLlm: false } }) },
}));

function msgFile(name: string): File {
  return new File(["x"], name, { type: "application/vnd.ms-outlook" });
}

describe("EmailImportTab hands the file name on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseApi.parseEmailFile).mockResolvedValue({ flights: [] } as never);
    vi.mocked(parseApi.parseEmail).mockResolvedValue({ flights: [] } as never);
  });

  it("reports the uploaded file's name alongside the result", async () => {
    const onEmailResult = vi.fn();
    const { container } = render(
      <EmailImportTab
        domain="flight"
        acceptedExtensions={[".msg", ".eml", ".txt"]}
        onEmailResult={onEmailResult}
        onError={vi.fn()}
      />
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const name = "2007-07-16_germanwings.com_Buchungsbestaetigung.msg";
    fireEvent.change(input as HTMLInputElement, { target: { files: [msgFile(name)] } });

    await waitFor(() => expect(onEmailResult).toHaveBeenCalled());
    expect(onEmailResult).toHaveBeenCalledWith(expect.anything(), name);
  });

  it("passes null for pasted text rather than inventing a name", async () => {
    const onEmailResult = vi.fn();
    render(
      <EmailImportTab
        domain="flight"
        acceptedExtensions={[".msg", ".eml", ".txt"]}
        onEmailResult={onEmailResult}
        onError={vi.fn()}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Flug LH400 am 15.01.2024" } });
    fireEvent.click(screen.getByRole("button", { name: /parse|auswerten|import:email/i }));

    await waitFor(() => expect(onEmailResult).toHaveBeenCalled());
    expect(onEmailResult).toHaveBeenCalledWith(expect.anything(), null);
  });
});
