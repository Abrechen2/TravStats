import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  createLoyaltyMembership: vi.fn(),
  updateLoyaltyMembership: vi.fn(),
}));
vi.mock("../../../lib/api/loyalty", () => api);

import MaskedNumber, { maskNumber } from "../MaskedNumber";
import LoyaltyCardForm from "../LoyaltyCardForm";
import TierHistoryToggle from "../TierHistoryToggle";
import { draftsToPeriods } from "../tierHistory";

describe("maskNumber", () => {
  it("leaves the last four characters readable", () => {
    expect(maskNumber("992003112345")).toBe("•••• 2345");
  });

  it("masks a number of four characters or fewer whole — showing it all is not masking", () => {
    expect(maskNumber("1234")).toBe("••••");
    expect(maskNumber("12")).toBe("••••");
  });
});

describe("MaskedNumber", () => {
  it("reveals the number on request and hides it again", () => {
    render(<MaskedNumber value="992003112345" />);
    expect(screen.getByTestId("masked-number")).toHaveTextContent("•••• 2345");
    fireEvent.click(screen.getByRole("button", { name: "loyalty:number.show" }));
    expect(screen.getByTestId("masked-number")).toHaveTextContent("992003112345");
    fireEvent.click(screen.getByRole("button", { name: "loyalty:number.hide" }));
    expect(screen.getByTestId("masked-number")).toHaveTextContent("•••• 2345");
  });
});

describe("draftsToPeriods", () => {
  const draft = (o: Partial<{ tier: string; validFrom: string; validUntil: string }>) => ({
    key: "k",
    tier: "Gold",
    validFrom: "2024-01-01",
    validUntil: "",
    ...o,
  });

  it("turns an empty end into 'still held'", () => {
    expect(draftsToPeriods([draft({})])).toEqual([
      { tier: "Gold", validFrom: "2024-01-01", validUntil: null },
    ]);
  });

  it("refuses a period without a tier or a start, or one ending before it starts", () => {
    expect(draftsToPeriods([draft({ tier: " " })])).toBeNull();
    expect(draftsToPeriods([draft({ validFrom: "" })])).toBeNull();
    expect(draftsToPeriods([draft({ validUntil: "2023-12-31" })])).toBeNull();
  });
});

describe("LoyaltyCardForm", () => {
  beforeEach(() => vi.clearAllMocks());

  const renderForm = (domain: "flight" | "cruise" = "flight") => {
    const onSaved = vi.fn();
    render(
      <LoyaltyCardForm
        domain={domain}
        prefill={{ programName: "Miles & More", membershipNumber: "", coverage: [] }}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    );
    return { onSaved };
  };

  it("takes a two-character airline code, upper-cased, and refuses anything else", () => {
    renderForm();
    const input = screen.getByLabelText("loyalty:field.airlineCodes");
    fireEvent.change(input, { target: { value: "lh" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("LH")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Lufthansa" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("loyalty:field.invalidCode")).toBeInTheDocument();
    expect(screen.queryByText("LUFTHANSA")).toBeNull();
  });

  it("takes a cruise line as written", () => {
    renderForm("cruise");
    const input = screen.getByLabelText("loyalty:field.cruiseLines");
    fireEvent.change(input, { target: { value: "AIDA Cruises" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("AIDA Cruises")).toBeInTheDocument();
  });

  it("does not save a status history the server would refuse", async () => {
    renderForm();
    fireEvent.click(screen.getByText("loyalty:history.add"));
    fireEvent.click(screen.getByTestId("loyalty-save-flight"));
    expect(await screen.findByText("loyalty:history.invalid")).toBeInTheDocument();
    expect(api.createLoyaltyMembership).not.toHaveBeenCalled();
  });

  it("says a duplicate name is a duplicate, not a failure", async () => {
    api.createLoyaltyMembership.mockRejectedValue({
      response: { status: 409, data: { code: "DUPLICATE" } },
    });
    const { onSaved } = renderForm();
    fireEvent.click(screen.getByTestId("loyalty-save-flight"));
    expect(await screen.findByText("loyalty:duplicateError")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("TierHistoryToggle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves only the history, leaving the rest of the card alone", async () => {
    api.updateLoyaltyMembership.mockResolvedValue({});
    const onSaved = vi.fn();
    render(
      <TierHistoryToggle
        membershipId="m1"
        periods={[{ id: "p1", tier: "Silver", validFrom: "2022-01-01", validUntil: "2024-02-29" }]}
        onSaved={onSaved}
      />
    );
    fireEvent.click(screen.getByTestId("tier-history-toggle-m1"));
    fireEvent.click(screen.getByText("loyalty:history.save"));
    await waitFor(() =>
      expect(api.updateLoyaltyMembership).toHaveBeenCalledWith("m1", {
        tierPeriods: [{ tier: "Silver", validFrom: "2022-01-01", validUntil: "2024-02-29" }],
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
