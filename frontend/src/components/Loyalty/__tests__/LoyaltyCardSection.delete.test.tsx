import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoyaltyMembership } from "../../../types/loyalty";

/**
 * Browser acceptance 2026-09-26: deleting a loyalty card asked through the
 * browser's own `confirm()`. It asks in the page now, in German.
 */

const api = vi.hoisted(() => ({ deleteLoyaltyMembership: vi.fn() }));
vi.mock("../../../lib/api/loyalty", () => api);
vi.mock("../FrequentFlyerSuggestions", () => ({ default: () => null }));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});

import LoyaltyCardSection from "../LoyaltyCardSection";

const card: LoyaltyMembership = {
  id: "m1",
  userId: "u1",
  domain: "flight",
  programName: "Miles & More",
  membershipNumber: null,
  tier: null,
  notes: null,
  airlineCodes: ["LH"],
  cruiseLines: [],
  railOperators: [],
  chainIds: [],
  chains: [],
  lodgingIds: [],
  lodgings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("LoyaltyCardSection — delete", () => {
  const native = vi.fn(() => true);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", native);
    api.deleteLoyaltyMembership.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks in the page and deletes on the dialog's button", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<LoyaltyCardSection domain="flight" cards={[card]} onChanged={onChanged} />);

    const row = screen.getByTestId("loyalty-card-m1");
    await user.click(within(row).getByRole("button", { name: "Löschen" }));
    const dialog = screen.getByTestId("confirm-modal");
    expect(dialog.textContent).toContain("Miles & More");
    expect(api.deleteLoyaltyMembership).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(api.deleteLoyaltyMembership).toHaveBeenCalledWith("m1"));
    expect(onChanged).toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });

  it("keeps the card when the question is cancelled", async () => {
    const user = userEvent.setup();
    render(<LoyaltyCardSection domain="flight" cards={[card]} onChanged={vi.fn()} />);

    await user.click(
      within(screen.getByTestId("loyalty-card-m1")).getByRole("button", { name: "Löschen" })
    );
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(api.deleteLoyaltyMembership).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirm-modal")).toBeNull();
  });
});
