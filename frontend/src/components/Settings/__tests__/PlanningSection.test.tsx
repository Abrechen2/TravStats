import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserSettings } from "../../../lib/api/types";
import { settingsApi } from "../../../lib/api";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { useCapabilitiesEpochStore } from "../../../store/capabilitiesEpochStore";

const mocks = vi.hoisted(() => ({ instanceOn: vi.fn<() => boolean>() }));
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

  it("stays visible but locked, with its reason, while the instance does not offer TravPlan", () => {
    mocks.instanceOn.mockReturnValue(false);
    render(<PlanningSection />);
    const toggle = screen.getByRole("switch", { name: /settings:rows\.travPlan\.name/ });
    expect(toggle).toBeDisabled();
    expect(screen.getByText("settings:rows.travPlan.offOnServer")).toBeInTheDocument();
  });

  it("reads the switch from what GET /settings said", () => {
    useSuggestionSwitchesStore.getState().noteRemote({ travPlan: { enabled: true } });
    render(<PlanningSection />);
    expect(screen.getByRole("switch", { name: /settings:rows\.travPlan\.name/ })).toBeChecked();
  });

  it("switching it on saves it, then has the navigation ask again", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
    const before = useCapabilitiesEpochStore.getState().epoch.travPlan;
    render(<PlanningSection />);
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
});
