import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const forgotPassword = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    setupApi: {
      getStatus: () =>
        Promise.resolve({
          setupComplete: true,
          requiresSetup: false,
          message: "",
          publicDemoLogin: false,
        }),
    },
    passkeyApi: { availability: () => Promise.resolve({ available: false }) },
    authApi: {
      ...actual.authApi,
      getSmtpStatus: () =>
        Promise.resolve({ smtpEnabled: false, adminContactEmail: "admin@example.com" }),
      getRegistrationStatus: () => Promise.resolve({ registrationEnabled: true }),
      forgotPassword: (username: string) => forgotPassword(username),
    },
  };
});

import LoginPage from "../LoginPage";

/**
 * forgejo#88, point 2 — the dialog on an instance that cannot send mail.
 *
 * Until now this branch rendered ONE sentence ("contact an administrator") and
 * no input: there was nothing to submit, so nobody could be told. The two
 * things that must hold are that the form is actually offered, and that what
 * it says afterwards is the notification promise rather than the mail one.
 */
const openDialog = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
  await userEvent.click(await screen.findByRole("button", { name: "login.forgotPassword" }));
};

describe("forgot-password dialog without mail delivery", () => {
  beforeEach(() => {
    forgotPassword.mockReset();
    forgotPassword.mockResolvedValue({ message: "ok" });
  });

  it("offers the form, and says the instance cannot send mail", async () => {
    await openDialog();

    expect(
      await screen.findByLabelText("login.forgotPasswordModal.usernameLabel")
    ).toBeInTheDocument();
    expect(screen.getByText("login.forgotPasswordModal.noSmtp")).toBeInTheDocument();
  });

  it("submits the username and then promises an administrator was told", async () => {
    await openDialog();

    await userEvent.type(
      await screen.findByLabelText("login.forgotPasswordModal.usernameLabel"),
      "lockedout"
    );
    await userEvent.click(screen.getByRole("button", { name: "login.forgotPasswordModal.submit" }));

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith("lockedout"));
    // The notification sentence, NOT the "a reset link has been sent" one —
    // no link was sent, and saying so would be a lie the user acts on.
    expect(await screen.findByText("login.forgotPasswordModal.noSmtpNotified")).toBeInTheDocument();
    expect(screen.queryByText("login.forgotPasswordModal.success")).toBeNull();
  });
});
