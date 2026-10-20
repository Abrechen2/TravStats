import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TemplateRepoSettings from "../TemplateRepoSettings";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts && "count" in opts ? `${key}#${String(opts.count)}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../lib/api/templateRepo", () => ({
  templateRepoApi: { get: mocks.get, save: mocks.save, test: mocks.test },
}));

const DEFAULT = "https://raw.githubusercontent.com/Abrechen2/travstats-templates/main";
const MIRROR = "https://mirror.example.org/templates/main";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({
    url: null,
    effectiveUrl: DEFAULT,
    origin: "default",
    defaultUrl: DEFAULT,
  });
});

/** forgejo#309: the template repository URL, tested and saved from Administration. */
describe("TemplateRepoSettings", () => {
  it("says where the sync reads from and reports a test as its stable code", async () => {
    mocks.test.mockResolvedValue({ result: "unreachable", templates: null });
    render(<TemplateRepoSettings />);
    expect(await screen.findByTestId("template-repo-effective")).toHaveTextContent(
      "admin:templateRepo.readsFrom.default"
    );
    fireEvent.change(screen.getByLabelText("admin:templateRepo.url"), {
      target: { value: MIRROR },
    });
    fireEvent.click(screen.getByRole("button", { name: "admin:templateRepo.test" }));
    expect(await screen.findByTestId("template-repo-test")).toHaveTextContent(
      "admin:templateRepo.result.unreachable"
    );
    expect(mocks.test).toHaveBeenCalledWith(MIRROR);
  });

  it("saves, and says the last good set is still in use when the new index was not read", async () => {
    mocks.save.mockResolvedValue({
      url: MIRROR,
      effectiveUrl: MIRROR,
      origin: "admin",
      defaultUrl: DEFAULT,
      sync: { index: "unavailable", ranAt: "2026-10-20T12:00:00.000Z", active: 28 },
    });
    render(<TemplateRepoSettings />);
    fireEvent.change(await screen.findByLabelText("admin:templateRepo.url"), {
      target: { value: MIRROR },
    });
    fireEvent.click(screen.getByRole("button", { name: "admin:templateRepo.save" }));
    expect(await screen.findByTestId("template-repo-saved")).toHaveTextContent(
      "admin:templateRepo.syncFailed#28"
    );
    expect(mocks.save).toHaveBeenCalledWith(MIRROR);
    expect(screen.getByTestId("template-repo-effective")).toHaveTextContent(
      "admin:templateRepo.readsFrom.admin"
    );
  });

  it("words a refused URL by the server's code", async () => {
    mocks.save.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { code: "TEMPLATE_REPO_URL_HTTPS_REQUIRED" } },
    });
    render(<TemplateRepoSettings />);
    fireEvent.change(await screen.findByLabelText("admin:templateRepo.url"), {
      target: { value: "http://templates.example.org/raw" },
    });
    fireEvent.click(screen.getByRole("button", { name: "admin:templateRepo.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "admin:templateRepo.result.httpsRequired"
    );
  });
});
