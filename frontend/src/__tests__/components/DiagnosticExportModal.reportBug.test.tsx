import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiagnosticExportModal from "../../components/DiagnosticExportModal";
import { diagnosticExportApi } from "../../lib/api/diagnosticExport";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const mockAddToast = vi.fn();
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof mockAddToast }) => unknown) =>
    selector({ addToast: mockAddToast }),
}));

vi.mock("../../lib/api/diagnosticExport", () => ({
  diagnosticExportApi: {
    fetch: vi.fn(),
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fakeBundle = {
  generatedAt: "2026-04-16T10:00:00.000Z",
  version: "0.28.0-beta",
  platform: { nodeVersion: "v20", os: "linux", uptimeSeconds: 10 },
  logs: { stats: {}, files: [], appTail: [], errorTail: [] },
  notes: "scrubbed",
};

describe("DiagnosticExportModal — Report Bug", () => {
  const openMock = vi.fn();
  const createObjectURLMock = vi.fn(() => "blob:mock");

  beforeEach(() => {
    vi.clearAllMocks();
    (diagnosticExportApi.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBundle);
    vi.stubGlobal("open", openMock);
    // jsdom lacks these; the bug-report flow downloads the bundle as a file
    // (too large to paste into GitHub — #157).
    URL.createObjectURL = createObjectURLMock;
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads the bundle file and opens a prefilled GitHub issue URL", async () => {
    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common:diagnostic.reportBug" })).toBeEnabled()
    );

    await userEvent.click(screen.getByRole("button", { name: "common:diagnostic.reportBug" }));

    // 1. The bundle was downloaded as a file (a blob URL was created)
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);

    // 2. window.open called once with prefilled URL
    expect(openMock).toHaveBeenCalledTimes(1);
    const [url, target, features] = openMock.mock.calls[0];
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    expect(url).toContain("github.com/Abrechen2/TravStats/issues/new");
    expect(url).toContain("template=bug.yml");
    expect(url).toContain("labels=bug");
    expect(url).toContain("version=0.28.0-beta");

    // 3. Success toast fired (reportBugOpened)
    expect(mockAddToast).toHaveBeenCalledWith("info", "common:diagnostic.reportBugOpened");
  });

  it("disables the Report Bug button until the bundle has loaded", () => {
    // fetch returns a pending promise so the bundle stays null
    (diagnosticExportApi.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByRole("button", { name: "common:diagnostic.reportBug" })).toBeDisabled();
  });
});
