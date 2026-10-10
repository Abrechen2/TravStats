import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));

const create = vi.fn();
const update = vi.fn();
const searchStations = vi.fn();
const listProviders = vi.fn();
vi.mock("../../../lib/api/rental", () => ({
  rentalApi: {
    listProviders: () => listProviders(),
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    searchStations: (...a: unknown[]) => searchStations(...a),
  },
}));

import { RentalFormModal } from "../RentalFormModal";
import { __resetRentalProviderSuggestions } from "../rentalProviders";
import { makeRental } from "./rentalFixture";

/** The form is three steps over one draft (forgejo#236); a field is reached by its step. */
const toStep = (step: "booking" | "pickup" | "return"): void => {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`rental:form\\.steps\\.${step}`) }));
};

const HITS = [
  {
    kind: "earlier",
    airportId: null,
    iata: null,
    name: "City office",
    address: "Main St 1",
    city: null,
    lat: 50.1,
    lon: 8.6,
    country: "DE",
    timezone: "Europe/Berlin",
  },
  {
    kind: "airport",
    airportId: 9,
    iata: "FRA",
    name: "Frankfurt Airport",
    address: null,
    city: "Frankfurt",
    lat: 50.03,
    lon: 8.57,
    country: "DE",
    timezone: "Europe/Berlin",
  },
];

/**
 * The silent-failure classes at the form: every hit is offered (1), a pick
 * carries its airport into the body (2), a failed search and a refused save
 * each say what happened — and a refused save never calls `onSaved` (3).
 */
describe("RentalFormModal", () => {
  beforeEach(() => {
    create.mockReset();
    update.mockReset();
    searchStations.mockReset();
  });

  it("says when the station search fails instead of showing an empty list", async () => {
    searchStations.mockRejectedValue(new Error("network"));
    render(<RentalFormModal rental={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("rental:station.searchPlaceholder"), {
      target: { value: "Frank" },
    });
    expect(await screen.findByText("rental:station.searchError")).toBeTruthy();
  });

  it("offers every hit the server answers, and a pick carries its airport", async () => {
    searchStations.mockResolvedValue(HITS);
    update.mockResolvedValue(makeRental());
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("Frankfurt Flughafen"), {
      target: { value: "Frank" },
    });
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByText("Frankfurt Airport"));
    fireEvent.click(screen.getByRole("button", { name: "rental:form.save" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].pickupStation).toMatchObject({ airportId: 9, country: "DE" });
  });

  it("keeps the dialog open and names a geocoder outage when the save is refused", async () => {
    update.mockRejectedValue({
      response: {
        status: 503,
        data: { code: "RENTAL_GEOCODER_UNAVAILABLE", field: "pickupStation" },
      },
    });
    const onSaved = vi.fn();
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "rental:form.save" }));
    expect(await screen.findByText("rental:form.errors.geocoderUnavailable")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not send a draft whose station nothing places", async () => {
    render(<RentalFormModal rental={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "rental:form.save" }));
    expect(
      (await screen.findAllByText("rental:form.errors.stationUnplaced")).length
    ).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
  });

  // forgejo#196: the common companies are suggestions; any other name is kept as typed.
  // The list is the server's catalogue (data, not code); a failed load offers
  // nothing and the field still saves free text.
  it("suggests the common providers and saves a name outside the list as typed", async () => {
    __resetRentalProviderSuggestions();
    listProviders.mockResolvedValue([
      { id: "sixt", name: "Sixt" },
      { id: "share-now", name: "Share Now" },
    ]);
    update.mockResolvedValue(makeRental());
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    const provider = screen.getByDisplayValue("Testcar");
    const listId = provider.getAttribute("list");
    expect(listId).toBeTruthy();
    const offered = (): (string | null)[] =>
      Array.from(document.getElementById(listId as string)?.querySelectorAll("option") ?? []).map(
        (o) => o.getAttribute("value")
      );
    await waitFor(() => expect(offered()).toEqual(["Sixt", "Share Now"]));
    fireEvent.change(provider, { target: { value: "Autohaus Meier" } });
    fireEvent.click(screen.getByRole("button", { name: "rental:form.save" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].provider).toBe("Autohaus Meier");
  });

  it("offers no suggestions when the catalogue cannot be loaded, and still saves", async () => {
    __resetRentalProviderSuggestions();
    listProviders.mockRejectedValue(new Error("offline"));
    update.mockResolvedValue(makeRental());
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    const provider = screen.getByDisplayValue("Testcar");
    fireEvent.change(provider, { target: { value: "Sixt" } });
    fireEvent.click(screen.getByRole("button", { name: "rental:form.save" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].provider).toBe("Sixt");
    expect(document.querySelectorAll("#rental-provider-suggestions option")).toHaveLength(0);
  });

  it("sends the typed licence plate with the rental", async () => {
    update.mockResolvedValue(makeRental());
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    toStep("pickup");
    fireEvent.change(screen.getByLabelText("rental:form.licensePlate"), {
      target: { value: " F-TS 2026 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "rental:form.save" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].licensePlate).toBe("F-TS 2026");
  });

  // forgejo#206: both readings in the form, the km they give said before saving.
  it("takes both odometer readings, says the km they give, and sends them", async () => {
    update.mockResolvedValue(makeRental());
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    toStep("return");
    expect(screen.getByTestId("rental-form-driven").textContent).toBe("rental:form.drivenUnknown");
    toStep("pickup");
    fireEvent.change(screen.getByLabelText("rental:form.odometerOutKm"), {
      target: { value: "12.000" },
    });
    toStep("return");
    fireEvent.change(screen.getByLabelText("rental:form.odometerInKm"), {
      target: { value: "12.634" },
    });
    expect(screen.getByTestId("rental-form-driven").textContent).toBe("rental:form.driven");
    fireEvent.click(screen.getByRole("button", { name: "rental:form.save" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ odometerOutKm: 12_000, odometerInKm: 12_634 });
    // No correction was typed: none is sent, so nothing is labelled "by hand".
    expect("distanceKm" in update.mock.calls[0][1]).toBe(false);
  });

  it("refuses a return reading below the pick-up one beside that field, and does not save", async () => {
    render(<RentalFormModal rental={makeRental()} onClose={vi.fn()} onSaved={vi.fn()} />);
    toStep("pickup");
    fireEvent.change(screen.getByLabelText("rental:form.odometerOutKm"), {
      target: { value: "12634" },
    });
    toStep("return");
    fireEvent.change(screen.getByLabelText("rental:form.odometerInKm"), {
      target: { value: "12000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "rental:form.save" }));
    // The error sits beside the field and is its description (forgejo#246).
    const returnReading = screen.getByLabelText("rental:form.odometerInKm");
    expect(returnReading.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(returnReading.getAttribute("aria-describedby") ?? "")?.textContent
    ).toBe("rental:form.errors.odometerReversed");
    expect(update).not.toHaveBeenCalled();
  });
});
