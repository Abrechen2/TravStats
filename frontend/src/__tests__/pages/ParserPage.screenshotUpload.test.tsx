import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ParserPage from "../../pages/ParserPage";

/**
 * forgejo#309 — a screenshot is a workshop sample. The server reads it by
 * OCR; the page then opens the TEXT annotation (with the domain picker) on
 * what was read, like a mail. A screenshot the OCR read nothing from is
 * refused with a code, and the page says which refusal it was in the
 * reader's language — never the server's English sentence, never nothing.
 */

const upload = vi.fn();
const addToast = vi.fn();

vi.mock("../../lib/api", () => ({
  trainingApi: {
    upload: (file: File, type: string) => upload(file, type),
    getById: vi.fn().mockResolvedValue({
      id: "td-shot",
      type: "screenshot",
      domain: "rail",
      status: "pending",
      annotations: {
        fullText: "Hinfahrt am 14.11.2027\nAugsburg Hbf  08:12  →  München Hbf  08:48  RE 89",
        textSelections: [],
      },
      extractedData: [],
      tags: [],
      createdAt: "2027-11-01T10:00:00.000Z",
    }),
    annotate: vi.fn(),
  },
  parserTemplatesApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../components/Parser/MyTemplates", () => ({
  default: () => <div data-testid="my-templates" />,
}));
vi.mock("../../components/TemplateStatusView", () => ({ default: () => <div /> }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector?: (s: { user: { isAdmin: boolean } }) => unknown) => {
    const state = { user: { isAdmin: false } };
    return selector ? selector(state) : state;
  },
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: unknown }) => unknown) => selector({ addToast }),
}));
vi.mock("../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

async function uploadScreenshot(): Promise<void> {
  render(
    <MemoryRouter>
      <ParserPage />
    </MemoryRouter>
  );
  const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]');
  await userEvent.upload(
    input as HTMLInputElement,
    new File([new Uint8Array([137, 80, 78, 71])], "connection.png", { type: "image/png" })
  );
}

const refusal = (code: string) =>
  Object.assign(new Error("Request failed"), {
    response: { status: 422, data: { error: "Almost no text could be read", code } },
  });

describe("the parser page with a screenshot", () => {
  beforeEach(() => {
    upload.mockReset();
    addToast.mockReset();
  });

  it("uploads it as a screenshot and opens the text annotation on the OCR text", async () => {
    upload.mockResolvedValue({
      id: "td-shot",
      type: "screenshot",
      status: "pending",
      domain: "rail",
    });

    await uploadScreenshot();

    expect(upload).toHaveBeenCalledWith(expect.any(File), "screenshot");
    // The domain picker and the text marking — not the boarding-pass view.
    expect(await screen.findByLabelText("parser:workshop.domainTitle")).toBeInTheDocument();
    expect(await screen.findByText(/Augsburg Hbf/)).toBeInTheDocument();
  });

  it.each(["TRAINING_IMAGE_NO_TEXT", "TRAINING_IMAGE_UNREADABLE"])(
    "says %s in the reader's language when the OCR read nothing",
    async (code) => {
      upload.mockRejectedValue(refusal(code));

      await uploadScreenshot();

      await waitFor(() =>
        expect(addToast).toHaveBeenCalledWith("error", `parser:annotate.uploadErrors.${code}`)
      );
      expect(screen.queryByLabelText("parser:workshop.domainTitle")).toBeNull();
    }
  );

  it("keeps the generic message for a failure that carries no screenshot code", async () => {
    upload.mockRejectedValue(new Error("Network Error"));

    await uploadScreenshot();

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "parser:annotate.uploadError")
    );
  });
});
