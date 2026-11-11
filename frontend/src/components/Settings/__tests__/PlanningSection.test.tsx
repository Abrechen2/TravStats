import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserSettings } from "../../../lib/api/types";
import { settingsApi } from "../../../lib/api";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import { useCapabilitiesEpochStore } from "../../../store/capabilitiesEpochStore";

const mocks = vi.hoisted(() => ({ instanceOn: vi.fn<() => boolean>() }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("../../../hooks/useTravPlanVisible", () => ({
  useTravPlanInstanceOn: () => mocks.instanceOn(),
}));

import PlanningSection from "../PlanningSection";

/**
 * The account's TravPlan switch beside the domains (owner, 2026-10-27:
 * "alles einzeln aktivierbar so wie die Domains").
 */
describe("PlanningSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.instanceOn.mockReturnValue(true);
    useSuggestionSwitchesStore.setState({ travPlan: false });
  });

  afterEach(() => {
    act(() => resetWriteQueue());
  });

  it("stays visible but locked, with its reason, while the instance does not offer TravPlan", () => {
    mocks.instanceOn.mockReturnValue(false);
    render(
      <MemoryRouter>
        <PlanningSection />
      </MemoryRouter>
    );
    const toggle = screen.getByRole("switch", { name: /settings:rows\.travPlan\.name/ });
    expect(toggle).toBeDisabled();
    expect(screen.getByText("settings:rows.travPlan.offOnServer")).toBeInTheDocument();
  });

  it("reads the switch from what GET /settings said", () => {
    useSuggestionSwitchesStore.getState().noteRemote({ travPlan: { enabled: true } });
    render(
      <MemoryRouter>
        <PlanningSection />
      </MemoryRouter>
    );
    expect(screen.getByRole("switch", { name: /settings:rows\.travPlan\.name/ })).toBeChecked();
  });

  it("switching it on saves it, then has the navigation ask again", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
    const before = useCapabilitiesEpochStore.getState().epoch.travPlan;
    render(
      <MemoryRouter>
        <PlanningSection />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole("switch", { name: /settings:rows\.travPlan\.name/ }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(useSuggestionSwitchesStore.getState().travPlan).toBe(true);
    expect(update).toHaveBeenCalledWith({ travPlan: { enabled: true } });
    await waitFor(() =>
      expect(useCapabilitiesEpochStore.getState().epoch.travPlan).toBe(before + 1)
    );
  });

  it("offers the jump to Freunde for sharing plans while TravPlan is on, and not before", async () => {
    const show = () =>
      render(
        <MemoryRouter>
          <PlanningSection />
        </MemoryRouter>
      );
    const { unmount } = show();
    expect(screen.queryByText("settings:rows.planShare.name")).toBeNull();
    unmount();
    useSuggestionSwitchesStore.getState().noteRemote({ travPlan: { enabled: true } });
    show();
    await userEvent.click(screen.getByRole("button", { name: /settings:rows\.planShare\.jump/ }));
    expect(navigate).toHaveBeenCalledWith("/settings/freunde", undefined);
  });
});
