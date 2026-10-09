import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";
import { companionsApi } from "../lib/api";

// The flight forms ask the user's logbook for suggestions over the network;
// these tests pin other wiring and must reach none.
vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: () => ({
    seats: [],
    flightNumbers: [],
    frequentFlyerNumber: null,
    departureTerminals: [],
  }),
}));
vi.mock("../lib/api");
vi.mock("../store/settingsStore", () => ({
  useSettingsStore: vi.fn().mockReturnValue({
    features: { enableCostTracking: true },
    units: { distanceUnit: "kilometers" },
    defaults: {
      flightStatus: "scheduled",
      seatClass: "economy",
      favoriteAirline: "",
      flightCategory: "business",
    },
  }),
}));
vi.mock("../lib/geo", () => ({
  calculateDistance: vi.fn().mockReturnValue(1000),
}));
vi.mock("../lib/timeEstimation", () => ({
  storeHistoricalFlightTime: vi.fn(),
  estimateFlightTimes: vi.fn().mockReturnValue({
    arrivalTime: "14:00",
    source: "heuristic",
    confidence: "low",
  }),
}));

// TripSelectField fetches the trip list on mount from `lib/api/trips` — a
// different module than the `lib/api` barrel, so a barrel mock never covered it
// and the request escaped to the network (forgejo#110). An empty list is what a
// failed request already produced, so the assertions below are unchanged.
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return { ...actual, tripsApi: { ...actual.tripsApi, getAll: vi.fn().mockResolvedValue([]) } };
});

// EmailImportTab fetches `/parser-capabilities` through `lib/api/client` --
// a different module than the `lib/api` barrel mocked above, so the request
// escaped to the real network and then failed whichever test happened to be
// running when it landed. Same shape as the trips mock above (forgejo#110).
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  const stub = (): Promise<{ data: Record<string, never> }> => Promise.resolve({ data: {} });
  return {
    ...actual,
    api: {
      get: vi.fn(stub),
      post: vi.fn(stub),
      put: vi.fn(stub),
      patch: vi.fn(stub),
      delete: vi.fn(stub),
    },
  };
});

// The airport picker searches the catalogue; here a button stands in that
// picks a fixed airport into the same input id.
const AIRPORTS = {
  "flight-form-departure-airport": {
    iata: "MUC",
    icao: "EDDM",
    name: "Munich",
    city: "Munich",
    country: "DE",
    lat: 48.35,
    lon: 11.79,
    timezone: "Europe/Berlin",
  },
  "flight-form-arrival-airport": {
    iata: "CPH",
    icao: "EKCH",
    name: "Copenhagen",
    city: "Copenhagen",
    country: "DK",
    lat: 55.62,
    lon: 12.65,
    timezone: "Europe/Copenhagen",
  },
} as const;
vi.mock("../components/AirportAutocomplete", () => ({
  default: ({
    id,
    value,
    onChange,
  }: {
    id: keyof typeof AIRPORTS;
    value: { iata: string } | null;
    onChange: (a: unknown) => void;
  }) => (
    <>
      <input id={id} required readOnly value={value?.iata ?? ""} />
      <button type="button" onClick={() => onChange(AIRPORTS[id])}>
        {`pick-${id}`}
      </button>
    </>
  ),
}));

const mockOnCancel = vi.fn();

async function openManual(onSubmit: (...a: unknown[]) => unknown) {
  render(<SimplifiedFlightFormV2 onSubmit={onSubmit as never} onCancel={mockOnCancel} />);
  fireEvent.click(screen.getByText(/flights:form\.manualEntryAction/i));
  await screen.findByRole("button", { name: /flights:form\.submit$/i });
}

function pickBothAirports(): void {
  fireEvent.click(screen.getByText("pick-flight-form-departure-airport"));
  fireEvent.click(screen.getByText("pick-flight-form-arrival-airport"));
}

const form = (): HTMLFormElement => screen.getByRole("dialog").querySelector("form")!;
const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });

/** forgejo#245–#249 on the flight CREATE form — the reference the others copied. */
describe("SimplifiedFlightFormV2 — the shared form blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.mocked(companionsApi.list).mockResolvedValue([]);
  });

  it("closes an untouched form at once, and asks once something was entered", async () => {
    await openManual(vi.fn());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(mockOnCancel).toHaveBeenCalledTimes(1));
  });

  it("asks before a changed form is discarded", async () => {
    await openManual(vi.fn());
    fireEvent.click(screen.getByText("pick-flight-form-departure-airport"));
    fireEvent.click(screen.getByRole("button", { name: "flights:form.cancel" }));
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it("keeps the draft after a dropped connection, says so, and the retry saves", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce(undefined);
    await openManual(onSubmit);
    pickBothAirports();
    fireEvent.submit(form());

    const banner = await screen.findByText("common:saveErrors.network");
    const alert = banner.closest("[data-form-error-banner]") as HTMLElement;
    expect(alert).toHaveAttribute("role", "alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(
      (document.getElementById("flight-form-departure-airport") as HTMLInputElement).value
    ).toBe("MUC");

    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  it("sends one create for a double submit", async () => {
    let settle: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((r) => (settle = r)));
    await openManual(onSubmit);
    pickBothAirports();
    act(() => {
      fireEvent.submit(form());
      fireEvent.submit(form());
    });
    await act(async () => settle());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("puts a time the server refused beside that time, not in the banner", async () => {
    const refused = Object.assign(new Error("422"), {
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          error: "Time field refused",
          code: "LOCAL_TIME_NONEXISTENT",
          field: "departureLocal",
        },
      },
    });
    await openManual(vi.fn().mockRejectedValue(refused));
    pickBothAirports();
    fireEvent.submit(form());

    const depTime = document.getElementById("timesFieldsDepTime") as HTMLInputElement;
    await waitFor(() => expect(depTime).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(depTime.getAttribute("aria-describedby")!)).toHaveTextContent(
      "common:saveErrors.localTimeNonexistent"
    );
    expect(document.querySelector("[data-form-error-banner]")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(depTime));

    // The next edit takes it away.
    fireEvent.change(depTime, { target: { value: "03:30" } });
    await waitFor(() => expect(depTime).not.toHaveAttribute("aria-invalid"));
  });

  it("names a half-filled actual pair at its missing time and goes there", async () => {
    const onSubmit = vi.fn();
    await openManual(onSubmit);
    pickBothAirports();
    fireEvent.change(document.getElementById("timesFieldsActualDepDate")!, {
      target: { value: "2026-10-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: /flights:form\.submitAndReturn/i }));

    const actualTime = document.getElementById("timesFieldsActualDepTime") as HTMLInputElement;
    await waitFor(() => expect(actualTime).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(actualTime.getAttribute("aria-describedby")!)).toHaveTextContent(
      "flights:form.errors.actualTimeMissing"
    );
    await waitFor(() => expect(document.activeElement).toBe(actualTime));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("starts the discard guard over after 'save and return' prepared the next leg", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await openManual(onSubmit);
    pickBothAirports();
    fireEvent.click(screen.getByRole("button", { name: /flights:form\.submitAndReturn/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        (document.getElementById("flight-form-departure-airport") as HTMLInputElement).value
      ).toBe("CPH")
    );
    fireEvent.click(screen.getByRole("button", { name: "flights:form.cancel" }));
    expect(screen.queryByText("common:discard.title")).toBeNull();
    await waitFor(() => expect(mockOnCancel).toHaveBeenCalledTimes(1));
  });

  it("names each airport input by its visible label", async () => {
    await openManual(vi.fn());
    const label = document.querySelector('label[for="flight-form-departure-airport"]');
    expect(label).toHaveTextContent("flights:form.from");
  });

  it("names every field by its visible label, not by a placeholder", async () => {
    await openManual(vi.fn());
    for (const key of [
      "flights:form.airline",
      "flights:form.flightNumber",
      "flights:form.seat",
      "flights:form.seatClass",
      "flights:form.category",
      "flights:form.terminal",
      "flights:form.gate",
      "flights:form.bookingReference",
      "flights:form.ticketNumber",
      "flights:form.frequentFlyerNumber",
      "flights:form.notes",
      "flights:form.currency",
    ]) {
      expect(screen.getByLabelText(key), key).toBeInTheDocument();
    }
  });

  it("sizes its inputs for a finger on a coarse pointer", async () => {
    await openManual(vi.fn());
    expect(form().className).toContain("pointer-coarse:[&_select]:min-h-(--ts-size-touch-min)");
  });
});
