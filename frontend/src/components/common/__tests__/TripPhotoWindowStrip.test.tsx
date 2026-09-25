import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import TripPhotoWindowStrip from "../TripPhotoWindowStrip";
import { getTripPhotoWindow } from "../../../lib/api/tripPhotoWindows";

vi.mock("../../../lib/api/tripPhotoWindows", () => ({ getTripPhotoWindow: vi.fn() }));

/**
 * Package 9, item 4: a stay, a flight or a cruise shows the trip photos taken
 * in its time and place — read-only, and nothing at all when there are none.
 */
describe("TripPhotoWindowStrip", () => {
  it("asks for the entry's window and draws its photos without any edit control", async () => {
    vi.mocked(getTripPhotoWindow).mockResolvedValue([
      { id: "p1", url: "/api/v1/trips/t1/photos/p1/file", caption: "Pool", takenAt: null },
      { id: "p2", url: "/api/v1/trips/t1/photos/p2/file", caption: null, takenAt: null },
    ]);
    render(<TripPhotoWindowStrip entry="flights" id="f-1" />);

    const images = await screen.findAllByRole("img");
    expect(images.map((img) => img.getAttribute("src"))).toEqual([
      "/api/v1/trips/t1/photos/p1/file",
      "/api/v1/trips/t1/photos/p2/file",
    ]);
    expect(getTripPhotoWindow).toHaveBeenCalledWith("flights", "f-1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("draws nothing when no photo falls into the window", async () => {
    vi.mocked(getTripPhotoWindow).mockResolvedValue([]);
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<TripPhotoWindowStrip entry="lodging" id="l-1" />));
    });
    expect(container).toBeEmptyDOMElement();
  });
});
