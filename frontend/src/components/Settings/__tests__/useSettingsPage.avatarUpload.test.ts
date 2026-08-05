import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ChangeEvent } from "react";

const mocks = vi.hoisted(() => ({
  uploadProfilePicture: vi.fn(),
  deleteProfilePicture: vi.fn(),
  getSettings: vi.fn(),
  getApiKeys: vi.fn(),
  getProfile: vi.fn(),
  setProfile: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  settingsApi: {
    uploadProfilePicture: mocks.uploadProfilePicture,
    deleteProfilePicture: mocks.deleteProfilePicture,
    get: mocks.getSettings,
    getApiKeys: mocks.getApiKeys,
    getProfile: mocks.getProfile,
  },
  authApi: {},
  backupApi: { list: vi.fn(), getStatus: vi.fn() },
}));

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" }, ready: true }),
}));

vi.mock("../../../store/settingsStore", () => ({
  // The hook subscribes to `snapshotOf` as its auto-save dependency (#198).
  snapshotOf: () => "",
  useSettingsStore: () => ({
    profile: { username: "u", email: "e@example.com" },
    display: {},
    units: {},
    defaults: {},
    cruise: {},
    setProfile: mocks.setProfile,
    setDisplay: vi.fn(),
    setUnits: vi.fn(),
    setDefaults: vi.fn(),
    setCruise: vi.fn(),
    saveRemoteSettings: vi.fn().mockResolvedValue(undefined),
    hasPendingChanges: () => false,
  }),
}));

import { useSettingsPage } from "../useSettingsPage";

describe("useSettingsPage.handleAvatarUpload (#186)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getProfile.mockResolvedValue({ birthdate: null });
    mocks.getApiKeys.mockResolvedValue({
      airlabs: { hasKey: false, isShared: false, hasAccess: false },
      aviationstack: { hasKey: false, isShared: false, hasAccess: false },
      aerodatabox: { hasKey: false, isShared: false, hasAccess: false },
      opensky: { hasKey: false, isShared: false, hasAccess: false },
    });
  });

  function makeEvent(file: File): ChangeEvent<HTMLInputElement> {
    return {
      target: { files: [file], value: "" },
    } as unknown as ChangeEvent<HTMLInputElement>;
  }

  it("does not fall back to a blob: URL when the upload fails", async () => {
    mocks.uploadProfilePicture.mockRejectedValue(new Error("network error"));
    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://localhost/fake");

    const { result } = renderHook(() => useSettingsPage());
    const file = new File(["fake image bytes"], "avatar.png", { type: "image/png" });

    await act(async () => {
      await result.current.handleAvatarUpload(makeEvent(file));
    });

    expect(createObjectURLSpy).not.toHaveBeenCalled();
    expect(mocks.setProfile).not.toHaveBeenCalledWith(
      expect.objectContaining({ profilePicture: expect.stringMatching(/^blob:/) })
    );

    createObjectURLSpy.mockRestore();
  });

  it("sets the returned URL on a successful upload", async () => {
    mocks.uploadProfilePicture.mockResolvedValue({
      profilePictureUrl: "/api/v1/settings/profile-picture/abc.png",
    });

    const { result } = renderHook(() => useSettingsPage());
    const file = new File(["fake image bytes"], "avatar.png", { type: "image/png" });

    await act(async () => {
      await result.current.handleAvatarUpload(makeEvent(file));
    });

    expect(mocks.setProfile).toHaveBeenCalledWith({
      profilePicture: "/api/v1/settings/profile-picture/abc.png",
    });
  });

  it("clears the stored URL after a successful delete", async () => {
    mocks.deleteProfilePicture.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSettingsPage());
    await act(async () => {
      await result.current.handleAvatarDelete();
    });

    expect(mocks.deleteProfilePicture).toHaveBeenCalledTimes(1);
    // `undefined`, not `null` — an omitted key can never re-fail the general
    // PUT's profilePicture URL validation on the next auto-save.
    expect(mocks.setProfile).toHaveBeenCalledWith({ profilePicture: undefined });
  });

  it("keeps the current avatar when the delete request fails", async () => {
    mocks.deleteProfilePicture.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useSettingsPage());
    await act(async () => {
      await result.current.handleAvatarDelete();
    });

    expect(mocks.setProfile).not.toHaveBeenCalled();
  });
});
