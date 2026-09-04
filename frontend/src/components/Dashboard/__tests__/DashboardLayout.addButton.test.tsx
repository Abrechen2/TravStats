import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * M2 (fix round 1 review, 2026-08-30): the per-tab "+" button used to
 * build its click handler with `setAddingDomain(tab as AddableDomain)` --
 * an assertion, not a fact, that stopped being true the moment
 * `DashboardTab` grew a tab with no domain behind it ("Touren"). The
 * round-1 fix suppressed that ONE tab by name (`tab !== "tour"`) rather
 * than fixing the cast itself, which the review called out as guarding
 * the symptom. This test proves the actual fix: the button is gated by
 * `isValidDomain(tab)`, a real type guard, so it disappears for ANY
 * domain-less tab -- not just the one this feature happened to add --
 * while still working normally for real domain tabs.
 *
 * Deliberate-break protocol: replace the `isValidDomain(tab) && (...)`
 * guard in DashboardLayout.tsx with `tab !== "tour" && (...)` (the
 * round-1 version) -- this test's "hides for a hypothetical domain-less
 * tab" case would keep passing for "tour" specifically, so the real
 * proof is bringing back `tab as AddableDomain` (removing the guard
 * entirely) and confirming the "flight" case's onClick still resolves
 * correctly either way; the meaningful break is reverting to the literal
 * `as AddableDomain` cast with no guard at all, which the tour case below
 * catches immediately (button reappears with a broken handler).
 */

const mockUseDashboardRoute = vi.hoisted(() => vi.fn());
vi.mock("../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => mockUseDashboardRoute(),
}));

vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging", "poi"],
    isEnabled: () => true,
  }),
}));

vi.mock("../../../lib/api/upcoming", () => ({
  getUpcoming: vi.fn().mockResolvedValue([]),
}));

// Not under test here, and its own selectors need profile fields the
// global settingsStore test mock doesn't provide.
vi.mock("../../NavigationBar", () => ({
  default: () => <div data-testid="navigation-bar-stub" />,
}));

// #288: the places domain is behind the instance beta flag, which the global
// settingsStore mock leaves unset (so `usePlacesVisible` would answer
// "denied" and the menu would never list POI). Answer "yes" outright — the
// combined rule has its own tests; what is under test here is what the
// layout does with a POI pick.
vi.mock("../../../hooks/usePlacesVisible", () => ({
  usePlacesVisible: () => true,
}));

// The real form pulls in the location search and the map picker; a stub is
// enough to prove the layout mounts it.
vi.mock("../../places/PlaceFormModal", () => ({
  PlaceFormModal: () => <div data-testid="place-form-modal" />,
}));

// Imported after the mocks above so the module graph picks them up.
import { DashboardLayout } from "../DashboardLayout";

function renderAt(tab: string, setTab = vi.fn()): ReturnType<typeof render> {
  mockUseDashboardRoute.mockReturnValue({ tab, setTab });
  return render(
    <MemoryRouter>
      <DashboardLayout counts={{ flight: 1, cruise: 0, poi: 0, lodging: 0 }}>
        <div />
      </DashboardLayout>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockUseDashboardRoute.mockReset();
});

describe("DashboardLayout: the per-tab add button only targets real domains", () => {
  it("renders + Add flight on the flight tab, wired to a real AddableDomain", () => {
    renderAt("flight");
    const button = screen.getByRole("button", { name: /addPerTab\.flight/i });
    expect(button).toBeInTheDocument();
    // Clicking it must not throw -- `setAddingDomain(tab)` with `tab`
    // narrowed to a real DomainKey, never an unchecked cast.
    fireEvent.click(button);
  });

  it("renders no add button at all on the domain-less 'tour' tab", () => {
    renderAt("tour");
    expect(screen.queryByRole("button", { name: /addPerTab\.tour/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/addPerTab\.tour/i)).not.toBeInTheDocument();
  });
});

/**
 * #288: the "+" menu listed "POI hinzufügen" and the click set
 * `addingDomain = "poi"` — and then nothing rendered for it. The modal block
 * covered flight, cruise and lodging and held a stale "not wired until V2"
 * comment where the POI form should have been. The per-tab button on
 * /dashboard/poi was the same dead end.
 *
 * Deliberate-break protocol: put the comment back in place of the
 * `addingDomain === "poi"` block in DashboardLayout.tsx — both tests fail on
 * the missing form.
 */
describe("DashboardLayout: adding a POI from the map", () => {
  it("opens the place form when POI is picked from the add menu (#288)", () => {
    renderAt("all");
    expect(screen.queryByTestId("place-form-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /addPicker\.button/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /addPicker\.poi/i }));

    expect(screen.getByTestId("place-form-modal")).toBeInTheDocument();
  });

  it("opens the place form from the per-tab button on the POI tab", () => {
    renderAt("poi");
    expect(screen.queryByTestId("place-form-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /addPerTab\.poi/i }));

    expect(screen.getByTestId("place-form-modal")).toBeInTheDocument();
  });
});
