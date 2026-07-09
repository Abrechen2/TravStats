import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Slider, AppearanceSection } from "./controlPanelKit";

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

const baseSectionProps = {
  title: "Kreuzfahrten",
  routeLabel: "Routen",
  routeColor: null,
  routeDefault: [111, 160, 214] as [number, number, number],
  onRouteColorChange: () => {},
  routeAutoLabel: "Standard",
  widthLabel: "Stärke",
  routeWidth: 1,
  onRouteWidthChange: () => {},
  markerLabel: "Häfen",
  markerColor: null,
  markerDefault: [111, 160, 214] as [number, number, number],
  onMarkerColorChange: () => {},
  markerAutoLabel: "Auto",
  sizeLabel: "Größe",
  markerSize: 1,
  onMarkerSizeChange: () => {},
};

describe("AppearanceSection arrow slider", () => {
  it("renders the arrow slider only when arrow props are provided", () => {
    const { rerender } = render(<AppearanceSection {...baseSectionProps} />);
    expect(screen.queryByText("Pfeile")).toBeNull();

    rerender(
      <AppearanceSection
        {...baseSectionProps}
        arrowLabel="Pfeile"
        arrowScale={1}
        onArrowScaleChange={() => {}}
      />
    );
    expect(screen.getByText("Pfeile")).toBeTruthy();
  });

  it("renders width + size as sliders (range inputs)", () => {
    render(<AppearanceSection {...baseSectionProps} />);
    expect(screen.getAllByRole("slider").length).toBe(2);
  });
});
