import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import adminDe from "../../../i18n/resources/de/admin.json";

function resolve(bundle: unknown, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

// Resolve real DE strings so assertions can target actual UI copy, mirroring
// AirlineLogoRefreshButton.test.tsx — the global setup mock just echoes keys.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const namespaced = key.startsWith("admin:") ? key.slice("admin:".length) : key;
      const raw = resolve(adminDe, namespaced);
      return typeof raw === "string" ? raw : key;
    },
  }),
}));

const { search, list, create, airportSearch, airportCreate } = vi.hoisted(() => ({
  search: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  airportSearch: vi.fn(),
  airportCreate: vi.fn(),
}));

vi.mock("../../../lib/api/catalogue", () => ({
  airlinesApi: { search, list, create },
  aircraftApi: {
    search: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    create: vi.fn(),
  },
}));

vi.mock("../../../lib/api/airports", () => ({
  airportsApi: { search: airportSearch, create: airportCreate },
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import AirlinesSection from "../masterData/AirlinesSection";
import AircraftSection from "../masterData/AircraftSection";
import AirportsSection from "../masterData/AirportsSection";

describe("flight master-data sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const lufthansa = { id: 1, iata: "LH", icao: "DLH", name: "Lufthansa", callsign: "LUFTHANSA", country: "Germany", active: true, isUserAdded: false };
    search.mockResolvedValue([lufthansa]);
    list.mockResolvedValue({ items: [lufthansa], total: 1 });
  });

  it("renders the airline returned by airlinesApi.search", async () => {
    render(<AirlinesSection />);

    expect(await screen.findByText("Lufthansa")).toBeInTheDocument();
    expect(screen.getByText("LH")).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledWith(""));
  });

  it("renders the add-airline form inputs", async () => {
    render(<AirlinesSection />);
    await screen.findByText("Lufthansa");

    const airlineSection = screen
      .getByRole("heading", { name: /Airlines/ })
      .closest("section") as HTMLElement;
    expect(within(airlineSection).getByPlaceholderText("Name")).toBeInTheDocument();
    expect(within(airlineSection).getByPlaceholderText("IATA")).toBeInTheDocument();
    expect(within(airlineSection).getByPlaceholderText("ICAO")).toBeInTheDocument();
    expect(within(airlineSection).getByRole("button", { name: "Hinzufügen" })).toBeInTheDocument();
  });

  // #191 — the airports section, completing the flight master-data page.
  it("renders the airports section, searches on input, and creates via the form", async () => {
    const user = (await import("@testing-library/user-event")).default;
    airportSearch.mockResolvedValue([
      {
        id: 7,
        iata: "UET",
        icao: "EDHE",
        name: "Uetersen",
        city: "Uetersen",
        country: "DE",
        lat: 53.6,
        lon: 9.7,
        isUserAdded: true,
      },
    ]);
    airportCreate.mockResolvedValue({
      id: 8,
      name: "Testfeld",
      lat: 48.1,
      lon: 11.2,
      isUserAdded: true,
    });
    render(<AirportsSection />);

    const section = (await screen.findByRole("heading", { name: /Flughäfen/ })).closest(
      "section"
    ) as HTMLElement;

    // Search needs ≥2 chars, then lists the hit with the user-added badge.
    await user.type(
      within(section).getByPlaceholderText("Flughafen, IATA oder ICAO suchen …"),
      "ue"
    );
    expect(await within(section).findByText("Uetersen")).toBeInTheDocument();
    expect(within(section).getByText("Benutzerdefiniert")).toBeInTheDocument();
    await waitFor(() => expect(airportSearch).toHaveBeenCalledWith("ue"));

    // Create: name + coordinates are enough (codeless private airfield).
    await user.type(within(section).getByPlaceholderText("Name"), "Testfeld");
    await user.type(within(section).getByPlaceholderText("Breite"), "48.1");
    await user.type(within(section).getByPlaceholderText("Länge"), "11.2");
    await user.click(within(section).getByRole("button", { name: "Hinzufügen" }));

    await waitFor(() =>
      expect(airportCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Testfeld", lat: 48.1, lon: 11.2 })
      )
    );
    expect(addToast).toHaveBeenCalledWith("success", "Flughafen angelegt.");
  });

  it("rejects non-numeric coordinates before hitting the API", async () => {
    const user = (await import("@testing-library/user-event")).default;
    airportSearch.mockResolvedValue([]);
    render(<AirportsSection />);

    const section = (await screen.findByRole("heading", { name: /Flughäfen/ })).closest(
      "section"
    ) as HTMLElement;
    await user.type(within(section).getByPlaceholderText("Name"), "Testfeld");
    await user.type(within(section).getByPlaceholderText("Breite"), "abc");
    await user.type(within(section).getByPlaceholderText("Länge"), "11.2");
    await user.click(within(section).getByRole("button", { name: "Hinzufügen" }));

    expect(airportCreate).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("Koordinaten müssen Zahlen sein")
    );
  });

  // The catalogues run to thousands of rows. Before the split they rendered
  // into an unbounded list, so the page just grew and the section below was
  // pushed off-screen — the list has to scroll inside its own box.
  it("keeps each catalogue list scrollable inside a bounded box", async () => {
    render(<AirlinesSection />);
    await screen.findByText("Lufthansa");

    const list = screen.getByRole("list");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toMatch(/max-h-/);
  });

  it("renders the aircraft section with its own add form", async () => {
    render(<AircraftSection />);

    const section = (await screen.findByRole("heading", { name: /Flugzeugtypen/ })).closest(
      "section"
    ) as HTMLElement;
    await waitFor(() => expect(within(section).getByText("Keine Treffer.")).toBeInTheDocument());
  });
});
