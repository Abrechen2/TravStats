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

const { search, create } = vi.hoisted(() => ({
  search: vi.fn(),
  create: vi.fn(),
}));

vi.mock("../../../lib/api/catalogue", () => ({
  airlinesApi: { search, create },
  aircraftApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

import AirlineAircraftMasterData from "../AirlineAircraftMasterData";

describe("AirlineAircraftMasterData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.mockResolvedValue([
      { id: 1, iata: "LH", icao: "DLH", name: "Lufthansa", callsign: "LUFTHANSA", country: "Germany", active: true, isUserAdded: false },
    ]);
  });

  it("renders the airline returned by airlinesApi.search", async () => {
    render(<AirlineAircraftMasterData />);

    expect(await screen.findByText("Lufthansa")).toBeInTheDocument();
    expect(screen.getByText("LH")).toBeInTheDocument();
    await waitFor(() => expect(search).toHaveBeenCalledWith(""));
  });

  it("renders the add-airline form inputs", async () => {
    render(<AirlineAircraftMasterData />);
    await screen.findByText("Lufthansa");

    const airlineSection = screen
      .getByRole("heading", { name: /Airlines/ })
      .closest("section") as HTMLElement;
    expect(within(airlineSection).getByPlaceholderText("Name")).toBeInTheDocument();
    expect(within(airlineSection).getByPlaceholderText("IATA")).toBeInTheDocument();
    expect(within(airlineSection).getByPlaceholderText("ICAO")).toBeInTheDocument();
    expect(within(airlineSection).getByRole("button", { name: "Hinzufügen" })).toBeInTheDocument();
  });

  it("renders the aircraft section with its own add form", async () => {
    render(<AirlineAircraftMasterData />);
    await screen.findByText("Lufthansa");

    expect(screen.getByRole("heading", { name: /Flugzeugtypen/ })).toBeInTheDocument();
    expect(screen.getByText("Keine Treffer.")).toBeInTheDocument();
  });
});
