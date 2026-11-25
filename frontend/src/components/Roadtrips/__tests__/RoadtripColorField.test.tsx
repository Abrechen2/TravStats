import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const update = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/tours", () => ({ toursApi: { update } }));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import RoadtripColorField from "../RoadtripColorField";
import { LIST_PALETTE_HEX } from "../../../lib/listPalette";

const route = { id: "rt-1", color: null as string | null };
const pick = LIST_PALETTE_HEX[2];

describe("RoadtripColorField (GitHub #408)", () => {
  beforeEach(() => {
    update.mockReset();
  });

  it("saves the picked colour on the roadtrip and hands back the server's answer", async () => {
    const saved = { ...route, color: pick };
    update.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<RoadtripColorField route={route} onSaved={onSaved} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId(`roadtrip-color-${pick.slice(1)}`));
    });
    expect(update).toHaveBeenCalledWith(undefined, "rt-1", { color: pick });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("'automatic' clears it again, and is not offered while none is set", async () => {
    update.mockResolvedValue({ ...route, color: null });
    const { rerender } = render(<RoadtripColorField route={route} onSaved={vi.fn()} />);
    expect(screen.getByTestId("roadtrip-color-auto")).toBeDisabled();
    rerender(<RoadtripColorField route={{ ...route, color: pick }} onSaved={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("roadtrip-color-auto"));
    });
    expect(update).toHaveBeenCalledWith(undefined, "rt-1", { color: null });
  });

  it("says so when the save fails and does not report it as saved", async () => {
    update.mockRejectedValue({ response: { status: 500, data: { error: "boom" } } });
    const onSaved = vi.fn();
    render(<RoadtripColorField route={route} onSaved={onSaved} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId(`roadtrip-color-${pick.slice(1)}`));
    });
    expect(await screen.findByTestId("roadtrip-color-error")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
