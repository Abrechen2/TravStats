import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import PasswordResetRequestsSection from "../PasswordResetRequestsSection";
import { adminApi } from "../../../lib/api/admin";
import { useAuthStore } from "../../../store/authStore";

/**
 * forgejo#88, point 2 — the inbox block that tells an administrator somebody is
 * locked out.
 *
 * Two of these cases are about something that fails SILENTLY if it is wrong:
 *
 * - **A non-admin must not even ask.** The endpoint answers 403, so a leak
 *   would show as nothing on screen and an error in a log nobody reads — which
 *   is indistinguishable from the correct behaviour until the day the guard
 *   moves. The test asserts the CALL was never made, not just that the block
 *   is absent.
 * - **The row must link at the user.** `/admin` without `?user=` opens a table
 *   with no search box; the admin then hunts for the name by eye, which is the
 *   thing the button exists to avoid.
 */

vi.mock("../../../lib/api/admin", () => ({
  adminApi: {
    getPasswordResetRequests: vi.fn(),
    markPasswordResetRequestHandled: vi.fn(),
  },
}));

const REQUEST = {
  id: "req-1",
  userId: "user-7",
  username: "lockedout",
  requestedAt: new Date().toISOString(),
};

const signIn = (isAdmin: boolean): void => {
  useAuthStore.setState({ user: { id: "me", username: "me", isAdmin } });
};

const renderSection = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <PasswordResetRequestsSection />
    </MemoryRouter>
  );

describe("PasswordResetRequestsSection", () => {
  beforeEach(() => {
    vi.mocked(adminApi.getPasswordResetRequests).mockReset();
    vi.mocked(adminApi.markPasswordResetRequestHandled).mockReset();
    vi.mocked(adminApi.getPasswordResetRequests).mockResolvedValue({
      requests: [REQUEST],
      count: 1,
    });
    vi.mocked(adminApi.markPasswordResetRequestHandled).mockResolvedValue({
      id: REQUEST.id,
      handledAt: new Date().toISOString(),
    });
  });

  it("names the user who asked", async () => {
    signIn(true);
    renderSection();

    expect(
      await screen.findByText(/dataQuality:passwordResets\.row/, { exact: false })
    ).toBeInTheDocument();
  });

  it("asks nothing at all when the viewer is not an admin", async () => {
    signIn(false);
    const { container } = renderSection();

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(adminApi.getPasswordResetRequests).not.toHaveBeenCalled();
  });

  it("renders nothing when there is no open request — an empty heading is noise", async () => {
    signIn(true);
    vi.mocked(adminApi.getPasswordResetRequests).mockResolvedValue({ requests: [], count: 0 });

    const { container } = renderSection();

    await waitFor(() => expect(adminApi.getPasswordResetRequests).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("links into user management AT that user", async () => {
    signIn(true);
    renderSection();

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/admin?tab=general&section=users&user=user-7");
  });

  it("drops the row once it is marked handled", async () => {
    signIn(true);
    renderSection();

    await userEvent.click(
      await screen.findByRole("button", { name: "dataQuality:passwordResets.markHandled" })
    );

    await waitFor(() =>
      expect(adminApi.markPasswordResetRequestHandled).toHaveBeenCalledWith("req-1")
    );
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
  });

  it("stays away when the list cannot be read, rather than shouting at the user", async () => {
    signIn(true);
    vi.mocked(adminApi.getPasswordResetRequests).mockRejectedValue(new Error("403"));

    const { container } = renderSection();

    await waitFor(() => expect(adminApi.getPasswordResetRequests).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
