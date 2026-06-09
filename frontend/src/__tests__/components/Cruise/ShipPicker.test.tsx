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
      id: 99,
      name: "MS Custom",
      cruiseLine: "Custom Line",
      imo: null,
      yearBuilt: null,
      grossTonnage: null,
      capacity: null,
      status: "active",
      isUserAdded: true,
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
  });
});
