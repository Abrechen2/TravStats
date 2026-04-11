import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InvitationManagement, { Invitation } from "../../../components/Admin/InvitationManagement";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

const BASE_INVITE: Invitation = {
  id: "inv-1",
  email: null,
  token: "abcdef0123456789",
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  usedAt: null,
  createdAt: new Date().toISOString(),
  emailStatus: null,
  emailError: null,
  emailSentAt: null,
  creator: { username: "admin" },
  user: null,
};

describe("InvitationManagement", () => {
  const noop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Copy + Revoke buttons for an active link invitation", () => {
    render(
      <InvitationManagement
        invitations={[BASE_INVITE]}
        statusFilter="active"
        onStatusFilterChange={noop}
        onCreateLink={noop}
        onCreateEmail={noop}
        onCopyLink={noop}
        onResendEmail={noop}
        onRevoke={noop}
      />
    );

    expect(screen.getByRole("button", { name: /actions\.copyLink/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /actions\.revoke/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actions\.sendEmail/i })).not.toBeInTheDocument();
  });

  it("shows Resend button for an active invitation with email", () => {
    render(
      <InvitationManagement
        invitations={[
          {
            ...BASE_INVITE,
            email: "jane@example.com",
            emailStatus: "failed",
            emailError: "SMTP down",
          },
        ]}
        statusFilter="active"
        onStatusFilterChange={noop}
        onCreateLink={noop}
        onCreateEmail={noop}
        onCopyLink={noop}
        onResendEmail={noop}
        onRevoke={noop}
      />
    );

    expect(screen.getByRole("button", { name: /actions\.resendEmail/i })).toBeInTheDocument();
  });

  it("fires onRevoke when revoke button clicked", () => {
    const onRevoke = vi.fn();
    render(
      <InvitationManagement
        invitations={[BASE_INVITE]}
        statusFilter="active"
        onStatusFilterChange={noop}
        onCreateLink={noop}
        onCreateEmail={noop}
        onCopyLink={noop}
        onResendEmail={noop}
        onRevoke={onRevoke}
      />
    );

    const originalConfirm = window.confirm;
    window.confirm = vi.fn(() => true);
    fireEvent.click(screen.getByRole("button", { name: /actions\.revoke/i }));
    expect(onRevoke).toHaveBeenCalledWith(BASE_INVITE.id);
    window.confirm = originalConfirm;
  });

  it("renders used-by username for a consumed invitation", () => {
    render(
      <InvitationManagement
        invitations={[
          {
            ...BASE_INVITE,
            usedAt: new Date().toISOString(),
            user: { username: "jane_doe" },
          },
        ]}
        statusFilter="used"
        onStatusFilterChange={noop}
        onCreateLink={noop}
        onCreateEmail={noop}
        onCopyLink={noop}
        onResendEmail={noop}
        onRevoke={noop}
      />
    );

    expect(screen.getByText(/jane_doe/)).toBeInTheDocument();
  });
});
