import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { NavSection } from "../Nav/useNavItems";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../lib/api", () => ({
  pendingUpdatesApi: { getAll: vi.fn().mockResolvedValue({ count: 0 }) },
}));
vi.mock("../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: { getAll: vi.fn().mockResolvedValue({ count: 0 }) },
}));
vi.mock("../../lib/api/tripSuggestions", () => ({
  tripSuggestionsApi: { count: vi.fn().mockResolvedValue(0) },
}));
vi.mock("../../lib/api/sharing", () => ({
  sharingApi: { inboxCount: vi.fn().mockResolvedValue(0) },
}));
vi.mock("../../lib/api/travplan", () => ({
  travplanApi: { capabilities: mocks.capabilities },
}));
vi.mock("../UpdateBadge", () => ({ default: () => null }));
vi.mock("../Nav/UserMenu", () => ({ default: () => null }));
vi.mock("../Nav/MoreMenu", () => ({
  default: ({ sections }: { sections: NavSection[] }) => (
    <ul data-testid="more">
      {sections
        .flatMap((s) => s.items)
        .map((i) => (
          <li key={i.id}>{i.path}</li>
        ))}
    </ul>
  ),
}));

const authState = {
  user: { id: "u1", username: "demo", isAdmin: false },
  logout: vi.fn(),
};
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));
vi.unmock("../../store/settingsStore");

import NavigationBar from "../NavigationBar";
import { useSettingsStore } from "../../store/settingsStore";

const PLAN_PATH = "/plan/0f3c2a1e-0000-4000-8000-000000000001/budget";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationBar />
    </MemoryRouter>
  );
}

/**
 * TravPlan replaced the whole header on `/plan*`: the brand became a mode
 * switcher, and the four primary destinations became eight planning sections.
 * A planner could not reach the dashboard from the header, and the app looked
 * like a second product. The header is the app's on every route now; the
 * planning mode is one entry in "Mehr".
 */
describe("NavigationBar on a TravPlan route", () => {
  beforeEach(() => {
    mocks.capabilities.mockReset().mockResolvedValue({ enabled: true });
    useSettingsStore.setState({ betaFeaturesEnabled: true, enabledDomains: ["flight"] });
  });

  it("keeps the brand link and the app's primary destinations", async () => {
    renderAt(PLAN_PATH);
    expect(screen.getByRole("link", { name: "common:accessibility.home" })).toHaveAttribute(
      "href",
      "/dashboard"
    );
    const nav = screen.getByRole("navigation", { name: "dashboard:nav.main" });
    expect(within(nav).getByRole("link", { name: "dashboard:title" })).toHaveAttribute(
      "href",
      "/dashboard"
    );
    expect(within(nav).getByRole("link", { name: "trips:tab" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "mode" })).toBeNull();
    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled());
  });

  it("offers TravPlan as one entry in Mehr while it is visible", async () => {
    renderAt("/dashboard");
    await waitFor(() =>
      expect(within(screen.getAllByTestId("more")[0]).getByText("/plan")).toBeInTheDocument()
    );
  });

  it("drops the entry while the beta switch is off", async () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    renderAt("/dashboard");
    // Let the header's inbox counts settle, so nothing renders after the asserts.
    await act(async () => undefined);
    for (const more of screen.getAllByTestId("more")) {
      expect(within(more).queryByText("/plan")).toBeNull();
    }
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });
});
