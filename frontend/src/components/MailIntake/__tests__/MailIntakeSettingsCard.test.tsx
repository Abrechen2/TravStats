import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

import MailIntakeSettingsCard from "../MailIntakeSettingsCard";
import { mailIntakeApi, type MailIntakeStatus } from "../../../lib/api/mailIntake";
import { chooseMenuEntry } from "../../../__tests__/helpers/menu";

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
    prefilter: true,
    keepUnread: false,
    fetchFrom: "now",
    senderDomains: [],
    removedSenderDomains: [],
    subjectKeywords: [],
    removedSubjectKeywords: [],
    skippedCount: 12,
    processedCount: 3,
  },
  address: null,
  forwardingAvailable: false,
  senders: [],
  prefilterDefaults: {
    senderDomains: [{ domain: "lufthansa.com", brand: "Lufthansa", kind: "flight" }],
    keywords: { de: ["Buchungsbestätigung", "Reservierung"], en: ["booking confirmation"] },
  },
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
    chooseMenuEntry(await screen.findByTestId("mail-folder-menu"), "mailIntake:folder.test");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("mailIntake:errors.unreachable")
    );
  });

  it("asks, naming what goes, before removing the folder, the address or a sender", async () => {
    vi.mocked(mailIntakeApi.status).mockResolvedValue(
      status({
        forwardingAvailable: true,
        address: "trips+abc@example.org",
        senders: [{ id: "s1", address: "me@gmail.example" }],
      })
    );
    vi.mocked(mailIntakeApi.removeSource).mockResolvedValue(undefined);
    vi.mocked(mailIntakeApi.revokeAddress).mockResolvedValue(undefined);
    vi.mocked(mailIntakeApi.removeSender).mockResolvedValue(status());
    render(<MailIntakeSettingsCard />);

    const cases: Array<[() => HTMLElement, string, string, () => unknown]> = [
      [
        () => screen.getByTestId("mail-folder-menu"),
        "mailIntake:folder.remove",
        "mailIntake:folder.removeConfirm.message",
        () => mailIntakeApi.removeSource,
      ],
      [
        () => screen.getByTestId("mail-address-menu"),
        "mailIntake:forwarding.revoke",
        "mailIntake:forwarding.revokeConfirm.message",
        () => mailIntakeApi.revokeAddress,
      ],
      [
        () => screen.getByLabelText("mailIntake:forwarding.senderMenuLabel"),
        "mailIntake:forwarding.senderRemove",
        "mailIntake:forwarding.senderRemoveConfirm.message",
        () => mailIntakeApi.removeSender,
      ],
    ];
    await screen.findByTestId("mail-address");
    for (const [trigger, entry, message, fn] of cases) {
      chooseMenuEntry(trigger(), entry);
      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain(message);
      expect(fn()).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: entry }));
      await waitFor(() => expect(fn()).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
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

  describe("privacy block for a private INBOX", () => {
    it("shows both default keyword groups and the counters; saving sends the custom lists", async () => {
      vi.mocked(mailIntakeApi.status).mockResolvedValue(status());
      vi.mocked(mailIntakeApi.saveSource).mockResolvedValue(status().source!);
      render(<MailIntakeSettingsCard />);
      const block = await screen.findByTestId("mail-privacy");
      expect(
        within(screen.getByTestId("mail-keywords-groupDe")).getByText("Reservierung")
      ).toBeTruthy();
      expect(
        within(screen.getByTestId("mail-keywords-groupEn")).getByText("booking confirmation")
      ).toBeTruthy();
      expect(screen.getByTestId("mail-privacy-counters").textContent).toContain(
        "mailIntake:privacy.counters"
      );

      // switch a default word off, add an own word and an own domain
      fireEvent.click(within(block).getByText("Reservierung"));
      fireEvent.change(
        within(block).getByPlaceholderText("mailIntake:privacy.keywords.placeholder"),
        {
          target: { value: "Ihre Reise" },
        }
      );
      fireEvent.click(within(block).getByText("mailIntake:privacy.keywords.add"));
      fireEvent.change(
        within(block).getByPlaceholderText("mailIntake:privacy.senders.placeholder"),
        {
          target: { value: "@Mein-Reisebuero.de" },
        }
      );
      fireEvent.click(within(block).getByText("mailIntake:privacy.senders.add"));
      fireEvent.click(screen.getByText("mailIntake:folder.save"));

      await waitFor(() => expect(mailIntakeApi.saveSource).toHaveBeenCalled());
      expect(vi.mocked(mailIntakeApi.saveSource).mock.calls[0][0]).toMatchObject({
        prefilter: true,
        fetchFrom: "now",
        keepUnread: false,
        removedSubjectKeywords: ["Reservierung"],
        subjectKeywords: ["Ihre Reise"],
        senderDomains: ["mein-reisebuero.de"],
      });
    });

    it("refuses a sender that is not a domain, visibly", async () => {
      vi.mocked(mailIntakeApi.status).mockResolvedValue(status());
      render(<MailIntakeSettingsCard />);
      const block = await screen.findByTestId("mail-privacy");
      fireEvent.change(
        within(block).getByPlaceholderText("mailIntake:privacy.senders.placeholder"),
        {
          target: { value: "kein domain" },
        }
      );
      fireEvent.click(within(block).getByText("mailIntake:privacy.senders.add"));
      expect(within(block).getByRole("alert").textContent).toContain(
        "mailIntake:privacy.senders.invalid"
      );
    });

    it("a new INBOX folder shows 'nicht als gelesen markieren' on by default", async () => {
      vi.mocked(mailIntakeApi.status).mockResolvedValue(status({ source: null }));
      render(<MailIntakeSettingsCard />);
      await screen.findByTestId("mail-privacy");
      fireEvent.change(screen.getByDisplayValue("TravStats"), { target: { value: "INBOX" } });
      const box = screen.getByLabelText("mailIntake:privacy.keepUnread") as HTMLInputElement;
      expect(box.checked).toBe(true);
    });
  });
});
