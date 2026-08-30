import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { UpcomingEntry } from "../../../lib/api/upcoming";
import { DomainTabStrip } from "../DomainTabStrip";
import { useSettingsStore } from "../../../store/settingsStore";

// Real Zustand store instead of the global static mock — the POI tab is gated
// behind the instance-level beta flag, which lives in this store.
vi.unmock("../../../store/settingsStore");

// Override the global key-passthrough mock with human-readable labels for this component.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
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

  it("dims but still allows clicking a disabled-domain tab (so user can see the 'coming soon' screen)", () => {
    const onSelect = vi.fn();
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 0, cruise: 0, poi: 0, lodging: 0 }}
        enabled={{ flight: true, cruise: true, poi: false, lodging: true }}
        onSelect={onSelect}
      />
    );
    const poi = screen.getByRole("tab", { name: /poi/i });
    expect(poi.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(poi);
    expect(onSelect).toHaveBeenCalledWith("poi");
  });

  // The POI tab hides behind `poiDomain` — a DIFFERENT gate from the
  // `poiDashboardTab` one it replaced, and hidden for a different reason. That
  // one hid a stub: an emoji and a "nothing here yet" line. This one hides a
  // real domain (Place + PlaceVisit, a migration off the old trip stops, an
  // API, a map layer, a list) that is not FINISHED — no detail page, no way to
  // create a place from the UI, no lists yet. See config/betaFeatures.ts.
  describe("beta gate: poiDomain", () => {
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

    it.each([
      ["off", false],
      ["unknown (not loaded yet)", null],
    ])("hides the POI tab when the beta flag is %s", (_label, flag) => {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      renderStrip();
      expect(screen.queryByRole("tab", { name: /poi/i })).toBeNull();
      // the ungated tabs are untouched
      expect(screen.getByRole("tab", { name: /flights/i })).toBeTruthy();
      expect(screen.getByRole("tab", { name: /cruises/i })).toBeTruthy();
    });

    it("shows the POI tab when the beta flag is on", () => {
      useSettingsStore.setState({ betaFeaturesEnabled: true });
      renderStrip();
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

    it.each([
      ["off", false],
      ["unknown (not loaded yet)", null],
    ])("hides the Touren tab when the beta flag is %s", (_label, flag) => {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      renderStrip();
      expect(screen.queryByRole("tab", { name: /tours/i })).toBeNull();
      expect(screen.getByRole("tab", { name: /flights/i })).toBeTruthy();
    });

    it("shows the Touren tab, never dimmed, when the beta flag is on", () => {
      useSettingsStore.setState({ betaFeaturesEnabled: true });
      renderStrip();
      const tour = screen.getByRole("tab", { name: /tours/i });
      expect(tour).toBeTruthy();
      expect(tour.getAttribute("data-disabled")).toBe("false");
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
      startsAt: "2026-08-16T00:00:00.000Z",
      tripId: "t1",
      tripName: null,
      primary: "Tokyo",
      secondary: "Japan",
    },
    {
      domain: "flight",
      id: "f1",
      startsAt: "2026-08-20T08:00:00.000Z",
      tripId: "t1",
      tripName: "Tokyo · Japan",
      primary: "München → Wien",
      secondary: "LH 2280",
    },
  ];

  const renderStrip = (active: "all" | "flight" | "cruise"): void => {
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
});
