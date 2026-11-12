import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ServerOwn from "../ServerOwn";
import { resetWriteQueue } from "../../ui/settings/writeQueue";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { admin } from "../../Services/__tests__/servicesFixtures";

vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
let internetOff = false;
vi.mock("../useInternetDependency", () => ({
  useInternetDependency: () =>
    internetOff
      ? { reason: "internet-off-reason", jump: { label: "jump", onJump: () => {} } }
      : undefined,
}));
const api = vi.hoisted(() => ({
  adminOverview: vi.fn(),
  accountOverview: vi.fn(),
  adminUpdate: vi.fn(),
}));
vi.mock("../../../lib/api/externalServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/externalServices")>()),
  externalServicesApi: api,
}));

const url = (key: string, value: string) => ({ key, kind: "url" as const, value, expert: true });
const overview = {
  categories: [
    {
      id: "mapsRoutes",
      services: [
        admin("geocoder", {
          level: "instance",
          allowAccountKeys: null,
          fields: [
            url("photonUrl", "https://photon.example"),
            url("nominatimUrl", "https://nominatim.example"),
            url("ownGeoUrl", ""),
          ],
        }),
        admin("selfHostedRouting", {
          level: "instance",
          allowAccountKeys: null,
          fields: [url("osrmUrl", ""), url("railRoutingUrl", "")],
        }),
        admin("openData", {
          level: "instance",
          allowAccountKeys: null,
          fields: [url("marketOverpassUrl", "")],
        }),
        admin("updatesTemplates", {
          level: "instance",
          allowAccountKeys: null,
          fields: [url("templateRepoUrl", "")],
        }),
        admin("fx", {
          level: "instance",
          alwaysOn: true,
          allowAccountKeys: null,
          fields: [
            {
              key: "primarySource",
              kind: "select" as const,
              value: "frankfurter",
              options: ["frankfurter", "ecb"],
              expert: true,
            },
            // Not one of the group's fields: the public fallback is the master switch's business.
            { key: "cdnFallback", kind: "switch" as const, value: true, expert: false },
          ],
        }),
      ],
    },
  ],
  accountConnections: [],
};

const show = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <ServerOwn />
      </MemoryRouter>
    );
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  internetOff = false;
  useSettingsLevelStore.setState({ level: "expert" });
  api.adminOverview.mockResolvedValue(overview);
  api.accountOverview.mockResolvedValue({
    connections: [],
    ownKeys: [],
    aiConsents: [],
    instanceProvided: [],
    blocked: [],
  });
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
  useSettingsLevelStore.setState({ level: null });
});

describe("Eigene Server (settings v3 S5)", () => {
  it("draws the five groups of the prototype in its order, from the fields of the catalogue's cards", async () => {
    await show();
    await screen.findByDisplayValue("https://photon.example");
    const groups = [...document.querySelectorAll("[data-own-group]")].map(
      (el) => (el as HTMLElement).dataset.ownGroup
    );
    expect(groups).toEqual(["places", "routes", "maps", "templates", "rates"]);
    // The public fallback is not an own server: it is not drawn here.
    expect(screen.queryByText("externalServices:fields.fx.cdnFallback")).toBeNull();
  });

  it("writes the fields of one group to the card they belong to, and only those", async () => {
    api.adminUpdate.mockResolvedValue({});
    await show();
    const photon = await screen.findByDisplayValue("https://photon.example");
    await userEvent.clear(photon);
    await userEvent.type(photon, "https://geo.home.lan/photon");
    const group = photon.closest("[data-own-group]") as HTMLElement;
    await userEvent.click(
      within(group).getByRole("button", { name: "settingsRows:services.ui.save" })
    );
    await waitFor(() =>
      expect(api.adminUpdate).toHaveBeenCalledWith("geocoder", {
        fields: { photonUrl: "https://geo.home.lan/photon" },
      })
    );
  });

  it("leaves the places and routes alone while the internet is off, and locks what still calls out", async () => {
    internetOff = true;
    await show();
    await screen.findByDisplayValue("https://photon.example");
    const locked = (id: string) =>
      (document.querySelector(`[data-own-group="${id}"]`) as HTMLElement).querySelectorAll(
        "[data-locked]"
      ).length;
    // An own geo server or routing is the infrastructure of the house: it keeps working offline.
    expect(locked("places")).toBe(0);
    expect(locked("routes")).toBe(0);
    // Overpass and the template source are calls the master switch gates.
    expect(locked("maps")).toBe(1);
    expect(locked("templates")).toBe(1);
    expect(locked("rates")).toBeGreaterThan(0);
    expect(screen.getAllByText("internet-off-reason").length).toBeGreaterThanOrEqual(3);
  });

  it("locks nothing while the internet is on", async () => {
    await show();
    await screen.findByDisplayValue("https://photon.example");
    expect(document.querySelectorAll("[data-locked]")).toHaveLength(0);
    expect(screen.queryByText("internet-off-reason")).toBeNull();
  });

  it("says the server's side could not be read, with a retry, instead of an empty page", async () => {
    api.adminOverview.mockRejectedValueOnce(new Error("down"));
    await show();
    expect(
      await screen.findByText("settingsRows:services.ui.serverLoadFailed")
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:services.ui.retry" }));
    expect(await screen.findByDisplayValue("https://photon.example")).toBeInTheDocument();
  });
});
