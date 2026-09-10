import type React from "react";

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ProfileSection from "../ProfileSection";

/**
 * Every field in this form can be found by the name shown beside it.
 *
 * Five inputs — username, first name, last name, e-mail and birthday — each had
 * a `<label>` next to them and nothing tying the two together: no `htmlFor`, no
 * wrapping label, no `aria-label`. Sighted mouse users never noticed; a screen
 * reader could not name the fields, and clicking the label text did not focus
 * anything (audit finding AUD-026).
 *
 * `getByLabelText` is the assertion on purpose: it fails exactly when the
 * association is missing, which a query by position or class would not.
 */
function renderSection(overrides: Record<string, unknown> = {}) {
  const props = {
    profile: {
      username: "dennis",
      email: "d@example.com",
      firstName: "Dennis",
      lastName: "Wittke",
      birthdate: "1980-01-01",
    },
    savingProfile: false,
    uploadingProfilePicture: false,
    removingProfilePicture: false,
    onSaveProfile: vi.fn(),
    onAvatarUpload: vi.fn(),
    onAvatarDelete: vi.fn(),
    onSetProfile: vi.fn(),
    onShowPasswordModal: vi.fn(),
    ...overrides,
  };
  const rendered = render(
    <ProfileSection {...(props as unknown as React.ComponentProps<typeof ProfileSection>)} />
  );
  return { props, ...rendered };
}

describe("ProfileSection labels", () => {
  it.each([
    "settings:profile.username",
    "settings:profile.firstName",
    "settings:profile.lastName",
    "settings:profile.email",
    "settings:profile.birthdate",
  ])("finds the %s field by its visible label", (label) => {
    renderSection();
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  // AUD-025: the field was editable and "Save profile" sent it, but the account
  // name lives in a column nothing here writes — the next load put the old name
  // straight back. Showing it is honest; offering to edit it was not.
  it("shows the account name without offering to change it", () => {
    const { props } = renderSection();
    const input = screen.getByLabelText("settings:profile.username") as HTMLInputElement;

    expect(input.readOnly).toBe(true);
    expect(input.value).toBe("dennis");
    expect(props.onSetProfile).not.toHaveBeenCalled();
    // And it says why, rather than leaving a dead field to be puzzled over.
    expect(screen.getByText("settings:profile.usernameHint")).toBeTruthy();
  });
});
