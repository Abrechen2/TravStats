import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import TrackArchiveSection from "../TrackArchiveSection";

const mockToursVisible = vi.fn(() => true);
const importFiles = vi.fn();
const downloadAll = vi.fn();
const downloadBlob = vi.fn();

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
  }),
}));
vi.mock("../../../hooks/useToursVisible", () => ({
  useToursVisible: () => mockToursVisible(),
}));
vi.mock("../../../lib/export", () => ({
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
}));
vi.mock("../../../lib/api/trackArchive", async (orig) => {
  const real = await orig<typeof import("../../../lib/api/trackArchive")>();
  return {
    ...real,
    trackArchiveApi: {
      importFiles: (...a: unknown[]) => importFiles(...a),
      downloadAll: () => downloadAll(),
      downloadTrack: vi.fn(),
    },
  };
});

const PREVIEW = {
  dryRun: true,
  files: [
    { file: "a.gpx", action: "createTour", tourId: null, tourName: "Preikestolen" },
    { file: "b.gpx", action: "duplicate", tourId: "t1", tourName: "Trolltunga" },
    {
      file: "c.gpx",
      action: "error",
      tourId: null,
      tourName: "Fjorde",
      message: "roadtripNotFound",
    },
  ],
};

function choose(files: File[]) {
  fireEvent.change(screen.getByLabelText("roadtrips:trackArchive.choose"), {
    target: { files },
  });
}

describe("TrackArchiveSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToursVisible.mockReturnValue(true);
  });

  it("is not there while tours sit behind the beta switch", () => {
    mockToursVisible.mockReturnValue(false);
    const { container } = render(<TrackArchiveSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("previews first, writes nothing, and applies exactly the files it previewed", async () => {
    importFiles.mockResolvedValueOnce(PREVIEW).mockResolvedValueOnce({ ...PREVIEW, dryRun: false });
    render(<TrackArchiveSection />);
    const file = new File(["<gpx/>"], "archiv.zip");
    choose([file]);

    await screen.findByText("roadtrips:trackArchive.preview");
    expect(importFiles).toHaveBeenCalledWith([file], true);
    // Why a file cannot land is said per file, not folded into a count.
    expect(screen.getByText(/roadtrips:trackArchive.errors.roadtripNotFound/)).toBeInTheDocument();

    // Only the one file that would be written counts toward the button.
    fireEvent.click(screen.getByText('roadtrips:trackArchive.apply {"count":1}'));
    await screen.findByText("roadtrips:trackArchive.applied");
    expect(importFiles).toHaveBeenLastCalledWith([file], false);
  });

  it("offers nothing to apply when every file is already there", async () => {
    importFiles.mockResolvedValueOnce({ dryRun: true, files: [PREVIEW.files[1]] });
    render(<TrackArchiveSection />);
    choose([new File(["<gpx/>"], "b.gpx")]);
    const apply = await screen.findByText('roadtrips:trackArchive.apply {"count":0}');
    expect(apply).toBeDisabled();
  });

  it("names the limit when the server refuses an archive as too large", async () => {
    const { TrackArchiveTooLarge } = await import("../../../lib/api/trackArchive");
    importFiles.mockRejectedValueOnce(new TrackArchiveTooLarge());
    render(<TrackArchiveSection />);
    choose([new File(["x"], "bomb.zip")]);
    expect(await screen.findByText("roadtrips:trackArchive.tooLarge")).toBeInTheDocument();
  });

  it("saves the ZIP under the name the server gave it", async () => {
    const blob = new Blob(["zip"]);
    downloadAll.mockResolvedValueOnce({
      blob,
      filename: "travstats-aufzeichnungen-2026-09-25.zip",
    });
    render(<TrackArchiveSection />);
    fireEvent.click(screen.getByText("roadtrips:trackArchive.exportButton"));
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(blob, "travstats-aufzeichnungen-2026-09-25.zip")
    );
  });
});
