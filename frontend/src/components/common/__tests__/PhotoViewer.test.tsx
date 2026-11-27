import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import PhotoViewer from "../PhotoViewer";
import { largeUrl, type ViewerPhoto } from "../photoViewer/viewerPhoto";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

const ITEMS: ViewerPhoto[] = [
  {
    id: "a",
    url: "/a.jpg",
    caption: "Fjord",
    takenAt: "2026-07-16T10:00:00.000Z",
    place: "Stavanger",
    source: "immich",
    entry: { href: "/roadtrips/r1", label: "Zum Roadtrip" },
  },
  { id: "b", url: "/b.jpg", source: "upload" },
];

const open = (startIndex = 0, onClose = vi.fn()) =>
  render(
    <MemoryRouter>
      <PhotoViewer items={ITEMS} startIndex={startIndex} onClose={onClose} />
    </MemoryRouter>
  );

describe("PhotoViewer", () => {
  it("steps with the arrow keys, wraps, and closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    open(0, onClose);
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/a.jpg");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/b.jpg");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/a.jpg");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/b.jpg");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("names date, place, source and links to the entry the photo belongs to", () => {
    open(0);
    const caption = screen.getByTestId("photo-viewer-caption");
    expect(caption).toHaveTextContent("Fjord");
    expect(caption).toHaveTextContent("Stavanger");
    expect(caption).toHaveTextContent("common:photoViewer.source.immich");
    expect(screen.getByRole("link", { name: "Zum Roadtrip" })).toHaveAttribute(
      "href",
      "/roadtrips/r1"
    );
  });

  it("closes with the × button and by clicking the backdrop, not the picture", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    open(0, onClose);
    await user.click(screen.getByTestId("lightbox-image"));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "common:photoViewer.close" }));
    await user.click(screen.getByTestId("photo-viewer"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("says so, visibly, when the picture cannot be loaded", () => {
    open(0);
    fireEvent.error(screen.getByTestId("lightbox-image"));
    expect(screen.getByRole("alert")).toHaveTextContent("common:photoViewer.loadFailed");
    expect(screen.queryByTestId("lightbox-image")).not.toBeInTheDocument();
  });

  it("zooms with the wheel and double-click resets", () => {
    open(0);
    const img = screen.getByTestId("lightbox-image");
    fireEvent.wheel(img, { deltaY: -100 });
    expect(img.style.transform).toContain("scale(1.15");
    fireEvent.doubleClick(img);
    expect(img.style.transform).toContain("scale(1)");
  });

  it("asks the library proxies for the large preview, and leaves uploads alone", () => {
    expect(largeUrl("/api/v1/entry-photos/roadtripStop/s1/photos/p1/file")).toBe(
      "/api/v1/entry-photos/roadtripStop/s1/photos/p1/file?size=preview"
    );
    expect(largeUrl("/api/v1/trips/t/photos/p/file")).toBe("/api/v1/trips/t/photos/p/file");
  });
});
