import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { DomainFilterButton } from "../DomainFilterButton";
import { DomainFilterEmptyOverlay } from "../DomainFilterEmptyOverlay";
import { useDashboardDomainFilterStore } from "../../../../store/dashboardDomainFilterStore";
import { useDashboardCountsStore } from "../../../../store/dashboardCountsStore";
import { useSettingsStore } from "../../../../store/settingsStore";

vi.unmock("../../../../store/settingsStore");

// Human-readable copy for the strings this suite actually reads; everything
// else falls through to the bare key, same pattern as DomainTabStrip.test.tsx.
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { visible?: number; total?: number }) => {
      const labels: Record<string, string> = {
        "dashboard:tabStrip.tabs.flight": "Flüge",
        "dashboard:tabStrip.tabs.cruise": "Kreuzfahrten",
        "dashboard:tabStrip.tabs.lodging": "Unterkünfte",
        "dashboard:tabStrip.tabs.poi": "Orte",
        "dashboard:tabStrip.tabs.tour": "Touren",
        "dashboard:tabStrip.tabs.roadtrip": "Roadtrips",
        "dashboard:domainFilter.panel.title": "Auf der Karte",
        "dashboard:domainFilter.panel.all": "Alle",
        "dashboard:domainFilter.panel.none": "Keine",
        "dashboard:domainFilter.row.only": "Nur",
        "dashboard:domainFilter.row.onlyTooltip": "Nur diese Domäne zeigen",
        "dashboard:domainFilter.empty.title": "Keine Domäne ausgewählt",
        "dashboard:domainFilter.empty.showAll": "Alle einblenden",
        "dashboard:domainFilter.empty.openFilter": "Auswahl öffnen",
        "dashboard:domainFilter.link.badge": "Link",
        "dashboard:domainFilter.link.adopt": "Als meine merken",
        "dashboard:domainFilter.link.mine": "Meine Auswahl",
        "dashboard:domainFilter.sheet.title": "Domänen",
        "dashboard:domainFilter.sheet.done": "Fertig",
      };
      if (key === "dashboard:domainFilter.button.label") {
        return `Domänen · ${opts?.visible}/${opts?.total}`;
      }
      return labels[key] ?? key;
    },
    i18n: { language: "de", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

/** Reads the current path out, so a test can assert where "Nur" navigated. */
function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

function Wrapper({ children }: { children: ReactNode }): JSX.Element {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={children} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * For the tests that follow a navigation. Kept apart from `Wrapper` because
 * the probe renders a node, and one suite below asserts an EMPTY container.
 *
 * The `:tab` route matters: since "Nur" became the way into a domain's own
 * view, clicking it navigates, and without that route the panel would simply
 * unmount mid-test.
 */
function NavWrapper({ children }: { children: ReactNode }): JSX.Element {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <LocationProbe />
      <Routes>
        <Route path="/dashboard" element={children} />
        <Route path="/dashboard/:tab" element={children} />
      </Routes>
    </MemoryRouter>
  );
}

function Controlled({ tourCount = 0 }: { tourCount?: number }): JSX.Element {
  const [open, setOpen] = useState(false);
  return <DomainFilterButton tourCount={tourCount} open={open} onOpenChange={setOpen} />;
}

describe("DomainFilterButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDashboardDomainFilterStore.setState({ hidden: new Set(), linkHidden: null });
    useDashboardCountsStore.setState({
      counts: { flight: 3, cruise: 1, poi: 0, lodging: 2, roadtrip: 0, rail: 0 },
      scheduledCounts: { flight: 0, cruise: 0, lodging: 0 },
      countsLoaded: true,
    });
    useSettingsStore.setState({
      enabledDomains: ["flight", "cruise", "lodging", "poi", "roadtrip"],
      betaFeaturesEnabled: true,
    });
  });

  it("shows the visible/total count on the closed button", () => {
    render(<Controlled />, { wrapper: Wrapper });
    expect(screen.getByRole("button", { name: /Domänen · 6\/6/ })).toBeInTheDocument();
  });

  it("opens a dialog with one checkbox row per available domain", async () => {
    const user = userEvent.setup();
    render(<Controlled tourCount={2} />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: /Domänen/ }));

    const dialog = screen.getByRole("dialog");
    const rows = within(dialog).getAllByRole("checkbox");
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.getAttribute("aria-checked") === "true")).toBe(true);
  });

  it("unticking a row hides it and updates the button count", async () => {
    const user = userEvent.setup();
    render(<Controlled />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: /Domänen/ }));
    await user.click(screen.getByRole("checkbox", { name: "Flüge" }));

    expect(screen.getByRole("checkbox", { name: "Flüge" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(useDashboardDomainFilterStore.getState().hidden.has("flight")).toBe(true);
  });

  it("focuses the first row on open, and arrow keys move focus between rows", async () => {
    const user = userEvent.setup();
    render(<Controlled />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: /Domänen/ }));

    const flightRow = screen.getByRole("checkbox", { name: "Flüge" });
    const cruiseRow = screen.getByRole("checkbox", { name: "Kreuzfahrten" });
    expect(flightRow).toHaveFocus();

    fireEvent.keyDown(flightRow, { key: "ArrowDown" });
    expect(cruiseRow).toHaveFocus();

    fireEvent.keyDown(cruiseRow, { key: " " });
    expect(cruiseRow).toHaveAttribute("aria-checked", "false");

    fireEvent.keyDown(cruiseRow, { key: "ArrowUp" });
    expect(flightRow).toHaveFocus();
  });

  it("Escape closes the panel and returns focus to the button", async () => {
    const user = userEvent.setup();
    render(<Controlled />, { wrapper: Wrapper });
    const button = screen.getByRole("button", { name: /Domänen/ });
    await user.click(button);

    expect(screen.getByRole("checkbox", { name: "Flüge" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  /**
   * "Nur" used to hide the other five rows in place. It now opens that
   * domain's OWN view, because that is the only state in which the domain's
   * own map modes exist at all — `TAB_MODE_REGISTRY` keys them by tab, and
   * eight of them (Hafen-Häufigkeit, Reiseverlauf, Nächte, Ketten, Trips …)
   * have no equivalent on "Alle". Isolating without navigating would have
   * shown one domain and still withheld everything it can be looked at with.
   */
  /**
   * A tablet is wide AND touched. The width test alone called every iPad a
   * desktop and served 40 px rows with a 36×21 px "Nur" button — measured on
   * 768×1024, 1024×768, 820×1180 and 1194×834 before this split existed.
   * Since the browser build targets iPads (owner, 2026-09-28: the phone is the
   * Companion's job), the size follows the POINTER and the layout follows the
   * width.
   */
  it("gives a touch device finger-sized rows even at desktop width", async () => {
    const user = userEvent.setup();
    // Wide viewport, coarse pointer — an iPad.
    window.matchMedia = ((query: string) => ({
      matches: query.includes("pointer: coarse"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    render(<Controlled />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: /Domänen/ }));

    // The dropdown, not the sheet — the width still decides that.
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-modal", "true");
    // But the rows and the "Nur" target are the large ones.
    expect(screen.getByRole("checkbox", { name: "Flüge" })).toHaveStyle({ minHeight: "52px" });
    const only = within(screen.getByRole("checkbox", { name: "Flüge" })).getByRole("button", {
      name: "Nur",
    });
    expect(only).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
  });

  it('"Nur" opens that domain\'s own view', async () => {
    const user = userEvent.setup();
    render(<Controlled />, { wrapper: NavWrapper });
    await user.click(screen.getByRole("button", { name: /Domänen/ }));
    const cruiseOnly = within(screen.getByRole("checkbox", { name: "Kreuzfahrten" })).getByRole(
      "button",
      { name: "Nur" }
    );
    await user.click(cruiseOnly);

    expect(screen.getByTestId("path")).toHaveTextContent("/dashboard/cruise");
  });

  /**
   * The claim is "derived", not "stored": on a single-domain view the rows
   * come from the ROUTE, and the persisted set — which belongs to "Alle" —
   * is left exactly as the reader left it. Asserted on the button's own
   * count plus the untouched store, rather than by reopening the panel,
   * because the panel closes with the navigation.
   */
  it("a single-domain view derives its rows from the route, leaving storage alone", async () => {
    const user = userEvent.setup();
    useDashboardDomainFilterStore.setState({ hidden: new Set(["lodging"]), linkHidden: null });
    render(<Controlled />, { wrapper: NavWrapper });
    await user.click(screen.getByRole("button", { name: /Domänen/ }));
    await user.click(
      within(screen.getByRole("checkbox", { name: "Kreuzfahrten" })).getByRole("button", {
        name: "Nur",
      })
    );

    expect(screen.getByTestId("path")).toHaveTextContent("/dashboard/cruise");
    // One of six visible, derived from the route.
    expect(screen.getByRole("button", { name: /Domänen · 1\/6/ })).toBeInTheDocument();
    // And the reader's own "Alle" selection is still theirs.
    expect([...useDashboardDomainFilterStore.getState().hidden]).toEqual(["lodging"]);
  });

  it('"Alle" and "Keine" toggle every row at once', async () => {
    const user = userEvent.setup();
    render(<Controlled />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: /Domänen/ }));
    await user.click(screen.getByRole("button", { name: "Keine" }));
    expect(
      screen.getAllByRole("checkbox").every((r) => r.getAttribute("aria-checked") === "false")
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Alle" }));
    expect(
      screen.getAllByRole("checkbox").every((r) => r.getAttribute("aria-checked") === "true")
    ).toBe(true);
  });

  it("a shared link shows the Link badge and does not persist until adopted", async () => {
    function LinkWrapper({ children }: { children: ReactNode }): JSX.Element {
      return (
        <MemoryRouter initialEntries={["/dashboard?domains=flight"]}>
          <Routes>
            <Route path="/dashboard" element={children} />
          </Routes>
        </MemoryRouter>
      );
    }
    const user = userEvent.setup();
    render(<Controlled />, { wrapper: LinkWrapper });
    await user.click(screen.getByRole("button", { name: /Domänen/ }));

    expect(screen.getByText("Link")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Flüge" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Kreuzfahrten" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(window.localStorage.getItem("travstats.dashboard.hiddenDomains.v1")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Als meine merken" }));
    expect(
      JSON.parse(window.localStorage.getItem("travstats.dashboard.hiddenDomains.v1") ?? "[]")
    ).toContain("cruise");
  });
});

describe("DomainFilterButton — mobile sheet (<640px)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDashboardDomainFilterStore.setState({ hidden: new Set(), linkHidden: null });
    useDashboardCountsStore.setState({
      counts: { flight: 3, cruise: 1, poi: 0, lodging: 2, roadtrip: 0, rail: 0 },
      scheduledCounts: { flight: 0, cruise: 0, lodging: 0 },
      countsLoaded: true,
    });
    useSettingsStore.setState({
      enabledDomains: ["flight", "cruise", "lodging", "poi"],
      betaFeaturesEnabled: false,
    });
    // Force the phone breakpoint (`useIsPhoneViewport`/`PHONE_MAX_WIDTH_PX = 639`).
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width: 639px"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it("opens a sheet (not a dropdown) with a Fertig header action", async () => {
    const user = userEvent.setup();
    render(<Controlled />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: /Domänen/ }));

    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(within(sheet).getByRole("button", { name: "Fertig" })).toBeInTheDocument();
    expect(within(sheet).getAllByRole("checkbox")).toHaveLength(4);
  });

  it("Fertig closes the sheet and returns focus to the button", async () => {
    const user = userEvent.setup();
    render(<Controlled />, { wrapper: Wrapper });
    const button = screen.getByRole("button", { name: /Domänen/ });
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Fertig" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});

describe("DomainFilterEmptyOverlay", () => {
  it("shows the empty state and both its actions work", async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn();
    const onOpenFilter = vi.fn();
    render(<DomainFilterEmptyOverlay isEmpty onShowAll={onShowAll} onOpenFilter={onOpenFilter} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("Keine Domäne ausgewählt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Alle einblenden" }));
    expect(onShowAll).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Auswahl öffnen" }));
    expect(onOpenFilter).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when not empty", () => {
    const { container } = render(
      <DomainFilterEmptyOverlay isEmpty={false} onShowAll={vi.fn()} onOpenFilter={vi.fn()} />,
      { wrapper: Wrapper }
    );
    expect(container).toBeEmptyDOMElement();
  });
});
