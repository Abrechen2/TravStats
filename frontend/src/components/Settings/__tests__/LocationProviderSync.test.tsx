import { useState } from "react";
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

import LocationProviderSection from "../LocationProviderSection";
import DawarichProviderHint from "../DawarichProviderHint";
import { useLocationProviderStore } from "../../../store/locationProviderStore";

const NONE = /settings:locationProvider\.options\.none\.label/;
const DAWARICH = /settings:locationProvider\.options\.dawarich\.label/;

beforeEach(() => {
  vi.clearAllMocks();
  useLocationProviderStore.getState().reset();
  Object.assign(server, { kind: "none", rev: 0, connected: false });
  getProvider.mockImplementation(async () => view());
  setProvider.mockImplementation(async (kind: "none" | "dawarich") => {
    if (server.kind !== kind) Object.assign(server, { kind, rev: server.rev + 1 });
    return view();
  });
});

/** Stands for the Dawarich row of Dienste: its save raises `check`, the hint asks again. */
function ConnectedRow(): JSX.Element {
  const [saved, setSaved] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          server.connected = true;
          setSaved((n) => n + 1);
        }}
      >
        connect
      </button>
      <DawarichProviderHint check={saved} />
    </>
  );
}

const page = () =>
  render(
    <MemoryRouter>
      <LocationProviderSection />
      <ConnectedRow />
    </MemoryRouter>
  );

describe("Standortquelle and the Dawarich connection on one page", () => {
  it("a connect opens Dawarich, the hint's switch shows in the section, and Keine still switches back", async () => {
    const user = userEvent.setup();
    page();
    expect(await screen.findByRole("radio", { name: DAWARICH })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "connect" }));
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
