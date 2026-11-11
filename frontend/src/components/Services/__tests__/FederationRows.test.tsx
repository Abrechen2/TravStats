import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: undefined }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
const visible = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: false,
    isFeatureVisible: (key: string) => visible.keys.has(key),
  }),
}));
const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  suspendPeer: vi.fn(),
  verifyPeer: vi.fn(),
  generateKey: vi.fn(),
  admissions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../lib/api/federationAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/federationAdmin")>()),
  federationAdminApi: api,
}));

import FederationRows from "../FederationRows";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { useFederationStatus } from "../../../store/federationStatusStore";

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
    visible.keys.clear();
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

  describe("setup checklist gates (federation serves comparison AND trip sharing)", () => {
    const live = { ...state, enabled: true, fingerprint: "ab".repeat(32), hasKey: true };
    const open = async (): Promise<void> => {
      api.get.mockResolvedValue(live);
      await act(async () => {
        render(
          <MemoryRouter>
            <FederationRows />
          </MemoryRouter>
        );
      });
      await screen.findAllByRole("switch");
    };

    it("shows identity but not the trip-sharing step when only comparison is visible", async () => {
      visible.keys.add("comparison");
      await open();
      expect(screen.getByTestId("federation-step-1")).toBeInTheDocument();
      expect(screen.queryByTestId("federation-step-2")).toBeNull();
      expect(document.getElementById("federation-trip-sharing")).toBeNull();
    });

    it("shows identity and the trip-sharing step when trip sharing is visible", async () => {
      visible.keys.add("federatedTripSharing");
      await open();
      expect(screen.getByTestId("federation-step-1")).toBeInTheDocument();
      expect(screen.getByTestId("federation-step-2")).toBeInTheDocument();
    });

    it("shows no checklist when neither is visible", async () => {
      await open();
      expect(screen.queryByTestId("federation-checklist")).toBeNull();
    });
  });

  describe("split over two pages (settings v3 S5)", () => {
    const live = {
      ...state,
      enabled: true,
      fingerprint: "ab".repeat(32),
      hasKey: true,
      peers: [
        {
          origin: "https://reise.example.net",
          fingerprint: "cd".repeat(32),
          enabled: true,
          verifiedAt: null,
          leaderboardVersions: [1],
        },
        {
          origin: "https://second.example",
          fingerprint: "ef".repeat(32),
          enabled: true,
          verifiedAt: null,
          leaderboardVersions: [1],
        },
      ],
    };
    const show = async (part: "switch" | "connections"): Promise<void> => {
      api.get.mockResolvedValue(live);
      await act(async () => {
        render(
          <MemoryRouter>
            <FederationRows part={part} />
          </MemoryRouter>
        );
      });
    };

    beforeEach(() => {
      useFederationStatus.setState({ enabled: null });
    });

    it("the switch part is the switch and nothing else", async () => {
      await show("switch");
      expect(await screen.findAllByRole("switch")).toHaveLength(1);
      expect(screen.queryByDisplayValue("https://me.example")).toBeNull();
      expect(screen.queryByTestId("federation-peer-list")).toBeNull();
    });

    it("the switch part still asks for the server's address while it has none: without it the switch cannot work", async () => {
      api.get.mockResolvedValue({ ...state, origin: null });
      await act(async () => {
        render(
          <MemoryRouter>
            <FederationRows part="switch" />
          </MemoryRouter>
        );
      });
      await screen.findByRole("switch");
      expect(screen.getByPlaceholderText("https://travstats.example.org")).toBeInTheDocument();
      cleanup();
      await show("switch");
      await screen.findByRole("switch");
      // With an address saved the rest is the connections page's business.
      expect(screen.queryByPlaceholderText("https://travstats.example.org")).toBeNull();
    });

    it("the connections part holds the peers and the key, and no switch for the connection itself", async () => {
      await show("connections");
      expect(await screen.findByTestId("federation-peer-list")).toBeInTheDocument();
      expect(screen.queryAllByRole("switch")).toHaveLength(0);
    });

    it("tells the menu at once when the switch is turned off, so Server-Verbindungen goes with it", async () => {
      api.update.mockResolvedValue({ ...live, enabled: false });
      await show("switch");
      useFederationStatus.getState().set(true);
      await userEvent.click(await screen.findByRole("switch"));
      await waitFor(() => expect(useFederationStatus.getState().enabled).toBe(false));
    });

    it("asks before a server is no longer trusted, and cuts it only after the answer", async () => {
      api.suspendPeer.mockResolvedValue(undefined);
      await show("connections");
      const rows = await screen.findAllByRole("button", { name: "federation.suspend" });
      await userEvent.click(rows[0]);
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("settingsRows:dialogs.peerremove.title");
      expect(api.suspendPeer).not.toHaveBeenCalled();
      await userEvent.click(
        within(dialog).getByRole("button", { name: "settingsRows:dialogs.peerremove.confirm" })
      );
      await waitFor(() =>
        expect(api.suspendPeer).toHaveBeenCalledWith("https://reise.example.net")
      );
    });

    it("does not cut anything when the question is declined", async () => {
      await show("connections");
      await userEvent.click(
        (await screen.findAllByRole("button", { name: "federation.suspend" }))[0]
      );
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(
        within(dialog)
          .getAllByRole("button")
          .find(
            (b) =>
              b !==
              within(dialog).getByRole("button", {
                name: "settingsRows:dialogs.peerremove.confirm",
              })
          )!
      );
      expect(api.suspendPeer).not.toHaveBeenCalled();
    });

    it("names how many servers a new key cuts off before it is made", async () => {
      await show("connections");
      await userEvent.click(
        await screen.findByRole("button", { name: "settingsRows:services.rows.fedkey.btn" })
      );
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("settingsRows:dialogs.fedkey.title");
      expect(api.generateKey).not.toHaveBeenCalled();
    });
  });
});
