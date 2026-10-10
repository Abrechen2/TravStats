import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PhotoJourneyNightlyScanCard from "../PhotoJourneyNightlyScanCard";
import { photoJourneysApi, type PhotoJourneyNightlySettings } from "../../../lib/api/photoJourneys";

/**
 * forgejo#94, point 1: the nightly-scan opt-in had a route and no web surface,
 * so the scan was off for everybody. Pinned: the card reads and writes the
 * opt-in, says when it runs and how far back, says when no library is
 * connected, reports the last run (including a failure, by its Immich reason),
 * and a failed load or save says so instead of showing a switch that lies.
 */
vi.mock("../../../lib/api/photoJourneys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/photoJourneys")>();
  return {
    ...actual,
    photoJourneysApi: { getNightlySettings: vi.fn(), setNightlyScan: vi.fn() },
  };
});
const demo = vi.hoisted(() => ({ value: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.value }));
// Keys and their arguments, so a test can see WHICH reason a sentence carries.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "de" },
  }),
}));

const K = "immich:nightlyScan";

function settings(over: Partial<PhotoJourneyNightlySettings> = {}): PhotoJourneyNightlySettings {
  return {
    nightlyScan: false,
    immichConnected: true,
    windowDays: 400,
    nextRunAt: "2026-10-11T04:55:00.000Z",
    lastRun: null,
    ...over,
  };
}

describe("PhotoJourneyNightlyScanCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demo.value = false;
  });

  it("says what the switch does, and turns the scan on through its route", async () => {
    vi.mocked(photoJourneysApi.getNightlySettings).mockResolvedValue(settings());
    vi.mocked(photoJourneysApi.setNightlyScan).mockResolvedValue(settings({ nightlyScan: true }));
    render(<PhotoJourneyNightlyScanCard />);

    const toggle = await screen.findByRole("switch", { name: `${K}.switch` });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(new RegExp(`${K}.what.*"days":400`))).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(`${K}.lastRun.never`);

    await userEvent.click(toggle);
    await waitFor(() => expect(photoJourneysApi.setNightlyScan).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
  });

  it("says plainly that nothing will run without an Immich connection", async () => {
    vi.mocked(photoJourneysApi.getNightlySettings).mockResolvedValue(
      settings({ nightlyScan: true, immichConnected: false })
    );
    render(<PhotoJourneyNightlyScanCard />);
    expect(await screen.findByRole("note")).toHaveTextContent(`${K}.notConnected`);
  });

  it("reports a failed last run with the library's own reason", async () => {
    vi.mocked(photoJourneysApi.getNightlySettings).mockResolvedValue(
      settings({
        nightlyScan: true,
        lastRun: {
          ranAt: "2026-10-10T04:55:00.000Z",
          result: "failed",
          created: null,
          failure: "unreachable",
        },
      })
    );
    render(<PhotoJourneyNightlyScanCard />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(`${K}.lastRun.failed`);
    expect(status).toHaveTextContent("immich:errors.unreachable");
  });

  it("reports a successful last run with what it found", async () => {
    vi.mocked(photoJourneysApi.getNightlySettings).mockResolvedValue(
      settings({
        nightlyScan: true,
        lastRun: {
          ranAt: "2026-10-10T04:55:00.000Z",
          result: "scanned",
          created: 5,
          failure: null,
        },
      })
    );
    render(<PhotoJourneyNightlyScanCard />);
    expect(await screen.findByRole("status")).toHaveTextContent(/lastRun\.scanned.*"count":5/);
  });

  it("draws no switch when the setting could not be loaded, and offers a retry", async () => {
    vi.mocked(photoJourneysApi.getNightlySettings)
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce(settings({ nightlyScan: true }));
    render(<PhotoJourneyNightlyScanCard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(`${K}.loadFailed`);
    expect(screen.queryByRole("switch")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: `${K}.retry` }));
    expect(await screen.findByRole("switch")).toBeChecked();
  });

  it("keeps the stored value and says so when saving fails", async () => {
    vi.mocked(photoJourneysApi.getNightlySettings).mockResolvedValue(settings());
    vi.mocked(photoJourneysApi.setNightlyScan).mockRejectedValue(new Error("Network Error"));
    render(<PhotoJourneyNightlyScanCard />);

    await userEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(`${K}.saveFailedOff`);
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("locks the switch for the shared demo account but still shows what it would do", async () => {
    demo.value = true;
    vi.mocked(photoJourneysApi.getNightlySettings).mockResolvedValue(
      settings({ immichConnected: false })
    );
    render(<PhotoJourneyNightlyScanCard />);
    expect(await screen.findByText("settings:demoLocked")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText(`${K}.notConnected`)).toBeInTheDocument();
  });
});
