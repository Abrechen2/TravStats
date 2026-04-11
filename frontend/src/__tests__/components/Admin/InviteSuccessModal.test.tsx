import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InviteSuccessModal from "../../../components/Admin/InviteSuccessModal";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

describe("InviteSuccessModal", () => {
  it("renders the URL and a copy button for link-only mode", () => {
    render(
      <InviteSuccessModal
        inviteUrl="http://localhost:3000/register?token=abc"
        emailSent={undefined}
        emailError={null}
        recipientEmail={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/abc/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copyLink/i })).toBeInTheDocument();
  });

  it("shows email-sent line when emailSent is true", () => {
    render(
      <InviteSuccessModal
        inviteUrl="http://…/register?token=abc"
        emailSent={true}
        emailError={null}
        recipientEmail="jane@example.com"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/emailSent/i)).toBeInTheDocument();
    expect(screen.getByText(/jane@example.com/)).toBeInTheDocument();
  });

  it("shows amber warning when emailSent is false", () => {
    render(
      <InviteSuccessModal
        inviteUrl="http://…/register?token=abc"
        emailSent={false}
        emailError="SMTP auth failed"
        recipientEmail="jane@example.com"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/emailFailed/i)).toBeInTheDocument();
    expect(screen.getByText(/SMTP auth failed/)).toBeInTheDocument();
  });

  it("fires onClose when Done is clicked", async () => {
    const onClose = vi.fn();
    render(
      <InviteSuccessModal
        inviteUrl="http://…/register?token=abc"
        emailSent={undefined}
        emailError={null}
        recipientEmail={null}
        onClose={onClose}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
