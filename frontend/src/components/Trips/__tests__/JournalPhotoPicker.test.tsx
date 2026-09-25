import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import JournalPhotoPicker from "../JournalPhotoPicker";
import JournalPhotoRow from "../JournalPhotoRow";
import { tripsApi } from "../../../lib/api";
import type { TripPhoto } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api", () => ({ tripsApi: { listPhotos: vi.fn() } }));

const photo = (id: string): TripPhoto => ({
  id,
  url: `/api/v1/trips/t1/photos/${id}/file`,
  caption: null,
  takenAt: null,
  sortIdx: 0,
  mimetype: "image/jpeg",
  sizeBytes: 1,
  createdAt: "",
});

function Harness({ onChange }: { onChange: (ids: string[]) => void }): JSX.Element {
  const [value, setValue] = useState<string[]>([]);
  return (
    <JournalPhotoPicker
      tripId="t1"
      value={value}
      onChange={(ids) => {
        setValue(ids);
        onChange(ids);
      }}
    />
  );
}

/**
 * Package 9, item 5: an entry picks photos from its trip's gallery; the order
 * of picking is the order shown, and a second click takes a photo back out.
 */
describe("JournalPhotoPicker", () => {
  it("picks from the trip's gallery in click order and unpicks on a second click", async () => {
    vi.mocked(tripsApi.listPhotos).mockResolvedValue([photo("a"), photo("b"), photo("c")]);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const tiles = await screen.findAllByRole("button", { pressed: false });
    expect(tripsApi.listPhotos).toHaveBeenCalledWith("t1");
    await userEvent.click(tiles[2]);
    await userEvent.click(tiles[0]);
    expect(onChange).toHaveBeenLastCalledWith(["c", "a"]);
    await userEvent.click(tiles[2]);
    expect(onChange).toHaveBeenLastCalledWith(["a"]);
  });

  it("says so when the trip has no photos to pick", async () => {
    vi.mocked(tripsApi.listPhotos).mockResolvedValue([]);
    render(<Harness onChange={vi.fn()} />);
    expect(await screen.findByText("trips:journalModal.photosEmpty")).toBeInTheDocument();
  });
});

describe("JournalPhotoRow", () => {
  it("shows an entry's photos in order and nothing without any", () => {
    const { rerender, container } = render(<JournalPhotoRow photos={[photo("b"), photo("a")]} />);
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual([
      "/api/v1/trips/t1/photos/b/file",
      "/api/v1/trips/t1/photos/a/file",
    ]);
    rerender(<JournalPhotoRow photos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
