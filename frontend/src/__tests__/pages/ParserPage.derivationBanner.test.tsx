import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ParserPage from "../../pages/ParserPage";

/**
 * forgejo#124 phase 6 — the reason has to SURVIVE the flow.
 *
 * The abstention note used to live in `EmailAnnotation`, which `onComplete`
 * unmounts in the same batch: the state was set, the component went away, and
 * the user landed on "My templates" with no template and no explanation. That
 * is the silent nothing the abstention exists to end, so the test drives the
 * whole flow through the PAGE and asserts the text is still on screen after
 * the annotation view is gone.
 */

const upload = vi.fn();
const annotate = vi.fn();

vi.mock("../../lib/api", () => ({
  trainingApi: {
    upload: (file: File, type: string) => upload(file, type),
    getById: vi.fn().mockResolvedValue({
      id: "td1",
      type: "email",
      domain: "cruise",
      status: "pending",
      annotations: {
        fullText: "Subject: Ihre Kreuzfahrt\nSchiff: Mein Schiff 4",
        textSelections: [],
      },
      extractedData: [],
      tags: [],
      createdAt: "2026-09-19T10:00:00.000Z",
    }),
    annotate: (...args: unknown[]) => annotate(...args),
  },
  parserTemplatesApi: { list: vi.fn().mockResolvedValue([]) },
}));

// Not under test here, and it would otherwise load its own list.
vi.mock("../../components/Parser/MyTemplates", () => ({
  default: () => <div data-testid="my-templates" />,
}));
vi.mock("../../components/TemplateStatusView", () => ({ default: () => <div /> }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The shell brings the whole navigation with it, which asks the auth store
// for far more than this page does. The page is what is under test.
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
  useToastStore: (selector: (s: { addToast: unknown }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

vi.mock("../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

async function uploadAndSave(): Promise<void> {
  render(
    <MemoryRouter>
      <ParserPage />
    </MemoryRouter>
  );
  const input = document.querySelector('input[accept=".eml,.msg,.txt"]');
  await userEvent.upload(
    input as HTMLInputElement,
    new File(["Schiff: Mein Schiff 4"], "cruise.eml", { type: "message/rfc822" })
  );
  const save = await screen.findByText("training:annotation.saveOnly");
  await userEvent.click(save);
}

describe("the parser page, after an annotation", () => {
  beforeEach(() => {
    upload.mockReset();
    annotate.mockReset();
    upload.mockResolvedValue({ id: "td1", type: "email", status: "pending", domain: "cruise" });
  });

  it("still says why no template was derived once the annotation view is gone", async () => {
    annotate.mockResolvedValue({
      success: true,
      derivation: {
        status: "abstained",
        domain: "cruise",
        reason: "cruiseNeedsRepeatingBlocks",
      },
    });

    await uploadAndSave();

    await waitFor(() =>
      expect(
        screen.getByText("parser:derivation.cannot.cruiseNeedsRepeatingBlocks")
      ).toBeInTheDocument()
    );
    // The annotation view really is gone — the reason is not simply still
    // mounted inside it.
    expect(screen.queryByText("training:annotation.saveOnly")).toBeNull();
    expect(screen.getByTestId("my-templates")).toBeInTheDocument();
  });

  it("says a template was derived, and points at the preview", async () => {
    annotate.mockResolvedValue({
      success: true,
      templateId: "t1",
      derivation: { status: "derived", templateId: "t1", domain: "cruise" },
    });

    await uploadAndSave();

    await waitFor(() =>
      expect(screen.getByText("parser:workshop.derivedBanner")).toBeInTheDocument()
    );
  });

  it("can be dismissed", async () => {
    annotate.mockResolvedValue({
      success: true,
      derivation: { status: "abstained", domain: "cruise", reason: "noPlaceDocumentReader" },
    });

    await uploadAndSave();

    const note = await screen.findByText("parser:derivation.cannot.noPlaceDocumentReader");
    expect(note).toBeInTheDocument();
    await userEvent.click(screen.getByText("parser:workshop.dismiss"));
    expect(screen.queryByText("parser:derivation.cannot.noPlaceDocumentReader")).toBeNull();
  });
});
