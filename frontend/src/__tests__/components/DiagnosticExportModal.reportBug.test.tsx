import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import DiagnosticExportModal from "../../components/DiagnosticExportModal";
import { diagnosticExportApi } from "../../lib/api/diagnosticExport";
import { versionApi } from "../../lib/api/version";
import deCommon from "../../i18n/resources/de/common.json";
import type { DiagnosticBundle } from "../../shared/logContract";

/**
 * "Fehler melden" (audit 2026-09-26, finding 7). Rendered with the REAL German
 * copy, so the assertions read what an admin reads.
 */

function deT(key: string, options?: Record<string, unknown>): string {
  const [, path] = key.split(":");
  const value = path
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      deCommon
    );
  if (typeof value !== "string") return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
}

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: deT, i18n: { language: "de" } }),
}));

const mockAddToast = vi.fn();
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof mockAddToast }) => unknown) =>
    selector({ addToast: mockAddToast }),
}));

vi.mock("../../lib/api/diagnosticExport", () => ({
  diagnosticExportApi: { fetch: vi.fn() },
}));

vi.mock("../../lib/api/version", () => ({
  versionApi: { get: vi.fn() },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fakeBundle: DiagnosticBundle = {
  schema: "travstats-diagnostic/2",
  generatedAt: "2026-09-26T10:00:00.000Z",
  app: { version: "2.7.0", buildVersion: "2.7.0-beta.15" },
  runtime: { node: "v22.0.0", os: "linux", arch: "x64", uptimeSeconds: 10 },
  domains: { status: "ok", data: { flight: 2 } },
  settings: { status: "failed", errorCode: "P1001" },
  counts: { status: "ok", data: { users: 2 } },
  database: {
    status: "ok",
    data: { appliedMigrations: 3, failedMigrations: 0, latestMigration: "20260926_x" },
  },
  logs: {
    status: "ok",
    data: { files: [], recent: [], errors: [], unreadableFiles: 0, truncated: false },
  },
};

function httpError(status: number, body: Record<string, unknown> = {}): AxiosError {
  return new AxiosError("Request failed", "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    statusText: "",
    data: body,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

describe("DiagnosticExportModal — Report Bug", () => {
  const openMock = vi.fn();
  const createObjectURLMock = vi.fn(() => "blob:mock");
  let downloadedBlob: Blob | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    downloadedBlob = null;
    vi.mocked(diagnosticExportApi.fetch).mockResolvedValue(fakeBundle);
    vi.mocked(versionApi.get).mockResolvedValue({
      version: "2.7.0",
      buildVersion: "2.7.0-beta.15",
      latestAvailable: null,
      updateAvailable: false,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
    });
    vi.stubGlobal("open", openMock);
    URL.createObjectURL = vi.fn((blob: Blob) => {
      downloadedBlob = blob;
      return createObjectURLMock();
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews exactly the JSON that is downloaded", async () => {
    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);
    const preview = await screen.findByRole("textbox", {
      name: "Vorschau – genau diese Datei wird heruntergeladen:",
    });

    await userEvent.click(screen.getByRole("button", { name: "Als Datei speichern" }));

    expect(downloadedBlob).not.toBeNull();
    // jsdom's Blob has no text(); FileReader reads it the same way a browser would.
    const downloaded = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(downloadedBlob!);
    });
    expect(downloaded).toBe((preview as HTMLTextAreaElement).value);
    expect(JSON.parse((preview as HTMLTextAreaElement).value).schema).toBe(
      "travstats-diagnostic/2"
    );
  });

  it("states what is included instead of promising that all personal data is gone", async () => {
    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);
    await screen.findByRole("textbox");

    expect(screen.queryByText(/Alle persönlichen Daten wurden entfernt/)).toBeNull();
    expect(screen.getByText(/Nicht enthalten: Log-Texte, Namen/)).toBeInTheDocument();
    expect(screen.getByText(/Dateiname:Zeile/)).toBeInTheDocument();
  });

  it("says which section failed, and with which code, instead of showing it empty", async () => {
    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);
    expect(
      await screen.findByText(
        "Abschnitt „settings“ konnte nicht erfasst werden (Code P1001) und ist im Paket als fehlgeschlagen markiert."
      )
    ).toBeInTheDocument();
  });

  it("downloads the bundle file and opens a prefilled GitHub issue URL", async () => {
    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Fehler melden" })).toBeEnabled()
    );

    await userEvent.click(screen.getByRole("button", { name: "Fehler melden" }));

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledTimes(1);
    const [url, target, features] = openMock.mock.calls[0];
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    expect(url).toContain("github.com/Abrechen2/TravStats/issues/new");
    expect(url).toContain("template=bug.yml");
    expect(url).toContain("labels=bug");
    expect(url).toContain("version=2.7.0");
    expect(mockAddToast).toHaveBeenCalledWith("info", deCommon.diagnostic.reportBugOpened);
  });

  it("still opens the issue when the export fails, and says why there is no attachment", async () => {
    vi.mocked(diagnosticExportApi.fetch).mockRejectedValue(
      httpError(429, { error: "Too many diagnostic export requests" })
    );
    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Das Diagnose-Paket konnte nicht erzeugt werden: zu viele Exporte in kurzer Zeit"
    );
    expect(alert).not.toHaveTextContent("Too many");

    const report = screen.getByRole("button", { name: "Fehler melden" });
    expect(report).toBeEnabled();
    await userEvent.click(report);

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    const [url] = openMock.mock.calls[0];
    expect(url).toContain("github.com/Abrechen2/TravStats/issues/new");
    expect(url).toContain("template=bug.yml");
    expect(url).toContain("version=2.7.0");
    expect(createObjectURLMock).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith("warning", deCommon.diagnostic.exportFailedToast);
  });

  it("names a withheld bundle as such", async () => {
    vi.mocked(diagnosticExportApi.fetch).mockRejectedValue(
      httpError(500, { error: "x", code: "DIAGNOSTIC_EXPORT_REJECTED" })
    );
    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "das Paket hat die eigene Prüfliste nicht bestanden"
    );
  });

  it("opens the issue without a version when even the version lookup fails", async () => {
    vi.mocked(diagnosticExportApi.fetch).mockRejectedValue(httpError(500));
    vi.mocked(versionApi.get).mockRejectedValue(new Error("offline"));
    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Serverfehler (HTTP 500)");

    await userEvent.click(screen.getByRole("button", { name: "Fehler melden" }));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(openMock.mock.calls[0][0]).not.toContain("version=");
  });

  it("disables the Report Bug button while the bundle is being built", () => {
    vi.mocked(diagnosticExportApi.fetch).mockReturnValue(new Promise(() => {}));
    render(<DiagnosticExportModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Fehler melden" })).toBeDisabled();
  });
});
