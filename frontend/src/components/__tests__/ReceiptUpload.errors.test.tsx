import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const uploadsApiMock = vi.hoisted(() => ({ uploadReceipt: vi.fn() }));

vi.mock("../../lib/api", () => ({ uploadsApi: uploadsApiMock, API_URL: "" }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import ReceiptUpload from "../ReceiptUpload";

/**
 * Auditor 3, 2026-09-19: uploading a receipt as the shared demo printed a red
 * "DEMO_ACCOUNT_FORBIDDEN" under the drop zone. That is the machine's word
 * for the refusal — the `error` field of the body, which the component was
 * rendering directly. A code is a word for a program; it belongs in a
 * condition, not on screen.
 */
describe("ReceiptUpload — what a refused upload says", () => {
  const dropFile = (): void => {
    const { container } = render(
      <ReceiptUpload onUploadSuccess={vi.fn()} onDelete={vi.fn()} currentReceiptUrl={null} />
    );
    const input = container.querySelector('input[type="file"]');
    const file = new File(["x"], "beleg.png", { type: "image/png" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
  };

  beforeEach(() => {
    uploadsApiMock.uploadReceipt.mockReset();
  });

  it("maps the demo refusal to the sentence the settings cards use", async () => {
    uploadsApiMock.uploadReceipt.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "DEMO_ACCOUNT_FORBIDDEN", message: "The demo account cannot change this." },
      },
    });

    dropFile();

    expect(await screen.findByText("settings:demoLocked")).toBeInTheDocument();
    expect(screen.queryByText(/DEMO_ACCOUNT_FORBIDDEN/)).not.toBeInTheDocument();
  });

  it("shows the server's sentence for any other failure", async () => {
    uploadsApiMock.uploadReceipt.mockRejectedValue({
      response: {
        status: 413,
        data: { error: "PAYLOAD_TOO_LARGE", message: "File is too large." },
      },
    });

    dropFile();

    expect(await screen.findByText("File is too large.")).toBeInTheDocument();
    expect(screen.queryByText(/PAYLOAD_TOO_LARGE/)).not.toBeInTheDocument();
  });

  /**
   * Not the code, even when there is nothing else. A body with a bare code
   * used to reach the screen through the same path as the demo refusal.
   */
  it("falls back to its own copy when the server sends no sentence", async () => {
    uploadsApiMock.uploadReceipt.mockRejectedValue({
      response: { status: 500, data: { error: "INTERNAL_ERROR" } },
    });

    dropFile();

    await waitFor(() =>
      expect(screen.getByText("flights:receipt.uploadFailed")).toBeInTheDocument()
    );
    expect(screen.queryByText(/INTERNAL_ERROR/)).not.toBeInTheDocument();
  });
});
