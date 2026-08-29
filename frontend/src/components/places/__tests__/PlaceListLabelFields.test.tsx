import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlaceListLabelFields, hasSymbol } from "../PlaceListLabelFields";
import type { PlaceLabelMode } from "../../../lib/placeLabel";

// The project's test i18n returns raw keys, so assertions match keys and never
// German copy — copy changes must not turn a behaviour test red.
function setup(icon: string, labelMode: PlaceLabelMode) {
  const onIconChange = vi.fn();
  const onLabelModeChange = vi.fn();
  render(
    <PlaceListLabelFields
      icon={icon}
      onIconChange={onIconChange}
      labelMode={labelMode}
      onLabelModeChange={onLabelModeChange}
    />
  );
  const button = (mode: PlaceLabelMode) =>
    screen.getByText(`places:lists.labelMode.${mode}`).closest("button") as HTMLButtonElement;
  return { onIconChange, onLabelModeChange, button };
}

describe("PlaceListLabelFields", () => {
  it("refuses the symbol choice while the list has no symbol", () => {
    // Offering it would let a user pick a label the map cannot draw and then
    // wonder why nothing changed.
    const { button } = setup("", "name");
    expect(button("icon").disabled).toBe(true);
    expect(screen.getByText("places:lists.labelModeNeedsSymbol")).toBeTruthy();
  });

  it("offers the symbol choice once a symbol is set", () => {
    const { button } = setup("🍟", "name");
    expect(button("icon").disabled).toBe(false);
    expect(screen.getByText("places:lists.labelModeHint")).toBeTruthy();
  });

  it("reports the switch back to the caller", () => {
    const { button, onLabelModeChange } = setup("🍟", "name");
    fireEvent.click(button("icon"));
    expect(onLabelModeChange).toHaveBeenCalledWith("icon");
  });

  it("falls back to the name when the symbol is cleared", () => {
    // Otherwise the list keeps asking for a symbol it no longer has: harmless
    // on the map, which already falls back, but a form showing a choice that
    // has quietly stopped meaning anything.
    const { onIconChange, onLabelModeChange } = setup("🍟", "icon");
    fireEvent.change(screen.getByLabelText("places:lists.symbolLabel"), {
      target: { value: "" },
    });
    expect(onIconChange).toHaveBeenCalledWith("");
    expect(onLabelModeChange).toHaveBeenCalledWith("name");
  });

  it("leaves the mode alone when the symbol merely changes", () => {
    const { onLabelModeChange } = setup("🍟", "icon");
    fireEvent.change(screen.getByLabelText("places:lists.symbolLabel"), {
      target: { value: "🍔" },
    });
    expect(onLabelModeChange).not.toHaveBeenCalled();
  });
});

describe("hasSymbol", () => {
  it("does not count whitespace as a symbol", () => {
    // A pin drawn from a space is an invisible pin.
    expect(hasSymbol("   ")).toBe(false);
    expect(hasSymbol("")).toBe(false);
    expect(hasSymbol("🍟")).toBe(true);
  });
});

describe("saving the symbol", () => {
  it("does not commit on every keystroke", () => {
    // The detail page saves as you go. Committing per character would send one
    // PATCH per keypress, and a ZWJ emoji is several — the middle ones saving
    // half a glyph.
    const onIconCommit = vi.fn();
    render(
      <PlaceListLabelFields
        icon="🍟"
        onIconChange={vi.fn()}
        labelMode="icon"
        onLabelModeChange={vi.fn()}
        onIconCommit={onIconCommit}
      />
    );
    const input = screen.getByLabelText("places:lists.symbolLabel");
    fireEvent.change(input, { target: { value: "🍔" } });
    expect(onIconCommit).not.toHaveBeenCalled();
    fireEvent.blur(input, { target: { value: "🍔" } });
    expect(onIconCommit).toHaveBeenCalledWith("🍔");
  });
});
