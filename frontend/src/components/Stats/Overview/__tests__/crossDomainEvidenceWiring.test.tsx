import { describe, it, expect, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { JSX } from "react";
import type { YearScopedAgg } from "../../../../lib/stats/domain-stats";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import CrossDomainKpis from "../CrossDomainKpis";

/**
 * Which KPI tiles open the panel, and with WHICH population (task 7b-2),
 * read from the URL and the open-store the tile itself writes.
 *
 * The scope matters more here than anywhere else in the feature: these three
 * are the only measures in the registry whose number depends on the domain
 * chips, so a tile that opened them without `domains` would quietly ask the
 * server a different question and the panel would answer a number the tile
 * never showed. That is the defect the whole panel exists to make
 * impossible, so it is asserted rather than assumed.
 */

const agg: YearScopedAgg = {
  totalEvents: 42,
  perDomainEvents: { flight: 30, cruise: 12 },
  countriesCount: 18,
  activeDays: 95,
};

/** Reports the search string after each click — `MemoryRouter` never touches `window.location`. */
function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

async function keysOpenedBy(section: JSX.Element): Promise<string[]> {
  // `screen` queries the whole document, so a previous render's buttons would
  // still be found here and would click a router this closure cannot see.
  cleanup();
  let search = "";
  render(
    <MemoryRouter>
      {section}
      <LocationProbe
        onChange={(next) => {
          search = next;
        }}
      />
    </MemoryRouter>
  );
  const keys: string[] = [];
  for (const trigger of screen.getAllByRole("button")) {
    await act(async () => {
      trigger.click();
    });
    const raw = new URLSearchParams(search).get("evidence") ?? "";
    keys.push(raw.slice(raw.indexOf(":") + 1));
  }
  return keys.sort();
}

const lifetime = (
  <CrossDomainKpis
    agg={agg}
    prevAgg={null}
    selectedYear={null}
    compareYear={null}
    compareEnabled={false}
    comparisonKind="fullYear"
    achievements={null}
    foldedDomains={["flight", "cruise"]}
  />
);

describe("the cross-domain KPI tiles open the measures they render", () => {
  it("wires the three served tiles and leaves the release-2 achievements one alone", async () => {
    const keys = await keysOpenedBy(lifetime);
    expect(keys).toEqual(
      ["crossDomainActiveDayCount", "crossDomainCountryCount", "crossDomainEventCount"].sort()
    );
    // `crossDomainUnlockedAchievementCount` is `servedIn: 2`; a trigger over
    // it would be a pointer cursor on a 404.
    expect(keys).not.toContain("crossDomainUnlockedAchievementCount");
  });

  it("every key these tiles open is a registered measure that release 1 serves", async () => {
    const keys = await keysOpenedBy(lifetime);
    expect(keys.filter((key) => EVIDENCE_MEASURES[key]?.servedIn !== 1)).toEqual([]);
  });

  it("sends the chips as the scope, so the panel measures what the tile measured", async () => {
    cleanup();
    const { useEvidenceOpenStore } = await import("../../../evidence/evidenceOpenStore");
    render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={agg}
          prevAgg={null}
          selectedYear={2024}
          compareYear={null}
          compareEnabled={false}
          comparisonKind="fullYear"
          achievements={null}
          foldedDomains={["flight", "poi"]}
        />
      </MemoryRouter>
    );
    await act(async () => {
      screen.getAllByRole("button")[0].click();
    });
    const scope = useEvidenceOpenStore.getState().scope;
    // `poi` is the domain registry's word; the evidence contract's is
    // `place`, and the tile is what translates between them.
    expect(scope).toEqual({ period: "year", year: 2024, domains: ["flight", "place"] });
    expect(useEvidenceOpenStore.getState().renderedValue).toBe(42);
  });
});
