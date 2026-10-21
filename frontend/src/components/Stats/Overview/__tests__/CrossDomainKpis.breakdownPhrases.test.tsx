import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CrossDomainKpis from "../CrossDomainKpis";
import { DOMAIN_KEYS } from "../../../../shared/domains";
import de from "../../../../i18n/resources/de/stats.json";
import en from "../../../../i18n/resources/en/stats.json";

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

/**
 * beta.22 UAT: the Statistik tile read "overviewKpis.breakdown.ferry" — ferry
 * was counted but had no counted phrase. Locale parity cannot see this: both
 * locales lacked it alike. Every domain the fold can count needs its phrase.
 */
describe("CrossDomainKpis breakdown — a phrase for every counted domain", () => {
  it.each(DOMAIN_KEYS)("%s has _one and _other in DE and EN", (key) => {
    for (const locale of [de, en]) {
      const phrases = locale.overviewKpis.breakdown as Record<string, string>;
      expect(phrases[`${key}_one`]).toEqual(expect.stringContaining("{{count}}"));
      expect(phrases[`${key}_other`]).toEqual(expect.stringContaining("{{count}}"));
    }
  });

  it("renders no raw key when every domain is counted", () => {
    const perDomainEvents = Object.fromEntries(DOMAIN_KEYS.map((k) => [k, 2]));
    render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={{
            totalEvents: DOMAIN_KEYS.length * 2,
            perDomainEvents,
            countriesCount: 1,
            activeDays: 1,
          }}
          currentAgg={null}
          prevAgg={null}
          selectedYear={null}
          compareYear={null}
          compareEnabled={false}
          comparisonKind="fullYear"
          achievements={null}
          foldedDomains={[...DOMAIN_KEYS]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("2 Fährüberfahrten", { exact: false })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("overviewKpis.breakdown");
  });
});
