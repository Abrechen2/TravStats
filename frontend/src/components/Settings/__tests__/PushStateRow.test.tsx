import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
const getPreferences = vi.fn();
vi.mock("../../../lib/api", () => ({
  notificationsApi: { getPreferences: () => getPreferences() },
}));

import PushStateRow from "../PushStateRow";

const renderRow = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <PushStateRow />
    </MemoryRouter>
  );
  await act(async () => {});
};

/** "Mitteilungen" on the phones page: the same answer the reminders page gives. */
describe("PushStateRow (Telefone)", () => {
  beforeEach(() => {
    getPreferences.mockReset();
  });
  afterEach(() => cleanup());

  it("says a phone is ready when the server can reach one", async () => {
    getPreferences.mockResolvedValue({ push: { available: true, reason: null } });
    await renderRow();
    expect(screen.getByText("settings:notifications.pushStatus.ok")).toBeInTheDocument();
    expect(screen.queryByText("settings:blocks.dep.noPush.reason")).toBeNull();
  });

  it("names the server's missing push relay as the reason, not the phone's", async () => {
    getPreferences.mockResolvedValue({ push: { available: false, reason: "no_relay" } });
    await renderRow();
    expect(screen.getByText("settings:notifications.pushStatus.no_relay")).toBeInTheDocument();
    expect(screen.getByText("settings:blocks.dep.noPush.reason")).toBeInTheDocument();
  });

  it("says nothing is paired when no phone has a notification token", async () => {
    getPreferences.mockResolvedValue({ push: { available: false, reason: "no_device_token" } });
    await renderRow();
    expect(
      screen.getByText("settings:notifications.pushStatus.no_device_token")
    ).toBeInTheDocument();
  });

  it("says the state could not be read instead of drawing 'ready'", async () => {
    getPreferences.mockImplementation(() => Promise.reject(new Error("503")));
    render(
      <MemoryRouter>
        <PushStateRow />
      </MemoryRouter>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.getByText("settings:notifications.loadError")).toBeInTheDocument();
    expect(screen.queryByText("settings:notifications.pushStatus.ok")).toBeNull();
  });

  it("reads the state again when the page regains focus, so a phone allowed meanwhile shows as ready", async () => {
    getPreferences.mockResolvedValue({ push: { available: false, reason: "no_device_token" } });
    await renderRow();
    expect(
      screen.getByText("settings:notifications.pushStatus.no_device_token")
    ).toBeInTheDocument();
    getPreferences.mockResolvedValue({ push: { available: true, reason: null } });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByText("settings:notifications.pushStatus.ok")).toBeInTheDocument();
    expect(getPreferences).toHaveBeenCalledTimes(2);
  });

  it("keeps the last answer on screen when the refresh at focus fails", async () => {
    getPreferences.mockResolvedValue({ push: { available: true, reason: null } });
    await renderRow();
    getPreferences.mockImplementation(() => Promise.reject(new Error("503")));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByText("settings:notifications.pushStatus.ok")).toBeInTheDocument();
  });
});
