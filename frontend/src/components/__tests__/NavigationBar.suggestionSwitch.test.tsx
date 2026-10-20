import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ count: vi.fn() }));

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
  tripSuggestionsApi: { count: mocks.count },
}));
vi.mock("../../lib/api/sharing", () => ({
  sharingApi: { inboxCount: vi.fn().mockResolvedValue(0) },
}));
vi.mock("../../lib/api/travplan", () => ({
  travplanApi: { capabilities: vi.fn().mockResolvedValue({ enabled: false }) },
}));
vi.mock("../UpdateBadge", () => ({ default: () => null }));
vi.mock("../Nav/UserMenu", () => ({ default: () => null }));
vi.mock("../Nav/MoreMenu", () => ({ default: () => null }));

const authState = {
  user: { id: "u1", username: "demo", isAdmin: false },
  logout: vi.fn(),
};
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));

vi.unmock("../../store/settingsStore");

import NavigationBar from "../NavigationBar";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";

const INBOX = "dataQuality:inbox.nav";

function renderBar() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <NavigationBar />
    </MemoryRouter>
  );
}

/**
 * The Posteingang badge and the trip suggestions switch (forgejo#306): a
 * switched-off kind is neither asked for nor counted, and a flip re-counts at
 * once rather than at the next 30-second poll.
 */
describe("NavigationBar inbox badge and the trip suggestions switch", () => {
  beforeEach(() => {
    mocks.count.mockReset().mockResolvedValue(3);
    useSuggestionSwitchesStore.setState({ trips: true, stays: true });
  });

  it("counts trip suggestions while the switch is on", async () => {
    renderBar();
    expect(await screen.findByRole("link", { name: `${INBOX} (3)` })).toBeInTheDocument();
  });

  it("neither asks for nor counts them while it is off", async () => {
    useSuggestionSwitchesStore.setState({ trips: false });
    renderBar();
    await waitFor(() => expect(screen.getByRole("link", { name: INBOX })).toBeInTheDocument());
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("a flip updates the badge without a reload", async () => {
    renderBar();
    await screen.findByRole("link", { name: `${INBOX} (3)` });
    act(() => useSuggestionSwitchesStore.setState({ trips: false }));
    expect(await screen.findByRole("link", { name: INBOX })).toBeInTheDocument();
    act(() => useSuggestionSwitchesStore.setState({ trips: true }));
    expect(await screen.findByRole("link", { name: `${INBOX} (3)` })).toBeInTheDocument();
  });
});
