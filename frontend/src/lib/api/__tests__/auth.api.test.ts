import { describe, it, expect, vi, beforeEach } from "vitest";
import { authApi } from "../auth";
import { api } from "../client";

vi.mock("../client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe("authApi.getSmtpStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns smtpEnabled true when SMTP is configured", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { smtpEnabled: true } });
    const result = await authApi.getSmtpStatus();
    expect(result.smtpEnabled).toBe(true);
    expect(api.get).toHaveBeenCalledWith("/auth/smtp-status");
  });
});

describe("authApi.forgotPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts username and returns message", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { message: "ok" } });
    const result = await authApi.forgotPassword("alice");
    expect(result.message).toBe("ok");
    expect(api.post).toHaveBeenCalledWith("/auth/forgot-password", { username: "alice" });
  });
});

describe("authApi.resetPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts token and newPassword", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { message: "reset ok" } });
    const result = await authApi.resetPassword("tok123", "newpass1");
    expect(result.message).toBe("reset ok");
    expect(api.post).toHaveBeenCalledWith("/auth/reset-password", {
      token: "tok123",
      newPassword: "newpass1",
    });
  });
});

describe("authApi.forceChangePassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts changeToken and newPassword", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { message: "changed" } });
    const result = await authApi.forceChangePassword("ctok", "newpass1");
    expect(result.message).toBe("changed");
    expect(api.post).toHaveBeenCalledWith("/auth/force-change-password", {
      changeToken: "ctok",
      newPassword: "newpass1",
    });
  });
});
