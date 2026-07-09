import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Slider } from "./controlPanelKit";

describe("Slider", () => {
  it("renders a range input with the value and formatted readout", () => {
    render(
      <Slider
        label="Stärke"
        value={1.4}
        min={0.3}
        max={2}
        step={0.1}
        onChange={() => {}}
      />
    );
    const input = screen.getByRole("slider") as HTMLInputElement;
    expect(input.value).toBe("1.4");
    expect(screen.getByText("1.4×")).toBeTruthy();
  });

  it("emits a parsed number on change", () => {
    const onChange = vi.fn();
    render(
      <Slider label="x" value={1} min={0} max={2} step={0.1} onChange={onChange} />
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it("shows a custom readout via format (e.g. off at 0)", () => {
    render(
      <Slider
        label="Größe"
        value={0}
        min={0}
        max={1.6}
        step={0.1}
        onChange={() => {}}
        format={(v) => (v <= 0 ? "Aus" : `${v.toFixed(1)}×`)}
      />
    );
    expect(screen.getByText("Aus")).toBeTruthy();
  });
});
