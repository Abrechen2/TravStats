import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserSettings } from "../../../lib/api/types";
import { settingsApi } from "../../../lib/api";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { useCapabilitiesEpochStore } from "../../../store/capabilitiesEpochStore";

const mocks = vi.hoisted(() => ({ instanceOn: vi.fn<() => boolean>() }));
vi.mock("../../../hooks/useTravPlanVisible", () => ({
  useTravPlanInstanceOn: () => mocks.instanceOn(),
}));

import TravPlanModuleRow from "../TravPlanModuleRow";

/**
 * The account's TravPlan switch beside the domains (owner, 2026-10-27:
 * "alles einzeln aktivierbar so wie die Domains").
 */
describe("TravPlanModuleRow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.instanceOn.mockReturnValue(true);
    useSuggestionSwitchesStore.setState({ travPlan: false });
  });

  it("is not drawn while the instance does not offer TravPlan", () => {
    mocks.instanceOn.mockReturnValue(false);
    const { container } = render(<TravPlanModuleRow />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reads the switch from what GET /settings said", () => {
    useSuggestionSwitchesStore.getState().noteRemote({ travPlan: { enabled: true } });
    render(<TravPlanModuleRow />);
    expect(screen.getByRole("switch", { name: /settings:travPlan\.label/ })).toBeChecked();
  });

  it("switching it on saves it, then has the navigation ask again", async () => {
    const update = vi.spyOn(settingsApi, "update").mockResolvedValue({} as UserSettings);
    const before = useCapabilitiesEpochStore.getState().epoch.travPlan;
    render(<TravPlanModuleRow />);
    await userEvent.click(screen.getByRole("switch", { name: /settings:travPlan\.label/ }));
    expect(useSuggestionSwitchesStore.getState().travPlan).toBe(true);
    expect(update).toHaveBeenCalledWith({ travPlan: { enabled: true } });
    await waitFor(() =>
      expect(useCapabilitiesEpochStore.getState().epoch.travPlan).toBe(before + 1)
    );
  });
});
