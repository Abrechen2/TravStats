import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ParserPage from "../../pages/ParserPage";

/**
 * forgejo#330 - the parser page explains itself: what a template is, who
 * reads a booking and in which order, what happens to an upload, and what to
 * do when nothing matched - and a document handed over from "not recognised"
 * lands in the workshop without being picked again.
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

const renderPage = (state?: unknown): void => {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/parser", state }]}>
      <ParserPage />
    </MemoryRouter>
  );
};

describe("the parser page explains itself", () => {
  beforeEach(() => {
    upload.mockReset();
    addToast.mockReset();
  });

  it("names the three sources in the order they are tried, each with a one-line reason and a help", () => {
    renderPage();
    const items = screen
      .getAllByRole("listitem")
      .filter((li) => li.dataset.testid?.startsWith("parser-source-"));
    expect(items.map((li) => li.dataset.testid)).toEqual([
      "parser-source-own",
      "parser-source-community",
      "parser-source-builtin",
    ]);
    for (const li of items) {
      expect(within(li).getAllByRole("button")).toHaveLength(1);
    }
    expect(screen.getByText("parser:overview.sources.own.line")).toBeInTheDocument();
    expect(screen.getByText("parser:overview.sources.community.line")).toBeInTheDocument();
    expect(screen.getByText("parser:overview.sources.builtin.line")).toBeInTheDocument();
  });

  it("says what happens to an uploaded booking and what to do when nothing matched", () => {
    renderPage();
    expect(screen.getByText(/parser:overview.upload/)).toBeInTheDocument();
    expect(screen.getByText(/parser:overview.nothing$/)).toBeInTheDocument();
  });

  it("gives every tab a one-line purpose, following the tab", () => {
    renderPage();
    expect(screen.getByTestId("parser-tab-hint")).toHaveTextContent("parser:tabHints.annotate");
    fireEvent.click(screen.getByRole("tab", { name: "parser:tabs.myTemplates" }));
    expect(screen.getByTestId("parser-tab-hint")).toHaveTextContent("parser:tabHints.myTemplates");
    fireEvent.click(screen.getByRole("tab", { name: "parser:tabs.communityTemplates" }));
    expect(screen.getByTestId("parser-tab-hint")).toHaveTextContent("parser:tabHints.community");
  });

  it("the 'nothing recognised' button brings the user back to the workshop", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "parser:tabs.communityTemplates" }));
    fireEvent.click(screen.getByRole("button", { name: "parser:overview.nothingAction" }));
    expect(screen.getByTestId("parser-tab-hint")).toHaveTextContent("parser:tabHints.annotate");
  });
});

describe("a document handed over from 'not recognised'", () => {
  beforeEach(() => {
    upload.mockReset();
    addToast.mockReset();
  });

  it("is uploaded once, as a mail, and opens the annotation without a file pick", async () => {
    upload.mockResolvedValue({ id: "td-shot", type: "email", status: "pending", domain: "rail" });
    const file = new File(["Fahrschein"], "ticket.txt", { type: "text/plain" });
    renderPage({ workshopDocument: file });

    await screen.findByLabelText("parser:workshop.domainTitle");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(file, "email");
  });

  it("sends an image through OCR as a screenshot", async () => {
    upload.mockResolvedValue({
      id: "td-shot",
      type: "screenshot",
      status: "pending",
      domain: "rail",
    });
    const file = new File([new Uint8Array([137, 80])], "shot.png", { type: "image/png" });
    renderPage({ workshopDocument: file });
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file, "screenshot"));
  });

  it("says so when the handed-over upload fails, and leaves the upload tiles to try again", async () => {
    upload.mockRejectedValue(new Error("Network Error"));
    renderPage({ workshopDocument: new File(["x"], "ticket.txt", { type: "text/plain" }) });
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "parser:annotate.uploadError")
    );
    expect(screen.getByText("parser:annotate.title")).toBeInTheDocument();
    // The document is not lost: it can be tried again without picking it anew.
    upload.mockResolvedValue({ id: "td-shot", type: "email", status: "pending", domain: "rail" });
    fireEvent.click(await screen.findByRole("button", { name: "parser:handoff.retry" }));
    await screen.findByLabelText("parser:workshop.domainTitle");
    expect(upload).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "parser:handoff.retry" })).toBeNull();
  });

  it("ignores a location state that carries no file", () => {
    renderPage({ workshopDocument: "nope" });
    expect(upload).not.toHaveBeenCalled();
  });
});
