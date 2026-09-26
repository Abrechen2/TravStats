import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

import { LocationSuggestions } from "../LocationSuggestions";

/**
 * Acceptance 2026-09-26: two rows read "Kolosseum, Rom, Italien" and nothing
 * told the monument from the other hit. Each row now says what kind of place
 * it is (in the reader's words, never the raw OSM value) and where exactly.
 */
describe("LocationSuggestions", () => {
  const base = { city: "Rom", country: "Italien", lat: 41.89, lon: 12.49 };

  it("tells two same-named hits apart by kind and locality", () => {
    render(
      <LocationSuggestions
        listboxId="lb"
        idPrefix="loc"
        isSearching={false}
        searchError={false}
        results={[
          { ...base, name: "Kolosseum", type: "archaeological_site", district: "Monti" },
          { ...base, name: "Kolosseum", type: "bus_stop", address: "Via Labicana" },
        ]}
        activeIndex={-1}
        onSelect={vi.fn()}
        searchingLabel="s"
        errorLabel="e"
        noResultsLabel="n"
      />
    );

    expect(screen.getByTestId("loc-option-0-detail")).toHaveTextContent(
      "places:categories.landmark · Monti"
    );
    expect(screen.getByTestId("loc-option-1-detail")).toHaveTextContent("Via Labicana");
    expect(screen.getByTestId("loc-option-1-detail")).not.toHaveTextContent("bus_stop");
  });
});
