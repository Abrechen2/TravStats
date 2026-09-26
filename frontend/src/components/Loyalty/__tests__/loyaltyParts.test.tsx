import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  createLoyaltyMembership: vi.fn(),
  updateLoyaltyMembership: vi.fn(),
}));
vi.mock("../../../lib/api/loyalty", () => api);

import MaskedNumber, { maskNumber } from "../MaskedNumber";
import LoyaltyCardForm from "../LoyaltyCardForm";

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

  it("sends the current status and no dated history", async () => {
    api.createLoyaltyMembership.mockResolvedValue({});
    const { onSaved } = renderForm();
    fireEvent.change(screen.getByLabelText("loyalty:field.tier"), { target: { value: "Senator" } });
    fireEvent.click(screen.getByTestId("loyalty-save-flight"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, input] = api.createLoyaltyMembership.mock.calls[0];
    expect(input.tier).toBe("Senator");
    expect(input).not.toHaveProperty("tierPeriods");
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
