import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useSettingsStore } from "../../../store/settingsStore";

const markMock = vi.fn();
vi.mock("../../../lib/api/operators", async (importActual) => {
  const actual = await importActual<typeof import("../../../lib/api/operators")>();
  return { ...actual, getOperatorMark: (...a: unknown[]) => markMock(...a) };
});
vi.mock("../../../hooks/usePlaceCategories", () => ({
  usePlaceCategories: () => ({ customs: [] }),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import { FlightCard, CruiseCard } from "../TimelineEventCards";
import { BusTripCard } from "../../bus/BusTripCard";
import { FerryTripCard } from "../../ferry/FerryTripCard";
import { RailTripCard } from "../../rail/RailTripCard";
import { RentalTripCard } from "../../rental/RentalTripCard";

const when = {
  utc: "2027-05-02T07:00:00.000Z",
  zone: "Europe/Lisbon",
  offset: "+01:00",
  local: "2027-05-02T08:00:00",
  precision: "minute" as const,
  zoneSource: "stored" as const,
};

function setStyle(style: string | undefined): void {
  (useSettingsStore.getState().units as unknown as Record<string, unknown>).airlineLogoStyle =
    style;
}

const wrap = (node: JSX.Element) => render(<MemoryRouter>{node}</MemoryRouter>);
const t = ((k: string) => k) as never;

beforeEach(() => markMock.mockResolvedValue({ available: true, source: "wikidata", credit: null }));
afterEach(() => {
  setStyle(undefined);
  markMock.mockReset();
});

const flightEv = {
  id: "f1",
  kind: "flight",
  date: when.utc,
  when,
  title: "LH 1 FRA → LIS",
  subtitle: null,
  flight: { id: "f1", airlineIata: "LH", airline: "Lufthansa", flightNumber: "LH1" },
} as never;

describe("trip timeline carries the operator's mark", () => {
  it("flight card shows the airline tile and keeps the domain colour as a border", () => {
    wrap(<FlightCard ev={flightEv} language="de" t={t} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("/api/v1/airline-logos/LH?variant=logo");
    expect(screen.getByTestId("timeline-card-with-mark").style.borderLeft).toContain("4px solid");
  });

  it("flight card honours the user's 'icon' airline logo style", () => {
    setStyle("icon");
    wrap(<FlightCard ev={flightEv} language="de" t={t} />);
    expect((screen.getByRole("img") as HTMLImageElement).src).toContain("variant=icon");
  });

  it("flight card falls back to the code tile when the logo fails", async () => {
    wrap(<FlightCard ev={flightEv} language="de" t={t} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("LH")).toBeInTheDocument();
  });

  it("cruise card shows the cruise line's logo", async () => {
    const ev = {
      id: "c1",
      kind: "cruise",
      date: when.utc,
      when,
      title: "Tour",
      subtitle: null,
      cruise: { id: "c1", cruiseLine: "AIDA Cruises", stops: [] },
    } as never;
    wrap(<CruiseCard ev={ev} language="de" t={t} />);
    expect((await screen.findByTestId("operator-logo")).getAttribute("src")).toBe(
      "/api/v1/operators/logo?domain=cruise&name=AIDA%20Cruises"
    );
  });

  it("bus and ferry cards show the operator logo, one lookup per operator", async () => {
    const ride = (operator: string | null) =>
      ({
        id: "b1",
        operator,
        lineName: null,
        vesselName: null,
        depStationName: "A",
        arrStationName: "B",
        price: null,
        currency: null,
      }) as never;
    wrap(
      <>
        <BusTripCard ride={ride("FlixBus")} date={when.utc} dateLabel="2. Mai" />
        <BusTripCard ride={ride("FlixBus")} date={when.utc} dateLabel="3. Mai" />
        <FerryTripCard ride={ride("Stena Line")} date={when.utc} dateLabel="4. Mai" />
      </>
    );
    await waitFor(() => expect(screen.getAllByTestId("operator-logo")).toHaveLength(3));
    // The shared getOperatorMark cache sits below this mock; the cards ask by (domain, name).
    expect(markMock.mock.calls.map((c) => `${c[0]}:${c[1]}`).sort()).toEqual([
      "bus:FlixBus",
      "bus:FlixBus",
      "ferry:Stena Line",
    ]);
  });

  it("a ride without operator keeps the domain tile, no lookup", () => {
    wrap(
      <BusTripCard
        ride={
          {
            id: "b2",
            operator: null,
            depStationName: "A",
            arrStationName: "B",
            price: null,
          } as never
        }
        date={when.utc}
        dateLabel="x"
      />
    );
    expect(markMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("operator-tile")).toBeInTheDocument();
  });

  it("rail card shows the catalogue logo, falling back to the monogram", () => {
    const journey = {
      id: "r1",
      operator: "Deutsche Bahn",
      depStationName: "A",
      arrStationName: "B",
      price: null,
      delayMinutes: null,
      status: "scheduled",
    } as never;
    wrap(<RailTripCard journey={journey} date={when.utc} dateLabel="x" />);
    const logo = screen.getByTestId("operator-logo");
    expect(logo.getAttribute("src")).toContain("/api/v1/rail/operators/logo?name=Deutsche%20Bahn");
    fireEvent.error(logo);
    expect(screen.queryByTestId("operator-logo")).toBeNull();
    expect(screen.getByText("DB")).toBeInTheDocument();
  });

  it("rental pickup card shows the provider tile", () => {
    const rental = {
      id: "r1",
      provider: "Sixt",
      pickupStationName: "Lisboa",
      returnStationName: "Lisboa",
      pickupTime: when.utc,
      returnTime: "2027-05-06T07:00:00.000Z",
      pickupTimezone: "Europe/Lisbon",
      returnTimezone: "Europe/Lisbon",
      pickupPrecision: "minute",
      returnPrecision: "minute",
      status: "scheduled",
    } as never;
    wrap(<RentalTripCard rental={rental} end="pickup" when={when} />);
    expect(screen.getByTestId("operator-logo").getAttribute("src")).toContain("providers/logo");
  });
});
