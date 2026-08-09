import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import BookingFields, { type BookingFieldsValue } from "../BookingFields";

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
