import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CommunityExportPanel from "./CommunityExportPanel";

/**
 * forgejo#309: "Export for the community" downloads the repository file the
 * server built and offers GitHub's new-file page — and words a refusal by its
 * code, naming what was found. Nothing is posted from the app.
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

describe("CommunityExportPanel", () => {
  it("downloads the file and links GitHub's new-file page in the domain's folder", async () => {
    const githubUrl =
      "https://github.com/Abrechen2/travstats-templates/new/main/bus?filename=fernbus-probeland.json";
    mocks.exportFn.mockResolvedValue({
      template: { id: "bus:fernbus-probeland" },
      filename: "fernbus-probeland.json",
      domain: "bus",
      githubUrl,
      removed: [{ kind: "identity", path: "match.markers[2]" }],
    });
    render(<CommunityExportPanel templateId="t9" domain="bus" />);
    expect(screen.getByText("parser:communityExport.explain")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.download" }));

    const link = await screen.findByRole("link", { name: "parser:communityExport.openGithub" });
    expect(link).toHaveAttribute("href", githubUrl);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(mocks.exportFn).toHaveBeenCalledWith("t9");
    expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), "fernbus-probeland.json");
    expect(screen.getByRole("status")).toHaveTextContent("parser:communityExport.removed");
  });

  it("words a refusal by its code and names what was found", async () => {
    mocks.exportFn.mockRejectedValue({
      response: {
        status: 422,
        data: { code: "TEMPLATE_EXPORT_PERSONAL_DATA", kinds: "bookingReference,identity" },
      },
    });
    render(<CommunityExportPanel templateId="t9" domain="bus" />);
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.download" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("parser:communityExport.refused.TEMPLATE_EXPORT_PERSONAL_DATA");
    expect(alert).toHaveTextContent("parser:labels.bus.bookingReference");
    expect(alert).toHaveTextContent("parser:communityExport.kind.identity");
    expect(mocks.download).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("words the deleted-sample refusal by its own code, not the generic failure", async () => {
    mocks.exportFn.mockRejectedValue({
      response: { status: 422, data: { code: "TEMPLATE_EXPORT_SOURCE_MISSING" } },
    });
    render(<CommunityExportPanel templateId="t9" domain="ferry" />);
    fireEvent.click(screen.getByRole("button", { name: "parser:communityExport.download" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "parser:communityExport.refused.TEMPLATE_EXPORT_SOURCE_MISSING"
    );
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
