import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const postImportPreview = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/import", () => ({ postImportPreview }));
vi.mock("../../../lib/logger", () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import { Fr24ImportTile } from "../Fr24ImportTile";

const CSV = [
  "Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,Seat number,Seat type,Flight class,Flight reason,Note",
  "2024-03-01,LH400,Frankfurt (FRA/EDDF),New York (JFK/KJFK),10:05:00,12:55:00,08:50:00,,,,,,1,1,",
].join("\n");

/** A failed preview showed its sentence and left no trace of why it failed. */
describe("Fr24ImportTile — a failed preview", () => {
  it("tells the user and logs the cause", async () => {
    const cause = new Error("network down");
    postImportPreview.mockRejectedValueOnce(cause);
    render(<Fr24ImportTile />);
    const file = new File([CSV], "fr24.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("settings:import.tile.fr24.uploadLabel"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByText("settings:import.parserErrors.previewFailed")).toBeInTheDocument()
    );
    expect(logError).toHaveBeenCalledWith(expect.any(String), cause);
  });
});
