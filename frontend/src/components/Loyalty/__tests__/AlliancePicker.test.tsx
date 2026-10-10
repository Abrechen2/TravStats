import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const catalogue = vi.hoisted(() => ({
  airlinesApi: { alliances: vi.fn() },
}));
vi.mock("../../../lib/api/catalogue", () => catalogue);

const loyalty = vi.hoisted(() => ({
  createLoyaltyMembership: vi.fn(),
  updateLoyaltyMembership: vi.fn(),
}));
vi.mock("../../../lib/api/loyalty", () => loyalty);

import LoyaltyCardForm from "../LoyaltyCardForm";
import { findNamed, queryNamed } from "../../../__tests__/helpers/namedElement";

const MEMBERS = {
  star: ["LH", "LX", "OS", "UA"],
  skyteam: ["AF", "KL", "DL"],
  oneworld: ["BA", "AA"],
};

const renderForm = (coverage: string[] = []) => {
  const onSaved = vi.fn();
  render(
    <LoyaltyCardForm
      domain="flight"
      prefill={{ programName: "Miles & More", membershipNumber: "", coverage }}
      onSaved={onSaved}
      onCancel={vi.fn()}
    />
  );
  return { onSaved };
};

/**
 * forgejo#133: a programme that covers a whole alliance is picked as one.
 * The picker must carry every member into the card (not a subset), and a
 * failed load must say so instead of quietly offering nothing.
 */
describe("LoyaltyCardForm — alliance picker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds every member of the chosen alliance, keeping codes already there", async () => {
    catalogue.airlinesApi.alliances.mockResolvedValue(MEMBERS);
    loyalty.createLoyaltyMembership.mockResolvedValue({});
    const { onSaved } = renderForm(["LH", "EW"]);

    fireEvent.click(await findNamed("button", "loyalty:alliances.star"));
    for (const code of ["LX", "OS", "UA", "EW"]) expect(screen.getByText(code)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("loyalty-save-flight"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, input] = loyalty.createLoyaltyMembership.mock.calls[0];
    expect(input.airlineCodes).toEqual(["LH", "EW", "LX", "OS", "UA"]);
  });

  it("says the alliances could not be loaded instead of offering nothing", async () => {
    catalogue.airlinesApi.alliances.mockRejectedValue(new Error("Network Error"));
    renderForm();
    expect(await screen.findByText("loyalty:alliances.loadError")).toBeInTheDocument();
    expect(queryNamed("button", "loyalty:alliances.star")).toBeNull();
    // The typed-code path still works — the picker is an addition, not a gate.
    expect(screen.getByLabelText("loyalty:field.airlineCodes")).toBeInTheDocument();
  });

  it("refuses an alliance that would push the card past the server's limit, and says why", async () => {
    // 48 distinct codes (A0..E7); four more would exceed the card's 50.
    const many = Array.from(
      { length: 48 },
      (_, i) => String.fromCharCode(65 + Math.floor(i / 10)) + String(i % 10)
    );
    catalogue.airlinesApi.alliances.mockResolvedValue(MEMBERS);
    renderForm(many);
    fireEvent.click(await findNamed("button", "loyalty:alliances.star"));
    expect(screen.getByText("loyalty:alliances.tooMany")).toBeInTheDocument();
    expect(screen.queryByText("UA")).toBeNull();
  });

  it("is not offered on a cruise card", () => {
    catalogue.airlinesApi.alliances.mockResolvedValue(MEMBERS);
    render(<LoyaltyCardForm domain="cruise" onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(catalogue.airlinesApi.alliances).not.toHaveBeenCalled();
    expect(queryNamed("button", "loyalty:alliances.star")).toBeNull();
  });
});
