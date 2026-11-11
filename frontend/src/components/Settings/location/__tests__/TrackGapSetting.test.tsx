import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count ? `${k}:${o.count}` : k),
  }),
}));
const { getGap, setGap } = vi.hoisted(() => ({ getGap: vi.fn(), setGap: vi.fn() }));
vi.mock("../../../../lib/api/trackGap", () => ({ trackGapApi: { get: getGap, set: setGap } }));

import TrackGapSetting from "../TrackGapSetting";
import { SettingRows } from "../../../ui/SettingRow";
import { resetWriteQueue } from "../../../ui/settings/writeQueue";

describe("TrackGapSetting", () => {
  beforeEach(() => {
    resetWriteQueue();
    getGap.mockReset();
    setGap.mockReset();
  });
  afterEach(cleanup);

  it("shows the stored gap, including one outside the presets", async () => {
    getGap.mockResolvedValue({ minutes: 45, default: 120, min: 5, max: 720 });
    render(
      <SettingRows>
        <TrackGapSetting />
      </SettingRows>
    );
    await waitFor(() =>
      expect(screen.getAllByText(/location\.trackGap\.option:45/).length).toBeGreaterThan(0)
    );
  });

  it("a failed load draws no value nobody chose and says so", async () => {
    getGap.mockRejectedValue(new Error("offline"));
    render(
      <SettingRows>
        <TrackGapSetting />
      </SettingRows>
    );
    await waitFor(() =>
      expect(screen.getByText("settings:location.trackGap.loadError")).toBeTruthy()
    );
    expect(screen.queryByText(/location\.trackGap\.option/)).toBeNull();
  });

  it("a locked (demo) row never asks the server", () => {
    render(
      <SettingRows>
        <TrackGapSetting locked={{ why: "demo", reason: "demo" }} />
      </SettingRows>
    );
    expect(getGap).not.toHaveBeenCalled();
  });
});
