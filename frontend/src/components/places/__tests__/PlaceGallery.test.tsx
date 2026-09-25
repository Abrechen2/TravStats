import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlaceGallery } from "../PlaceGallery";
import type { Place, PlaceVisit } from "../../../types/place";

const setPlaceCover = vi.fn();
vi.mock("../../../lib/api/places", () => ({
  setPlaceCover: (...a: unknown[]) => setPlaceCover(...a),
}));
const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const photo = (id: string) =>
  ({ id, url: `/p/${id}`, caption: null }) as NonNullable<PlaceVisit["photos"]>[number];
const visit = (visitedAt: string | null, ids: string[]) =>
  ({ id: `v-${ids.join("")}`, visitedAt, photos: ids.map(photo) }) as unknown as PlaceVisit;
const place = (visits: PlaceVisit[], coverPhotoId: string | null = null) =>
  ({ id: "place-1", name: "Trevi", visits, coverPhotoId }) as unknown as Place;

const leadSrc = (): string | null =>
  screen.getByRole("img", { name: "places:gallery.lead" }).getAttribute("src");

/**
 * Package 9, item 3: the place page leads with a photograph — the user's
 * choice, or the first of the most recent visit — and every visit's photos
 * are one gallery.
 */
describe("PlaceGallery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws nothing for a place without photos", () => {
    const { container } = render(<PlaceGallery place={place([visit("2024-01-01", [])])} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leads with the most recent visit's first photo, undated visits last", () => {
    render(
      <PlaceGallery
        place={place([
          visit(null, ["u"]),
          visit("2020-05-01T10:00:00.000Z", ["old"]),
          visit("2024-05-01T10:00:00.000Z", ["new", "new2"]),
        ])}
      />
    );
    expect(leadSrc()).toBe("/p/new");
    expect(
      screen.getAllByRole("button").map((b) => b.querySelector("img")?.getAttribute("src"))
    ).toEqual(["/p/new", "/p/new2", "/p/old", "/p/u"]);
  });

  it("leads with the chosen cover, and saves a new choice", async () => {
    setPlaceCover.mockResolvedValue(undefined);
    render(<PlaceGallery place={place([visit("2024-05-01", ["a", "b"])], "b")} />);
    expect(leadSrc()).toBe("/p/b");

    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(setPlaceCover).toHaveBeenCalledWith("place-1", "a");
    expect(leadSrc()).toBe("/p/a");
  });

  it("goes back to the previous lead when saving fails", async () => {
    setPlaceCover.mockRejectedValue(new Error("offline"));
    render(<PlaceGallery place={place([visit("2024-05-01", ["a", "b"])], "b")} />);

    await userEvent.click(screen.getAllByRole("button")[0]);
    await waitFor(() => expect(leadSrc()).toBe("/p/b"));
    expect(addToast).toHaveBeenCalledWith("error", "places:gallery.coverFailed");
  });
});
