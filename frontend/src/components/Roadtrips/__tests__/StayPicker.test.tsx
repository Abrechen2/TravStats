import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import StayPicker from "../StayPicker";
import { createLodging, createStay, deleteLodging } from "../../../lib/api/lodging";

vi.mock("../../../lib/api/lodging", () => ({
  createLodging: vi.fn(),
  createStay: vi.fn(),
  deleteLodging: vi.fn(),
  listLodgings: vi.fn(),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function renderPicker(onPick = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <StayPicker
      selectedStayId={null}
      near={{ startDate: "2026-07-14", endDate: "2026-07-16" }}
      place={{ name: "Mosvangen", lat: 58.95, lon: 5.72 }}
      tripId={null}
      onPick={onPick}
      lodgings={[]}
    />
  );
  fireEvent.click(screen.getByText("roadtrips:stay.createNew"));
  fireEvent.click(screen.getByText("roadtrips:stay.createAndLink"));
  return onPick;
}

describe("StayPicker — a new stay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createLodging).mockResolvedValue({ id: "l1", name: "Mosvangen" } as never);
  });

  it("links the stay it made", async () => {
    vi.mocked(createStay).mockResolvedValue({
      id: "s1",
      checkIn: "2026-07-14",
      checkOut: "2026-07-16",
    } as never);
    const onPick = renderPicker();
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" })));
    expect(deleteLodging).not.toHaveBeenCalled();
  });

  it("takes the lodging back when its stay could not be made, so no empty one is left", async () => {
    vi.mocked(createStay).mockRejectedValue(new Error("500"));
    vi.mocked(deleteLodging).mockResolvedValue();
    const onPick = renderPicker();
    expect(await screen.findByText("roadtrips:stay.createFailed")).toBeInTheDocument();
    expect(deleteLodging).toHaveBeenCalledWith("l1");
    expect(onPick).not.toHaveBeenCalled();
  });
});
