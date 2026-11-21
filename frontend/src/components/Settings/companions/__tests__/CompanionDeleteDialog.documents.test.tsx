import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ManagedCompanion } from "../../../../lib/api/companions";
import { CompanionDeleteDialog } from "../CompanionDeleteDialogs";

/**
 * Document-links D7: deleting a person hands their assigned documents back to
 * the owner, and the dialog says how many BEFORE it asks.
 */
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: () => void }) => unknown) =>
    select({ addToast: vi.fn() }),
}));

const person = (documents?: number): ManagedCompanion => ({
  id: "c1",
  name: "Norbert",
  linkedUser: null,
  uses: {},
  hiddenUses: 0,
  expensesPaid: 0,
  documents,
  lastTogether: null,
  inUse: false,
});

describe("CompanionDeleteDialog — documents (D7)", () => {
  it("names the documents that will be assigned to the owner afterwards", () => {
    render(<CompanionDeleteDialog companion={person(3)} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText(/companions:manage\.delete\.documentsAfter/)).toBeInTheDocument();
  });

  it("says nothing about documents when none are assigned", () => {
    render(<CompanionDeleteDialog companion={person(0)} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.queryByText(/documentsAfter/)).toBeNull();
  });
});
