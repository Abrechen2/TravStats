import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LodgingPreferencesSection from "../LodgingPreferencesSection";

describe("LodgingPreferencesSection", () => {
  it("changing the currency select calls onSetBaseCurrency with the chosen ISO code", () => {
    const onSetBaseCurrency = vi.fn();
    render(
      <LodgingPreferencesSection baseCurrency="EUR" onSetBaseCurrency={onSetBaseCurrency} />
    );

    const select = screen.getByLabelText("settings:lodgingPreferences.baseCurrency");
    fireEvent.change(select, { target: { value: "CHF" } });

    expect(onSetBaseCurrency).toHaveBeenCalledTimes(1);
    expect(onSetBaseCurrency).toHaveBeenCalledWith("CHF");
  });

  it("reflects the current baseCurrency prop as the selected option", () => {
    render(<LodgingPreferencesSection baseCurrency="GBP" onSetBaseCurrency={vi.fn()} />);

    const select = screen.getByLabelText(
      "settings:lodgingPreferences.baseCurrency"
    ) as HTMLSelectElement;
    expect(select.value).toBe("GBP");
  });
});
