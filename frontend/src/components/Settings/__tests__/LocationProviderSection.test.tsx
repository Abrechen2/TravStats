import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { LocationProviderSettings } from "../../../lib/api/locationProvider";

const { getProvider, setProvider } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  setProvider: vi.fn(),
}));

// The error-key mapping stays real: a refusal is checked against the copy it
// actually resolves to, not against a stub.
vi.mock("../../../lib/api/locationProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/locationProvider")>()),
  locationProviderApi: { get: getProvider, set: setProvider },
}));

const isDemo = vi.hoisted(() => ({ current: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => isDemo.current }));

const beta = vi.hoisted(() => ({ open: true }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: beta.open,
    isFeatureVisible: (key: string) => beta.open && key === "travTrack",
  }),
}));

import LocationProviderSection from "../LocationProviderSection";
import { useLocationProviderStore } from "../../../store/locationProviderStore";

/**
 * Settings → Standort (TravTrack plan, task S5): choose where recordings go
 * and positions are read from. A refused choice says why and keeps the old
 * one; a provider that stopped working says so instead of looking like none.
 */

const state = (over: Partial<LocationProviderSettings> = {}): LocationProviderSettings => ({
  kind: "none",
  rev: 0,
  status: "ok",
  choices: { none: true, travtrack: false, dawarich: true },
  ...over,
});

const NONE = "settings:locationProvider.options.none.label";
const DAWARICH = "settings:locationProvider.options.dawarich.label";
const TRAVTRACK = "settings:locationProvider.options.travtrack.label";

const show = () =>
  render(
    <MemoryRouter>
      <LocationProviderSection />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  isDemo.current = false;
  beta.open = true;
  useLocationProviderStore.getState().reset();
  getProvider.mockResolvedValue(state());
});

describe("LocationProviderSection", () => {
  it("renders the stored choice", async () => {
    getProvider.mockResolvedValue(state({ kind: "dawarich", rev: 1 }));
    show();
    expect(await screen.findByRole("radio", { name: new RegExp(DAWARICH) })).toBeChecked();
    expect(screen.getByRole("radio", { name: new RegExp(NONE) })).not.toBeChecked();
    expect(screen.getByText("settings:locationProvider.nothingMoves")).toBeInTheDocument();
    expect(
      screen.getByText("settings:locationProvider.options.dawarich.points.readOnly")
    ).toBeInTheDocument();
  });

  it("PUTs the picked choice and shows what the server stored", async () => {
    setProvider.mockResolvedValue(state({ kind: "dawarich", rev: 1 }));
    show();
    const dawarich = await screen.findByRole("radio", { name: new RegExp(DAWARICH) });
    await userEvent.click(dawarich);

    expect(setProvider).toHaveBeenCalledWith("dawarich");
    await waitFor(() => expect(dawarich).toBeChecked());
  });

  it("a 409 DAWARICH_NOT_CONFIGURED shows its mapped copy and keeps the old choice selected", async () => {
    setProvider.mockRejectedValue({
      response: {
        status: 409,
        data: { error: "Dawarich needs your own connection", code: "DAWARICH_NOT_CONFIGURED" },
      },
    });
    show();
    await userEvent.click(await screen.findByRole("radio", { name: new RegExp(DAWARICH) }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings:locationProvider.errors.dawarichNotConfigured"
    );
    expect(screen.queryByText(/Dawarich needs your own connection/)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: new RegExp(NONE) })).toBeChecked();
    expect(screen.getByRole("radio", { name: new RegExp(DAWARICH) })).not.toBeChecked();
  });

  it("has no TravTrack card while choices.travtrack is false", async () => {
    show();
    await screen.findByRole("radio", { name: new RegExp(NONE) });
    expect(screen.queryByRole("radio", { name: new RegExp(TRAVTRACK) })).not.toBeInTheDocument();
  });

  it("shows the TravTrack card when this server offers it", async () => {
    getProvider.mockResolvedValue(
      state({ choices: { none: true, travtrack: true, dawarich: false } })
    );
    show();
    expect(await screen.findByRole("radio", { name: new RegExp(TRAVTRACK) })).toBeEnabled();
  });

  it("the TravTrack card needs the beta key as well as choices.travtrack", async () => {
    beta.open = false;
    getProvider.mockResolvedValue(
      state({ choices: { none: true, travtrack: true, dawarich: false } })
    );
    show();
    await screen.findByRole("radio", { name: new RegExp(NONE) });
    expect(screen.queryByRole("radio", { name: new RegExp(TRAVTRACK) })).not.toBeInTheDocument();
  });

  it("keeps the stored TravTrack choice visible with its warning while the beta key is closed", async () => {
    beta.open = false;
    getProvider.mockResolvedValue(
      state({
        kind: "travtrack",
        status: "unavailable",
        choices: { none: true, travtrack: false, dawarich: false },
      })
    );
    show();
    expect(await screen.findByRole("radio", { name: new RegExp(TRAVTRACK) })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "settings:locationProvider.status.unavailable"
    );
  });

  it("disables Dawarich without an own connection and links to the connection card", async () => {
    getProvider.mockResolvedValue(
      state({ choices: { none: true, travtrack: false, dawarich: false } })
    );
    show();
    expect(await screen.findByRole("radio", { name: new RegExp(DAWARICH) })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "settings:locationProvider.connectDawarich" })
    ).toHaveAttribute("href", "/settings/location?section=dawarich");
  });

  it("warns when the chosen Dawarich is no longer configured, instead of showing none", async () => {
    getProvider.mockResolvedValue(
      state({
        kind: "dawarich",
        rev: 2,
        status: "notConfigured",
        choices: { none: true, travtrack: false, dawarich: false },
      })
    );
    show();
    expect(await screen.findByRole("radio", { name: new RegExp(DAWARICH) })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "settings:locationProvider.status.notConfigured"
    );
  });

  it("says when the setting cannot be loaded, and offers no choice it cannot know", async () => {
    getProvider.mockRejectedValue(new Error("network"));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings:locationProvider.loadError"
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("shows the shared demo account the demo-locked notice instead of choices", async () => {
    isDemo.current = true;
    show();
    expect(await screen.findByText("settings:demoLocked")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(getProvider).not.toHaveBeenCalled();
  });
});
