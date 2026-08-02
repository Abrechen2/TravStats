import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortPicker } from "../../../components/Cruise/PortPicker";
import { portsApi } from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  // geocode MUST be part of the mock: without it the component's fallback
  // call hits undefined, throws, and the tests silently exercise the error
  // path instead of the one they claim to cover.
  portsApi: { search: vi.fn(), geocode: vi.fn(), create: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

describe("PortPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(portsApi.geocode).mockResolvedValue([]);
  });

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

  // The resolution chain the roadmap's "Taranto" item complained about,
  // pinned at the component level (backend counterpart: ports.test.ts).
  it("never calls the geocoder when the local catalog has a hit (offline-first)", async () => {
    vi.mocked(portsApi.search).mockResolvedValue([
      {
        id: 7635,
        name: "Taranto",
        city: null,
        country: "Italy",
        unlocode: "ITTAR",
        lat: 40.47,
        lon: 17.23,
        timezone: "Europe/Rome",
        region: "mediterranean",
        isUserAdded: false,
      },
    ]);
    render(<PortPicker value={null} onChange={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "Taranto");
    await screen.findByRole("button", { name: /Taranto/ });

    expect(portsApi.geocode).not.toHaveBeenCalled();
  });

  it("surfaces a search failure instead of pretending the catalog is empty", async () => {
    vi.mocked(portsApi.search).mockRejectedValue(new Error("network down"));
    render(<PortPicker value={null} onChange={vi.fn()} />);

    await userEvent.type(screen.getByRole("combobox"), "Taranto");

    expect(await screen.findByText("picker.searchError")).toBeInTheDocument();
  });

  it("falls back to the geocoder on an empty local result and persists a picked candidate", async () => {
    vi.mocked(portsApi.search).mockResolvedValue([]);
    vi.mocked(portsApi.geocode).mockResolvedValue([
      {
        name: "Portoferraio",
        city: "Portoferraio",
        country: "Italia",
        lat: 42.81,
        lon: 10.31,
        source: "geocoder",
      },
    ]);
    vi.mocked(portsApi.create).mockResolvedValue({
      id: 99001,
      name: "Portoferraio",
      city: "Portoferraio",
      country: "Italia",
      unlocode: null,
      lat: 42.81,
      lon: 10.31,
      timezone: null,
      region: null,
      isUserAdded: true,
    });
    const onChange = vi.fn();
    render(<PortPicker value={null} onChange={onChange} />);

    await userEvent.type(screen.getByRole("combobox"), "Portoferraio");

    // Labelled as geocoder results, not passed off as catalog hits.
    expect(await screen.findByText("picker.via_geocoder")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Portoferraio/ }));
    await waitFor(() =>
      expect(portsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Portoferraio", lat: 42.81, lon: 10.31 })
      )
    );
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 99001 }));
  });

  it("shows an error when persisting a geocoder candidate fails", async () => {
    vi.mocked(portsApi.search).mockResolvedValue([]);
    vi.mocked(portsApi.geocode).mockResolvedValue([
      { name: "Portoferraio", city: null, country: null, lat: 42.81, lon: 10.31, source: "geocoder" },
    ]);
    vi.mocked(portsApi.create).mockRejectedValue(new Error("500"));
    render(<PortPicker value={null} onChange={vi.fn()} />);

    await userEvent.type(screen.getByRole("combobox"), "Portoferraio");
    await userEvent.click(await screen.findByRole("button", { name: /Portoferraio/ }));

    expect(await screen.findByText("picker.createPortError")).toBeInTheDocument();
  });
});
