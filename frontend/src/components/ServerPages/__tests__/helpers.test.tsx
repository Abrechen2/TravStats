import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { addressProblem, originsProblem, parseOrigins, rpIdProblem } from "../fieldChecks";
import { completeOrder, moveAmongEnabled } from "../cloudOrder";
import { usePublicUrlMissing } from "../usePublicUrlMissing";
import { resetInstanceStore } from "../instanceStore";
import MaintenanceTimeModel from "../MaintenanceTimeModel";
import { SettingsMenuColumn } from "../../Settings/frame/SettingsMenu";
import { httpError, instance } from "./fixtures";

const api = vi.hoisted(() => ({ getInstanceSettings: vi.fn(), getUsers: vi.fn() }));
vi.mock("../../../lib/api", () => ({ adminApi: api }));
vi.mock("../../Admin/timeModel/TimeMigrationReport", () => ({ default: () => null }));
vi.mock("../../Admin/timeModel/ZoneReResolve", () => ({ default: () => null }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  resetInstanceStore();
});

describe("field checks", () => {
  it("takes http(s) addresses and names anything else", () => {
    expect(addressProblem("")).toBeNull();
    expect(addressProblem("https://trav.example:3010")).toBeNull();
    expect(addressProblem("trav.example")).toBe("scheme");
    expect(addressProblem("ftp://trav.example")).toBe("scheme");
  });

  it("takes a bare domain for the passkeys and refuses a URL, a port or an IP address", () => {
    expect(rpIdProblem("travstats.example.com")).toBeNull();
    expect(rpIdProblem("https://travstats.example.com")).toBe("domain");
    expect(rpIdProblem("trav.example:443")).toBe("domain");
    expect(rpIdProblem("192.168.1.5")).toBe("domain");
  });

  it("reads one origin per line and ignores blank lines", () => {
    expect(parseOrigins("https://a.example\n\n  https://b.example  \n")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(originsProblem("https://a.example\nb.example")).toBe("scheme");
  });
});

describe("the cloud chain order", () => {
  it("completes a short saved order with the missing kinds", () => {
    expect(completeOrder(["custom"])).toEqual(["custom", "openai", "anthropic", "google"]);
  });

  it("moves a provider past the next ENABLED one and leaves disabled ones where they are", () => {
    const order = completeOrder(["openai", "anthropic", "google", "custom"]);
    const enabled = new Set(["openai", "google"] as const);
    expect(moveAmongEnabled(order, enabled, "openai", 1)).toEqual([
      "google",
      "anthropic",
      "openai",
      "custom",
    ]);
    expect(moveAmongEnabled(order, enabled, "openai", -1)).toEqual(order);
  });
});

describe("the missing public address (B15)", () => {
  it("is true for an admin whose server has none, false when it is set or could not be read", async () => {
    api.getInstanceSettings.mockResolvedValueOnce({
      settings: instance({ frontendUrl: null }),
      passkeyStatus: null,
    });
    const missing = renderHook(() => usePublicUrlMissing(true));
    await waitFor(() => expect(missing.result.current).toBe(true));
    missing.unmount();

    resetInstanceStore();
    api.getInstanceSettings.mockRejectedValueOnce(httpError());
    const unreadable = renderHook(() => usePublicUrlMissing(true));
    await waitFor(() => expect(api.getInstanceSettings).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(unreadable.result.current).toBe(false);
  });

  it("never asks the server for an account that is not an admin", () => {
    renderHook(() => usePublicUrlMissing(false));
    expect(api.getInstanceSettings).not.toHaveBeenCalled();
  });

  it("puts a warn dot with its reason on the menu entry", () => {
    render(
      <MemoryRouter>
        <SettingsMenuColumn
          label="Einstellungen"
          groups={[
            {
              id: "server",
              label: "Server",
              entries: [
                {
                  id: "server",
                  label: "Server",
                  to: "/settings/server",
                  icon: "settings",
                  warn: { label: "Adresse fehlt" },
                },
              ],
            },
          ]}
          activeId="server"
          hiddenPages={0}
          search={null}
          levelSwitch={null}
          footer={null}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("img", { name: "Adresse fehlt" })).toBeInTheDocument();
  });
});

describe("Wartung › Zeitzonen", () => {
  it("says when the accounts for the report could not be loaded", async () => {
    api.getUsers.mockRejectedValue(httpError());
    render(<MaintenanceTimeModel />);
    expect(await screen.findByText("settingsRows:maintenance.usersLoadFailed")).toBeInTheDocument();
  });
});

describe("the instance settings copy", () => {
  it("is read again once it is older than a minute, and keeps the old copy when that fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { useInstanceStore } = await import("../instanceStore");
      api.getInstanceSettings.mockResolvedValue({
        settings: instance({ instanceName: "One" }),
        passkeyStatus: null,
      });
      await useInstanceStore.getState().ensureLoaded();
      await useInstanceStore.getState().ensureLoaded();
      expect(api.getInstanceSettings).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 61_000);
      api.getInstanceSettings.mockRejectedValueOnce(httpError());
      await useInstanceStore.getState().ensureLoaded();
      expect(api.getInstanceSettings).toHaveBeenCalledTimes(2);
      expect(useInstanceStore.getState().settings?.instanceName).toBe("One");
      expect(useInstanceStore.getState().load).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
