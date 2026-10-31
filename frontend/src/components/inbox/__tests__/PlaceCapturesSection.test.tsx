import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import PlaceCapturesSection from "../PlaceCapturesSection";
import { placeCapturesApi, type PlaceCapture } from "../../../lib/api/placeCaptures";

/**
 * A position the phone captured without a name must reach the reader as itself
 * (companion#90): shown as an unnamed place, named or dismissed on the server,
 * and a failed request keeps the row and says why instead of looking done.
 */

vi.mock("../../../lib/api/placeCaptures", () => ({
  placeCapturesApi: { listOpen: vi.fn(), resolve: vi.fn(), dismiss: vi.fn() },
}));

const capture = (over: Partial<PlaceCapture> = {}): PlaceCapture => ({
  id: "cap-1",
  clientId: "c-1",
  lat: 37.5665,
  lon: 126.978,
  accuracyM: 12.4,
  capturedAt: "2026-10-04T05:30:00.000Z",
  note: "Café am Fluss",
  status: "open",
  placeId: null,
  visitId: null,
  createdAt: "2026-10-04T05:31:00.000Z",
  ...over,
});

const axiosFailure = (status: number, code?: string) =>
  Object.assign(new Error("failed"), {
    isAxiosError: true,
    response: { status, data: code ? { code, error: "English prose" } : {} },
  });

describe("PlaceCapturesSection", () => {
  beforeEach(() => {
    vi.mocked(placeCapturesApi.listOpen).mockReset();
    vi.mocked(placeCapturesApi.resolve).mockReset();
    vi.mocked(placeCapturesApi.dismiss).mockReset();
  });

  it("shows an open capture as an unnamed place with its time, position and note", async () => {
    vi.mocked(placeCapturesApi.listOpen).mockResolvedValue([capture()]);
    render(<PlaceCapturesSection />);
    await screen.findByText("dataQuality:placeCaptures.unnamed");
    expect(screen.getByText("Café am Fluss")).toBeInTheDocument();
    expect(screen.getByText(/37\.56650, 126\.97800/)).toBeInTheDocument();
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-10-04T05:30:00.000Z"
    );
  });

  it("renders nothing when there is no open capture", async () => {
    vi.mocked(placeCapturesApi.listOpen).mockResolvedValue([]);
    const { container } = render(<PlaceCapturesSection />);
    await waitFor(() => expect(placeCapturesApi.listOpen).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when the list cannot be loaded, instead of reading as an empty inbox", async () => {
    vi.mocked(placeCapturesApi.listOpen).mockRejectedValue(axiosFailure(500));
    render(<PlaceCapturesSection />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("names a capture: sends the name and category, then the row is gone", async () => {
    vi.mocked(placeCapturesApi.listOpen)
      .mockResolvedValueOnce([capture()])
      .mockResolvedValueOnce([]);
    vi.mocked(placeCapturesApi.resolve).mockResolvedValue(capture({ status: "resolved" }));
    render(<PlaceCapturesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "dataQuality:placeCaptures.name" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hof Café" } });
    fireEvent.click(screen.getByRole("button", { name: "dataQuality:placeCaptures.save" }));
    await waitFor(() =>
      expect(placeCapturesApi.resolve).toHaveBeenCalledWith("cap-1", {
        name: "Hof Café",
        category: "other",
      })
    );
    await waitFor(() => expect(screen.queryByText("Café am Fluss")).not.toBeInTheDocument());
  });

  it("keeps the row and shows the reason when naming fails", async () => {
    vi.mocked(placeCapturesApi.listOpen).mockResolvedValue([capture()]);
    vi.mocked(placeCapturesApi.resolve).mockRejectedValue(axiosFailure(500));
    render(<PlaceCapturesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "dataQuality:placeCaptures.name" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hof Café" } });
    fireEvent.click(screen.getByRole("button", { name: "dataQuality:placeCaptures.save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Café am Fluss")).toBeInTheDocument();
  });

  it("dismisses a capture on the server and drops the row", async () => {
    vi.mocked(placeCapturesApi.listOpen)
      .mockResolvedValueOnce([capture()])
      .mockResolvedValueOnce([]);
    vi.mocked(placeCapturesApi.dismiss).mockResolvedValue(capture({ status: "dismissed" }));
    render(<PlaceCapturesSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: "dataQuality:placeCaptures.dismiss" })
    );
    await waitFor(() => expect(placeCapturesApi.dismiss).toHaveBeenCalledWith("cap-1"));
    await waitFor(() => expect(screen.queryByText("Café am Fluss")).not.toBeInTheDocument());
  });

  it("keeps the row and shows an error when dismissing fails", async () => {
    vi.mocked(placeCapturesApi.listOpen).mockResolvedValue([capture()]);
    vi.mocked(placeCapturesApi.dismiss).mockRejectedValue(axiosFailure(500));
    render(<PlaceCapturesSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: "dataQuality:placeCaptures.dismiss" })
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Café am Fluss")).toBeInTheDocument();
  });

  it("reloads the list when the server says the capture was already resolved", async () => {
    vi.mocked(placeCapturesApi.listOpen)
      .mockResolvedValueOnce([capture()])
      .mockResolvedValueOnce([]);
    vi.mocked(placeCapturesApi.dismiss).mockRejectedValue(
      axiosFailure(409, "CAPTURE_ALREADY_RESOLVED")
    );
    render(<PlaceCapturesSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: "dataQuality:placeCaptures.dismiss" })
    );
    await waitFor(() => expect(placeCapturesApi.listOpen).toHaveBeenCalledTimes(2));
  });
});
