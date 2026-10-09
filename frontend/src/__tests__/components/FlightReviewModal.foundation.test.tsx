import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

const getByCode = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api/airports", () => ({ airportsApi: { getByCode } }));
vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  parseApi: { submitParserCorrection: vi.fn() },
}));
// The picker's own search is not under test; it renders its id and error.
vi.mock("../../components/AirportAutocomplete", () => ({
  default: ({ id, error }: { id: string; error?: string | null }) => (
    <>
      <input id={id} readOnly aria-invalid={error ? true : undefined} />
      {error ? <p>{error}</p> : null}
    </>
  ),
}));
vi.mock("../../store/authStore", () => ({ useAuthStore: () => ({ user: { id: "u1" } }) }));
vi.mock("../../store/settingsStore", () => {
  const state = { features: { enableCostTracking: false }, baseCurrency: "EUR" };
  return { useSettingsStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("@/hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("@/hooks/useSuggestions", () => ({
  useSuggestions: () => ({ airlines: [], aircraft: [] }),
}));

const airport = (code: string) => ({
  iata: code,
  icao: `E${code}`,
  name: code,
  lat: 50,
  lon: 8,
  timezone: "Europe/Berlin",
});

const booking = {
  flightNumber: "LH400",
  departureCode: "FRA",
  arrivalCode: "MUC",
  departureTime: "2027-01-15T10:00:00Z",
  arrivalTime: "2027-01-15T11:00:00Z",
  inferredFields: ["flightNumber"],
} as unknown as ParsedBooking;

function renderReview(onConfirm = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) {
  render(
    <FlightReviewModal
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      initialData={booking}
      source="email"
    />
  );
  return { onConfirm, onClose };
}

const confirm = (): HTMLButtonElement =>
  document.querySelector('button[type="submit"]') as HTMLButtonElement;
const airportsResolved = () => waitFor(() => expect(confirm()).not.toBeDisabled());
const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });
// A refusal the server answered (nothing stored), so a create may retry.
const dbDown = Object.assign(new Error("503"), {
  isAxiosError: true,
  response: { status: 503, data: { code: "DB_UNAVAILABLE" } },
});

/** forgejo#245–#249 on the parser review (part of creating a flight from a document). */
describe("FlightReviewModal — the shared form blocks", () => {
  beforeEach(() => {
    getByCode.mockReset().mockImplementation(async (code: string) => airport(code));
  });

  it("says beside the greyed confirm which airport is still missing", async () => {
    getByCode.mockImplementation(async (code: string) => {
      if (code === "MUC") throw { response: { status: 404 } };
      return airport(code);
    });
    renderReview();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "flights:form.missing.arrivalAirport" })
      ).toBeInTheDocument()
    );
    expect(confirm()).toBeDisabled();
    const hint = document.getElementById(confirm().getAttribute("aria-describedby")!);
    expect(hint).toHaveTextContent("common:form.saveBlocked");
  });

  it("closes untouched at once, and asks once a parsed value was changed", async () => {
    const { onClose } = renderReview();
    await airportsResolved();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding a corrected value", async () => {
    const { onClose } = renderReview();
    await airportsResolved();
    fireEvent.change(screen.getByLabelText(/flights:form\.seat$/), { target: { value: "12A" } });
    fireEvent.click(screen.getByRole("button", { name: "flights:review.discard" }));
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the corrections after a database restart; the retry confirms", async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(dbDown).mockResolvedValueOnce(undefined);
    renderReview(onConfirm);
    await airportsResolved();
    fireEvent.change(screen.getByLabelText(/flights:form\.seat$/), { target: { value: "12A" } });
    fireEvent.click(confirm());
    const banner = (await screen.findByText("common:saveErrors.dbUnavailable")).closest(
      "[data-form-error-banner]"
    ) as HTMLElement;
    expect(banner).toHaveAttribute("role", "alert");
    expect((screen.getByLabelText(/flights:form\.seat$/) as HTMLInputElement).value).toBe("12A");
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });

  // Bus review, Minor 2 (integration wiring): confirming creates the flight.
  it("offers no retry when the confirmation's answer was lost", async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(networkError);
    renderReview(onConfirm);
    await airportsResolved();
    fireEvent.click(confirm());
    expect(await screen.findByText("common:saveErrors.outcomeUnknown")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common:buttons.retry" })).toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("confirms once for a double click", async () => {
    let settle: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => (settle = r)));
    renderReview(onConfirm);
    await airportsResolved();
    act(() => {
      fireEvent.click(confirm());
      fireEvent.click(confirm());
    });
    await act(async () => settle());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("puts a time the server refused beside that time", async () => {
    const refused = Object.assign(new Error("422"), {
      isAxiosError: true,
      response: {
        status: 422,
        data: { code: "LOCAL_TIME_NONEXISTENT", field: "departureLocal" },
      },
    });
    renderReview(vi.fn().mockRejectedValue(refused));
    await airportsResolved();
    fireEvent.click(confirm());
    const time = screen.getByLabelText(/flights:form\.departureTime/) as HTMLInputElement;
    await waitFor(() => expect(time).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(time.getAttribute("aria-describedby")!)).toHaveTextContent(
      "common:saveErrors.localTimeNonexistent"
    );
    expect(document.querySelector("[data-form-error-banner]")).toBeNull();
  });

  it("writes out why a value is a guess instead of hiding it in a tooltip", async () => {
    renderReview();
    await airportsResolved();
    const label = document.querySelector(`label[for="${screen.getByDisplayValue("LH400").id}"]`);
    expect(label).toHaveTextContent("flights:review.inferredHint");
    expect(label?.querySelector("[title]")).toBeNull();
  });
});
