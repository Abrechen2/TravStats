import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ exportFile: vi.fn() }));
vi.mock("../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: api,
}));
const downloads = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock("../../../lib/export", () => downloads);
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

import TrackExportDialog from "../TrackExportDialog";

/**
 * A span over the export's cap comes in parts (Codex P2): the dialog follows
 * the server's continuation instead of leaving the rest unreachable — "Rest
 * exportieren" asks for exactly the span the server named, until the file is
 * whole.
 */

const blob = new Blob(["x"]);
const REST = { from: "2026-10-12T05:00:00.000Z", to: "2026-10-12T15:00:00.000Z" };

describe("TrackExportDialog", () => {
  beforeEach(() => {
    api.exportFile.mockReset();
    downloads.downloadBlob.mockReset();
  });

  const open = () =>
    render(<TrackExportDialog open onClose={() => {}} fromDay="2026-10-12" toDay="2026-10-12" />);

  it("downloads a whole span in one file and says so", async () => {
    api.exportFile.mockResolvedValue({ blob, filename: "a.gpx", truncated: false, rest: null });
    open();
    fireEvent.click(screen.getByRole("button", { name: "track:export.do" }));
    expect(await screen.findByText("track:export.done")).toBeInTheDocument();
    expect(downloads.downloadBlob).toHaveBeenCalledWith(blob, "a.gpx");
  });

  it("offers the rest of a truncated span and fetches exactly the span the server named", async () => {
    api.exportFile
      .mockResolvedValueOnce({ blob, filename: "a.gpx", truncated: true, rest: REST })
      .mockResolvedValueOnce({ blob, filename: "a.gpx", truncated: false, rest: null });
    open();
    fireEvent.click(screen.getByRole("button", { name: "track:export.do" }));
    expect(
      await screen.findByText('track:export.truncated {"part":1}', { exact: false })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "track:export.rest" }));
    await waitFor(() => expect(api.exportFile).toHaveBeenCalledTimes(2));
    expect(api.exportFile).toHaveBeenLastCalledWith(REST, "gpx");
    // Each part is its own file, numbered so none replaces the one before.
    await waitFor(() => expect(downloads.downloadBlob).toHaveBeenLastCalledWith(blob, "a-2.gpx"));
    expect(
      await screen.findByText('track:export.doneParts {"count":2}', { exact: false })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "track:export.rest" })).toBeNull();
  });

  it("says plainly when a truncated file names no continuation", async () => {
    api.exportFile.mockResolvedValue({ blob, filename: "a.gpx", truncated: true, rest: null });
    open();
    fireEvent.click(screen.getByRole("button", { name: "track:export.do" }));
    expect(await screen.findByText("track:export.truncatedNoRest")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "track:export.rest" })).toBeNull();
  });

  it("starts over when the span is changed after a part", async () => {
    api.exportFile.mockResolvedValue({ blob, filename: "a.gpx", truncated: true, rest: REST });
    open();
    fireEvent.click(screen.getByRole("button", { name: "track:export.do" }));
    await screen.findByRole("button", { name: "track:export.rest" });
    fireEvent.change(screen.getByLabelText("track:export.to"), {
      target: { value: "2026-10-13" },
    });
    expect(screen.getByRole("button", { name: "track:export.do" })).toBeInTheDocument();
  });
});
