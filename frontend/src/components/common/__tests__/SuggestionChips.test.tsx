import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts ? `${key}:${opts.field}:${opts.value}` : key,
  }),
}));

import SuggestionChips from "../SuggestionChips";

const chips = () => screen.queryAllByRole("button").map((b) => b.textContent);

describe("SuggestionChips", () => {
  it("offers every suggestion while the field is empty, and a click picks one", () => {
    const onPick = vi.fn();
    render(
      <SuggestionChips value="" suggestions={["12A", "3C"]} onPick={onPick} fieldLabel="Seat" />
    );
    expect(chips()).toEqual(["12A", "3C"]);
    fireEvent.click(screen.getByRole("button", { name: /Seat:3C/ }));
    expect(onPick).toHaveBeenCalledWith("3C");
  });

  it("narrows to what continues the typed text, case-insensitively", () => {
    render(
      <SuggestionChips
        value="lh"
        suggestions={["LH2440", "SK1636", "LH6000"]}
        onPick={vi.fn()}
        fieldLabel="Flight"
      />
    );
    expect(chips()).toEqual(["LH2440", "LH6000"]);
  });

  it("drops the chip the field already holds, and renders nothing when none is left", () => {
    const { container } = render(
      <SuggestionChips value="12A" suggestions={["12A"]} onPick={vi.fn()} fieldLabel="Seat" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
