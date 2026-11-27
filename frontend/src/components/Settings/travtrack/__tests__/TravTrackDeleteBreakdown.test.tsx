import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const deletePreview = vi.fn();
vi.mock("../../../../lib/api/travtrackDaySources", () => ({
  daySourcesApi: { deletePreview: (...a: unknown[]) => deletePreview(...a) },
}));

import TravTrackDeleteBreakdown from "../TravTrackDeleteBreakdown";

describe("TravTrackDeleteBreakdown — what a range delete takes, before it is confirmed", () => {
  beforeEach(() => {
    deletePreview.mockReset();
  });

  it("lists the affected days with their points per source", async () => {
    deletePreview.mockResolvedValue({
      points: 8,
      days: [
        { date: "2026-08-10", points: 6, sources: { "companion:phone-1": 6 } },
        { date: "2026-08-11", points: 2, sources: { "gpx:takeout": 2 } },
      ],
    });
    render(<TravTrackDeleteBreakdown from="2026-08-10" until="2026-08-11" version={0} />);
    const box = await screen.findByTestId("delete-breakdown");
    expect(box.textContent).toContain("track:quality.previewDays");
    expect(box.textContent).toContain("2026-08-10: 6");
    expect(box.textContent).toContain("track:daySources.kind.import");
    expect(deletePreview).toHaveBeenCalledWith({ fromDay: "2026-08-10", toDay: "2026-08-11" });
  });

  it("says when the preview could not be read, rather than showing nothing", async () => {
    deletePreview.mockRejectedValue({ response: { data: { code: "TRAVTRACK_DISABLED" } } });
    render(<TravTrackDeleteBreakdown from="2026-08-10" until="2026-08-10" version={0} />);
    expect((await screen.findByRole("alert")).textContent).toBe("track:errors.disabled");
  });
});
