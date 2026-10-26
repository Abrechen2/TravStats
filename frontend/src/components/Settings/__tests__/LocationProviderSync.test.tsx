import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { LocationProviderSettings } from "../../../lib/api/locationProvider";

/**
 * The "Standortquelle" section and the Dawarich connection card share one
 * page and one provider (Codex review of S2–S5, finding 1). A connect must
 * open the Dawarich radio, the card's hint switching to Dawarich must show in
 * the section, and "Keine" must then still be a change the section sends.
 *
 * The server is a small fake holding the stored provider and whether an own
 * connection exists, so both cards read the same truth through their own calls.
 */

const server = vi.hoisted(() => ({
  kind: "none" as "none" | "travtrack" | "dawarich",
  rev: 0,
  connected: false,
}));
const view = (): LocationProviderSettings => ({
  kind: server.kind,
  rev: server.rev,
  status: "ok",
  choices: { none: true, travtrack: false, dawarich: server.connected },
});

const { getProvider, setProvider } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  setProvider: vi.fn(),
}));
vi.mock("../../../lib/api/locationProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/locationProvider")>()),
  locationProviderApi: { get: getProvider, set: setProvider },
}));

const { getSettings, updateSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("../../../lib/api/dawarich", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/dawarich")>()),
  dawarichApi: { getSettings, updateSettings, testConnection: vi.fn() },
}));

import LocationProviderSection from "../LocationProviderSection";
import DawarichConnectionCard from "../DawarichConnectionCard";
import { useLocationProviderStore } from "../../../store/locationProviderStore";

const NONE = /settings:locationProvider\.options\.none\.label/;
const DAWARICH = /settings:locationProvider\.options\.dawarich\.label/;

const connection = () => ({
  baseUrl: server.connected ? "https://dawarich.lan" : null,
  hasKey: server.connected,
  source: server.connected ? ("user" as const) : null,
  isShared: false,
  hasAccess: server.connected,
});

beforeEach(() => {
  vi.clearAllMocks();
  useLocationProviderStore.getState().reset();
  Object.assign(server, { kind: "none", rev: 0, connected: false });
  getProvider.mockImplementation(async () => view());
  setProvider.mockImplementation(async (kind: "none" | "dawarich") => {
    if (server.kind !== kind) Object.assign(server, { kind, rev: server.rev + 1 });
    return view();
  });
  getSettings.mockImplementation(async () => connection());
  updateSettings.mockImplementation(async () => {
    server.connected = true;
    return connection();
  });
});

const page = () =>
  render(
    <MemoryRouter>
      <LocationProviderSection />
      <DawarichConnectionCard />
    </MemoryRouter>
  );

describe("Standortquelle and the Dawarich connection on one page", () => {
  it("a connect opens Dawarich, the hint's switch shows in the section, and Keine still switches back", async () => {
    const user = userEvent.setup();
    page();
    expect(await screen.findByRole("radio", { name: DAWARICH })).toBeDisabled();

    await user.type(
      screen.getByLabelText("trips:tours.dawarichSettings.baseUrl"),
      "https://dawarich.lan"
    );
    await user.type(screen.getByLabelText("trips:tours.dawarichSettings.apiKey"), "key");
    await user.click(screen.getByRole("button", { name: "trips:tours.dawarichSettings.save" }));

    await waitFor(() => expect(screen.getByRole("radio", { name: DAWARICH })).toBeEnabled());

    await user.click(
      await screen.findByRole("button", { name: "settings:locationProvider.dawarichHint.use" })
    );
    await waitFor(() => expect(screen.getByRole("radio", { name: DAWARICH })).toBeChecked());
    expect(screen.getByRole("radio", { name: NONE })).not.toBeChecked();

    await user.click(screen.getByRole("radio", { name: NONE }));
    await waitFor(() => expect(setProvider).toHaveBeenLastCalledWith("none"));
    await waitFor(() => expect(screen.getByRole("radio", { name: NONE })).toBeChecked());
  });
});
