import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { UpcomingEntry } from "../../../lib/api/upcoming";
import { DomainTabStrip } from "../DomainTabStrip";
import { useSettingsStore } from "../../../store/settingsStore";

// Real Zustand store instead of the global static mock — the POI tab is gated
// behind the instance-level beta flag, which lives in this store.
vi.unmock("../../../store/settingsStore");

// The strip navigates on click; the spy is what lets a test read WHERE it went.
const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

// Override the global key-passthrough mock with human-readable labels for this component.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      // The two planned hints carry a count and are the point of the test
      // below, so they interpolate here rather than falling through to the
      // bare key like the labels do.
      if (key === "dashboard:tabStrip.scheduledHint") return ` incl. ${opts?.count} planned`;
      if (key === "dashboard:tabStrip.plannedExtraHint") return ` +${opts?.count} planned`;
      const labels: Record<string, string> = {
        "dashboard:tabStrip.label": "Domain switcher",
        "dashboard:tabStrip.tabs.all": "All",
        "dashboard:tabStrip.tabs.flight": "Flights",
        "dashboard:tabStrip.tabs.cruise": "Cruises",
        "dashboard:tabStrip.tabs.poi": "POIs",
        "dashboard:tabStrip.tabs.lodging": "Lodging",
        "dashboard:tabStrip.tabs.tour": "Tours",
      };
      return labels[key] ?? key;
    },
    i18n: { language: "en", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

describe("DomainTabStrip", () => {
  // The POI tab only exists on a beta-flagged instance; the pre-existing cases
  // below are about tab behaviour, so run them with the gate open.
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
  });

  it("renders the five tabs with counts", () => {
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 127, cruise: 2, poi: 0, lodging: 0 }}
        enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
        onSelect={() => {}}
      />
    );
    expect(screen.getByRole("tab", { name: /all/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /127/ })).toBeTruthy();
    // cruise tab shows count "2" — match via the cruise label + count
    expect(screen.getByRole("tab", { name: /cruises/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /cruises/i }).textContent).toContain("2");
  });

  it("marks the active tab with aria-selected", () => {
    render(
      <DomainTabStrip
        active="cruise"
        counts={{ flight: 0, cruise: 2, poi: 0, lodging: 0 }}
        enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
        onSelect={() => {}}
      />
    );
    const tab = screen.getByRole("tab", { name: /cruise/i });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("calls onSelect with the clicked tab", () => {
    const onSelect = vi.fn();
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 0, cruise: 0, poi: 0, lodging: 0 }}
        enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /flights/i }));
    expect(onSelect).toHaveBeenCalledWith("flight");
  });

  // forgejo#88 P5, re-measured in the beta audit of 2026-09-19: the dimmed tab
  // carried a pointer cursor and aria-disabled, no title and no aria-label, and
  // the click did NOTHING — `onSelect` went to /dashboard/poi and
  // `useDashboardRoute` bounced it back. The tab stays visible (that is how the
  // area gets switched back on), so the click has to land somewhere that
  // explains itself: the domain's own route, which draws DomainDisabledNotice.
  describe("a tab whose domain is switched off", () => {
    const renderWithPoiOff = (onSelect = vi.fn()): typeof onSelect => {
      render(
        <DomainTabStrip
          active="all"
          counts={{ flight: 0, cruise: 0, poi: 0, lodging: 0 }}
          enabled={{ flight: true, cruise: true, poi: false, lodging: true }}
          onSelect={onSelect}
        />
      );
      return onSelect;
    };

    it("is dimmed but still drawn", () => {
      renderWithPoiOff();
      expect(screen.getByRole("tab", { name: /poi/i }).getAttribute("data-disabled")).toBe("true");
    });

    /**
     * It carried `aria-disabled` while the click did nothing, which was at
     * least honest. Once the click reaches the notice, the attribute tells
     * assistive tech to skip the ONLY route back to the switch that turns the
     * area on (review, 2026-09-19). Dimming is a fact about the area and
     * stays; "not operable" was never true of this control again.
     */
    it("does not tell assistive tech to skip the one way back", () => {
      renderWithPoiOff();
      expect(screen.getByRole("tab", { name: /poi/i })).not.toHaveAttribute("aria-disabled");
    });

    it("says why, in the title and the accessible name", () => {
      renderWithPoiOff();
      const poi = screen.getByRole("tab", { name: /poi/i });
      expect(poi.getAttribute("title")).toBe("dashboard:tabStrip.disabledHint");
      expect(poi.getAttribute("aria-label")).toBe("POIs — dashboard:tabStrip.disabledHint");
    });

    it("routes to the domain's own page on click, instead of doing nothing", () => {
      navigateSpy.mockClear();
      const onSelect = renderWithPoiOff();
      fireEvent.click(screen.getByRole("tab", { name: /poi/i }));
      expect(navigateSpy).toHaveBeenCalledWith("/places");
      // Not the dashboard tab — that route normalises straight back out.
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("leaves an ENABLED tab on the plain tab switch", () => {
      navigateSpy.mockClear();
      const onSelect = renderWithPoiOff();
      fireEvent.click(screen.getByRole("tab", { name: /cruises/i }));
      expect(onSelect).toHaveBeenCalledWith("cruise");
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });

  // The POI tab sat behind `poiDomain` until 2026-09-05, when the gate's own
  // condition (the CSV import getting a surface) was met. Pinned here so the
  // gate does not quietly come back: the tab is drawn whatever the flag says.
  describe("places left the beta switch", () => {
    it.each([
      ["off", false],
      ["unknown (not loaded yet)", null],
      ["on", true],
    ])("shows the POI tab when the beta flag is %s", (_label, flag) => {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      render(
        <DomainTabStrip
          active="all"
          counts={{ flight: 1, cruise: 1, poi: 0, lodging: 0 }}
          enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
          onSelect={() => {}}
        />
      );
      expect(screen.getByRole("tab", { name: /poi/i })).toBeTruthy();
    });
  });

  // The "Touren" tab is complete, unlike the POI domain above — it hides
  // behind the SAME shape of gate (`tourRoutes`, config/betaFeatures.ts) only
  // because the feature has not yet been through the owner's release
  // decision. It also has no domain behind it: `counts`/`enabled` are keyed
  // by DomainKey and never carry a "tour" entry, so the tab must render with
  // no count badge and — unlike POI — must never be dimmed either.
  describe("beta gate: tourRoutes", () => {
    const renderStrip = (): void => {
      render(
        <DomainTabStrip
          active="all"
          counts={{ flight: 1, cruise: 1, poi: 0, lodging: 0 }}
          enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
          onSelect={() => {}}
        />
      );
    };

    // Tours left the beta registry on 2026-09-18 (owner). The strip must now
    // offer the tab whatever the instance flag says — including while it is
    // still unknown, which is the state a cold load spends one request in and
    // the reason the gated version needed three states instead of a boolean.
    it.each([
      ["off", false],
      ["unknown (not loaded yet)", null],
      ["on", true],
    ])("offers the Touren tab when the beta flag is %s", (_label, flag) => {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      renderStrip();
      expect(screen.getByRole("tab", { name: /tours/i })).toBeTruthy();
      expect(screen.getByRole("tab", { name: /flights/i })).toBeTruthy();
    });

    it("shows the Touren tab, never dimmed, when the beta flag is on", () => {
      useSettingsStore.setState({ betaFeaturesEnabled: true });
      renderStrip();
      const tour = screen.getByRole("tab", { name: /tours/i });
      expect(tour).toBeTruthy();
      expect(tour.getAttribute("data-disabled")).toBe("false");
    });

    /**
     * The tab kept a hard-coded "Beta" pill after the gate was removed
     * (auditor 3, 2026-09-19). `config/betaFeatures.ts` holds one key,
     * `devicePairing`, and the 2.7.0 announcement tells readers tours have
     * shipped -- so the badge was contradicting both the registry and the
     * release notes. A badge that no registry entry backs is a badge nothing
     * can ever take away.
     */
    it("draws no Beta badge on the Touren tab — tours are released", () => {
      useSettingsStore.setState({ betaFeaturesEnabled: true });
      renderStrip();
      expect(screen.getByRole("tab", { name: /tours/i }).textContent).not.toMatch(/beta/i);
      expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    });
  });
});

describe("DomainTabStrip: the next-up entry", () => {
  // It replaces a card that floated over the map and covered the mode switcher
  // completely (232x39 px, measured 2026-08-14). Living in the strip, it also
  // gets to follow the tab: the next thing about what you are looking at.
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
  });

  const NOW = Date.parse("2026-08-14T12:00:00.000Z");
  const entries: UpcomingEntry[] = [
    {
      domain: "trip",
      id: "t1",
      detailId: "t1",
      startsAt: "2026-08-16T00:00:00.000Z",
      tripId: "t1",
      tripName: null,
      primary: "Tokyo",
      secondary: "Japan",
    },
    {
      domain: "flight",
      id: "f1",
      detailId: "f1",
      startsAt: "2026-08-20T08:00:00.000Z",
      tripId: "t1",
      tripName: "Tokyo · Japan",
      primary: "München → Wien",
      secondary: "LH 2280",
    },
  ];

  const renderStrip = (active: "all" | "flight" | "cruise" | "tour"): void => {
    render(
      <MemoryRouter>
        <DomainTabStrip
          active={active}
          counts={{ flight: 1, cruise: 0, poi: 0, lodging: 0 }}
          enabled={{ flight: true, cruise: true, poi: false, lodging: true }}
          onSelect={vi.fn()}
          upcoming={entries}
          nowMs={NOW}
        />
      </MemoryRouter>
    );
  };

  it("shows the soonest entry of any domain on the Alle tab", () => {
    renderStrip("all");
    expect(screen.getByTestId("next-up-entry").textContent).toContain("Tokyo");
  });

  it("follows the active tab: the flight tab shows the next FLIGHT, not the sooner trip", () => {
    renderStrip("flight");
    const entry = screen.getByTestId("next-up-entry").textContent ?? "";
    // The flight is the ENTRY; the trip may still appear on it as the journey
    // it belongs to, which is a different claim than "the trip is next".
    expect(entry).toContain("München → Wien");
    expect(entry).toContain("LH 2280");
  });

  it("shows nothing at all when the active tab has nothing ahead", () => {
    // Silence beats "—": an empty domain has no news, and a placeholder in the
    // strip would read like a broken value.
    renderStrip("cruise");
    expect(screen.queryByTestId("next-up-entry")).not.toBeInTheDocument();
  });

  it("counts the days from the injected clock, not the real one", () => {
    renderStrip("all");
    expect(screen.getByTestId("next-up-entry").textContent).toContain("dashboard:nextUp.inDays");
  });

  it("names the trip an entry belongs to, instead of only linking to it", () => {
    // Owner, 2026-08-14: "wenn das nächste Teil einer Reise ist muss das
    // gezeigt werden". The id alone carried the click and told the reader
    // nothing.
    renderStrip("flight");
    expect(screen.getByTestId("next-up-trip").textContent).toContain("Tokyo · Japan");
  });

  it("does not repeat the name on a trip entry, where it is already the headline", () => {
    renderStrip("all");
    expect(screen.queryByTestId("next-up-trip")).not.toBeInTheDocument();
  });

  // L4 (fix round 1 review, 2026-08-30): the match used to compare
  // `entry.domain` (`DomainKey | "trip"`) against `active` (`DashboardTab`)
  // directly -- two overlapping-but-different unions, correct only because
  // no `entry.domain` value happens to equal "tour" or "all". Now
  // `isValidDomain(active)` narrows first, so a domain-less tab returns
  // `undefined` by construction rather than by the comparison silently
  // finding nothing.
  // #314: the entry used to navigate to the TRIP when it had one and to the
  // domain's list otherwise, so the line naming your next flight dropped you on
  // the flight list with the flight still to find.
  it("opens the entry's own page, not the trip it belongs to and not the list", () => {
    navigateSpy.mockClear();
    renderStrip("flight");
    fireEvent.click(screen.getByTestId("next-up-entry"));
    expect(navigateSpy).toHaveBeenCalledWith("/flights/f1");
  });

  it("shows nothing on the domain-less 'tour' tab, which cannot match any upcoming entry", () => {
    renderStrip("tour");
    expect(screen.queryByTestId("next-up-entry")).not.toBeInTheDocument();
  });

  // Tester, 2026-09-21: the strip said "Flüge 123 · 2 geplant" and
  // "Unterkünfte 243" with nothing at all, while naming his next stay on the
  // right -- so he asked whether lodging simply has no planned figure. It
  // does; the strip was not asking for it. The wording differs because the
  // counting rules do: `counts.flight` already contains its planned flights,
  // `counts.lodging` is houses been to and contains none of the planned ones
  // (`shared/lodgingCounting.ts`).
  describe("planned hint", () => {
    const renderCounts = (scheduledCounts: Partial<Record<string, number>>): void => {
      render(
        <MemoryRouter>
          <DomainTabStrip
            active="all"
            counts={{ flight: 123, cruise: 0, poi: 0, lodging: 243 }}
            scheduledCounts={scheduledCounts}
            enabled={{ flight: true, cruise: true, poi: true, lodging: true }}
            onSelect={() => {}}
          />
        </MemoryRouter>
      );
    };

    it("names the planned stays on the lodging tab, as an addition to its count", () => {
      renderCounts({ lodging: 2 });
      expect(screen.getByRole("tab", { name: /lodging/i }).textContent).toContain("243 +2 planned");
    });

    it("keeps the flight hint a subset, because planned flights are already counted", () => {
      renderCounts({ flight: 2 });
      expect(screen.getByRole("tab", { name: /flights/i }).textContent).toContain(
        "123 incl. 2 planned"
      );
    });

    it("says nothing where there is nothing planned", () => {
      renderCounts({ lodging: 0, flight: 0 });
      expect(screen.getByRole("tab", { name: /lodging/i }).textContent).not.toContain("planned");
      expect(screen.getByRole("tab", { name: /flights/i }).textContent).not.toContain("planned");
    });
  });
});
