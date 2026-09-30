import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/tours", () => ({ toursApi: { update: vi.fn() } }));

import TourDayEditor from "../TourDayEditor";
import { toursApi } from "../../../lib/api/tours";
import type { TourRoute } from "../../../types/tour";

/**
 * Acceptance D2 (2026-09-26): a standalone day tour could not be dated
 * anywhere. The tour page now edits its day and start time, and a refused
 * save says so instead of silently keeping the old value on screen.
 */

const ROUTE = {
  id: "r1",
  tripId: null,
  name: "Fiesole",
  kind: "tour",
  date: null,
  startTime: null,
} as unknown as TourRoute;

describe("TourDayEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves the day, then the start time, and hands back the saved tour", async () => {
    const onSaved = vi.fn();
    vi.mocked(toursApi.update).mockResolvedValue({ ...ROUTE, date: "2025-05-04" });
    render(<TourDayEditor route={ROUTE} tripId={undefined} onSaved={onSaved} />);

    expect(screen.getByLabelText("trips:tours.day.startTime")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("trips:tours.day.date"), {
      target: { value: "2025-05-04" },
    });
    await waitFor(() =>
      expect(toursApi.update).toHaveBeenCalledWith(undefined, "r1", { date: "2025-05-04" })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("trips:tours.day.startTime"), {
      target: { value: "08:30" },
    });
    await waitFor(() =>
      expect(toursApi.update).toHaveBeenLastCalledWith(undefined, "r1", { startTime: "08:30" })
    );
  });

  it("says a refused save was refused", async () => {
    vi.mocked(toursApi.update).mockRejectedValue({ response: { status: 400 } });
    render(<TourDayEditor route={ROUTE} tripId={undefined} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("trips:tours.day.date"), {
      target: { value: "2025-05-04" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("trips:tours.day.saveError");
  });
});
