import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ getInstanceSettings: vi.fn(), updateInstanceSettings: vi.fn() }));
vi.mock("../../../lib/api", () => ({ adminApi: api }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import OperatorLogosCard from "../OperatorLogosCard";

/** forgejo#323: the admin switch for operator logos from Wikidata / Commons — on by default. */
describe("OperatorLogosCard", () => {
  beforeEach(() => {
    api.getInstanceSettings.mockReset();
    api.updateInstanceSettings.mockReset();
  });

  it("shows the server's state and switches it off, taking the confirmed value", async () => {
    api.getInstanceSettings.mockResolvedValue({ settings: { operatorLogosOpenDataEnabled: true } });
    api.updateInstanceSettings.mockResolvedValue({
      settings: { operatorLogosOpenDataEnabled: false },
    });
    render(<OperatorLogosCard />);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(api.updateInstanceSettings).toHaveBeenCalledWith({
      operatorLogosOpenDataEnabled: false,
    });
  });

  it("says so when the state cannot be loaded, and offers no switch to flip blindly", async () => {
    api.getInstanceSettings.mockRejectedValue(new Error("500"));
    render(<OperatorLogosCard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:operatorLogos.loadFailed");
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("says so when the save fails", async () => {
    api.getInstanceSettings.mockResolvedValue({ settings: { operatorLogosOpenDataEnabled: true } });
    api.updateInstanceSettings.mockRejectedValue(new Error("403"));
    render(<OperatorLogosCard />);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:operatorLogos.saveFailed");
  });
});
