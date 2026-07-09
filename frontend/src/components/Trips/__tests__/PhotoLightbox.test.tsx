import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted lets these vi.fn()s survive vi.mock factory hoisting and stay
// reachable from the test bodies below (see ImmichConnectionCard.test.tsx).
const { setImmichCover, setPhotoCover } = vi.hoisted(() => ({
  setImmichCover: vi.fn(),
  setPhotoCover: vi.fn(),
}));
vi.mock("../../../lib/api/immich", () => ({ immichApi: { setImmichCover, setPhotoCover } }));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

import PhotoLightbox, { type LightboxItem } from "../PhotoLightbox";

const ITEMS: LightboxItem[] = [
  { id: "p1", previewUrl: "/p1.jpg", caption: "First", source: { kind: "photo" } },
  { id: "a1", previewUrl: "/a1.jpg", caption: null, source: { kind: "immich", linkId: "link-1" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  setImmichCover.mockResolvedValue({ coverImageUrl: "/cover-immich" });
  setPhotoCover.mockResolvedValue({ coverImageUrl: "/cover-photo" });
});

const renderBox = (startIndex = 0, onCoverChanged = vi.fn()) =>
  render(
    <PhotoLightbox
      tripId="trip-1"
      items={ITEMS}
      startIndex={startIndex}
      onClose={vi.fn()}
      onCoverChanged={onCoverChanged}
    />
  );

describe("PhotoLightbox", () => {
  it("shows the item at startIndex", () => {
    renderBox(1);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a1.jpg");
  });

  it("navigates with the next/previous buttons and wraps around", async () => {
    const user = userEvent.setup();
    renderBox(0);

    await user.click(screen.getByRole("button", { name: "gallery.next" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a1.jpg");

    await user.click(screen.getByRole("button", { name: "gallery.next" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/p1.jpg");

    await user.click(screen.getByRole("button", { name: "gallery.previous" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a1.jpg");
  });

  it("navigates with the arrow keys and closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PhotoLightbox tripId="trip-1" items={ITEMS} startIndex={0} onClose={onClose} />);

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("img")).toHaveAttribute("src", "/a1.jpg");

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("sets a local photo as the cover", async () => {
    const onCoverChanged = vi.fn();
    const user = userEvent.setup();
    renderBox(0, onCoverChanged);

    await user.click(screen.getByRole("button", { name: "gallery.setAsCover" }));

    await waitFor(() => expect(setPhotoCover).toHaveBeenCalledWith("trip-1", "p1"));
    expect(setImmichCover).not.toHaveBeenCalled();
    expect(onCoverChanged).toHaveBeenCalledWith("/cover-photo");
  });

  it("sets a live Immich asset as the cover using its link id", async () => {
    const user = userEvent.setup();
    renderBox(1);

    await user.click(screen.getByRole("button", { name: "gallery.setAsCover" }));

    await waitFor(() => expect(setImmichCover).toHaveBeenCalledWith("trip-1", "link-1", "a1"));
    expect(setPhotoCover).not.toHaveBeenCalled();
  });

  it("renders nothing for an empty item list", () => {
    const { container } = render(
      <PhotoLightbox tripId="trip-1" items={[]} startIndex={0} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
