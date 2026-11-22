import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import LifeBookRow from "../LifeBookRow";
import { JobFailedError } from "../../../lib/api/jobs";

/** The life book row: builds with the chosen scope and language, downloads, and fails visibly. */

const api = { build: vi.fn(), download: vi.fn(), getEvery: vi.fn() };
const downloadBlob = vi.fn();

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}|${Object.values(o).join("|")}` : k),
    i18n: { language: "en-GB" },
  }),
}));
vi.mock("../../../lib/export", () => ({ downloadBlob: (...a: unknown[]) => downloadBlob(...a) }));
vi.mock("../../../lib/api/lifeBook", () => ({
  lifeBookApi: {
    build: (...a: unknown[]) => api.build(...a),
    download: (id: string) => api.download(id),
  },
}));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { getEvery: () => api.getEvery() },
}));

const result = {
  exportId: "e1",
  filename: "travstats-lebensbuch-a-2026-11-22.html",
  bytes: 10,
  trips: 2,
  entries: 5,
  photos: 3,
  photosSkipped: 0,
};

describe("LifeBookRow", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    downloadBlob.mockReset();
  });

  it("builds the whole book in the UI language and downloads it under the server's name", async () => {
    api.build.mockResolvedValue(result);
    api.download.mockResolvedValue(new Blob(["<html>"]));
    render(<LifeBookRow />);
    fireEvent.click(screen.getByRole("button", { name: "settings:lifeBook.button" }));
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), result.filename)
    );
    expect(api.build.mock.calls[0].slice(0, 2)).toEqual([{ scope: "all" }, "en"]);
  });

  it("needs a trip before it builds a trip book, then sends that trip", async () => {
    api.getEvery.mockResolvedValue([{ id: "t1", name: "Lissabon" }]);
    api.build.mockResolvedValue(result);
    api.download.mockResolvedValue(new Blob(["x"]));
    render(<LifeBookRow />);
    fireEvent.change(screen.getByLabelText("settings:lifeBook.scope"), {
      target: { value: "trip" },
    });
    const button = screen.getByRole("button", { name: "settings:lifeBook.button" });
    expect(button).toBeDisabled();
    await screen.findByText("Lissabon");
    fireEvent.change(screen.getByLabelText("settings:lifeBook.trip"), { target: { value: "t1" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(api.build).toHaveBeenCalled());
    expect(api.build.mock.calls[0][0]).toEqual({ scope: "trip", tripId: "t1" });
  });

  it("says visibly when photos are missing from the finished book", async () => {
    api.build.mockResolvedValue({ ...result, photosSkipped: 4 });
    api.download.mockResolvedValue(new Blob(["x"]));
    render(<LifeBookRow />);
    fireEvent.click(screen.getByRole("button", { name: "settings:lifeBook.button" }));
    expect(await screen.findByText(/settings:lifeBook\.photosSkipped\|4/)).toBeInTheDocument();
  });

  it("names a too-large book instead of a generic failure, and downloads nothing", async () => {
    api.build.mockRejectedValue(new JobFailedError("LIFE_BOOK_TOO_LARGE", 413));
    render(<LifeBookRow />);
    fireEvent.click(screen.getByRole("button", { name: "settings:lifeBook.button" }));
    expect(
      await screen.findByText(/settings:lifeBook\.failed\.LIFE_BOOK_TOO_LARGE/)
    ).toBeInTheDocument();
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
