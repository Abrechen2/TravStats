import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

import BookingFields, { type BookingFieldsValue } from "../BookingFields";
import { useSettingsStore } from "../../../../store/settingsStore";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const VALUE: BookingFieldsValue = {
  bookingReference: "9RFAA7",
  ticketNumber: "2202236084346",
  bookingClassLetter: "Y",
  baggageAllowance: "23 kg",
  frequentFlyerNumber: "992223334",
};

function byPlaceholder(container: HTMLElement, key: string): HTMLInputElement {
  return container.querySelector(
    `input[placeholder="flights:form.placeholders.${key}"]`
  ) as HTMLInputElement;
}

describe("BookingFields", () => {
  it("renders all five booking inputs with their values", () => {
    const { container } = render(<BookingFields value={VALUE} onChange={() => {}} />);

    expect(byPlaceholder(container, "bookingReference").value).toBe("9RFAA7");
    expect(byPlaceholder(container, "ticketNumber").value).toBe("2202236084346");
    expect(byPlaceholder(container, "bookingClassLetter").value).toBe("Y");
    expect(byPlaceholder(container, "baggageAllowance").value).toBe("23 kg");
    expect(byPlaceholder(container, "frequentFlyerNumber").value).toBe("992223334");
  });

  it("editing one field emits the full value with ONLY that field changed", () => {
    const onChange = vi.fn();
    const { container } = render(<BookingFields value={VALUE} onChange={onChange} />);

    fireEvent.change(byPlaceholder(container, "baggageAllowance"), {
      target: { value: "2 x 32 kg" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...VALUE, baggageAllowance: "2 x 32 kg" });
  });

  it("uppercases the booking reference and the booking class letter on input", () => {
    const onChange = vi.fn();
    const { container } = render(<BookingFields value={VALUE} onChange={onChange} />);

    fireEvent.change(byPlaceholder(container, "bookingReference"), {
      target: { value: "9rfaa7" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, bookingReference: "9RFAA7" });

    fireEvent.change(byPlaceholder(container, "bookingClassLetter"), {
      target: { value: "j" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, bookingClassLetter: "J" });
  });

  it("bounds the class letter input to the backend's 5-character limit", () => {
    const { container } = render(<BookingFields value={VALUE} onChange={() => {}} />);
    expect(byPlaceholder(container, "bookingClassLetter").maxLength).toBe(5);
  });
});

/** forgejo#186: "23" alone read "Freigepäck 23" on the flight page. */
describe("the baggage allowance's unit hint", () => {
  const withBaggage = (baggageAllowance: string): BookingFieldsValue => ({
    ...VALUE,
    baggageAllowance,
  });
  // The suite-wide setup replaces the store with a `vi.fn` over a fixed
  // state, so a test that needs another unit swaps that function's
  // implementation and puts the original back.
  const storeMock = vi.mocked(useSettingsStore);
  const originalStore = storeMock.getMockImplementation();
  const useUnits = (units: Record<string, unknown>): void => {
    storeMock.mockImplementation(((selector: (state: unknown) => unknown) =>
      selector({ units })) as never);
  };

  afterEach(() => {
    if (originalStore) storeMock.mockImplementation(originalStore);
  });

  it("shows kilograms behind a bare number", () => {
    render(<BookingFields value={withBaggage("23")} onChange={() => {}} />);
    expect(screen.getByTestId("baggage-allowance-unit")).toHaveTextContent("kg");
  });

  it("shows the unit the user chose in the settings", () => {
    useUnits({ distanceUnit: "kilometers", weightUnit: "lb" });
    render(<BookingFields value={withBaggage("50")} onChange={() => {}} />);
    expect(screen.getByTestId("baggage-allowance-unit")).toHaveTextContent("lb");
  });

  it.each(["23 kg", "2x23kg", "1 PC", "50 lbs", ""])(
    "shows no unit beside %j, which is displayed as stored",
    (stored) => {
      render(<BookingFields value={withBaggage(stored)} onChange={() => {}} />);
      expect(screen.queryByTestId("baggage-allowance-unit")).not.toBeInTheDocument();
    }
  );

  it("emits the text as typed — the unit is never written into the value", () => {
    const onChange = vi.fn();
    const { container } = render(<BookingFields value={withBaggage("")} onChange={onChange} />);
    fireEvent.change(byPlaceholder(container, "baggageAllowance"), { target: { value: "23" } });
    expect(onChange).toHaveBeenCalledWith(withBaggage("23"));
  });
});
