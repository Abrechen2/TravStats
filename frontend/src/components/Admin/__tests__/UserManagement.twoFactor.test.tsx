import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UserManagement from "../UserManagement";
import type { AdminUser } from "../SystemInfo";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "admin-1" } }),
}));
vi.mock("../AdminPasswordResetModal", () => ({ default: () => null }));

const user = (overrides: Partial<AdminUser>): AdminUser => ({
  id: "u1",
  username: "alex",
  isAdmin: false,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  twoFactorEnabledAt: null,
  _count: { flights: 0, userAchievements: 0 },
  ...overrides,
});

const noop = (): void => {};

describe("UserManagement — reset 2FA", () => {
  const onResetTwoFactor = vi.fn();

  beforeEach(() => {
    onResetTwoFactor.mockReset();
  });

  const renderWith = (u: AdminUser): ReturnType<typeof render> =>
    render(
      <UserManagement
        users={[u]}
        onToggleUserActive={noop}
        onDeleteUser={noop}
        onResetTwoFactor={onResetTwoFactor}
      />
    );

  // The action's presence IS the 2FA indicator — offering it for an account
  // without 2FA would suggest a state that does not exist.
  it("offers no reset action while 2FA is off", () => {
    renderWith(user({ twoFactorEnabledAt: null }));
    expect(screen.queryByText("admin:users.actions.resetTwoFactor")).toBeNull();
  });

  it("offers the action when 2FA is on, and asks before acting", () => {
    renderWith(user({ twoFactorEnabledAt: "2026-08-09T12:00:00.000Z" }));

    fireEvent.click(screen.getByText("admin:users.actions.resetTwoFactor"));
    // Confirm dialog open, nothing has happened yet.
    expect(onResetTwoFactor).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("admin:users.resetTwoFactorConfirm.confirm"));
    expect(onResetTwoFactor).toHaveBeenCalledWith("u1");
  });

  it("does nothing when the dialog is cancelled", () => {
    renderWith(user({ twoFactorEnabledAt: "2026-08-09T12:00:00.000Z" }));

    fireEvent.click(screen.getByText("admin:users.actions.resetTwoFactor"));
    fireEvent.click(screen.getByText("common:buttons.cancel"));
    expect(onResetTwoFactor).not.toHaveBeenCalled();
  });
});
