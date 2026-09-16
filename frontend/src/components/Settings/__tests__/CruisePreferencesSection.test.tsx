import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import CruisePreferencesSection from "../CruisePreferencesSection";

const CRUISE = { defaultLine: "AIDA", defaultCabinType: "balcony", showCruiseArcs: true } as const;

describe("CruisePreferencesSection", () => {
  it("offers the cabin types as pills and clears the default back to null", () => {
    const onSetCruise = vi.fn();
    render(<CruisePreferencesSection cruise={{ ...CRUISE }} onSetCruise={onSetCruise} />);

    expect(screen.getByRole("radio", { name: "cruise:cabinType.balcony" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "settings:cruisePreferences.defaultCabinNone" })
    );
    expect(onSetCruise).toHaveBeenCalledWith({ defaultCabinType: null });

    fireEvent.click(screen.getByRole("radio", { name: "cruise:cabinType.suite" }));
    expect(onSetCruise).toHaveBeenLastCalledWith({ defaultCabinType: "suite" });
  });

  it("toggles the map arcs with a switch", () => {
    const onSetCruise = vi.fn();
    render(<CruisePreferencesSection cruise={{ ...CRUISE }} onSetCruise={onSetCruise} />);
    fireEvent.click(screen.getByRole("switch", { name: "settings:cruisePreferences.showArcs" }));
    expect(onSetCruise).toHaveBeenCalledWith({ showCruiseArcs: false });
  });
});
