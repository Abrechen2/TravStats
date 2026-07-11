import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MembershipManager } from "../MembershipManager";
import {
  listMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
} from "../../../lib/api/lodging";
import type { LodgingMembership } from "../../../types/lodging";

vi.mock("../../../lib/api/lodging", () => ({
  listMemberships: vi.fn(),
  createMembership: vi.fn(),
  updateMembership: vi.fn(),
  deleteMembership: vi.fn(),
}));

const existingMembership: LodgingMembership = {
  id: "m1",
  userId: "user-1",
  programName: "Marriott Bonvoy",
  membershipNumber: "12345",
  tier: "Gold",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("MembershipManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberships).mockResolvedValue([existingMembership]);
  });

  it("loads and lists existing memberships", async () => {
    render(<MembershipManager />);
    expect(await screen.findByText("Marriott Bonvoy")).toBeInTheDocument();
  });

  // (c) The backend enforces one membership per program per user and
  // returns 409 on a duplicate (routes/lodgingMemberships.ts). That must
  // surface as a clean, readable message — never a raw error or a crash.
  it("surfaces a duplicate-program 409 as a readable message, not a crash", async () => {
    vi.mocked(createMembership).mockRejectedValue({
      response: { status: 409, data: { error: "A membership for this program already exists" } },
    });

    render(<MembershipManager />);
    await waitFor(() => expect(listMemberships).toHaveBeenCalled());

    await userEvent.click(screen.getByText("lodging:membership.add"));
    await userEvent.type(
      screen.getByLabelText("lodging:field.programName"),
      "Marriott Bonvoy",
    );
    await userEvent.click(screen.getByText("common:buttons.save"));

    const message = await screen.findByTestId("membership-form-error");
    expect(message.textContent).toBe("lodging:membership.duplicateError");
    // The component must not have thrown/unmounted — the form is still there.
    expect(screen.getByLabelText("lodging:field.programName")).toBeInTheDocument();
  });

  it("shows a generic save error for a non-409 failure", async () => {
    vi.mocked(createMembership).mockRejectedValue(new Error("network down"));

    render(<MembershipManager />);
    await waitFor(() => expect(listMemberships).toHaveBeenCalled());

    await userEvent.click(screen.getByText("lodging:membership.add"));
    await userEvent.type(screen.getByLabelText("lodging:field.programName"), "Hilton Honors");
    await userEvent.click(screen.getByText("common:buttons.save"));

    const message = await screen.findByTestId("membership-form-error");
    expect(message.textContent).toBe("lodging:membership.saveError");
  });

  it("creates a membership and reloads the list on success", async () => {
    vi.mocked(createMembership).mockResolvedValue({
      ...existingMembership,
      id: "m2",
      programName: "Hilton Honors",
    });
    vi.mocked(listMemberships)
      .mockResolvedValueOnce([existingMembership])
      .mockResolvedValueOnce([existingMembership, { ...existingMembership, id: "m2", programName: "Hilton Honors" }]);

    render(<MembershipManager />);
    await screen.findByText("Marriott Bonvoy");

    await userEvent.click(screen.getByText("lodging:membership.add"));
    await userEvent.type(screen.getByLabelText("lodging:field.programName"), "Hilton Honors");
    await userEvent.click(screen.getByText("common:buttons.save"));

    await waitFor(() => expect(createMembership).toHaveBeenCalledWith({ programName: "Hilton Honors" }));
    expect(await screen.findByText("Hilton Honors")).toBeInTheDocument();
  });

  it("deletes a membership via the delete button", async () => {
    vi.mocked(deleteMembership).mockResolvedValue(undefined);
    vi.mocked(listMemberships).mockResolvedValueOnce([existingMembership]).mockResolvedValueOnce([]);

    render(<MembershipManager />);
    await screen.findByText("Marriott Bonvoy");

    await userEvent.click(screen.getByTestId("membership-delete-m1"));

    await waitFor(() => expect(deleteMembership).toHaveBeenCalledWith("m1"));
  });

  // Chain detail page scoping (filterProgramName) — a chain's membership
  // block must show only the one membership for ITS program, pre-fill and
  // lock the program field on "add", and hide "add" once one exists.
  it("filterProgramName: shows only the matching membership and hides unrelated ones", async () => {
    vi.mocked(listMemberships).mockResolvedValue([
      existingMembership,
      { ...existingMembership, id: "m2", programName: "Hilton Honors" },
    ]);

    render(<MembershipManager filterProgramName="Hilton Honors" />);

    await screen.findByText("Hilton Honors");
    expect(screen.queryByText("Marriott Bonvoy")).not.toBeInTheDocument();
  });

  it("filterProgramName: hides the add button once a membership for the program exists", async () => {
    vi.mocked(listMemberships).mockResolvedValue([existingMembership]);

    render(<MembershipManager filterProgramName="Marriott Bonvoy" />);

    await screen.findByText("Marriott Bonvoy");
    expect(screen.queryByText("lodging:membership.add")).not.toBeInTheDocument();
  });

  it("filterProgramName: offers to add one, pre-filled and locked, when none exists yet", async () => {
    vi.mocked(listMemberships).mockResolvedValue([]);

    render(<MembershipManager filterProgramName="Hyatt World of Hyatt" />);

    await waitFor(() => expect(listMemberships).toHaveBeenCalled());
    await userEvent.click(screen.getByText("lodging:membership.add"));

    const input = screen.getByLabelText("lodging:field.programName") as HTMLInputElement;
    expect(input.value).toBe("Hyatt World of Hyatt");
    expect(input).toBeDisabled();
  });

  it("updates an existing membership on edit+save", async () => {
    vi.mocked(updateMembership).mockResolvedValue({ ...existingMembership, tier: "Platinum" });

    render(<MembershipManager />);
    await screen.findByText("Marriott Bonvoy");

    await userEvent.click(screen.getByText("common:buttons.edit"));
    const tierInput = screen.getByLabelText("lodging:field.tier");
    await userEvent.clear(tierInput);
    await userEvent.type(tierInput, "Platinum");
    await userEvent.click(screen.getByText("common:buttons.save"));

    await waitFor(() =>
      expect(updateMembership).toHaveBeenCalledWith(
        "m1",
        expect.objectContaining({ programName: "Marriott Bonvoy", tier: "Platinum" }),
      ),
    );
  });
});
