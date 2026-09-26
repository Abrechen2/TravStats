import { render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CurrencySelect from "../CurrencySelect";
import { ECB_CURRENCIES } from "../../../shared/currencies";
import { getCurrencyDisplayName } from "../../../lib/units";

// The global react-i18next mock returns the KEY, so groups are addressed by
// their key rather than by the German word a user would read.
const FREQUENT = /currencySelect.frequent/i;

describe("CurrencySelect", () => {
  it("puts the user's own currencies first and finds the rest by search", async () => {
    render(<CurrencySelect value="EUR" onChange={vi.fn()} recent={["NOK", "EGP"]} />);
    const group = screen.getByRole("group", { name: FREQUENT });
    expect(within(group).getByText(/NOK/)).toBeInTheDocument();
    expect(within(group).getByText(/EGP/)).toBeInTheDocument();
    // AED exists but is not one of this user's — it is reachable by search.
    expect(within(group).queryByText(/AED/)).toBeNull();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "AED" } });
    expect(await screen.findByText(/AED/)).toBeInTheDocument();
  });

  it("searches the currency NAME too, because that is the word a user knows", () => {
    render(<CurrencySelect value="EUR" onChange={vi.fn()} recent={["NOK"]} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dirham" } });
    expect(screen.getByText(/AED/)).toBeInTheDocument();
    expect(screen.queryByText(/NOK/)).toBeNull();
  });

  it("can be restricted, which is how the base-currency field uses it", () => {
    render(<CurrencySelect value="EUR" onChange={vi.fn()} restrictTo={ECB_CURRENCIES} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "EGP" } });
    expect(screen.queryByText(/EGP/)).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "NOK" } });
    expect(screen.getByText(/NOK/)).toBeInTheDocument();
  });

  it("always offers the current value, even one the user no longer books in", () => {
    // Otherwise a stay in a retired currency renders as a blank picker and the
    // next save silently rewrites it to whatever happens to be first.
    render(<CurrencySelect value="AED" onChange={vi.fn()} recent={["EUR", "NOK"]} />);
    const group = screen.getByRole("group", { name: FREQUENT });
    expect(within(group).getByText(/AED/)).toBeInTheDocument();
  });

  it("reports the picked code to its owner", () => {
    const onChange = vi.fn();
    render(<CurrencySelect value="EUR" onChange={onChange} recent={["EUR", "NOK"]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "NOK" } });
    expect(onChange).toHaveBeenCalledWith("NOK");
  });
  describe("a code the browser's ICU does not name yet", () => {
    afterEach(() => vi.restoreAllMocks());

    /** An older ICU: knows EUR, answers SLE and ZWG with the bare code. */
    function olderIcu(): void {
      const Real = Intl.DisplayNames;
      vi.spyOn(Intl, "DisplayNames").mockImplementation(function (
        locales?: string | string[],
        options?: Intl.DisplayNamesOptions
      ) {
        const real = new Real(locales, options as Intl.DisplayNamesOptions);
        return { of: (c: string) => (c === "SLE" || c === "ZWG" ? c : real.of(c)) };
      } as unknown as typeof Intl.DisplayNames);
    }

    // Acceptance 2026-09-26: the picker offered "SLE — SLE" and "ZWG — ZWG".
    it("names it from the fallback table, never code — code", () => {
      olderIcu();
      render(<CurrencySelect value="ZWG" onChange={vi.fn()} recent={["SLE"]} />);
      expect(screen.queryByText("SLE — SLE")).toBeNull();
      expect(screen.queryByText("ZWG — ZWG")).toBeNull();
      expect(getCurrencyDisplayName("ZWG", "de")).toBe("Simbabwe-Gold");
      expect(getCurrencyDisplayName("SLE", "en")).toBe("Sierra Leonean leone");
    });
  });
});
