import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

import { GlobeTimeHistogram } from "../GlobeTimeHistogram";
import { MAX_HISTOGRAM_BARS, type MonthBucket } from "../timeSliderUtils";
import { useTimeSliderStore } from "../../../store/timeSliderStore";
import { useDomainColorStore } from "../../../store/domainColorStore";

const months = (n: number, others: MonthBucket["others"]): MonthBucket[] =>
  Array.from({ length: n }, (_, i) => ({
    start: new Date(Date.UTC(2005, i, 1)),
    flights: 1,
    cruises: i % 5 === 0 ? 1 : 0,
    others,
  }));

beforeEach(() => {
  useTimeSliderStore.getState().reset();
  useTimeSliderStore
    .getState()
    .setRange(new Date(Date.UTC(2005, 0, 1)), new Date(Date.UTC(2025, 0, 1)));
});

describe("GlobeTimeHistogram bars", () => {
  it("stacks a segment for every domain that has entries, not only flights", () => {
    const { container } = render(
      <GlobeTimeHistogram
        buckets={months(12, { rail: 2, lodging: 1 })}
        visibleFlights={12}
        visibleCruises={3}
      />
    );
    const domains = new Set(
      [...container.querySelectorAll("[data-domain]")].map((e) => e.getAttribute("data-domain"))
    );
    expect(domains).toEqual(new Set(["flight", "cruise", "rail", "lodging"]));
  });

  it("paints each segment with the domain colour store's colour", () => {
    useDomainColorStore.setState((s) => ({ colors: { ...s.colors, rail: "#123456" } }));
    const { container } = render(
      <GlobeTimeHistogram buckets={months(3, { rail: 1 })} visibleFlights={3} visibleCruises={0} />
    );
    const rail = container.querySelector<HTMLElement>('[data-domain="rail"]');
    expect(rail?.style.background).toMatch(/rgb\(18, 52, 86\)|#123456/);
  });

  it("draws a readable number of bars for twenty years of months", () => {
    const { container } = render(
      <GlobeTimeHistogram buckets={months(240, {})} visibleFlights={240} visibleCruises={0} />
    );
    // one flight segment per bar; 240 one-pixel slivers read as a blank strip
    const bars = container.querySelectorAll('[data-domain="flight"]').length;
    expect(bars).toBeGreaterThan(10);
    expect(bars).toBeLessThanOrEqual(MAX_HISTOGRAM_BARS);
  });
});
