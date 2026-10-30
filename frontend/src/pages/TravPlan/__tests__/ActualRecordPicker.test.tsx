import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlanItem } from "../../../lib/api/travplan";

const mocks = vi.hoisted(() => ({ getById: vi.fn() }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api", () => ({ tripsApi: { getById: mocks.getById } }));
vi.mock("../../../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { ActualRecordPicker } from "../ActualRecordPicker";

const item = { kind: "flight" } as unknown as PlanItem;
const renderPicker = (): ReturnType<typeof render> =>
  render(<ActualRecordPicker tripId="t1" item={item} onLink={vi.fn()} busy={false} />);

// forgejo#385 (RULE-36): a failed trip read made the picker vanish, which
// reads as "nothing to link".
describe("ActualRecordPicker", () => {
  beforeEach(() => {
    mocks.getById.mockReset();
  });

  it("says the records could not be loaded when the trip read fails", async () => {
    mocks.getById.mockImplementation(async () => {
      throw new Error("503");
    });
    renderPicker();
    expect(await screen.findByRole("alert")).toHaveTextContent("linkActualFailed");
  });

  it("offers a completed flight and treats a phantom 'returned' status as not done", async () => {
    mocks.getById.mockResolvedValue({
      flights: [
        { id: "a", status: "flown", flightNumber: "LH400" },
        { id: "b", status: "returned", flightNumber: "XX1" },
      ],
    });
    renderPicker();
    expect(await screen.findByRole("option", { name: "LH400" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "XX1" })).not.toBeInTheDocument();
  });
});
