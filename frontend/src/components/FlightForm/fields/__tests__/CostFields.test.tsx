import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

import CostFields, { type CostFieldsValue } from "../CostFields";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../../../CurrencyInput", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input
      data-testid="currency-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("../../../ReceiptUpload", () => ({
  default: ({
    currentReceiptUrl,
    onUploadSuccess,
    onDelete,
  }: {
    currentReceiptUrl?: string | null;
    onUploadSuccess: (url: string) => void;
    onDelete: () => void;
  }) => (
    <div data-testid="receipt-upload" data-url={currentReceiptUrl}>
      <button type="button" onClick={() => onUploadSuccess("/uploads/receipts/r1.pdf")}>
        upload
      </button>
      <button type="button" onClick={onDelete}>
        delete
      </button>
    </div>
  ),
}));
vi.mock("../../../Help/HelpIcon", () => ({ default: () => null }));

const VALUE: CostFieldsValue = {
  price: 199.99,
  currency: "EUR",
  taxes: 30.5,
  fees: 12,
  receiptUrl: "",
};

function byPlaceholder(container: HTMLElement, key: string): HTMLInputElement {
  return container.querySelector(
    `input[placeholder="flights:form.placeholders.${key}"]`
  ) as HTMLInputElement;
}

describe("CostFields", () => {
  it("always renders price, currency and the receipt upload", () => {
    const { container } = render(
      <CostFields value={VALUE} onChange={() => {}} showBreakdown={false} />
    );

    expect(byPlaceholder(container, "price").value).toBe("199.99");
    expect(screen.getByTestId("currency-input")).toBeInTheDocument();
    expect(screen.getByTestId("receipt-upload")).toBeInTheDocument();
  });

  it("renders taxes and fees only when the breakdown is enabled (#192)", () => {
    const { container, rerender } = render(
      <CostFields value={VALUE} onChange={() => {}} showBreakdown={false} />
    );
    expect(byPlaceholder(container, "taxes")).toBeNull();
    expect(byPlaceholder(container, "fees")).toBeNull();

    rerender(<CostFields value={VALUE} onChange={() => {}} showBreakdown={true} />);
    expect(byPlaceholder(container, "taxes").value).toBe("30.5");
    expect(byPlaceholder(container, "fees").value).toBe("12");
  });

  it("emits the full value with only the edited amount changed", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CostFields value={VALUE} onChange={onChange} showBreakdown={true} />
    );

    fireEvent.change(byPlaceholder(container, "taxes"), { target: { value: "45.75" } });

    expect(onChange).toHaveBeenCalledWith({ ...VALUE, taxes: 45.75 });
  });

  it("emits undefined for a cleared amount — never 0", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CostFields value={VALUE} onChange={onChange} showBreakdown={true} />
    );

    fireEvent.change(byPlaceholder(container, "price"), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith({ ...VALUE, price: undefined });
  });

  it("folds a successful receipt upload into the value, and delete clears it", () => {
    const onChange = vi.fn();
    render(<CostFields value={VALUE} onChange={onChange} showBreakdown={false} />);

    fireEvent.click(screen.getByText("upload"));
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, receiptUrl: "/uploads/receipts/r1.pdf" });

    fireEvent.click(screen.getByText("delete"));
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, receiptUrl: "" });
  });
});
