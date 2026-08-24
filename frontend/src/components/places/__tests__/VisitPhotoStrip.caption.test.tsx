import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VisitPhotoStrip } from "../VisitPhotoStrip";
import type { PlaceVisitPhoto } from "../../../types/placeList";

const updateVisitPhoto = vi.fn();

vi.mock("../../../lib/api/places", () => ({
  updateVisitPhoto: (...args: unknown[]) => updateVisitPhoto(...args),
  uploadVisitPhotos: vi.fn(),
  deleteVisitPhoto: vi.fn(),
}));

function photo(over: Partial<PlaceVisitPhoto> = {}): PlaceVisitPhoto {
  return {
    id: "p1",
    url: "/api/v1/places/visits/v1/photos/p1/file",
    caption: null,
    mimetype: "image/jpeg",
    sizeBytes: 1,
    sortIdx: 0,
    createdAt: new Date().toISOString(),
    ...over,
  } as PlaceVisitPhoto;
}

/**
 * `PATCH …/photos/:id` accepted a caption from the day the photo-proof route
 * was built, and no client function existed — the caption was readable as an
 * image's alt text and typeable nowhere.
 */
describe("VisitPhotoStrip — captions", () => {
  beforeEach(() => {
    updateVisitPhoto.mockReset();
    updateVisitPhoto.mockImplementation(
      async (_v: string, _p: string, input: { caption: string | null }) =>
        photo({ caption: input.caption })
    );
  });

  it("saves a typed caption, trimmed", async () => {
    const user = userEvent.setup();
    render(<VisitPhotoStrip visitId="v1" photos={[photo()]} />);

    await user.click(screen.getByRole("button", { name: /caption|unterschrift/i }));
    const box = screen.getByRole("textbox");
    await user.type(box, "  Am Gipfel  ");
    await user.tab();

    await waitFor(() =>
      expect(updateVisitPhoto).toHaveBeenCalledWith("v1", "p1", { caption: "Am Gipfel" })
    );
  });

  // A photo with no caption and a photo captioned with nothing are the same
  // thing; only one of them belongs in the database.
  it("clears the caption when the box is emptied, rather than storing an empty string", async () => {
    const user = userEvent.setup();
    render(<VisitPhotoStrip visitId="v1" photos={[photo({ caption: "Alt" })]} />);

    await user.click(screen.getByRole("button", { name: /Alt/ }));
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.tab();

    await waitFor(() =>
      expect(updateVisitPhoto).toHaveBeenCalledWith("v1", "p1", { caption: null })
    );
  });

  it("writes nothing when the caption did not change", async () => {
    const user = userEvent.setup();
    render(<VisitPhotoStrip visitId="v1" photos={[photo({ caption: "Alt" })]} />);

    await user.click(screen.getByRole("button", { name: /Alt/ }));
    await user.tab();

    expect(updateVisitPhoto).not.toHaveBeenCalled();
  });

  it("abandons the edit on Escape", async () => {
    const user = userEvent.setup();
    render(<VisitPhotoStrip visitId="v1" photos={[photo({ caption: "Alt" })]} />);

    await user.click(screen.getByRole("button", { name: /Alt/ }));
    await user.keyboard("{Escape}");

    expect(updateVisitPhoto).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
