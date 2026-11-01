import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CommunityExportPanel from "./CommunityExportPanel";

/**
 * forgejo#309 / forgejo#330: "Share with the community" shows exactly the file
 * the server built, then opens a prefilled issue in the template repository
 * under the user's own account - and words a refusal by its code, naming what
 * was found. Nothing is posted from the app.
 */
const mocks = vi.hoisted(() => ({ exportFn: vi.fn(), download: vi.fn() }));

vi.mock("../../lib/api", () => ({
  parserTemplatesApi: { communityExport: (id: string) => mocks.exportFn(id) },
}));
vi.mock("../../lib/export", () => ({ downloadBlob: mocks.download }));
vi.mock("../../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

beforeEach(() => vi.clearAllMocks());

const exported = (template: Record<string, unknown>) => ({
  template,
  filename: "fernbus-probeland.json",
  domain: "bus",
  githubUrl: "https://example.invalid/unused",
  removed: [{ kind: "identity", path: "match.markers[2]" }],
});
const clean = {
  id: "bus:fernbus-probeland",
  domain: "bus",
  issuer: { name: "Fernbus Probeland" },
  markets: ["DE"],
  match: { anchors: ["Fernbus Probeland"] },
};

describe("CommunityExportPanel", () => {
  it("shows what will be published BEFORE anything opens, then opens the prefilled issue", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mocks.exportFn.mockResolvedValue(exported(clean));
    render(<CommunityExportPanel templateId="t9" domain="bus" />);
    expect(screen.getByText("parser:communityExport.explain")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.review" }));

    const review = await screen.findByTestId("community-export-review");
    expect(review).toHaveTextContent("Fernbus Probeland");
    expect(screen.getByLabelText("parser:communityExport.jsonLabel")).toHaveTextContent(
      '"anchors"'
    );
    expect(review).toHaveTextContent("parser:communityExport.removed");
    expect(open).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.openIssue" }));
    const url = new URL(open.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/Abrechen2/travstats-templates/issues/new"
    );
    expect(url.searchParams.get("provider")).toBe("Fernbus Probeland");
    expect(JSON.parse(url.searchParams.get("template_json") ?? "")).toEqual(clean);
    expect(open.mock.calls[0][2]).toBe("noopener,noreferrer");
    open.mockRestore();
  });

  it("copies the JSON and opens the empty form when the template is too long for a link", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    const long = {
      ...clean,
      match: { anchors: Array.from({ length: 400 }, (_, i) => `Anker ${i}`) },
    };
    mocks.exportFn.mockResolvedValue(exported(long));
    render(<CommunityExportPanel templateId="t9" domain="bus" />);
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.review" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "parser:communityExport.copyAndOpen" })
    );

    expect(await screen.findByRole("status")).toHaveTextContent("parser:communityExport.copied");
    expect(JSON.parse(writeText.mock.calls[0][0] as string)).toEqual(long);
    expect(new URL(open.mock.calls[0][0] as string).searchParams.get("template_json")).toBeNull();
    open.mockRestore();
  });

  it("says so when the clipboard is unavailable instead of pretending it copied", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    const long = {
      ...clean,
      match: { anchors: Array.from({ length: 400 }, (_, i) => `Anker ${i}`) },
    };
    mocks.exportFn.mockResolvedValue(exported(long));
    render(<CommunityExportPanel templateId="t9" domain="bus" />);
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.review" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "parser:communityExport.copyAndOpen" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("parser:communityExport.copyFailed");
    open.mockRestore();
  });

  it("blocks the share when the text that would leave still looks personal", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mocks.exportFn.mockResolvedValue(
      exported({ ...clean, match: { anchors: ["Buchung X7K2QP", "max@example.org"] } })
    );
    render(<CommunityExportPanel templateId="t9" domain="bus" />);
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.review" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("parser:communityExport.looksPersonal");
    expect(alert).toHaveTextContent("parser:communityExport.suspect.email");
    expect(alert).toHaveTextContent("parser:communityExport.suspect.bookingCode");
    const share = screen.getByRole("button", { name: "parser:communityExport.openIssue" });
    expect(share).toBeDisabled();
    fireEvent.click(share);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("saves the file on request, and only then", async () => {
    mocks.exportFn.mockResolvedValue(exported(clean));
    render(<CommunityExportPanel templateId="t9" domain="bus" />);
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.review" }));
    fireEvent.click(await screen.findByRole("button", { name: "parser:communityExport.download" }));
    expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), "fernbus-probeland.json");
  });

  it("words a refusal by its code and names what was found", async () => {
    mocks.exportFn.mockRejectedValue({
      response: {
        status: 422,
        data: { code: "TEMPLATE_EXPORT_PERSONAL_DATA", kinds: "bookingReference,identity" },
      },
    });
    render(<CommunityExportPanel templateId="t9" domain="bus" />);
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.review" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("parser:communityExport.refused.TEMPLATE_EXPORT_PERSONAL_DATA");
    expect(alert).toHaveTextContent("parser:labels.bus.bookingReference");
    expect(alert).toHaveTextContent("parser:communityExport.kind.identity");
    expect(screen.queryByTestId("community-export-review")).toBeNull();
  });

  it("words the deleted-sample refusal by its own code, not the generic failure", async () => {
    mocks.exportFn.mockRejectedValue({
      response: { status: 422, data: { code: "TEMPLATE_EXPORT_SOURCE_MISSING" } },
    });
    render(<CommunityExportPanel templateId="t9" domain="ferry" />);
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "parser:communityExport.refused.TEMPLATE_EXPORT_SOURCE_MISSING"
    );
  });

  it("falls back to the generic failure for a network error", async () => {
    mocks.exportFn.mockRejectedValue(new Error("offline"));
    render(<CommunityExportPanel templateId="t9" domain="bus" />);
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("parser:communityExport.failed");
  });
});
