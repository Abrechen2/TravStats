import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));
const places = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/travtrack")>()),
  travTrackApi: { places },
}));

import TravTrackPlacesRow from "../TravTrackPlacesRow";

const answer = (over: object = {}) => ({
  places: [
    { id: "home", name: "Flat", kind: "home", lat: 50, lon: 8, radiusM: 150, window: null },
    {
      id: "w1",
      name: "Office",
      kind: "work",
      lat: 50.1,
      lon: 8.1,
      radiusM: 200,
      window: { days: [1, 2], from: "08:00", until: "17:00" },
    },
  ],
  lodgingAsPlace: { enabled: true, radiusM: 120 },
  lodgingSkipped: 2,
  ...over,
});

describe("Settings → fixed places (read-only)", () => {
  afterEach(() => {
    cleanup();
    places.mockReset();
  });

  it("lists home first, then the other places with radius and window, and the lodging switch", async () => {
    places.mockResolvedValue(answer());
    render(<TravTrackPlacesRow />);
    const rows = await screen.findAllByTestId("place-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Flat");
    expect(rows[1].textContent).toContain("Office");
    expect(rows[1].textContent).toContain('"metres":200');
    expect(rows[1].textContent).toContain('"from":"08:00"');
    expect(screen.getByTestId("places-lodging").textContent).toContain(
      "settings:location.tt.places.lodgingOn"
    );
    expect(screen.getByText(/lodgingSkipped/).textContent).toContain('"count":2');
  });

  it("says a home without a point is not set yet", async () => {
    places.mockResolvedValue(
      answer({
        places: [
          { id: "home", name: "", kind: "home", lat: null, lon: null, radiusM: 150, window: null },
        ],
      })
    );
    render(<TravTrackPlacesRow />);
    expect(await screen.findByText(/homeUnknown/)).toBeTruthy();
  });

  it("shows a failed load as a failure with a retry, never as an empty list", async () => {
    places.mockRejectedValueOnce(new Error("down"));
    render(<TravTrackPlacesRow />);
    expect(await screen.findByText(/loadError/)).toBeTruthy();
    expect(screen.queryByTestId("places")).toBeNull();
    places.mockResolvedValue(answer());
    fireEvent.click(screen.getByText("settings:blocks.save.retry"));
    await waitFor(() => expect(screen.getAllByTestId("place-row")).toHaveLength(2));
  });
});
