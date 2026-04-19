import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortPicker } from "../../../components/Cruise/PortPicker";
import { portsApi } from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  portsApi: { search: vi.fn(), create: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

describe("PortPicker", () => {
  it("searches as user types and shows results", async () => {
    vi.mocked(portsApi.search).mockResolvedValue([
      {
        id: 1,
        name: "Hamburg",
        city: "Hamburg",
        country: "Germany",
        unlocode: "DEHAM",
        lat: 53.5411,
        lon: 9.9842,
        timezone: "Europe/Berlin",
        region: "Europe",
        isUserAdded: false,
      },
    ]);
    const onChange = vi.fn();
    render(<PortPicker value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "ham");
    await waitFor(() => expect(portsApi.search).toHaveBeenCalled(), { timeout: 2000 });
    await userEvent.click(await screen.findByRole("button", { name: /Hamburg/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("shows add-custom button when no result matches and creates a port", async () => {
    vi.mocked(portsApi.search).mockResolvedValue([]);
    vi.mocked(portsApi.create).mockResolvedValue({
      id: 77,
      name: "Custom Harbor",
      city: "Nowhere",
      country: "Atlantis",
      unlocode: null,
      lat: 12.345,
      lon: -45.678,
      timezone: null,
      region: null,
      isUserAdded: true,
    });
    const onChange = vi.fn();
    render(<PortPicker value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "Custom Harbor");
    await waitFor(() => expect(portsApi.search).toHaveBeenCalled(), { timeout: 2000 });

    const addBtn = await screen.findByRole("button", { name: /picker\.add_custom_port/ });
    await userEvent.click(addBtn);

    // Ensure lat/lon inputs render.
    const latInput = await screen.findByPlaceholderText(/lat/i);
    const lonInput = await screen.findByPlaceholderText(/lon/i);
    expect(latInput).toBeInTheDocument();
    expect(lonInput).toBeInTheDocument();

    const cityInput = await screen.findByPlaceholderText(/city/i);
    const countryInput = await screen.findByPlaceholderText(/country/i);
    await userEvent.type(cityInput, "Nowhere");
    await userEvent.type(countryInput, "Atlantis");
    await userEvent.type(latInput, "12.345");
    await userEvent.type(lonInput, "-45.678");

    const saveButtons = screen.getAllByRole("button", { name: /picker\.add_custom_port/ });
    await userEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() =>
      expect(portsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Custom Harbor",
          city: "Nowhere",
          country: "Atlantis",
          lat: 12.345,
          lon: -45.678,
        })
      )
    );
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 77 }));
  });
});
