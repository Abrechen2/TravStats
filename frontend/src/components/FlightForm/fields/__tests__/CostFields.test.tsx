import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";

import CostFields, { type CostFieldsValue } from "../CostFields";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
// The real picker, fed a history — the point of the flight field is that it
// offers the same "your currencies first" list as every other domain.
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => ["NOK", "EGP"] };
});
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
    expect(screen.getByRole("combobox")).toHaveValue("EUR");
    expect(screen.getByTestId("receipt-upload")).toBeInTheDocument();
  });

  it("offers the user's recently used currencies first, like every other domain", () => {
    render(<CostFields value={VALUE} onChange={() => {}} showBreakdown={false} />);
    const frequent = screen.getByRole("group", { name: /currencySelect.frequent/i });
    expect(within(frequent).getByText(/NOK/)).toBeInTheDocument();
    expect(within(frequent).getByText(/EGP/)).toBeInTheDocument();
  });

  it("emits the picked currency", () => {
    const onChange = vi.fn();
    render(<CostFields value={VALUE} onChange={onChange} showBreakdown={false} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "NOK" } });
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, currency: "NOK" });
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
