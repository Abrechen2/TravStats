import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PanelHeader,
  Slider,
  CruiseAppearanceSection,
  FlightAppearanceSection,
  LodgingAppearanceSection,
  usePanelExpanded,
} from "./controlPanelKit";
import { PlaceAppearanceSection } from "./PlaceAppearanceSection";
import { DEFAULT_FLIGHT_COLOR_CONFIG, FLIGHT_COLOR_MODES } from "../../lib/flightColor";
import { CRUISE_COLOR_MODES, DEFAULT_CRUISE_COLOR_CONFIG } from "../../lib/cruiseColor";

describe("PanelHeader", () => {
  it("calls onToggle when the header is clicked", () => {
    const onToggle = vi.fn();
    render(<PanelHeader title="Karte" expanded={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /Karte/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("points the chevron down while expanded and up while collapsed (#195)", () => {
    // The panels are anchored bottom-left, so the body collapses DOWNWARDS
    // (chevron down) and expands UPWARDS (chevron up) — the chevron always
    // shows where the body moves on click.
    const { container, rerender } = render(
      <PanelHeader title="Karte" expanded={true} onToggle={() => {}} />
    );
    const chevron = (): SVGElement => container.querySelector("svg") as SVGElement;
    expect(chevron().style.transform).toBe("none");

    rerender(<PanelHeader title="Karte" expanded={false} onToggle={() => {}} />);
    expect(chevron().style.transform).toBe("rotate(180deg)");
  });

  it("exposes the state via aria-expanded", () => {
    render(<PanelHeader title="Karte" expanded={false} onToggle={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("usePanelExpanded", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to collapsed (#194 owner decision) without baking the default into storage", () => {
    const { result } = renderHook(() => usePanelExpanded());
    expect(result.current[0]).toBe(false);
    // No write on mount — persisting the default would make any future
    // default change a no-op for everyone who ever loaded the app.
    expect(window.localStorage.getItem("mapAppearance.v2")).toBeNull();
  });

  it("persists the choice in the shared mapAppearance blob and restores it (#194)", () => {
    const { result, unmount } = renderHook(() => usePanelExpanded());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    unmount();

    const blob = JSON.parse(window.localStorage.getItem("mapAppearance.v2") ?? "{}") as {
      panelExpanded?: boolean;
    };
    expect(blob.panelExpanded).toBe(true);

    // A fresh mount — e.g. after a reload or the 2D ↔ globe switch — starts
    // from the persisted value instead of snapping back to the default.
    const { result: remounted } = renderHook(() => usePanelExpanded());
    expect(remounted.current[0]).toBe(true);
  });
});

describe("Slider", () => {
  it("renders a range input with the value and formatted readout", () => {
    render(<Slider label="Stärke" value={1.4} min={0.3} max={2} step={0.1} onChange={() => {}} />);
    const input = screen.getByRole("slider") as HTMLInputElement;
    expect(input.value).toBe("1.4");
    expect(screen.getByText("1.4×")).toBeTruthy();
  });

  it("emits a parsed number on change", () => {
    const onChange = vi.fn();
    render(<Slider label="x" value={1} min={0} max={2} step={0.1} onChange={onChange} />);
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

// The cruise section is rendered by BOTH control panels (globe + flat map)
// from this one component, so they cannot drift on which controls exist.
const cruiseSectionProps = {
  title: "Kreuzfahrten",
  colorConfig: DEFAULT_CRUISE_COLOR_CONFIG,
  onColorModeChange: () => {},
  onColorChange: () => {},
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

describe("CruiseAppearanceSection", () => {
  it("offers every cruise colour mode as an explicit choice — including 'Pro Reise', which used to be invisible", () => {
    render(<CruiseAppearanceSection {...cruiseSectionProps} />);
    // i18n is not initialised in this unit test, so t() echoes the key —
    // asserting on the key still proves each mode has its own control.
    for (const mode of CRUISE_COLOR_MODES) {
      expect(screen.getByText(`map:globe.panel.cruiseColorMode.${mode}.label`)).toBeTruthy();
    }
  });

  it("emits the picked mode", () => {
    const onColorModeChange = vi.fn();
    render(
      <CruiseAppearanceSection {...cruiseSectionProps} onColorModeChange={onColorModeChange} />
    );
    fireEvent.click(screen.getByText("map:globe.panel.cruiseColorMode.perCruise.label"));
    expect(onColorModeChange).toHaveBeenCalledWith("perCruise");
  });

  it("shows TWO colour rows in status mode, ONE in solid, and NONE in perCruise", () => {
    const { rerender } = render(<CruiseAppearanceSection {...cruiseSectionProps} />);
    expect(screen.getByText("map:globe.panel.cruiseColorMode.swatchSailed")).toBeTruthy();
    expect(screen.getByText("map:globe.panel.cruiseColorMode.swatchPlanned")).toBeTruthy();

    rerender(
      <CruiseAppearanceSection
        {...cruiseSectionProps}
        colorConfig={{ ...DEFAULT_CRUISE_COLOR_CONFIG, mode: "solid" }}
      />
    );
    expect(screen.queryByText("map:globe.panel.cruiseColorMode.swatchSailed")).toBeNull();
    expect(screen.getByText("map:globe.panel.routes")).toBeTruthy();

    // perCruise has no colour to set — the colours come from the cruises.
    rerender(
      <CruiseAppearanceSection
        {...cruiseSectionProps}
        colorConfig={{ ...DEFAULT_CRUISE_COLOR_CONFIG, mode: "perCruise" }}
      />
    );
    expect(screen.queryByText("map:globe.panel.cruiseColorMode.swatchSailed")).toBeNull();
    expect(screen.queryByText("map:globe.panel.routes")).toBeNull();
    // …but it does warn that per-cruise hues compete with the flight colours
    // in the "Alle" view.
    expect(screen.getByText("map:globe.panel.cruiseColorMode.perCruise.hint")).toBeTruthy();
  });

  it("emits the slot the active mode actually uses", () => {
    const onColorChange = vi.fn();
    render(
      <CruiseAppearanceSection
        {...cruiseSectionProps}
        colorConfig={{ ...DEFAULT_CRUISE_COLOR_CONFIG, mode: "solid" }}
        onColorChange={onColorChange}
      />
    );
    // Any swatch on the shared palette; the case is about WHICH SLOT the
    // click writes to, not about the hue.
    fireEvent.click(screen.getByLabelText("rgb(143,163,184)"));
    expect(onColorChange).toHaveBeenCalledWith("solid", [143, 163, 184]);
  });

  it("renders the arrow slider only when arrow props are provided (flat map only)", () => {
    const { rerender } = render(<CruiseAppearanceSection {...cruiseSectionProps} />);
    expect(screen.queryByText("Pfeile")).toBeNull();

    rerender(
      <CruiseAppearanceSection
        {...cruiseSectionProps}
        arrowLabel="Pfeile"
        arrowScale={1}
        onArrowScaleChange={() => {}}
      />
    );
    expect(screen.getByText("Pfeile")).toBeTruthy();
  });

  it("renders width + size as sliders (range inputs)", () => {
    render(<CruiseAppearanceSection {...cruiseSectionProps} />);
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
    fireEvent.click(screen.getByLabelText("rgb(143,163,184)"));
    expect(onColorChange).toHaveBeenCalledWith("frequency", [143, 163, 184]);
  });
});

// The lodging section is rendered by the flat-map panel (lodging pins are
// flat-map only, unlike flight/cruise) — a single marker-size slider, no
// colour mode, no width, no arrows (a lodging pin has no route to draw).
describe("LodgingAppearanceSection", () => {
  const lodgingSectionProps = {
    title: "Unterkünfte",
    markerSize: 1,
    onMarkerSizeChange: () => {},
    sizeLabel: "Größe",
  };

  it("renders exactly one slider — the marker size", () => {
    render(<LodgingAppearanceSection {...lodgingSectionProps} />);
    expect(screen.getAllByRole("slider").length).toBe(1);
    expect(screen.getByText("Unterkünfte")).toBeTruthy();
  });

  it("emits the size on change", () => {
    const onMarkerSizeChange = vi.fn();
    render(
      <LodgingAppearanceSection {...lodgingSectionProps} onMarkerSizeChange={onMarkerSizeChange} />
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1.2" } });
    expect(onMarkerSizeChange).toHaveBeenCalledWith(1.2);
  });

  it("shows 'Aus' at 0 — the same off-semantics as flight/cruise marker sliders", () => {
    render(<LodgingAppearanceSection {...lodgingSectionProps} markerSize={0} />);
    expect(screen.getByText("map:globe.panel.off")).toBeTruthy();
  });
});

// 2026-08-28: places were the only domain whose panel offered no marker size,
// so the map answered "how big are my places" with silence. The section now
// carries the same slider lodging does — and, unlike lodging, it must still
// render when only ONE half is supplied, because a caller may want the colours
// without the slider or the other way round.
describe("PlaceAppearanceSection", () => {
  const placeSectionProps = {
    title: "Orte",
    markerSize: 1,
    onMarkerSizeChange: () => {},
    sizeLabel: "Größe",
    onColorModeChange: () => {},
    onColorChange: () => {},
  };

  it("renders the marker-size slider", () => {
    render(<PlaceAppearanceSection {...placeSectionProps} />);
    expect(screen.getAllByRole("slider").length).toBe(1);
    expect(screen.getByText("Orte")).toBeTruthy();
  });

  it("emits the size on change", () => {
    const onMarkerSizeChange = vi.fn();
    render(
      <PlaceAppearanceSection {...placeSectionProps} onMarkerSizeChange={onMarkerSizeChange} />
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1.2" } });
    expect(onMarkerSizeChange).toHaveBeenCalledWith(1.2);
  });

  it("shows 'Aus' at 0 — the same off-semantics the other domains use", () => {
    render(<PlaceAppearanceSection {...placeSectionProps} markerSize={0} />);
    expect(screen.getByText("map:globe.panel.off")).toBeTruthy();
  });

  it("still renders the slider when no colour handlers are given", () => {
    // The old early-return bailed out on missing colour handlers, which would
    // have swallowed the slider whole.
    render(
      <PlaceAppearanceSection
        title="Orte"
        markerSize={1}
        onMarkerSizeChange={() => {}}
        sizeLabel="Größe"
      />
    );
    expect(screen.getAllByRole("slider").length).toBe(1);
  });

  it("renders nothing at all when neither colours nor a size are offered", () => {
    const { container } = render(<PlaceAppearanceSection title="Orte" />);
    expect(container.textContent).toBe("");
  });
});
