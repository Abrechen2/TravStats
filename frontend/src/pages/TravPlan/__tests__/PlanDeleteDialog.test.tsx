import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanDeleteDialog } from "../PlanDeleteDialog";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  remove: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${Object.values(opts).join(",")}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: { deletePreview: mocks.preview, deletePlan: mocks.remove },
}));

const preview = {
  removes: {
    items: 0,
    ideas: 2,
    bookings: 3,
    placeholders: 1,
    stations: 4,
    stages: 3,
    variants: 1,
    tasks: 0,
    packing: 0,
    receipts: 7,
    proposals: 0,
  },
  keeps: { stations: 2, confirmedItems: 0 },
  tripIsEmptyShell: false,
};

describe("PlanDeleteDialog", () => {
  beforeEach(() => {
    mocks.preview.mockReset();
    mocks.remove.mockReset();
  });

  it("lists what the server says goes and what stays, before anything can be deleted", async () => {
    mocks.preview.mockResolvedValueOnce(preview);
    render(<PlanDeleteDialog tripId="t" name="Ostsee" onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole("button", { name: "deletePlan.confirm" })).toBeDisabled();
    expect(await screen.findByText("deletePlan.what.stations:4")).toBeInTheDocument();
    expect(screen.getByText("deletePlan.what.receipts:7")).toBeInTheDocument();
    expect(screen.queryByText(/what\.tasks/)).not.toBeInTheDocument();
    expect(screen.getByText("deletePlan.staysStations:2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "deletePlan.confirm" })).toBeEnabled();
  });

  it("offers no delete when it could not say what would go", async () => {
    mocks.preview.mockRejectedValueOnce(new Error("offline"));
    render(<PlanDeleteDialog tripId="t" name="Ostsee" onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(await screen.findByText("deletePlan.previewFailed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "deletePlan.confirm" })).toBeDisabled();
  });

  it("deletes on confirm and reports the plan gone", async () => {
    mocks.preview.mockResolvedValueOnce(preview);
    mocks.remove.mockResolvedValueOnce({ deleted: true });
    const onDeleted = vi.fn();
    render(<PlanDeleteDialog tripId="t" name="Ostsee" onClose={vi.fn()} onDeleted={onDeleted} />);
    await screen.findByText("deletePlan.what.stations:4");
    await userEvent.click(screen.getByRole("button", { name: "deletePlan.confirm" }));
    expect(mocks.remove).toHaveBeenCalledWith("t");
    expect(onDeleted).toHaveBeenCalled();
  });

  it("says a failed delete failed and stays open instead of navigating away", async () => {
    mocks.preview.mockResolvedValueOnce(preview);
    mocks.remove.mockRejectedValueOnce(new Error("500"));
    const onDeleted = vi.fn();
    render(<PlanDeleteDialog tripId="t" name="Ostsee" onClose={vi.fn()} onDeleted={onDeleted} />);
    await screen.findByText("deletePlan.what.stations:4");
    await userEvent.click(screen.getByRole("button", { name: "deletePlan.confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("deletePlan.failed");
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
