import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PhotoPeriodAutoSetting from "../PhotoPeriodAutoSetting";

const getAutoPeriod = vi.fn();
const setAutoPeriod = vi.fn();
vi.mock("../../../lib/api/tripPhotoSources", () => ({
  tripPhotoSourcesApi: {
    getAutoPeriod: () => getAutoPeriod(),
    setAutoPeriod: (v: boolean) => setAutoPeriod(v),
  },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

describe("PhotoPeriodAutoSetting", () => {
  beforeEach(() => {
    getAutoPeriod.mockReset().mockResolvedValue(false);
    setAutoPeriod.mockReset();
  });

  it("shows the server's default (off) and saves a toggle", async () => {
    setAutoPeriod.mockResolvedValue(undefined);
    render(<PhotoPeriodAutoSetting />);
    const box = await screen.findByRole("checkbox");
    await screen.findByRole("checkbox", { checked: false });
    await userEvent.click(box);
    expect(setAutoPeriod).toHaveBeenCalledWith(true);
    expect(await screen.findByRole("checkbox", { checked: true })).toBeInTheDocument();
  });

  it("says a failed save and keeps the old state", async () => {
    setAutoPeriod.mockRejectedValue(new Error("500"));
    render(<PhotoPeriodAutoSetting />);
    await userEvent.click(await screen.findByRole("checkbox", { checked: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("periodAuto.saveFailed");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});
