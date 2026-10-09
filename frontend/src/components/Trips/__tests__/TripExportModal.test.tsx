import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TripExportModal } from "../TripExportModal";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});

const download = vi.fn();
vi.mock("../../../lib/api/tripExchange", () => ({
  tripExchangeApi: { download: (...args: unknown[]) => download(...args) },
}));
const downloadBlob = vi.fn();
vi.mock("../../../lib/export", () => ({
  downloadBlob: (...args: unknown[]) => downloadBlob(...args),
}));

describe("TripExportModal", () => {
  beforeEach(() => vi.clearAllMocks());

  const renderModal = () => render(<TripExportModal tripId="trip-1" onClose={vi.fn()} />);

  it("starts with every extra off and says the file leaves the server", () => {
    renderModal();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box).not.toBeChecked();
    expect(screen.getByTestId("trip-export-warning")).toHaveTextContent("verlässt den Server");
  });

  it("downloads with exactly the extras that were ticked", async () => {
    const blob = new Blob(["zip"]);
    download.mockResolvedValue({ blob, filename: "lissabon-2026-10-09.travstats" });
    renderModal();
    fireEvent.click(screen.getByRole("checkbox", { name: /Persönliche Angaben mitgeben/ }));
    fireEvent.click(screen.getByRole("button", { name: "Herunterladen" }));
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(blob, "lissabon-2026-10-09.travstats")
    );
    expect(download).toHaveBeenCalledWith("trip-1", {
      documents: false,
      photos: false,
      private: true,
    });
    expect(screen.getByText("Die Datei wurde heruntergeladen.")).toBeInTheDocument();
  });

  it("shows a failed export as itself and downloads nothing", async () => {
    download.mockRejectedValue({ response: { status: 429 } });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Herunterladen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zu viele Exporte");
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(screen.queryByText("Die Datei wurde heruntergeladen.")).not.toBeInTheDocument();
  });
});
