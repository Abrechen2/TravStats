import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { updateInstanceSettings } = vi.hoisted(() => ({ updateInstanceSettings: vi.fn() }));
vi.unmock("../../../store/settingsStore");
vi.mock("../../../lib/api", () => ({ adminApi: { updateInstanceSettings } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import OpenDataCard from "../OpenDataCard";
import { useSettingsStore } from "../../../store/settingsStore";

/** The instance's open data switch: off by default, flipped only by an admin. */
describe("OpenDataCard", () => {
  beforeEach(() => {
    updateInstanceSettings.mockReset();
    useSettingsStore.setState({ openDataEnabled: false });
  });

  it("lets an admin switch it on and takes the value the server confirmed", async () => {
    updateInstanceSettings.mockResolvedValue({ settings: { openDataEnabled: true } });
    render(<OpenDataCard isAdmin />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(useSettingsStore.getState().openDataEnabled).toBe(true));
    expect(updateInstanceSettings).toHaveBeenCalledWith({ openDataEnabled: true });
  });

  it("only tells anyone else how it stands", () => {
    render(<OpenDataCard isAdmin={false} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText(/openData:settings.stateOff/)).toBeInTheDocument();
  });

  it("says so when the save fails, and keeps the old state", async () => {
    updateInstanceSettings.mockRejectedValue(new Error("403"));
    render(<OpenDataCard isAdmin />);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("openData:settings.saveFailed");
    expect(useSettingsStore.getState().openDataEnabled).toBe(false);
  });
});
