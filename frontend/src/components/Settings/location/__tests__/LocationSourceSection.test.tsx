import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState, type JSX } from "react";
import type { LocationProviderSettings } from "../../../../lib/api/locationProvider";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const demo = vi.hoisted(() => ({ current: false }));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.current }));
vi.mock("../../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: (key: string) => key === "travTrack" }),
}));
const { getProvider, setProvider } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  setProvider: vi.fn(),
}));
vi.mock("../../../../lib/api/locationProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/locationProvider")>()),
  locationProviderApi: { get: getProvider, set: setProvider },
}));
vi.mock("../../../../lib/api/trackGap", () => ({
  trackGapApi: {
    get: vi.fn().mockResolvedValue({ minutes: 120, default: 120, min: 5, max: 720 }),
    set: vi.fn(),
  },
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import LocationSourceSection, { DAWARICH_CONNECTION_PATH } from "../LocationSourceSection";
import DawarichProviderHint from "../../DawarichProviderHint";
import { useLocationProviderStore } from "../../../../store/locationProviderStore";
import { resetWriteQueue } from "../../../ui/settings/writeQueue";

/**
 * Standort → Quelle on the settings blocks: the choice is a write on its own
 * row; a refusal keeps it with a reason and a retry; Dawarich needs the
 * account's OWN connection (R8) and says so.
 */

const state = (over: Partial<LocationProviderSettings> = {}): LocationProviderSettings => ({
  kind: "none",
  rev: 0,
  status: "ok",
  choices: { none: true, travtrack: true, dawarich: true },
  ...over,
});
const NONE = "settings:location.source.options.none";
const TRAVTRACK = "settings:location.source.options.travtrack";
const DAWARICH = "settings:location.source.options.dawarich";
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
const show = () =>
  render(
    <MemoryRouter>
      <LocationSourceSection />
    </MemoryRouter>
  );

function apiError(status: number, code?: string): Error {
  return Object.assign(new Error(String(status)), { response: { status, data: { code } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  demo.current = false;
  useLocationProviderStore.getState().reset();
  getProvider.mockResolvedValue(state());
  setProvider.mockImplementation(async (kind) => state({ kind }));
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
});

describe("Standort → Quelle", () => {
  it("draws no 'none' nobody chose when the source cannot be loaded, and retries", async () => {
    getProvider.mockRejectedValueOnce(new Error("offline"));
    show();
    expect(await screen.findByText("settings:location.source.loadError")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    getProvider.mockResolvedValue(state());
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    expect(await screen.findByRole("radio", { name: NONE })).toBeChecked();
  });

  it("writes the choice to the provider endpoint", async () => {
    show();
    fireEvent.click(await screen.findByRole("radio", { name: TRAVTRACK }));
    await settle();
    expect(setProvider).toHaveBeenCalledWith("travtrack");
    expect(await screen.findByRole("radio", { name: TRAVTRACK })).toBeChecked();
  });

  it("keeps Dawarich unselectable without the own connection, says why and jumps to it", async () => {
    getProvider.mockResolvedValue(
      state({ choices: { none: true, travtrack: true, dawarich: false } })
    );
    show();
    expect(await screen.findByRole("radio", { name: DAWARICH })).toBeDisabled();
    expect(screen.getByText("settings:blocks.dep.noOwnDawarich.reason")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/settings:blocks\.dep\.noOwnDawarich\.jump/));
    expect(navigate.mock.calls[0][0]).toBe(DAWARICH_CONNECTION_PATH);
    expect(screen.getByText("settings:location.dawlink.notConnected")).toBeInTheDocument();
  });

  it("a refused switch keeps the choice, names the refusal and offers a retry", async () => {
    setProvider.mockRejectedValueOnce(apiError(409, "DAWARICH_NOT_CONFIGURED"));
    show();
    fireEvent.click(await screen.findByRole("radio", { name: DAWARICH }));
    await settle();
    expect(
      await screen.findByText("settings:location.source.errors.dawarichNotConfigured")
    ).toBeInTheDocument();
    // The choice stays on the row instead of snapping back to "none".
    expect(screen.getByRole("radio", { name: DAWARICH })).toBeChecked();
    fireEvent.click(screen.getAllByRole("button", { name: "settings:blocks.save.retry" })[0]);
    await waitFor(() => expect(setProvider).toHaveBeenCalledTimes(2));
  });

  it("a network failure keeps the choice and offers discard back to the saved value", async () => {
    setProvider.mockRejectedValueOnce(new Error("Network Error"));
    show();
    fireEvent.click(await screen.findByRole("radio", { name: TRAVTRACK }));
    await settle();
    expect(
      await screen.findByRole("button", { name: "settings:blocks.save.discard" })
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: TRAVTRACK })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.discard" }));
    expect(await screen.findByRole("radio", { name: NONE })).toBeChecked();
  });

  it("a stored source that stopped working stays shown as chosen, with a warning", async () => {
    getProvider.mockResolvedValue(
      state({
        kind: "dawarich",
        status: "notConfigured",
        choices: { none: true, travtrack: true, dawarich: false },
      })
    );
    show();
    expect(await screen.findByRole("radio", { name: DAWARICH })).toBeChecked();
    expect(screen.getByText("settings:location.source.status.notConfigured")).toBeInTheDocument();
  });

  it("offers TravTrack only where the server does, unless it is the stored choice", async () => {
    getProvider.mockResolvedValue(
      state({ choices: { none: true, travtrack: false, dawarich: true } })
    );
    show();
    await screen.findByRole("radio", { name: NONE });
    expect(screen.queryByRole("radio", { name: TRAVTRACK })).toBeNull();
    cleanup();
    useLocationProviderStore.getState().reset();
    getProvider.mockResolvedValue(
      state({
        kind: "travtrack",
        status: "unavailable",
        choices: { none: true, travtrack: false, dawarich: true },
      })
    );
    show();
    expect(await screen.findByRole("radio", { name: TRAVTRACK })).toBeChecked();
    expect(screen.getByText("settings:location.source.status.unavailable")).toBeInTheDocument();
  });

  it("drops the Dawarich rows once TravTrack is the chosen source", async () => {
    getProvider.mockResolvedValue(
      state({ kind: "travtrack", choices: { none: true, travtrack: true, dawarich: false } })
    );
    show();
    expect(await screen.findByRole("radio", { name: TRAVTRACK })).toBeChecked();
    expect(screen.queryByText("settings:location.dawlink.name")).toBeNull();
    expect(screen.queryByText("settings:blocks.dep.noOwnDawarich.reason")).toBeNull();
  });

  it("is locked for the demo account and asks the server nothing", async () => {
    demo.current = true;
    show();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getAllByText("settings:blocks.lock.demo").length).toBeGreaterThan(0);
    expect(getProvider).not.toHaveBeenCalled();
  });
});

/** Stands for the Dawarich row of Dienste: its save raises `check`, the hint asks again. */
function ConnectedRow({ onConnect }: { onConnect: () => void }): JSX.Element {
  const [saved, setSaved] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          onConnect();
          setSaved((n) => n + 1);
        }}
      >
        connect
      </button>
      <DawarichProviderHint check={saved} />
    </>
  );
}

describe("Standort → Quelle and the Dawarich connection on one page", () => {
  it("a connect opens Dawarich, the hint's switch shows in the row, and Keine still switches back", async () => {
    let connected = false;
    getProvider.mockImplementation(async () =>
      state({ choices: { none: true, travtrack: false, dawarich: connected } })
    );
    render(
      <MemoryRouter>
        <LocationSourceSection />
        <ConnectedRow
          onConnect={() => {
            connected = true;
          }}
        />
      </MemoryRouter>
    );
    expect(await screen.findByRole("radio", { name: DAWARICH })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "connect" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: DAWARICH })).toBeEnabled());
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:locationProvider.dawarichHint.use" })
    );
    await waitFor(() => expect(screen.getByRole("radio", { name: DAWARICH })).toBeChecked());
    fireEvent.click(screen.getByRole("radio", { name: NONE }));
    await settle();
    await waitFor(() => expect(setProvider).toHaveBeenLastCalledWith("none"));
  });
});
