import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProfileZonePrompt, {
  PROFILE_ZONE_DEFER_KEY_PREFIX,
} from "../../components/ProfileZonePrompt";
import { settingsApi } from "../../lib/api";
import { useAuthStore } from "../../store/authStore";
import { useProfileZoneStore } from "../../store/profileZoneStore";
import { useSettingsStore } from "../../store/settingsStore";

vi.unmock("../../store/settingsStore");
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../lib/api", () => ({ settingsApi: { updateProfileZone: vi.fn() } }));
vi.mock("../../shared/time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/time")>();
  return { ...actual, deviceZone: () => "America/St_Johns" };
});

function signIn(isSharedDemo = false): void {
  useAuthStore.setState({
    user: { id: "u1", username: "anna", isSharedDemo } as never,
  });
}

const prompt = (props: Partial<{ otherDialogOpen: boolean }> = {}) =>
  render(<ProfileZonePrompt sessionConfirmed otherDialogOpen={props.otherDialogOpen ?? false} />);

/**
 * Owner decision 2026-09-26 (ADR 0002 Q1): a user without a profile zone is
 * asked at the next login, with the device's zone proposed, and it is written
 * once confirmed; until then "today" is UTC, and a note says so.
 */
describe("ProfileZonePrompt", () => {
  beforeEach(() => {
    vi.mocked(settingsApi.updateProfileZone)
      .mockReset()
      .mockResolvedValue({} as never);
    useProfileZoneStore.getState().reset();
    signIn();
    window.sessionStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("asks when the server holds no zone, proposing the device's", () => {
    useProfileZoneStore.getState().noteRemote({ display: { theme: "dark" } });
    prompt();
    expect(screen.getByText("Deine Zeitzone")).toBeInTheDocument();
    expect(screen.getByLabelText("Vorschlag von deinem Gerät")).toHaveValue("America/St_Johns");
  });

  it("does not ask when the server already holds a zone", () => {
    useProfileZoneStore.getState().noteRemote({ display: { timezone: "Europe/Berlin" } });
    prompt();
    expect(screen.queryByText("Deine Zeitzone")).not.toBeInTheDocument();
  });

  it("does not ask before the settings arrived, while another dialog is up, or the shared demo", () => {
    const { unmount } = prompt();
    expect(screen.queryByText("Deine Zeitzone")).not.toBeInTheDocument();
    unmount();
    useProfileZoneStore.getState().noteRemote({ display: {} });
    const second = prompt({ otherDialogOpen: true });
    expect(screen.queryByText("Deine Zeitzone")).not.toBeInTheDocument();
    second.unmount();
    signIn(true);
    prompt();
    expect(screen.queryByText("Deine Zeitzone")).not.toBeInTheDocument();
  });

  it("writes the confirmed zone through the narrow write, then never asks again", async () => {
    useProfileZoneStore.getState().noteRemote({ display: {} });
    const { rerender } = prompt();
    fireEvent.change(screen.getByLabelText("Vorschlag von deinem Gerät"), {
      target: { value: "Asia/Tokyo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(settingsApi.updateProfileZone).toHaveBeenCalledTimes(1));
    expect(settingsApi.updateProfileZone).toHaveBeenCalledWith({
      zone: "Asia/Tokyo",
      followsDevice: false,
    });
    await waitFor(() => expect(screen.queryByText("Deine Zeitzone")).not.toBeInTheDocument());
    expect(useProfileZoneStore.getState().status).toBe("confirmed");
    expect(useSettingsStore.getState().display.timezone).toBe("Asia/Tokyo");
    rerender(<ProfileZonePrompt sessionConfirmed otherDialogOpen={false} />);
    expect(screen.queryByText("Deine Zeitzone")).not.toBeInTheDocument();
    expect(screen.queryByText(/in UTC/)).not.toBeInTheDocument();
  });

  it("the Companion's follow-the-device opt-in travels with the zone", async () => {
    useProfileZoneStore.getState().noteRemote({ display: {} });
    prompt();
    fireEvent.click(screen.getByRole("checkbox", { name: /Companion-App/ }));
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    await waitFor(() =>
      expect(settingsApi.updateProfileZone).toHaveBeenCalledWith({
        zone: "America/St_Johns",
        followsDevice: true,
      })
    );
  });

  it("believes the server's own verdict over a display value", () => {
    useProfileZoneStore.getState().noteRemote({
      display: { timezone: "Europe/Berlin" },
      profileZone: { hasProfileZone: false },
    });
    prompt();
    expect(screen.getByText("Deine Zeitzone")).toBeInTheDocument();
  });

  it("a failed write stays open and says so in German", async () => {
    vi.mocked(settingsApi.updateProfileZone).mockRejectedValue({ isAxiosError: true });
    useProfileZoneStore.getState().noteRemote({ display: {} });
    prompt();
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Server ist nicht erreichbar/);
    expect(screen.getByText("Deine Zeitzone")).toBeInTheDocument();
    expect(useProfileZoneStore.getState().status).toBe("missing");
  });

  it("'Später' puts it off for the session and leaves the UTC note, which reopens it", () => {
    useProfileZoneStore.getState().noteRemote({ display: {} });
    prompt();
    fireEvent.click(screen.getByRole("button", { name: "Später" }));
    expect(screen.queryByText("Deine Zeitzone")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("„heute“ in UTC");
    expect(window.sessionStorage.getItem(`${PROFILE_ZONE_DEFER_KEY_PREFIX}u1`)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Zeitzone jetzt festlegen" }));
    expect(screen.getByText("Deine Zeitzone")).toBeInTheDocument();
  });

  it("a deferral in this session is remembered across a remount", () => {
    window.sessionStorage.setItem(`${PROFILE_ZONE_DEFER_KEY_PREFIX}u1`, "1");
    useProfileZoneStore.getState().noteRemote({ display: {} });
    prompt();
    expect(screen.queryByText("Deine Zeitzone")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("works when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    useProfileZoneStore.getState().noteRemote({ display: {} });
    prompt();
    expect(screen.getByText("Deine Zeitzone")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Später" }));
    });
    expect(screen.queryByText("Deine Zeitzone")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
