import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
const resetRejections = vi.fn();
vi.mock("../../../lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { resetRejections: () => resetRejections() },
}));

import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import TripSuggestionMemoryRows from "../TripSuggestionMemoryRows";

/**
 * Trip suggestions v2: the quiet period after a dismissal and the
 * "Abgelehnte zurücksetzen" action, in Reisen & Vorschläge.
 */
describe("TripSuggestionMemoryRows", () => {
  beforeEach(() => {
    resetRejections.mockReset();
    useSuggestionSwitchesStore.setState({ trips: true, tripQuietDays: 14 });
  });
  afterEach(() => cleanup());

  it("resets the declined suggestions and says how many were forgotten", async () => {
    resetRejections.mockResolvedValue(3);
    render(<TripSuggestionMemoryRows />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settingsRows:trips.abgelehnt.btn" }));
    });
    expect(resetRejections).toHaveBeenCalledTimes(1);
    expect(screen.getByText("settingsRows:trips.abgelehnt.res")).toBeInTheDocument();
  });

  it("shows a failed reset as an error, never as success", async () => {
    resetRejections.mockRejectedValue(new Error("503"));
    render(<TripSuggestionMemoryRows />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settingsRows:trips.abgelehnt.btn" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("settingsRows:trips.abgelehnt.failed");
    expect(screen.queryByText("settingsRows:trips.abgelehnt.res")).toBeNull();
  });

  it("draws nothing while trip suggestions are switched off", () => {
    useSuggestionSwitchesStore.setState({ trips: false });
    const { container } = render(<TripSuggestionMemoryRows />);
    expect(container).toBeEmptyDOMElement();
  });
});
