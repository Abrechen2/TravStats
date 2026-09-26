import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  updateApiKeys: vi.fn(),
  testApiKey: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({
  settingsApi: api,
  adminApi: { testApiKey: vi.fn() },
}));
vi.mock("../../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import PersonalRoutingKeysSection from "../PersonalRoutingKeysSection";
import de from "../../../i18n/resources/de/settings.json";
import en from "../../../i18n/resources/en/settings.json";

/**
 * Alex, Discord 2026-09-26: the personal settings page offered the routing
 * card with "wird als globaler Schlüssel für alle genutzt, solange niemand
 * einen eigenen hinterlegt" — the INSTANCE's key, worded for everybody, on a
 * page that is yours, with no way anywhere to store "einen eigenen". The key
 * resolves user → instance → environment (`apiKeyResolver.getApiKey`); the
 * personal page now holds the user's own key, the instance card moved to
 * Administration → Externe Dienste.
 */
const status = (own: boolean, shared: boolean) => ({
  hasKey: own,
  isShared: shared,
  hasAccess: own || shared,
});
const ALL = {
  airlabs: status(false, false),
  aviationstack: status(false, false),
  aerodatabox: status(false, false),
  opensky: status(false, false),
  openrouteservice: status(false, false),
  graphhopper: status(true, false),
};

describe("PersonalRoutingKeysSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getApiKeys.mockResolvedValue(ALL);
  });

  it("says the key is the reader's own and the instance's only stands in for it", () => {
    for (const copy of [de.routingPersonal, en.routingPersonal]) {
      expect(copy.description).not.toMatch(/für alle|for everyone|global/i);
      expect(copy.openrouteservice.description).toMatch(/dein Konto|your account/i);
    }
    // The instance card, now on the admin page, says whose key it is.
    expect(de.routing.openrouteservice.description).toMatch(/Schlüssel der Instanz/);
    expect(en.routing.openrouteservice.description).toMatch(/instance's key/);
  });

  it("saves only the key the reader typed, never the other routing key or a flight key", async () => {
    api.updateApiKeys.mockResolvedValue({ message: "ok" });
    const user = userEvent.setup();
    render(<PersonalRoutingKeysSection />);

    await screen.findByText("settings:routingPersonal.openrouteservice.label");
    const editButtons = screen.getAllByRole("button", { name: "common:buttons.edit" });
    await user.click(editButtons[0]);
    await user.type(
      screen.getByLabelText("settings:routingPersonal.openrouteservice.label"),
      "my-ors-key"
    );
    await user.click(screen.getByTestId("routing-personal-save"));

    await waitFor(() =>
      expect(api.updateApiKeys).toHaveBeenCalledWith({ openrouteserviceApiKey: "my-ors-key" })
    );
    expect(await screen.findByRole("status")).toHaveTextContent("settings:routingPersonal.saved");
  });

  it("removes the reader's own key as an explicit null", async () => {
    api.updateApiKeys.mockResolvedValue({ message: "ok" });
    const user = userEvent.setup();
    render(<PersonalRoutingKeysSection />);

    await screen.findByText("settings:routingPersonal.graphhopper.label");
    // Only a key the reader actually has can be removed.
    expect(screen.queryByTestId("routing-personal-remove-openrouteservice")).toBeNull();
    await user.click(screen.getByTestId("routing-personal-remove-graphhopper"));
    expect(
      screen.getByText("settings:routingPersonal.graphhopper.removePending")
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("routing-personal-save"));

    await waitFor(() =>
      expect(api.updateApiKeys).toHaveBeenCalledWith({ graphhopperApiKey: null })
    );
  });

  it("says a failed save in words, not the server's text", async () => {
    api.updateApiKeys.mockRejectedValue({
      response: { status: 500, data: { error: "Internal server error" } },
      message: "Request failed with status code 500",
    });
    const user = userEvent.setup();
    render(<PersonalRoutingKeysSection />);

    await screen.findByText("settings:routingPersonal.openrouteservice.label");
    await user.click(screen.getAllByRole("button", { name: "common:buttons.edit" })[0]);
    await user.type(screen.getByLabelText("settings:routingPersonal.openrouteservice.label"), "k");
    await user.click(screen.getByTestId("routing-personal-save"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("settings:routingPersonal.saveError");
    expect(alert).not.toHaveTextContent(/Request failed|Internal server error/);
  });

  it("shows an instance key as shared, with nothing for the reader to enter", async () => {
    api.getApiKeys.mockResolvedValue({ ...ALL, openrouteservice: status(false, true) });
    const user = userEvent.setup();
    render(<PersonalRoutingKeysSection />);
    await screen.findByText("settings:routingPersonal.openrouteservice.label");
    expect(screen.getAllByText("settings:apiKeys.shared").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "common:buttons.edit" })[0]);
    expect(screen.getByLabelText("settings:routingPersonal.openrouteservice.label")).toBeDisabled();
  });

  it("offers no form when its keys could not be loaded", async () => {
    api.getApiKeys.mockRejectedValue(new Error("offline"));
    render(<PersonalRoutingKeysSection />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("settings:routingPersonal.loadError")).toBeInTheDocument();
    expect(screen.queryByTestId("routing-personal-save")).toBeNull();
  });
});
