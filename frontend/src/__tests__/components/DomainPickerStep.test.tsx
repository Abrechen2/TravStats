import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Real store, not the global mock — the POI card is gated on the instance
// beta flag, which lives there.
vi.unmock("../../store/settingsStore");

import DomainPickerStep from "../../components/Setup/DomainPickerStep";
import { useSettingsStore } from "../../store/settingsStore";
import { DOMAINS } from "../../shared/domains";

describe("DomainPickerStep", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
  });

  it("renders all domains, only available are interactive", () => {
    const onChange = vi.fn();
    render(<DomainPickerStep value={["flight"]} onChange={onChange} />);
    expect(screen.getByText("domain.flight")).toBeInTheDocument();
    expect(screen.getByText("domain.cruise")).toBeInTheDocument();
  });

  it("calls onChange with new selection when a card is clicked", () => {
    const onChange = vi.fn();
    render(<DomainPickerStep value={["flight"]} onChange={onChange} />);
    const flightCard = screen.getByTestId("domain-card-flight");
    fireEvent.click(flightCard);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("locked (unavailable) cards do not trigger onChange", () => {
    // EVERY shipped domain is `available: true` now — poi was the last stub
    // and the Places domain replaced it. The locked branch is still live code
    // (`if (!DOMAINS[key].available) return`) and the next stubbed domain will
    // rely on it, so availability is forced here rather than the test deleted.
    // Deleting it would leave the branch untested until it silently broke.
    const restore = DOMAINS.poi.available;
    DOMAINS.poi.available = false;
    try {
      const onChange = vi.fn();
      render(<DomainPickerStep value={["flight"]} onChange={onChange} />);
      fireEvent.click(screen.getByTestId("domain-card-poi"));
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      DOMAINS.poi.available = restore;
    }
  });

  // A fresh install has never fetched /settings, so the flag is unknown and
  // reads as OFF. That is the right answer for the setup wizard: a brand-new
  // instance must not be offered a domain that is still in beta.
  it.each([
    ["off", false],
    ["unknown (not loaded yet)", null],
  ])("omits the poi card when the beta flag is %s", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    render(<DomainPickerStep value={["flight"]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("domain-card-poi")).toBeNull();
    expect(screen.getByTestId("domain-card-flight")).toBeInTheDocument();
  });
});
