import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import CoverImage from "../../../components/Trips/CoverImage";
import CoverCropHost from "../../../components/Trips/CoverCropHost";
import { useCoverCropStore, type CoverCropRequest } from "../../../store/coverCropStore";
import { tripsApi } from "../../../lib/api/trips";

vi.mock("../../../lib/api/trips", () => ({ tripsApi: { update: vi.fn() } }));

/** jsdom lays nothing out: give the frame and the photo sizes, then fire `load`. */
function sizeEverything(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: 100,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 400,
    bottom: 100,
    toJSON: () => ({}),
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 1000 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    value: 3000,
  });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
    configurable: true,
    value: 1000,
  });
}

describe("CoverImage: the crop is applied where the cover renders", () => {
  beforeEach(sizeEverything);

  it("without a crop it renders centred as before (object-fit cover, no placement)", () => {
    render(
      <div style={{ position: "relative" }}>
        <CoverImage url="/c.jpg" crop={null} opacity={0.2} />
      </div>
    );
    const img = document.querySelector("img")!;
    fireEvent.load(img);
    expect(img.dataset.cropped).toBe("false");
    expect(img.className).toContain("object-cover");
  });

  it("with a crop it places the photo by the crop, not by the centre", () => {
    render(
      <div style={{ position: "relative" }}>
        <CoverImage url="/c.jpg" crop={{ x: 0.4, y: 0.5, zoom: 2 }} opacity={0.2} />
      </div>
    );
    const img = document.querySelector("img")!;
    fireEvent.load(img);
    expect(img.dataset.cropped).toBe("true");
    // frame 400x100, photo 3000x1000: cover scale 400/3000, zoom 2 -> 800x267 rendered;
    // focal x 0.4 sits at the frame centre: left = 200 - 0.4*800 = -120.
    expect(parseFloat(img.style.left)).toBeCloseTo(-120, 0);
    expect(parseFloat(img.style.width)).toBeCloseTo(800, 0);
  });
});

describe("CoverCropHost / editor", () => {
  beforeEach(() => {
    sizeEverything();
    vi.mocked(tripsApi.update).mockReset();
    useCoverCropStore.setState({ request: null });
  });

  const openEditor = (over: Partial<CoverCropRequest> = {}) => {
    const onDone = vi.fn();
    render(<CoverCropHost />);
    act(() => {
      useCoverCropStore.getState().open({
        tripId: "t1",
        coverImageUrl: "/c.jpg",
        initialCrop: null,
        onDone,
        ...over,
      });
    });
    for (const img of document.querySelectorAll("img")) fireEvent.load(img);
    return onDone;
  };

  it("confirming a changed crop saves it on the trip and reloads", async () => {
    vi.mocked(tripsApi.update).mockResolvedValue({} as never);
    const onDone = openEditor({ initialCrop: { x: 0.5, y: 0.5, zoom: 2 } });
    fireEvent.keyDown(screen.getByTestId("cover-crop-stage"), { key: "+" });
    fireEvent.click(screen.getByRole("button", { name: "cover.crop.confirm" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [id, input] = vi.mocked(tripsApi.update).mock.calls[0];
    expect(id).toBe("t1");
    expect(input.coverCrop!.zoom).toBeGreaterThan(2);
    expect(useCoverCropStore.getState().request).toBeNull();
  });

  it("an untouched crop saves as null (centred), Reset returns to it", async () => {
    vi.mocked(tripsApi.update).mockResolvedValue({} as never);
    openEditor({ initialCrop: { x: 0.3, y: 0.5, zoom: 3 } });
    fireEvent.click(screen.getByRole("button", { name: "cover.crop.reset" }));
    fireEvent.click(screen.getByRole("button", { name: "cover.crop.confirm" }));
    await waitFor(() =>
      expect(tripsApi.update).toHaveBeenCalledWith("t1", {
        coverCrop: null,
        coverCropFor: "/c.jpg",
      })
    );
  });

  it("Escape cancels without saving", () => {
    const onDone = openEditor();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tripsApi.update).not.toHaveBeenCalled();
    expect(useCoverCropStore.getState().request).toBeNull();
    expect(onDone).toHaveBeenCalled();
  });

  it("a failed save keeps the editor open and says so", async () => {
    vi.mocked(tripsApi.update).mockRejectedValue(new Error("500"));
    openEditor({ initialCrop: { x: 0.5, y: 0.5, zoom: 2 } });
    fireEvent.click(screen.getByRole("button", { name: "cover.crop.confirm" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("cover-crop-editor")).toBeInTheDocument();
  });

  it("an untouched editor keeps the stored crop instead of re-clamping it to the header shape", async () => {
    vi.mocked(tripsApi.update).mockResolvedValue({} as never);
    // x 0.05 is valid for a narrow card frame but outside the header frame's range.
    openEditor({ initialCrop: { x: 0.05, y: 0.5, zoom: 6 } });
    fireEvent.click(screen.getByRole("button", { name: "cover.crop.confirm" }));
    await waitFor(() => expect(tripsApi.update).toHaveBeenCalled());
    expect(vi.mocked(tripsApi.update).mock.calls[0][1].coverCrop).toEqual({
      x: 0.05,
      y: 0.5,
      zoom: 6,
    });
  });

  it("arrow keys pan the photo and the frame stays filled", () => {
    openEditor({ initialCrop: { x: 0.5, y: 0.5, zoom: 3 } });
    const before = (screen.getByTestId("cover-crop-image") as HTMLImageElement).style.left;
    fireEvent.keyDown(screen.getByTestId("cover-crop-stage"), { key: "ArrowLeft" });
    const after = (screen.getByTestId("cover-crop-image") as HTMLImageElement).style.left;
    expect(after).not.toBe(before);
    expect(parseFloat(after)).toBeLessThanOrEqual(0);
  });
});
