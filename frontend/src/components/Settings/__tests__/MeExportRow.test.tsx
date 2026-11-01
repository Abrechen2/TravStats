import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import MeExportRow from "../MeExportRow";
import { MeExportError } from "../../../lib/api/meExport";

const download = vi.fn();
const downloadBlob = vi.fn();

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/export", () => ({
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
}));
vi.mock("../../../lib/api/meExport", async (orig) => {
  const real = await orig<typeof import("../../../lib/api/meExport")>();
  return { ...real, meExportApi: { download: () => download() } };
});

describe("MeExportRow", () => {
  beforeEach(() => {
    download.mockReset();
    downloadBlob.mockReset();
  });

  it("downloads the file the server names", async () => {
    const blob = new Blob(["{}"]);
    download.mockResolvedValue({ blob, filename: "travstats-my-data-2026-10-31.json" });
    render(<MeExportRow />);
    fireEvent.click(screen.getByRole("button", { name: "settingsRows:data.meine.btn" }));
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(blob, "travstats-my-data-2026-10-31.json")
    );
    expect(await screen.findByRole("status")).toHaveTextContent("settingsRows:data.meine.res");
  });

  it("names the reason when the download fails, instead of staying silent (rate limit)", async () => {
    download.mockRejectedValue(new MeExportError("rateLimited"));
    render(<MeExportRow />);
    fireEvent.click(screen.getByRole("button", { name: "settingsRows:data.meine.btn" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings:meExport.failed.rateLimited"
    );
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("falls back to the server-error text for an unknown failure", async () => {
    download.mockRejectedValue(new Error("boom"));
    render(<MeExportRow />);
    fireEvent.click(screen.getByRole("button", { name: "settingsRows:data.meine.btn" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:meExport.failed.server");
  });
});
