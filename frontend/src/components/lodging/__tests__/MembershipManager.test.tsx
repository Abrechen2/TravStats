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
  chainIds: [1],
  chains: [{ id: 1, name: "Marriott" }],
  lodgingIds: [],
  lodgings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const marriottScope = {
  id: 1,
  suggestedChains: [
    { id: 1, name: "Marriott" },
    { id: 2, name: "Sheraton" },
  ],
  suggestedProgramName: "Marriott Bonvoy",
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
    await userEvent.type(screen.getByLabelText("lodging:field.programName"), "Marriott Bonvoy");
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
      .mockResolvedValueOnce([
        existingMembership,
        { ...existingMembership, id: "m2", programName: "Hilton Honors" },
      ]);

    render(<MembershipManager />);
    await screen.findByText("Marriott Bonvoy");

    await userEvent.click(screen.getByText("lodging:membership.add"));
    await userEvent.type(screen.getByLabelText("lodging:field.programName"), "Hilton Honors");
    await userEvent.click(screen.getByText("common:buttons.save"));

    // `chainIds` always travels with the form: it renders every choice, so
    // what is ticked IS the complete set (unscoped here, hence empty).
    await waitFor(() =>
      expect(createMembership).toHaveBeenCalledWith({ programName: "Hilton Honors", chainIds: [] })
    );
    expect(await screen.findByText("Hilton Honors")).toBeInTheDocument();
  });

  it("deletes a membership via the delete button", async () => {
    vi.mocked(deleteMembership).mockResolvedValue(undefined);
    vi.mocked(listMemberships)
      .mockResolvedValueOnce([existingMembership])
      .mockResolvedValueOnce([]);

    render(<MembershipManager />);
    await screen.findByText("Marriott Bonvoy");

    await userEvent.click(screen.getByTestId("membership-delete-m1"));

    await waitFor(() => expect(deleteMembership).toHaveBeenCalledWith("m1"));
  });

  // Chain detail page scoping (`scopeChain`) — a chain's membership block must
  // show only the membership LINKED to that chain, prefill (but never lock) the
  // programme name, and hide "add" once one covers the chain.
  it("scopeChain: shows only the membership linked to this chain", async () => {
    vi.mocked(listMemberships).mockResolvedValue([
      existingMembership,
      {
        ...existingMembership,
        id: "m2",
        programName: "Hilton Honors",
        chainIds: [9],
        chains: [{ id: 9, name: "Hilton" }],
      },
    ]);

    render(
      <MembershipManager scopeChain={{ id: 9, suggestedChains: [{ id: 9, name: "Hilton" }] }} />
    );

    await screen.findByText("Hilton Honors");
    expect(screen.queryByText("Marriott Bonvoy")).not.toBeInTheDocument();
  });

  /**
   * The whole point of linking by id. The membership's name no longer has to
   * match the catalogue's `loyaltyProgram`: a user whose card reads "Minor
   * DISCOVERY" still sees it on a chain the catalogue calls "NH Rewards".
   * Under the old string match this rendered nothing.
   */
  it("scopeChain: finds the membership even when its name differs from the catalogue's", async () => {
    vi.mocked(listMemberships).mockResolvedValue([
      {
        ...existingMembership,
        id: "m3",
        programName: "Minor DISCOVERY",
        chainIds: [7],
        chains: [{ id: 7, name: "NH Hotels" }],
      },
    ]);

    render(
      <MembershipManager
        scopeChain={{
          id: 7,
          suggestedChains: [{ id: 7, name: "NH Hotels" }],
          suggestedProgramName: "NH Rewards",
        }}
      />
    );

    expect(await screen.findByText("Minor DISCOVERY")).toBeInTheDocument();
  });

  it("scopeChain: hides the add button once a membership covers this chain", async () => {
    vi.mocked(listMemberships).mockResolvedValue([existingMembership]);

    render(<MembershipManager scopeChain={marriottScope} />);

    await screen.findByText("Marriott Bonvoy");
    expect(screen.queryByText("lodging:membership.add")).not.toBeInTheDocument();
  });

  it("scopeChain: prefills the programme name but leaves it EDITABLE", async () => {
    vi.mocked(listMemberships).mockResolvedValue([]);

    render(
      <MembershipManager
        scopeChain={{
          id: 3,
          suggestedChains: [{ id: 3, name: "Hyatt" }],
          suggestedProgramName: "Hyatt World of Hyatt",
        }}
      />
    );

    await waitFor(() => expect(listMemberships).toHaveBeenCalled());
    await userEvent.click(screen.getByText("lodging:membership.add"));

    const input = screen.getByLabelText("lodging:field.programName") as HTMLInputElement;
    expect(input.value).toBe("Hyatt World of Hyatt");
    // Locking this field was the old design's price for the string join. A
    // stale catalogue name must be correctable — that is the reported bug.
    expect(input).not.toBeDisabled();
  });

  it("scopeChain: pre-ticks the suggested chains and sends what is ticked", async () => {
    vi.mocked(listMemberships).mockResolvedValue([]);
    vi.mocked(createMembership).mockResolvedValue(existingMembership);

    render(<MembershipManager scopeChain={marriottScope} />);

    await waitFor(() => expect(listMemberships).toHaveBeenCalled());
    await userEvent.click(screen.getByText("lodging:membership.add"));

    const sheraton = screen.getByLabelText("Sheraton") as HTMLInputElement;
    expect(sheraton.checked).toBe(true);
    // The suggestion is a starting point, not a decision — unticking must stick.
    await userEvent.click(sheraton);
    await userEvent.click(screen.getByText("common:buttons.save"));

    await waitFor(() => expect(createMembership).toHaveBeenCalled());
    expect(vi.mocked(createMembership).mock.calls[0][0].chainIds).toEqual([1]);
  });

  // Alex, 2026-08-08 (Discord): creating "GHA Discovery" on a second chain
  // returned a clean 409 and dead-ended. The card he wants already exists;
  // the action he wants is "cover this chain too" — not visible before.
  it("offers to extend the existing card when the name is already taken", async () => {
    const existing: LodgingMembership = {
      ...existingMembership,
      id: "m-existing",
      programName: "GHA Discovery",
      chainIds: [4],
      chains: [{ id: 4, name: "GHA" }],
    };
    vi.mocked(listMemberships).mockResolvedValue([existing]);
    vi.mocked(createMembership).mockRejectedValue({ response: { status: 409 } });
    vi.mocked(updateMembership).mockResolvedValue({ ...existing, chainIds: [4, 9] });

    render(
      <MembershipManager scopeChain={{ id: 9, suggestedChains: [{ id: 9, name: "NH Hotels" }] }} />
    );

    await userEvent.click(await screen.findByTestId("membership-add"));
    await userEvent.type(screen.getByTestId("membership-name-input"), "GHA Discovery");
    await userEvent.click(screen.getByTestId("membership-save"));

    const extend = await screen.findByTestId("membership-extend-existing");
    await userEvent.click(extend);

    await waitFor(() => expect(updateMembership).toHaveBeenCalled());
    expect(vi.mocked(updateMembership).mock.calls[0][0]).toBe("m-existing");
    expect(vi.mocked(updateMembership).mock.calls[0][1].chainIds).toEqual([4, 9]);
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
        expect.objectContaining({ programName: "Marriott Bonvoy", tier: "Platinum" })
      )
    );
  });
});
