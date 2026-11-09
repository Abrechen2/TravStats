import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { friendsRoutes } from "../../pages/friendsRoutes";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../pages/FriendInvitePage", () => ({ default: () => <p>invite page</p> }));
vi.mock("../../pages/FriendAcceptPage", () => ({ default: () => <p>accept page</p> }));

const authState: { user: { isAdmin: boolean } | null } = { user: { isAdmin: false } };
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));
vi.mock("../../hooks/useTravTrackVisible", () => ({ useTravTrackVisible: () => false }));
vi.mock("../../hooks/useTravPlanVisible", () => ({ useTravPlanVisible: () => false }));
vi.unmock("../../store/settingsStore");

import { useNavItems } from "../../components/Nav/useNavItems";
import { useSettingsStore } from "../../store/settingsStore";

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {friendsRoutes()}
        <Route path="/freunde" element={<p>friends page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("the friends routes", () => {
  it("/compare redirects to /freunde", async () => {
    renderAt("/compare");
    expect(await screen.findByText("friends page")).toBeInTheDocument();
  });

  it("serves the invitation landing page without a session", async () => {
    render(
      <MemoryRouter initialEntries={["/freunde/einladung"]}>
        <Routes>{friendsRoutes()}</Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("invite page")).toBeInTheDocument();
  });
});

describe("the Mehr menu", () => {
  beforeEach(() => {
    authState.user = { isAdmin: false };
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
  });

  it("the Mehr menu lists Freunde behind the comparison key", () => {
    const { result } = renderHook(() => useNavItems());
    const leaf = result.current.more.flatMap((s) => s.items).find((l) => l.id === "comparison");
    expect(leaf).toMatchObject({ path: "/freunde", icon: "users", label: "comparison:title" });
    act(() => useSettingsStore.setState({ betaFeaturesEnabled: false }));
    const hidden = renderHook(() => useNavItems()).result.current.more.flatMap((s) =>
      s.items.map((l) => l.id)
    );
    expect(hidden).not.toContain("comparison");
  });
});
