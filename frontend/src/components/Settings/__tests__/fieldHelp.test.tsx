import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldLabel } from "../SettingsShared";

/**
 * The settings used to open with an `InlineHelp` box that explained three or
 * four fields at once, above the form. The explanation now sits ON the field.
 *
 * Two things are pinned here. That the icon appears only where a `help` string
 * was actually supplied — otherwise the rule ("a field gets one only when its
 * label does not already say what it does") decays into a question mark on
 * every row, and then nobody reads any of them. And that the label still
 * renders its own text, which is the part a silent regression would eat.
 */
describe("FieldLabel", () => {
  it("renders the label text", () => {
    render(<FieldLabel>Distanz</FieldLabel>);
    expect(screen.getByText("Distanz")).toBeTruthy();
  });

  it("shows no help affordance when none was supplied", () => {
    const { container } = render(<FieldLabel>Sprache</FieldLabel>);
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("shows one when a help text was supplied", () => {
    const { container } = render(
      <FieldLabel help="Kilometer, Meilen oder Nautische Meilen.">Distanz</FieldLabel>,
    );
    expect(container.querySelectorAll("button").length).toBe(1);
  });

  it("keeps the label readable next to the icon", () => {
    // The icon is an addition, never a replacement — a label reduced to a
    // question mark would pass a naive "has help" assertion.
    render(<FieldLabel help="Erklärung">Währung</FieldLabel>);
    expect(screen.getByText("Währung")).toBeTruthy();
  });

  it("binds to its control, so clicking the label still focuses the field", () => {
    const { container } = render(
      <>
        <FieldLabel htmlFor="x" help="Erklärung">
          Währung
        </FieldLabel>
        <input id="x" />
      </>,
    );
    expect(container.querySelector("label")?.getAttribute("for")).toBe("x");
  });
});
