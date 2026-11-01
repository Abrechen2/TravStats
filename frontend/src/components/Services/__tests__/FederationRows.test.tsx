import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: undefined }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ betaFeaturesEnabled: false, isFeatureVisible: () => false }),
}));
const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("../../../lib/api/federationAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/federationAdmin")>()),
  federationAdminApi: api,
}));

import FederationRows from "../FederationRows";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

const state = {
  source: "settings",
  enabled: false,
  origin: "https://me.example",
  publicKey: null,
  fingerprint: null,
  hasKey: false,
  tripSharingEnabled: false,
  peers: [],
};

describe("FederationRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsLevelStore.setState({ level: "expert" });
    api.get.mockResolvedValue(state);
  });
  afterEach(cleanup);

  it("runs two changes one after the other, the second with the first one's result — they do not race", async () => {
    let release: (s: unknown) => void = () => {};
    api.update
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValue({ ...state, enabled: true, origin: "https://new.example" });
    await act(async () => {
      render(
        <MemoryRouter>
          <FederationRows />
        </MemoryRouter>
      );
    });
    const toggle = await screen.findByRole("switch");
    await userEvent.click(toggle);
    const field = screen.getByDisplayValue("https://me.example");
    await userEvent.clear(field);
    await userEvent.type(field, "https://new.example");
    await userEvent.tab();
    // The origin write waits for the switch write: one call so far.
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update.mock.calls[0][0]).toMatchObject({ enabled: true });
    await act(async () => release({ ...state, enabled: true }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    expect(api.update.mock.calls[1][0]).toEqual({ enabled: true, origin: "https://new.example" });
  });

  it("says why a write was refused and keeps the state it could read", async () => {
    api.update.mockRejectedValue({
      response: { status: 400, data: { error: "x", code: "FEDERATION_ENV_MANAGED" } },
    });
    await act(async () => {
      render(
        <MemoryRouter>
          <FederationRows />
        </MemoryRouter>
      );
    });
    await userEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
