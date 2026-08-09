import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChainPicker } from "../ChainPicker";
import { listChains, createChain } from "../../../lib/api/lodging";
import type { LodgingChain } from "../../../types/lodging";

vi.mock("../../../lib/api/lodging", () => ({
  listChains: vi.fn(),
  createChain: vi.fn(),
}));

const hilton: LodgingChain = {
  id: 1,
  name: "Hilton",
  brandColor: null,
  loyaltyProgram: "Hilton Honors",
  isUserAdded: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("ChainPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listChains).mockResolvedValue([]);
  });

  it("selects an existing chain from the search dropdown", async () => {
    vi.mocked(listChains).mockResolvedValue([hilton]);
    const onChange = vi.fn();

    render(<ChainPicker value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "hil");

    const option = await screen.findByText("Hilton");
    await userEvent.click(option);

    expect(onChange).toHaveBeenCalledWith(hilton);
  });

  // The backend matches chain names case-insensitively: POSTing "hilton"
  // when "Hilton" already exists returns the EXISTING row (200), not a new
  // one. The UI must reflect that plainly instead of implying a new chain
  // was created with a lowercase name.
  it("shows a 'matched existing' notice — not a false success — when the add flow resolves a case-variant duplicate", async () => {
    vi.mocked(listChains).mockResolvedValue([]); // debounced search finds nothing yet
    vi.mocked(createChain).mockResolvedValue(hilton); // backend returns the EXISTING "Hilton" row
    const onChange = vi.fn();

    render(<ChainPicker value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "hilton");

    const addButton = await screen.findByText('lodging:chainPicker.addMissing');
    await userEvent.click(addButton);

    const confirmButton = await screen.findByRole("button", {
      name: /chainPicker\.addMissing/,
    });
    await userEvent.click(confirmButton);

    await waitFor(() => expect(createChain).toHaveBeenCalledWith({ name: "hilton" }));
    expect(onChange).toHaveBeenCalledWith(hilton);
    const notice = await screen.findByTestId("chain-matched-existing");
    expect(notice.textContent).toBe("lodging:chainPicker.matchedExisting");
  });

  it("labels the clear button as a clear action, not the 'independent' field label (no stray text next to the selected chain)", async () => {
    // Regression: the clear button used to render `t("lodging:field.independent")`
    // ("Unabhängig") right next to the just-selected chain name, reading as a
    // stray duplicate label rather than a clear/remove action.
    render(<ChainPicker value={hilton} onChange={vi.fn()} />);

    const clearButton = await screen.findByText("lodging:chainPicker.clear");
    expect(clearButton.textContent).not.toBe("lodging:field.independent");
    expect(screen.queryByText("lodging:field.independent")).not.toBeInTheDocument();
  });

  it("does NOT show the matched-existing notice for a genuinely new chain (typed name === returned name)", async () => {
    const novotel: LodgingChain = { ...hilton, id: 2, name: "Novotel Business", isUserAdded: true };
    vi.mocked(listChains).mockResolvedValue([]);
    vi.mocked(createChain).mockResolvedValue(novotel);
    const onChange = vi.fn();

    render(<ChainPicker value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "Novotel Business");

    const addButton = await screen.findByText('lodging:chainPicker.addMissing');
    await userEvent.click(addButton);
    const confirmButton = await screen.findByRole("button", { name: /chainPicker\.addMissing/ });
    await userEvent.click(confirmButton);

    await waitFor(() => expect(createChain).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith(novotel);
    expect(screen.queryByTestId("chain-matched-existing")).not.toBeInTheDocument();
  });
});
