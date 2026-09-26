import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShipPicker } from "../../../components/Cruise/ShipPicker";
import { shipsApi } from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  shipsApi: { search: vi.fn(), create: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

describe("ShipPicker", () => {
  it("searches as user types and shows results", async () => {
    vi.mocked(shipsApi.search).mockResolvedValue([
      {
        id: 1,
        name: "AIDAnova",
        cruiseLine: "AIDA Cruises",
        imo: "9781865",
        yearBuilt: 2018,
        grossTonnage: null,
        capacity: null,
        status: "active",
        isUserAdded: false,
      },
    ]);
    const onChange = vi.fn();
    render(<ShipPicker value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "aida");
    await waitFor(() => expect(shipsApi.search).toHaveBeenCalled(), { timeout: 2000 });
    await userEvent.click(await screen.findByText("AIDAnova"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("shows add-custom button when no result matches and creates a ship", async () => {
    vi.mocked(shipsApi.search).mockResolvedValue([]);
    vi.mocked(shipsApi.create).mockResolvedValue({
      ship: {
        id: 99,
        name: "MS Custom",
        cruiseLine: "Custom Line",
        imo: null,
        yearBuilt: null,
        grossTonnage: null,
        capacity: null,
        status: "active",
        isUserAdded: true,
      },
      existing: false,
    });
    const onChange = vi.fn();
    render(<ShipPicker value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "MS Custom");
    await waitFor(() => expect(shipsApi.search).toHaveBeenCalled(), { timeout: 2000 });

    const addBtn = await screen.findByRole("button", { name: /picker\.add_custom_ship/ });
    await userEvent.click(addBtn);

    const lineInput = await screen.findByPlaceholderText(/field\.line/);
    await userEvent.type(lineInput, "Custom Line");

    // There will be two buttons carrying the add-custom key (trigger + save).
    // Click the one inside the dialog — identify it by being the second occurrence.
    const saveButtons = screen.getAllByRole("button", { name: /picker\.add_custom_ship/ });
    await userEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() =>
      expect(shipsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "MS Custom", cruiseLine: "Custom Line" })
      )
    );
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 99 }));
    expect(screen.queryByText("picker.shipAlreadyExists")).not.toBeInTheDocument();
  });

  // A failed search used to read as "no such ship" and offered "add ship" —
  // every such add wrote a duplicate into the shared catalogue.
  it("says the search failed and does not offer to add a ship", async () => {
    vi.mocked(shipsApi.search).mockRejectedValue(new Error("Network Error"));
    render(<ShipPicker value={null} onChange={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "AIDAnova");

    expect(await screen.findByText("picker.shipSearchError")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /picker\.add_custom_ship/ })
    ).not.toBeInTheDocument();
  });

  it("selects the existing ship and says so when the server reports a duplicate", async () => {
    vi.mocked(shipsApi.search).mockResolvedValue([]);
    vi.mocked(shipsApi.create).mockResolvedValue({
      ship: {
        id: 5,
        name: "AIDAnova",
        cruiseLine: "AIDA Cruises",
        imo: "9781865",
        yearBuilt: 2018,
        grossTonnage: null,
        capacity: null,
        status: "active",
        isUserAdded: false,
      },
      existing: true,
    });
    const onChange = vi.fn();
    render(<ShipPicker value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "aidanova");
    await userEvent.click(await screen.findByRole("button", { name: /picker\.add_custom_ship/ }));
    await userEvent.type(await screen.findByPlaceholderText(/field\.line/), "AIDA");
    const saveButtons = screen.getAllByRole("button", { name: /picker\.add_custom_ship/ });
    await userEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 5 })));
    expect(await screen.findByText("picker.shipAlreadyExists")).toBeInTheDocument();
  });
});
