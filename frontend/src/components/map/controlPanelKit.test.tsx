import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Slider, AppearanceSection, FlightAppearanceSection } from "./controlPanelKit";
import { DEFAULT_FLIGHT_COLOR_CONFIG, FLIGHT_COLOR_MODES } from "../../lib/flightColor";

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

// The flight section is rendered by BOTH control panels (globe + flat map)
// from this one component, so they cannot drift on which controls exist.
const flightSectionProps = {
  title: "Flüge",
  colorConfig: DEFAULT_FLIGHT_COLOR_CONFIG,
  onColorModeChange: () => {},
  onColorChange: () => {},
  routeWidth: 1,
  onRouteWidthChange: () => {},
  markerColor: null,
  onMarkerColorChange: () => {},
  markerSize: 1,
  onMarkerSizeChange: () => {},
  markerDefault: [240, 169, 71] as [number, number, number],
  markerLabel: "Flughäfen",
  markerAutoLabel: "Auto",
  widthLabel: "Stärke",
  sizeLabel: "Größe",
};

describe("FlightAppearanceSection", () => {
  it("offers every flight colour mode as an explicit choice", () => {
    render(<FlightAppearanceSection {...flightSectionProps} />);
    // i18n is not initialised in this unit test, so t() echoes the key —
    // asserting on the key still proves each mode has its own control.
    for (const mode of FLIGHT_COLOR_MODES) {
      expect(screen.getByText(`map:globe.panel.colorMode.${mode}.label`)).toBeTruthy();
    }
  });

  it("emits the picked mode", () => {
    const onColorModeChange = vi.fn();
    render(
      <FlightAppearanceSection {...flightSectionProps} onColorModeChange={onColorModeChange} />
    );
    fireEvent.click(screen.getByText("map:globe.panel.colorMode.solid.label"));
    expect(onColorModeChange).toHaveBeenCalledWith("solid");
  });

  it("shows TWO colour rows in status mode (flown + planned) and one otherwise", () => {
    const { rerender } = render(<FlightAppearanceSection {...flightSectionProps} />);
    expect(screen.getByText("map:globe.panel.colorMode.swatchFlown")).toBeTruthy();
    expect(screen.getByText("map:globe.panel.colorMode.swatchPlanned")).toBeTruthy();

    rerender(
      <FlightAppearanceSection
        {...flightSectionProps}
        colorConfig={{ ...DEFAULT_FLIGHT_COLOR_CONFIG, mode: "solid" }}
      />
    );
    expect(screen.queryByText("map:globe.panel.colorMode.swatchFlown")).toBeNull();
    expect(screen.getByText("map:globe.panel.routes")).toBeTruthy();
  });

  it("emits the slot that the active mode actually uses", () => {
    const onColorChange = vi.fn();
    render(
      <FlightAppearanceSection
        {...flightSectionProps}
        colorConfig={{ ...DEFAULT_FLIGHT_COLOR_CONFIG, mode: "frequency" }}
        onColorChange={onColorChange}
      />
    );
    // Sky-blue [80,200,255] — the retired scheduled default — is still on the
    // palette, so anyone who preferred it can pick it back.
    fireEvent.click(screen.getByLabelText("rgb(80,200,255)"));
    expect(onColorChange).toHaveBeenCalledWith("frequency", [80, 200, 255]);
  });
});
