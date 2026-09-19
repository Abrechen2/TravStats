import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("../../../lib/api/tokens", () => ({ apiTokensApi: api }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ApiTokensSection from "../ApiTokensSection";
import { useAuthStore } from "../../../store/authStore";

/** The signed-in account the section reads its rights from. */
const signIn = (isAdmin: boolean): void => {
  useAuthStore.setState({
    user: { id: "u1", username: isAdmin ? "root" : "demo", isAdmin },
  } as Parameters<typeof useAuthStore.setState>[0]);
};

const TOKEN = {
  id: "t1",
  label: "Home Assistant",
  prefix: "tsk_ab12",
  scope: "read",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-09-01T00:00:00Z",
};

describe("ApiTokensSection", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.list.mockResolvedValue([TOKEN]);
    signIn(true);
  });

  it("lists each token as a row with its scope and a revoke action", async () => {
    render(<ApiTokensSection />);
    expect(await screen.findByText("Home Assistant")).toBeInTheDocument();
    expect(screen.getByText("settings:apiTokens.scopesShort.read")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "settings:apiTokens.revokeButton" })
    ).toBeInTheDocument();
  });

  it("keeps the create form folded until asked for, and folds it again after creating", async () => {
    api.create.mockResolvedValue({ ...TOKEN, id: "t2", plaintext: "tsk_secret" });
    render(<ApiTokensSection />);
    await screen.findByText("Home Assistant");

    expect(screen.queryByLabelText("settings:apiTokens.newLabel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings:apiTokens.create" }));

    fireEvent.change(screen.getByLabelText("settings:apiTokens.newLabel"), {
      target: { value: "Script" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "settings:apiTokens.scopes.write" }));
    fireEvent.click(screen.getByRole("button", { name: "settings:apiTokens.create" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({ label: "Script", scope: "write" })
    );
    await waitFor(() => expect(screen.queryByLabelText("settings:apiTokens.newLabel")).toBeNull());
    expect(await screen.findByText("tsk_secret")).toBeInTheDocument();
  });

  /**
   * forgejo#88 finding 10.
   *
   * The dialog offered "Admin — voller Zugriff" to every account. The backend
   * was never fooled: `requireAdmin` refuses the request whatever the token
   * says, because the OWNING USER is not an admin. So this was not a hole — it
   * was worse in a quieter way. A reader minted an admin token, watched every
   * admin call answer 403, and had nothing telling them whether the token, the
   * scope or the endpoint was at fault.
   */
  it("offers no admin scope to an account that could never use one", async () => {
    signIn(false);
    render(<ApiTokensSection />);
    await screen.findByText("Home Assistant");
    fireEvent.click(screen.getByRole("button", { name: "settings:apiTokens.create" }));

    expect(
      screen.getByRole("radio", { name: "settings:apiTokens.scopes.read" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "settings:apiTokens.scopes.write" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "settings:apiTokens.scopes.admin" })).toBeNull();
  });

  it("still offers it to an admin, who can", async () => {
    render(<ApiTokensSection />);
    await screen.findByText("Home Assistant");
    fireEvent.click(screen.getByRole("button", { name: "settings:apiTokens.create" }));

    expect(
      screen.getByRole("radio", { name: "settings:apiTokens.scopes.admin" })
    ).toBeInTheDocument();
  });
});
