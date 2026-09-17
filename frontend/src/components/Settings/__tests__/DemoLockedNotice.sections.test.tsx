import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Both sections fetch on mount through real API modules; the frontend test
// setup fails any request that escapes a mock (forgejo#110), so both modules
// each section actually imports must be mocked here — copied from
// ApiTokensSection.test.tsx and PasskeySection.test.tsx.
const tokensApi = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
const passkeyApiMock = vi.hoisted(() => ({
  availability: vi.fn(),
  list: vi.fn(),
  registerOptions: vi.fn(),
  registerVerify: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));
// A mutable box rather than a plain boolean: the mock factory below closes
// over it once, at module-mock time, so flipping `.current` per test is the
// only way to change what useIsDemoAccount() returns between cases.
const isDemoMock = vi.hoisted(() => ({ current: true }));

const notificationsApiMock = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock("../../../lib/api/tokens", () => ({ apiTokensApi: tokensApi }));
vi.mock("../../../lib/api", () => ({
  passkeyApi: passkeyApiMock,
  notificationsApi: notificationsApiMock,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({
  useIsDemoAccount: () => isDemoMock.current,
}));

import ApiTokensSection from "../ApiTokensSection";
import PasskeySection from "../PasskeySection";
import NotificationsSection from "../NotificationsSection";
import ProfileSection from "../ProfileSection";

// Each case's locked control: the button the section offers a normal
// account, and which the demo account must never see.
const CASES = [
  ["ApiTokensSection", ApiTokensSection, "settings:apiTokens.create"],
  ["PasskeySection", PasskeySection, "settings:passkeys.add"],
] as const;

// The server refuses these for the shared demo account (403
// DEMO_ACCOUNT_FORBIDDEN). Offering the button anyway would be a button that
// always fails; the section says why instead.
describe("settings sections on the demo account", () => {
  beforeEach(() => {
    isDemoMock.current = true;
    tokensApi.list.mockReset().mockResolvedValue([]);
    tokensApi.create.mockReset();
    tokensApi.revoke.mockReset();
    passkeyApiMock.availability.mockReset().mockResolvedValue({ available: true, reason: null });
    passkeyApiMock.list.mockReset().mockResolvedValue([]);
    passkeyApiMock.registerOptions.mockReset();
    passkeyApiMock.registerVerify.mockReset();
    passkeyApiMock.remove.mockReset();
    notificationsApiMock.getPreferences.mockReset().mockResolvedValue({
      notificationEmail: null,
      notifyBefore24h: false,
      notifyBefore2h: false,
    });
    notificationsApiMock.updatePreferences.mockReset();
  });

  it.each(CASES)(
    "%s explains instead of offering the action",
    async (_name, Section, controlName) => {
      render(
        <MemoryRouter>
          <Section />
        </MemoryRouter>
      );
      expect(await screen.findByText("settings:demoLocked")).toBeInTheDocument();
      // The notice and the control are mutually exclusive branches — a
      // regression rendering both would still pass on the assertion above
      // alone, so the control's absence is checked explicitly too.
      expect(screen.queryByRole("button", { name: controlName })).not.toBeInTheDocument();
    }
  );

  // Proves the test cannot pass vacuously (e.g. from a wrong/renamed control
  // key): for a normal account the control IS offered and the notice is NOT.
  it.each(CASES)(
    "%s offers the action instead of the notice for a normal account",
    async (_name, Section, controlName) => {
      isDemoMock.current = false;
      render(
        <MemoryRouter>
          <Section />
        </MemoryRouter>
      );
      expect(await screen.findByRole("button", { name: controlName })).toBeInTheDocument();
      expect(screen.queryByText("settings:demoLocked")).not.toBeInTheDocument();
    }
  );
});

/**
 * The notification address is not a preference on this account: whoever writes
 * it can ask /auth/forgot-password for a reset link to their own inbox and
 * lock every other visitor out (finding C3). The server refuses the write, so
 * the section says so instead of offering a field that silently fails.
 */
describe("NotificationsSection on the demo account", () => {
  beforeEach(() => {
    isDemoMock.current = true;
    notificationsApiMock.getPreferences.mockReset().mockResolvedValue({
      notificationEmail: null,
      notifyBefore24h: false,
      notifyBefore2h: false,
    });
    notificationsApiMock.updatePreferences.mockReset();
  });

  it("explains instead of offering the address field", async () => {
    render(<NotificationsSection />);
    expect(await screen.findByText("settings:demoLocked")).toBeInTheDocument();
    expect(screen.queryByLabelText("settings:notifications.email")).not.toBeInTheDocument();
    // Not merely hidden: the section must not fetch the shared account's
    // address either.
    expect(notificationsApiMock.getPreferences).not.toHaveBeenCalled();
  });

  it("offers the field for a normal account — the case above is not vacuous", async () => {
    isDemoMock.current = false;
    render(<NotificationsSection />);
    expect(await screen.findByLabelText("settings:notifications.email")).toBeInTheDocument();
    expect(screen.queryByText("settings:demoLocked")).not.toBeInTheDocument();
  });
});

/**
 * Finding I1: the name and the birthdate were left editable while the picture
 * was locked. The name greets every visitor from the header, the birthdate
 * drives an achievement, and both survived the nightly reseed.
 */
describe("ProfileSection on the demo account", () => {
  const profile = {
    username: "demo",
    email: "",
    firstName: null,
    lastName: null,
    birthdate: null,
  };
  const renderProfile = (): void => {
    render(
      <ProfileSection
        profile={profile}
        uploadingProfilePicture={false}
        removingProfilePicture={false}
        onAvatarUpload={() => {}}
        onAvatarDelete={() => {}}
        onSetProfile={() => {}}
      />
    );
  };

  it("explains instead of offering the name and birthdate fields", () => {
    isDemoMock.current = true;
    renderProfile();
    expect(screen.getByText("settings:demoLocked")).toBeInTheDocument();
    expect(screen.queryByLabelText("settings:profile.firstName")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("settings:profile.lastName")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("settings:profile.birthdate")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("settings:profile.email")).not.toBeInTheDocument();
    // The username is read-only for everybody and stays visible: a visitor
    // still needs to see which account they are looking at.
    expect(screen.getByLabelText("settings:profile.username")).toBeInTheDocument();
  });

  it("offers them for a normal account — the case above is not vacuous", () => {
    isDemoMock.current = false;
    renderProfile();
    expect(screen.getByLabelText("settings:profile.firstName")).toBeInTheDocument();
    expect(screen.getByLabelText("settings:profile.birthdate")).toBeInTheDocument();
    expect(screen.queryByText("settings:demoLocked")).not.toBeInTheDocument();
  });
});
