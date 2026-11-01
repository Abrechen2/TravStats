import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { StayScanState } from "../../../../lib/api/dawarichStays";
import { JobFailedError, JobLostError } from "../../../../lib/api/jobs";

// `t` echoes the key and its arguments, so a reason handed to a block is visible.
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));
const demo = vi.hoisted(() => ({ current: false }));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.current }));
const expert = vi.hoisted(() => ({ current: false }));
vi.mock("../../frame/useExpertRows", () => ({ useExpertRows: () => expert.current }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { state: vi.fn(), enable: vi.fn(), scan: vi.fn() },
}));

import StayScanSection from "../StayScanSection";
import { dawarichStaysApi } from "../../../../lib/api/dawarichStays";
import { resetWriteQueue } from "../../../ui/settings/writeQueue";

const api = vi.mocked(dawarichStaysApi);
const base: StayScanState = {
  enabled: true,
  connected: true,
  placesEnabled: true,
  pausedReason: null,
  nextScanAt: "2026-11-01T18:15:00.000Z",
  result: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  dataThrough: null,
  windowStart: null,
  windowEnd: null,
  pointCount: 0,
  createdCount: 0,
};
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
const show = (props: { onScanned?: () => void } = {}) =>
  render(
    <MemoryRouter>
      <StayScanSection {...props} />
    </MemoryRouter>
  );
const apiError = (status: number, code?: string): Error =>
  Object.assign(new Error(String(status)), { response: { status, data: { code } } });
const scanButton = () => screen.findByRole("button", { name: "settings:location.stay.now.label" });

beforeEach(() => {
  vi.clearAllMocks();
  demo.current = false;
  expert.current = false;
  api.state.mockResolvedValue(base);
  api.enable.mockResolvedValue();
  api.scan.mockResolvedValue();
});
afterEach(() => {
  cleanup();
  act(() => resetWriteQueue());
});

describe("Standort → Aufenthalte finden", () => {
  it("the switch is the consent: it writes enable and nothing else", async () => {
    api.state.mockResolvedValue({ ...base, enabled: false, pausedReason: "disabled" });
    show();
    fireEvent.click(await screen.findByRole("switch"));
    await settle();
    expect(api.enable).toHaveBeenCalledWith(true);
  });

  it("a refused consent keeps the choice, names why and retries on the row", async () => {
    api.state.mockResolvedValue({ ...base, enabled: false, pausedReason: "disabled" });
    api.enable.mockRejectedValueOnce(apiError(409, "DAWARICH_PLACES_DISABLED"));
    show();
    fireEvent.click(await screen.findByRole("switch"));
    await settle();
    expect(await screen.findByText("settings:location.stay.errors.placesOff")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getAllByRole("button", { name: "settings:blocks.save.retry" })[0]);
    await waitFor(() => expect(api.enable).toHaveBeenCalledTimes(2));
  });

  it("cannot be switched on without a readable source, and says where to get one", async () => {
    api.state.mockResolvedValue({
      ...base,
      enabled: false,
      connected: false,
      pausedReason: "disabled",
    });
    show();
    const toggle = await screen.findByRole("switch");
    expect(toggle).toBeDisabled();
    expect(
      screen.getAllByText(/settings:location\.stay\.pause\.connectionMissing/).length
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText(/settings:blocks\.dep\.noOwnDawarich\.jump/)[0]);
    expect(navigate.mock.calls[0][0]).toContain("service=dawarich");
  });

  it("names TravTrack off as the pause reason of a TravTrack account", async () => {
    api.state.mockResolvedValue({
      ...base,
      source: "travtrack",
      connected: false,
      pausedReason: "travTrackDisabled",
    });
    show();
    expect(
      (await screen.findAllByText("settings:location.stay.pause.travTrackDisabled")).length
    ).toBeGreaterThan(0);
    // A scan that is already on stays switchable off while it is paused.
    expect(screen.getByRole("switch")).toBeEnabled();
    expect(screen.getByRole("button", { name: "settings:location.stay.now.label" })).toBeDisabled();
  });

  it.each([
    ["suggestionsDisabled", "/settings/trips"],
    ["placesDisabled", "/settings/domains"],
  ] as const)("a scan paused by %s says so and jumps to where it is lifted", async (reason, to) => {
    api.state.mockResolvedValue({ ...base, pausedReason: reason });
    show();
    expect((await screen.findAllByText(`settings:location.stay.pause.${reason}`)).length).toBe(2);
    fireEvent.click(screen.getAllByText(/›/)[0]);
    expect(navigate.mock.calls[0][0]).toBe(to);
  });

  it("a switched-off scan explains the locked button", async () => {
    api.state.mockResolvedValue({ ...base, enabled: false, pausedReason: "disabled" });
    show();
    expect(await screen.findByText("settings:location.stay.pause.disabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:location.stay.now.label" })).toBeDisabled();
  });

  it("runs 'Jetzt suchen' as a job with the chosen period and reports the result", async () => {
    expert.current = true;
    const onScanned = vi.fn();
    api.state.mockResolvedValueOnce(base).mockResolvedValue({
      ...base,
      result: "succeeded",
      finishedAt: "2026-11-01T10:00:00.000Z",
      createdCount: 3,
      pointCount: 120,
      dataThrough: new Date().toISOString(),
    });
    show({ onScanned });
    fireEvent.click(await screen.findByRole("radio", { name: /"count":30/ }));
    fireEvent.click(await scanButton());
    await waitFor(() => expect(api.scan).toHaveBeenCalledWith(30, expect.anything()));
    await waitFor(() => expect(onScanned).toHaveBeenCalled());
    expect(await screen.findByText(/settings:location\.stay\.result\.done/)).toBeInTheDocument();
  });

  it("keeps the period (an expert row) out of the standard level", async () => {
    show();
    await scanButton();
    expect(screen.queryByLabelText("settings:location.stay.period.name")).toBeNull();
  });

  it("a rate-limited scan says so and offers a retry", async () => {
    api.scan.mockRejectedValueOnce(apiError(429));
    show();
    fireEvent.click(await scanButton());
    expect(
      await screen.findByText(/settings:location\.stay\.errors\.rateLimited/)
    ).toBeInTheDocument();
    api.scan.mockResolvedValueOnce();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.job.retry" }));
    await waitFor(() => expect(api.scan).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["DAWARICH_SCAN_UNAVAILABLE", 409, "unavailable"],
    ["DAWARICH_OWN_CONNECTION_REQUIRED", 409, "ownConnection"],
    ["TRAVTRACK_DISABLED", 403, "travTrackOff"],
  ])("a refused scan (%s) has its own sentence", async (code, status, key) => {
    api.scan.mockRejectedValueOnce(apiError(status, code));
    show();
    fireEvent.click(await scanButton());
    expect(
      await screen.findByText(new RegExp(`settings:location\\.stay\\.errors\\.${key}`))
    ).toBeInTheDocument();
  });

  it("a server that does not answer is not a silent success", async () => {
    api.scan.mockRejectedValueOnce(new Error("Network Error"));
    show();
    fireEvent.click(await scanButton());
    expect(await screen.findByText(/settings:location\.stay\.errors\.offline/)).toBeInTheDocument();
  });

  it("a scan that fails on Dawarich's side names Dawarich's reason", async () => {
    api.scan.mockRejectedValueOnce(new JobFailedError("DAWARICH_AUTH", 502));
    api.state.mockResolvedValue({ ...base, result: "failed", error: "auth" });
    show();
    fireEvent.click(await scanButton());
    expect(
      await screen.findByText(/trips:tours\.tracks\.dawarich\.errors\.auth/)
    ).toBeInTheDocument();
  });

  it("when the server restarted mid-scan it says it does not know, and checks on request", async () => {
    api.scan.mockRejectedValueOnce(new JobLostError());
    show();
    fireEvent.click(await scanButton());
    expect(await screen.findByText("settings:blocks.job.unknown")).toBeInTheDocument();
    const calls = api.state.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.job.check" }));
    await waitFor(() => expect(api.state.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(screen.queryByText("settings:blocks.job.unknown")).toBeNull());
  });

  it("an interrupted or failed earlier scan is a failure with a retry, not a quiet blank", async () => {
    api.state.mockResolvedValue({ ...base, result: "interrupted" });
    show();
    expect(
      await screen.findByText(/settings:location\.stay\.result\.interrupted/)
    ).toBeInTheDocument();
    cleanup();
    api.state.mockResolvedValue({ ...base, result: "failed", error: "unreachable" });
    show();
    expect(
      await screen.findByText(/trips:tours\.tracks\.dawarich\.errors\.unreachable/)
    ).toBeInTheDocument();
  });

  it("a scan that is running on the server shows as running and locks the button", async () => {
    api.state.mockResolvedValue({ ...base, result: "running" });
    show();
    expect(await screen.findByText(/settings:location\.stay\.result\.running/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:location.stay.now.busy" })).toBeDisabled();
  });

  it("says the data is stale and when a scan found no points", async () => {
    api.state.mockResolvedValue({
      ...base,
      result: "succeeded",
      finishedAt: "2026-10-20T10:00:00.000Z",
      dataThrough: "2026-10-20T09:00:00.000Z",
    });
    show();
    expect(await screen.findByText("settings:location.stay.stale")).toBeInTheDocument();
    cleanup();
    api.state.mockResolvedValue({
      ...base,
      result: "succeeded",
      finishedAt: "2026-10-20T10:00:00.000Z",
      dataThrough: null,
    });
    show();
    expect(await screen.findByText("settings:location.stay.noPoints")).toBeInTheDocument();
  });

  it("does not hide a state it could not load, and loads again on request", async () => {
    api.state.mockRejectedValueOnce(new Error("offline"));
    show();
    expect(await screen.findByText(/settings:location\.stay\.loadError/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "settings:blocks.save.retry" }));
    await waitFor(() =>
      expect(screen.queryByText(/settings:location\.stay\.loadError/)).toBeNull()
    );
  });

  it("is locked for the demo account", async () => {
    demo.current = true;
    show();
    expect(await screen.findByRole("switch")).toBeDisabled();
    expect(screen.getByRole("button", { name: "settings:location.stay.now.label" })).toBeDisabled();
  });
});
