import type React from "react";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const demo = vi.hoisted(() => ({ value: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.value }));

import { generalSettingsWereSaved, useSettingsStore } from "../../../store/settingsStore";
import { useRemoteSettingsStatus } from "../../../store/remoteSettingsStatus";
import ProfileSection from "../ProfileSection";

/**
 * Profil: every field is found by the name beside it (AUD-026), the account name
 * is shown and not offered for editing (AUD-025), and the group saves with a
 * button: a refused save keeps what was typed and says so instead of snapping back.
 */
const PROFILE = {
  username: "dennis",
  email: "d@example.com",
  firstName: "Dennis",
  lastName: "Wittke",
  birthdate: "1980-01-01",
};
const save = vi.fn();
const setProfile = vi.fn();

function renderSection(): void {
  const props = {
    profile: PROFILE,
    uploadingProfilePicture: false,
    removingProfilePicture: false,
    onAvatarUpload: vi.fn(),
    onAvatarDelete: vi.fn(),
  };
  render(<ProfileSection {...(props as unknown as React.ComponentProps<typeof ProfileSection>)} />);
}

beforeEach(() => {
  demo.value = false;
  Object.assign(useSettingsStore.getState(), {
    setProfile,
    saveRemoteSettings: save,
    profile: { ...PROFILE },
  });
});
afterEach(() => {
  cleanup();
  save.mockReset();
  setProfile.mockReset();
});

describe("ProfileSection", () => {
  it.each([
    "settings:profile.firstName",
    "settings:profile.lastName",
    "settings:profile.email",
    "settings:profile.birthdate",
  ])("finds the %s field by its visible label", (label) => {
    renderSection();
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("shows the account name without offering to change it", () => {
    renderSection();
    expect(screen.getByText("@dennis")).toBeTruthy();
    expect(screen.queryByLabelText("settings:profile.username")).not.toBeInTheDocument();
  });

  it("writes nothing until the user saves, then writes the group once", async () => {
    save.mockResolvedValue(undefined);
    renderSection();
    fireEvent.change(screen.getByLabelText("settings:profile.firstName"), {
      target: { value: "Denis" },
    });
    expect(screen.getByText("settings:blocks.save.unsaved")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings:profile.save" }));
    });
    expect(setProfile).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Denis" }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a refused save keeps the typed value, says it was not saved and restores the store", async () => {
    save.mockRejectedValue(Object.assign(new Error("500"), { response: { status: 500 } }));
    renderSection();
    const first = screen.getByLabelText("settings:profile.firstName") as HTMLInputElement;
    fireEvent.change(first, { target: { value: "Denis" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings:profile.save" }));
    });
    expect(first.value).toBe("Denis");
    expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    expect(setProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ firstName: "Dennis", email: "d@example.com" })
    );
  });

  it("when only the birthday write was refused, the other fields stay saved in the store", async () => {
    const partial = new Error("birthdate refused");
    const store = await import("../../../store/settingsStore");
    const spy = vi
      .spyOn(store, "generalSettingsWereSaved")
      .mockImplementation((e) => e === partial);
    save.mockRejectedValue(partial);
    try {
      renderSection();
      fireEvent.change(screen.getByLabelText("settings:profile.firstName"), {
        target: { value: "Denis" },
      });
      fireEvent.change(screen.getByLabelText("settings:profile.birthdate"), {
        target: { value: "1981-02-03" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "settings:profile.save" }));
      });
      expect(setProfile).toHaveBeenLastCalledWith({ birthdate: "1980-01-01" });
      expect(generalSettingsWereSaved).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses to save an e-mail that is not one, and says why", async () => {
    renderSection();
    fireEvent.change(screen.getByLabelText("settings:profile.email"), {
      target: { value: "not-an-address" },
    });
    expect(screen.getByText("settings:profile.emailBad")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings:profile.save" }));
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("locks the fields in the demo account, with the reason, and offers no save", () => {
    demo.value = true;
    renderSection();
    expect(screen.getByLabelText("settings:profile.firstName")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "settings:profile.save" })).not.toBeInTheDocument();
  });

  it("writes nothing while the settings never loaded, and says why", async () => {
    useRemoteSettingsStatus.setState({ failed: true });
    try {
      renderSection();
      fireEvent.change(screen.getByLabelText("settings:profile.firstName"), {
        target: { value: "Denis" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "settings:profile.save" }));
      });
      expect(setProfile).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("settings:blocks.save.failed");
    } finally {
      useRemoteSettingsStatus.setState({ failed: false });
    }
  });

  it("when the general save was refused but the birthday write went through, the birthday stays", async () => {
    const refused = new Error("general refused");
    const store = await import("../../../store/settingsStore");
    const spy = vi.spyOn(store, "birthdateWasSaved").mockImplementation((e) => e === refused);
    save.mockRejectedValue(refused);
    try {
      renderSection();
      fireEvent.change(screen.getByLabelText("settings:profile.birthdate"), {
        target: { value: "1981-02-03" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "settings:profile.save" }));
      });
      expect(setProfile).toHaveBeenLastCalledWith(
        expect.objectContaining({ birthdate: "1981-02-03", firstName: "Dennis" })
      );
    } finally {
      spy.mockRestore();
    }
  });
});
