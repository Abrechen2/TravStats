/**
 * GitHub #401: a house the geocoder pinned in the wrong country (or could not
 * place) says WHY, and the user can confirm the pin or set it again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LodgingLocationCheckNotice } from "../LodgingLocationCheckNotice";
import { updateLodging } from "../../../lib/api/lodging";
import type { Lodging } from "../../../types/lodging";

vi.mock("../../../lib/api/lodging", () => ({ updateLodging: vi.fn() }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const base = {
  id: "l1",
  name: "Tulip Inn Wolfenbuettel",
  lat: 28.6,
  lon: 77.2,
  locationCheck: "pin_country_mismatch",
};

describe("LodgingLocationCheckNotice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when the position is not in question", () => {
    const { container } = render(
      <LodgingLocationCheckNotice
        lodging={{ ...base, locationCheck: null }}
        onSetLocation={vi.fn()}
        onReviewed={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says why, and offers to confirm a pin that exists", async () => {
    vi.mocked(updateLodging).mockResolvedValue({ id: "l1", locationCheck: "reviewed" } as Lodging);
    const onReviewed = vi.fn();
    render(
      <LodgingLocationCheckNotice lodging={base} onSetLocation={vi.fn()} onReviewed={onReviewed} />
    );
    expect(screen.getByTestId("lodging-location-check")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "lodging:locationCheck.confirm" }));
    await waitFor(() => expect(onReviewed).toHaveBeenCalled());
    expect(updateLodging).toHaveBeenCalledWith("l1", { locationCheck: "reviewed" });
  });

  it("offers no 'position is correct' when there is no pin to confirm", () => {
    render(
      <LodgingLocationCheckNotice
        lodging={{ ...base, lat: null, lon: null, locationCheck: "name_only" }}
        onSetLocation={vi.fn()}
        onReviewed={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "lodging:locationCheck.confirm" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "lodging:locationCheck.setLocation" })
    ).toBeInTheDocument();
  });
});
