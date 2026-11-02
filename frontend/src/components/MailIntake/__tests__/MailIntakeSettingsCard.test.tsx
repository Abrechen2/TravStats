import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import MailIntakeSettingsCard from "../MailIntakeSettingsCard";
import { mailIntakeApi, type MailIntakeStatus } from "../../../lib/api/mailIntake";

vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../lib/api/mailIntake", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/mailIntake")>();
  return {
    ...actual,
    mailIntakeApi: {
      status: vi.fn(),
      saveSource: vi.fn(),
      testSource: vi.fn(),
      runNow: vi.fn(),
      removeSource: vi.fn(),
      issueAddress: vi.fn(),
      revokeAddress: vi.fn(),
      addSender: vi.fn(),
      removeSender: vi.fn(),
    },
  };
});

const status = (over: Partial<MailIntakeStatus> = {}): MailIntakeStatus => ({
  off: null,
  source: {
    host: "imap.gmail.example",
    port: 993,
    tlsMode: "tls",
    username: "me@gmail.example",
    address: null,
    authservId: null,
    folder: "TravStats",
    enabled: true,
    hasPassword: true,
    lastRunAt: null,
    lastOkAt: null,
    lastError: null,
    lastErrorAt: null,
  },
  address: null,
  forwardingAvailable: false,
  senders: [],
  ...over,
});

describe("MailIntakeSettingsCard (forgejo#313)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never shows the stored password and shows a failed run as a sentence with its time", async () => {
    const base = status();
    vi.mocked(mailIntakeApi.status).mockResolvedValue(
      status({
        source: { ...base.source!, lastError: "auth_failed", lastErrorAt: "2026-11-02T09:00:00Z" },
      })
    );
    render(<MailIntakeSettingsCard />);
    const line = await screen.findByTestId("mail-source-status");
    expect(line.textContent).toContain("mailIntake:errors.auth_failed");
    expect(line.textContent).toContain("mailIntake:errors.auth_failed");
    expect((document.querySelector("input[type=password]") as HTMLInputElement).value).toBe("");
  });

  it("a refused save (host not public) is worded, not shown as a code", async () => {
    vi.mocked(mailIntakeApi.status).mockResolvedValue(status({ source: null }));
    vi.mocked(mailIntakeApi.saveSource).mockRejectedValue({
      response: { data: { code: "MAIL_HOST_BLOCKED" } },
    });
    render(<MailIntakeSettingsCard />);
    const inputs = await screen.findAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "10.0.0.5" } });
    fireEvent.change(inputs[1], { target: { value: "9" } });
    fireEvent.change(inputs[2], { target: { value: "me" } });
    fireEvent.click(screen.getByRole("button", { name: "mailIntake:folder.save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("mailIntake:errors.MAIL_HOST_BLOCKED");
  });

  it("a failed connection test is worded", async () => {
    vi.mocked(mailIntakeApi.status).mockResolvedValue(status());
    vi.mocked(mailIntakeApi.testSource).mockResolvedValue({ ok: false, error: "unreachable" });
    render(<MailIntakeSettingsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "mailIntake:folder.test" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("mailIntake:errors.unreachable")
    );
  });

  it("says plainly when the admin switched the feature off, and offers no form", async () => {
    vi.mocked(mailIntakeApi.status).mockResolvedValue(status({ off: "admin", source: null }));
    render(<MailIntakeSettingsCard />);
    expect(await screen.findByText("mailIntake:off.admin")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "mailIntake:folder.save" })).toBeNull();
  });

  it("shows the forwarding address and explains when the instance has none", async () => {
    vi.mocked(mailIntakeApi.status).mockResolvedValue(
      status({
        forwardingAvailable: true,
        address: "trips+abc@example.org",
        senders: [{ id: "s1", address: "me@gmail.example" }],
      })
    );
    const { unmount } = render(<MailIntakeSettingsCard />);
    expect((await screen.findByTestId("mail-address")).textContent).toBe("trips+abc@example.org");
    expect(screen.getByText("me@gmail.example")).toBeTruthy();
    unmount();
    vi.mocked(mailIntakeApi.status).mockResolvedValue(status({ forwardingAvailable: false }));
    render(<MailIntakeSettingsCard />);
    expect(await screen.findByText("mailIntake:forwarding.unavailable")).toBeTruthy();
  });
});
