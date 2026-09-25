import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import KindReviewNotice from "../KindReviewNotice";
import { tourIndexApi } from "../../../lib/api/tourIndex";
import { roadtripsApi } from "../../../lib/api/roadtrips";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { list: vi.fn() } }));
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: { confirmKind: vi.fn(), switchKind: vi.fn() },
}));

const row = (id: string, kind: "tour" | "roadtrip", flagged = true) => ({
  id,
  kind,
  name: `Route ${id}`,
  kindAssignedAutomatically: flagged,
});

describe("KindReviewNotice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says nothing when no row is still flagged", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([row("a", "tour", false)] as never);
    const { container } = render(<KindReviewNotice onChanged={() => {}} />);
    await waitFor(() => expect(tourIndexApi.list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a row, which takes it off the list without reloading the page", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([row("a", "roadtrip")] as never);
    vi.mocked(roadtripsApi.confirmKind).mockResolvedValue({} as never);
    const onChanged = vi.fn();
    render(<KindReviewNotice onChanged={onChanged} />);
    fireEvent.click(await screen.findByText("roadtrips:review.keep"));
    await waitFor(() => expect(roadtripsApi.confirmKind).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(screen.queryByText("Route a")).not.toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("moves a row to the other kind and tells the page to re-read", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([row("b", "tour")] as never);
    vi.mocked(roadtripsApi.switchKind).mockResolvedValue({} as never);
    const onChanged = vi.fn();
    render(<KindReviewNotice onChanged={onChanged} />);
    fireEvent.click(await screen.findByText("roadtrips:review.moveTo.roadtrip"));
    await waitFor(() =>
      expect(roadtripsApi.switchKind).toHaveBeenCalledWith("b", { kind: "roadtrip" })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
