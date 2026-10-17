import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const parseTrackerExport = vi.hoisted(() => vi.fn());
const postImportPreview = vi.hoisted(() => vi.fn());
const commitPreviewRows = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/import", () => ({ parseTrackerExport, postImportPreview }));
vi.mock("../commitPreview", () => ({ commitPreviewRows }));
vi.mock("../../../lib/logger", () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import { TrackerImportTile } from "../TrackerImportTile";

const LABEL = "settings:import.tile.tracker.uploadLabel";

function drop(content: string, name = "export.csv"): void {
  const file = new File([content], name, { type: "text/csv" });
  // jsdom's File has no text(); the tile reads the file through it.
  Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
  fireEvent.change(screen.getByLabelText(LABEL), { target: { files: [file] } });
}

const ROW = {
  date: "2023-08-01",
  fromIata: "FRA",
  toIata: "JFK",
  source: "jetlog",
  sourceRowIndex: 0,
};

describe("TrackerImportTile (forgejo#311)", () => {
  beforeEach(() => {
    parseTrackerExport.mockReset();
    postImportPreview.mockReset();
    commitPreviewRows.mockReset();
  });

  it("names what it expected when the file is not an export it knows", async () => {
    parseTrackerExport.mockResolvedValueOnce({
      rows: [],
      parserErrors: [{ rowIndex: -1, code: "unknownFormat", message: "Unrecognised" }],
      format: null,
      expected: { openflights: ["Date", "From", "To", "Flight_Number"] },
    });
    render(<TrackerImportTile />);
    drop("a,b\n1,2\n");
    await waitFor(() =>
      expect(screen.getByText(/settings:import.parserErrors.unknownFormat/)).toBeInTheDocument()
    );
    expect(screen.getByText(/Date, From, To, Flight_Number/)).toBeInTheDocument();
    expect(postImportPreview).not.toHaveBeenCalled();
  });

  it("previews the rows and says which app the file came from", async () => {
    parseTrackerExport.mockResolvedValueOnce({ rows: [ROW], parserErrors: [], format: "jetlog" });
    postImportPreview.mockResolvedValueOnce({
      rows: [],
      summary: { ok: 0, problems: 0, duplicates: 0, unresolvable: 0 },
    });
    render(<TrackerImportTile />);
    drop("date,origin,destination\n2023-08-01,EDDF,KJFK\n");
    await waitFor(() => expect(postImportPreview).toHaveBeenCalledWith([ROW]));
    expect(await screen.findByText(/settings:import.tile.tracker.detected/)).toBeInTheDocument();
  });

  it("refuses a file larger than the server takes before sending it", async () => {
    render(<TrackerImportTile />);
    drop("x".repeat(5_000_001));
    await waitFor(() =>
      expect(screen.getByText(/settings:import.parserErrors.tooLarge/)).toBeInTheDocument()
    );
    expect(parseTrackerExport).not.toHaveBeenCalled();
  });

  it("tells the user when the server cannot be reached, and logs why", async () => {
    const cause = new Error("network down");
    parseTrackerExport.mockRejectedValueOnce(cause);
    render(<TrackerImportTile />);
    drop("date,origin,destination\n");
    await waitFor(() =>
      expect(screen.getByText("settings:import.parserErrors.previewFailed")).toBeInTheDocument()
    );
    expect(logError).toHaveBeenCalledWith(expect.any(String), cause);
  });

  it("drops AirTrail's flight tracks before upload — they are not imported and can be megabytes", async () => {
    parseTrackerExport.mockResolvedValueOnce({
      rows: [],
      parserErrors: [],
      format: "airtrail",
    });
    render(<TrackerImportTile />);
    const json = JSON.stringify({
      users: [],
      flights: [{ date: "2024-01-01", track: { points: [[1, 2, 3]] } }],
    });
    drop(json, "airtrail.json");
    await waitFor(() => expect(parseTrackerExport).toHaveBeenCalled());
    const sent = JSON.parse(parseTrackerExport.mock.calls[0][0] as string);
    expect(sent.flights[0]).toEqual({ date: "2024-01-01" });
  });
});
