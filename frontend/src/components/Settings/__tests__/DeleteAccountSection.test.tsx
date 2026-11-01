import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
const demo = vi.hoisted(() => ({ value: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.value }));
vi.mock("../MeExportRow", () => ({ default: () => <div data-testid="export-row" /> }));

const deleteAccount = vi.fn();
vi.mock("../../../lib/api/auth", () => ({
  authApi: { deleteAccount: (b: unknown) => deleteAccount(b) },
}));
const status = vi.fn();
vi.mock("../../../lib/api/twoFactor", () => ({
  twoFactorApi: { getTwoFactorStatus: () => status() },
}));
const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
const logout = vi.fn();

import { useAuthStore } from "../../../store/authStore";
import DeleteAccountSection, { refusalOf } from "../DeleteAccountSection";

const refusedWith = (code: string, httpStatus = 401, error?: string): Error =>
  Object.assign(new Error(code), {
    response: { status: httpStatus, data: { code, ...(error ? { error } : {}) } },
  });

const open = async (): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: "settings:deleteAccount.open" }));
  await act(async () => {});
};
const typePassword = (value = "password123"): void => {
  fireEvent.change(screen.getByLabelText("settings:deleteAccount.password"), {
    target: { value },
  });
};
const goOn = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "settings:deleteAccount.continue" }));
};
const confirm = async (): Promise<void> => {
  const dialog = screen.getByRole("dialog");
  fireEvent.change(dialog.querySelector("input")!, { target: { value: "LÖSCHEN" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteAccount.dialog.confirm" }));
  });
};

beforeEach(() => {
  demo.value = false;
  status.mockResolvedValue({ enabled: false, recoveryCodesLeft: 0 });
  deleteAccount.mockReset();
  navigate.mockReset();
  logout.mockReset().mockResolvedValue(undefined);
  useAuthStore.setState({ user: { id: "u", username: "mara" } as never, logout } as never);
  render(
    <MemoryRouter>
      <DeleteAccountSection />
    </MemoryRouter>
  );
});
afterEach(cleanup);

describe("deleting one's own account", () => {
  it("offers the data download first, then asks for the password, then the typed word", async () => {
    await open();
    expect(screen.getByTestId("export-row")).toBeInTheDocument();
    goOn();
    // No password yet: nothing to confirm.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    typePassword();
    goOn();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("success: deletes, signs out and leaves for the login", async () => {
    deleteAccount.mockResolvedValue(undefined);
    await open();
    typePassword();
    goOn();
    await confirm();
    expect(deleteAccount).toHaveBeenCalledWith({
      password: "password123",
      confirmation: "LÖSCHEN",
    });
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("asks for the authenticator code when the account has two-factor, and sends it", async () => {
    status.mockResolvedValue({ enabled: true, recoveryCodesLeft: 3 });
    deleteAccount.mockResolvedValue(undefined);
    await open();
    typePassword();
    goOn();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("settings:deleteAccount.code"), {
      target: { value: "123456" },
    });
    goOn();
    await confirm();
    expect(deleteAccount).toHaveBeenCalledWith(expect.objectContaining({ code: "123456" }));
  });

  it.each([
    ["DELETE_PASSWORD_INCORRECT", 401],
    ["DELETE_SECOND_FACTOR_INVALID", 401],
    ["DELETE_LAST_ADMIN", 409],
  ])("a %s refusal says so in its own words and the account stays signed in", async (code, st) => {
    deleteAccount.mockRejectedValue(refusedWith(code, st));
    await open();
    typePassword();
    goOn();
    await confirm();
    expect(await screen.findByText(`settings:deleteAccount.refused.${code}`)).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a missing second factor turns the code field on and asks again", async () => {
    deleteAccount.mockRejectedValue(refusedWith("DELETE_SECOND_FACTOR_REQUIRED"));
    await open();
    typePassword();
    goOn();
    await confirm();
    expect(
      await screen.findByText("settings:deleteAccount.refused.DELETE_SECOND_FACTOR_REQUIRED")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("settings:deleteAccount.code")).toBeInTheDocument();
  });

  it("the demo refusal and an unreachable server each have their own line", () => {
    expect(refusalOf(refusedWith("x", 403, "DEMO_ACCOUNT_FORBIDDEN"))).toBe(
      "DEMO_ACCOUNT_FORBIDDEN"
    );
    expect(refusalOf(new Error("Network Error"))).toBe("offline");
    expect(refusalOf(refusedWith("SOMETHING_ELSE", 500))).toBe("other");
  });

  it("is locked in the demo account, with the reason", () => {
    cleanup();
    demo.value = true;
    render(
      <MemoryRouter>
        <DeleteAccountSection />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: "settings:deleteAccount.open" })).toBeDisabled();
    expect(screen.getByText("settings:blocks.lock.demo")).toBeInTheDocument();
  });
});
