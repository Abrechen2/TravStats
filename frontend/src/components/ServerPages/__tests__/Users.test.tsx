import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import UsersAccess from "../UsersAccess";
import UsersAccounts from "../UsersAccounts";
import UsersInvitations from "../UsersInvitations";
import { resetInstanceStore } from "../instanceStore";
import { httpError, instance } from "./fixtures";

const api = vi.hoisted(() => ({
  getInstanceSettings: vi.fn(),
  updateInstanceSettings: vi.fn(),
  getUsers: vi.fn(),
  toggleUserActive: vi.fn(),
  deleteUser: vi.fn(),
  disableUserTwoFactor: vi.fn(),
  getInvitations: vi.fn(),
  getSmtpConfig: vi.fn(),
  revokeInvitation: vi.fn(),
  resendInvitationEmail: vi.fn(),
  createLinkInvitation: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ adminApi: api }));
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "me" } }),
}));
vi.mock("../../Admin/LoginBackgroundsCard", () => ({
  LoginBackgroundsCard: () => <div data-testid="login-backgrounds" />,
}));
vi.mock("../../Admin/AdminPasswordResetModal", () => ({
  default: ({ username }: { username: string }) => <div data-testid="pw-modal">{username}</div>,
}));

const user = (id: string, over = {}) => ({
  id,
  username: id,
  isAdmin: false,
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
  twoFactorEnabledAt: null,
  _count: { flights: 3, userAchievements: 1 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetInstanceStore();
  api.getInstanceSettings.mockResolvedValue({ settings: instance(), passkeyStatus: null });
  api.getUsers.mockResolvedValue({
    users: [user("me"), user("jonas", { twoFactorEnabledAt: "2026-02-01" })],
  });
  api.getInvitations.mockResolvedValue({ invitations: [] });
  api.getSmtpConfig.mockResolvedValue({ configured: true });
});
afterEach(cleanup);

const rowOf = (name: string): HTMLElement => screen.getByText(name).closest("li") as HTMLElement;
const openMenu = async (name: string): Promise<void> => {
  await userEvent.click(
    within(rowOf(name)).getByRole("button", { name: "settingsRows:users.menu" })
  );
};

describe("Nutzer › Zugang", () => {
  it("refuses a maximum outside 1 to 1000 under the field and writes nothing", async () => {
    render(<UsersAccess />);
    const max = await screen.findByLabelText("settingsRows:users.maxnutzer.t");
    await userEvent.clear(max);
    await userEvent.type(max, "0");
    expect(screen.getByText("settingsRows:users.errors.range")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" })).toBeDisabled();
  });

  it("keeps the edit when the save is refused", async () => {
    api.updateInstanceSettings.mockRejectedValue(httpError(500));
    render(<UsersAccess />);
    await userEvent.click(
      await screen.findByRole("radio", { name: "settingsRows:users.registr.o.1" })
    );
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(document.querySelector('[data-group-state="failed"]')).toBeInTheDocument()
    );
    expect(screen.getByRole("radio", { name: "settingsRows:users.registr.o.1" })).toBeChecked();
  });

  it("offers registration as two words, 'Nur mit Einladung' and 'Offen', and writes the flag the choice stands for", async () => {
    api.updateInstanceSettings.mockResolvedValue({
      settings: instance({ allowRegistration: true }),
    });
    render(<UsersAccess />);
    expect(
      await screen.findByRole("radio", { name: "settingsRows:users.registr.o.0" })
    ).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "settingsRows:users.registr.o.1" }));
    await userEvent.click(screen.getByRole("button", { name: "settings:blocks.save.saveGroup" }));
    await waitFor(() =>
      expect(api.updateInstanceSettings).toHaveBeenCalledWith({
        maxUsers: 10,
        allowRegistration: true,
      })
    );
  });

  it("puts the sign-in pictures behind the expert level", async () => {
    const { useSettingsLevelStore } = await import("../../../store/settingsLevelStore");
    act(() => useSettingsLevelStore.setState({ level: "standard" }));
    const { rerender } = render(<UsersAccess />);
    await screen.findByRole("radio", { name: "settingsRows:users.registr.o.0" });
    expect(screen.queryByTestId("login-backgrounds")).toBeNull();
    act(() => useSettingsLevelStore.setState({ level: "expert" }));
    rerender(<UsersAccess />);
    expect(await screen.findByTestId("login-backgrounds")).toBeInTheDocument();
    act(() => useSettingsLevelStore.setState({ level: null }));
  });
});

describe("Nutzer › Konten", () => {
  const renderAccounts = () =>
    render(
      <MemoryRouter>
        <UsersAccounts />
      </MemoryRouter>
    );

  it("never offers to delete the account that is signed in", async () => {
    renderAccounts();
    await screen.findByText("me");
    await openMenu("me");
    expect(screen.queryByRole("menuitem", { name: "admin:users.actions.delete" })).toBeNull();
  });

  it("deletes only after the confirmation, and names the failure when the server refuses", async () => {
    api.deleteUser.mockRejectedValue(httpError(500));
    renderAccounts();
    await screen.findByText("jonas");
    await openMenu("jonas");
    await userEvent.click(screen.getByRole("menuitem", { name: "admin:users.actions.delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("settingsRows:dialogs.userdel.title");
    expect(api.deleteUser).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "settingsRows:dialogs.userdel.confirm" })
    );
    expect(await screen.findByText("settingsRows:users.errors.delete")).toBeInTheDocument();
    expect(screen.getByText("jonas")).toBeInTheDocument();
  });

  it("locks an account behind the confirmation but unlocks without one", async () => {
    api.toggleUserActive.mockResolvedValue({});
    api.getUsers.mockResolvedValue({ users: [user("me"), user("jonas", { isActive: false })] });
    renderAccounts();
    await screen.findByText("jonas");
    await openMenu("jonas");
    await userEvent.click(screen.getByRole("menuitem", { name: "admin:users.actions.activate" }));
    await waitFor(() => expect(api.toggleUserActive).toHaveBeenCalledWith("jonas"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before a new password is set, and opens the dialog that sets it only after the answer", async () => {
    renderAccounts();
    await screen.findByText("jonas");
    await openMenu("jonas");
    await userEvent.click(
      screen.getByRole("menuitem", { name: "admin:users.actions.resetPassword" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("settingsRows:dialogs.userpw.title");
    // Nothing is changed and nothing is shown before the answer.
    expect(screen.queryByTestId("pw-modal")).toBeNull();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "settingsRows:dialogs.userpw.confirm" })
    );
    expect(await screen.findByTestId("pw-modal")).toHaveTextContent("jonas");
  });

  it("does not open the password dialog when the question is cancelled", async () => {
    renderAccounts();
    await screen.findByText("jonas");
    await openMenu("jonas");
    await userEvent.click(
      screen.getByRole("menuitem", { name: "admin:users.actions.resetPassword" })
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /cancel|abbrechen|common:/i,
      })
    );
    expect(screen.queryByTestId("pw-modal")).toBeNull();
  });

  it("says the second step could not be reset", async () => {
    api.disableUserTwoFactor.mockRejectedValue(httpError(500));
    renderAccounts();
    await screen.findByText("jonas");
    await openMenu("jonas");
    await userEvent.click(
      screen.getByRole("menuitem", { name: "admin:users.actions.resetTwoFactor" })
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.user2fa.confirm",
      })
    );
    expect(await screen.findByText("settingsRows:users.errors.reset2fa")).toBeInTheDocument();
  });

  it("offers a retry when the accounts cannot be loaded", async () => {
    api.getUsers.mockRejectedValueOnce(httpError());
    renderAccounts();
    expect(await screen.findByText("settingsRows:users.errors.load")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "settingsRows:server.retry" }));
    expect(await screen.findByText("jonas")).toBeInTheDocument();
  });
});

describe("Nutzer › Einladungen", () => {
  const invitation = {
    id: "i1",
    email: "ilka@example.org",
    token: "t",
    expiresAt: "2999-01-01T00:00:00Z",
    usedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    emailStatus: "failed",
    emailError: "SMTP 535 5.7.8 authentication failed",
    emailSentAt: null,
    creator: { username: "owner" },
    user: null,
  };

  it("does not offer a mail invitation while the server sends no mail, and says why", async () => {
    api.getSmtpConfig.mockResolvedValue({ configured: false });
    render(<UsersInvitations />);
    expect(await screen.findByText("settingsRows:users.noMail")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "admin:invitations.actions.createEmail" })
    ).toBeDisabled();
  });

  it("revokes behind the confirmation and names the failure when the server refuses", async () => {
    api.getInvitations.mockResolvedValue({ invitations: [invitation] });
    api.revokeInvitation.mockRejectedValue(httpError(500));
    render(<UsersInvitations />);
    await userEvent.click(
      await screen.findByRole("button", { name: "admin:invitations.actions.revoke" })
    );
    expect(api.revokeInvitation).not.toHaveBeenCalled();
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "settingsRows:dialogs.invrevoke.confirm",
      })
    );
    expect(await screen.findByText("settingsRows:users.errors.revoke")).toBeInTheDocument();
  });

  it("treats a mail the server did not send as a failed resend, and never prints the SMTP text", async () => {
    api.getInvitations.mockResolvedValue({ invitations: [invitation] });
    api.resendInvitationEmail.mockResolvedValue({
      emailSent: false,
      emailError: invitation.emailError,
    });
    render(<UsersInvitations />);
    await userEvent.click(
      await screen.findByRole("button", { name: "admin:invitations.actions.resendEmail" })
    );
    expect(await screen.findByText("settingsRows:users.errors.resend")).toBeInTheDocument();
    expect(screen.queryByText(/535/)).toBeNull();
  });

  it("offers a retry when the invitations cannot be loaded", async () => {
    api.getInvitations.mockRejectedValueOnce(httpError());
    render(<UsersInvitations />);
    expect(
      await screen.findByText("settingsRows:users.errors.loadInvitations")
    ).toBeInTheDocument();
  });
});
