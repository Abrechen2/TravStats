import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockNotify = jest.fn<typeof import("../../notifications/dispatcher").notifyEntryReminder>();
jest.mock("../../notifications/dispatcher", () => ({ notifyEntryReminder: mockNotify }));
const mockClaim = jest.fn<typeof import("../claims").claimReminder>();
const mockSent = jest.fn<typeof import("../claims").markSent>();
const mockRelease = jest.fn<typeof import("../claims").releaseClaim>();
jest.mock("../claims", () => ({
  claimReminder: mockClaim,
  markSent: mockSent,
  releaseClaim: mockRelease,
}));
const mockEligible = jest.fn<typeof import("../eligibility").stillEligible>();
jest.mock("../eligibility", () => ({ stillEligible: mockEligible }));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { sendDueReminder } from "../dispatch";
import { REMINDER_DOMAINS, type ReminderChannel, type ReminderDomain } from "../prefs";

function due(domain: ReminderDomain, channel: ReminderChannel, extra: object = {}) {
  const sendMail = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  return {
    sendMail,
    args: {
      user: {
        id: "u1",
        notificationEmail: "u@example.com",
        notifyBefore24h: false,
        notifyBefore2h: false,
        settings: { data: {}, enabledDomains: [...REMINDER_DOMAINS] },
        reminderPreferences: [{ domain, enabled: true, leadHours: [24, 2], channel }],
      },
      domain,
      entryId: "e1",
      tripId: null,
      hours: 24,
      anchorAt: new Date("2026-11-10T12:00:00Z"),
      anchorKey: "k",
      sendMail,
      render: () => ({ title: "t", body: "b" }),
      now: new Date("2026-11-09T12:00:00Z"),
      ...extra,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotify.mockResolvedValue(undefined);
  mockClaim.mockResolvedValue({ id: "c1" });
  mockSent.mockResolvedValue(undefined);
  mockRelease.mockResolvedValue(undefined);
  mockEligible.mockResolvedValue(true);
});

describe.each(REMINDER_DOMAINS)("%s reminder", (domain) => {
  it.each([
    ["app", false, true],
    ["mail", true, false],
    ["both", true, true],
  ] as const)("channel %s: mail=%s push=%s", async (channel, mail, push) => {
    const { args, sendMail } = due(domain, channel);
    await sendDueReminder(args);
    expect(sendMail).toHaveBeenCalledTimes(mail ? 1 : 0);
    expect(mockNotify).toHaveBeenCalledTimes(push ? 1 : 0);
    if (push)
      expect(mockNotify.mock.calls[0][1]).toMatchObject({ domain, entryId: "e1", hours: 24 });
  });

  it("a disabled domain sends nothing on any channel", async () => {
    const { args, sendMail } = due(domain, "both");
    args.user.reminderPreferences[0].enabled = false;
    await sendDueReminder(args);
    expect(sendMail).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("sendDueReminder", () => {
  it("skips the mail part, but not the push, when the account has no e-mail address", async () => {
    const { args, sendMail } = due("rail", "both");
    args.user.notificationEmail = null as unknown as string;
    await sendDueReminder(args);
    expect(sendMail).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("does not send a mail another worker (or an earlier run) already claimed", async () => {
    mockClaim.mockResolvedValue(null);
    const { args, sendMail } = due("flight", "mail");
    await sendDueReminder(args);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rechecks right before the mail and drops it when the entry changed", async () => {
    mockEligible.mockResolvedValue(false);
    const { args, sendMail } = due("flight", "mail");
    await sendDueReminder(args);
    expect(sendMail).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it("a failing mail releases its claim for a retry and does not skip the push", async () => {
    const { args, sendMail } = due("lodging", "both");
    sendMail.mockRejectedValue(new Error("smtp down"));
    await sendDueReminder(args);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith({ id: "c1" });
    expect(mockSent).not.toHaveBeenCalled();
  });

  it("a push that throws does not stop the mail", async () => {
    mockNotify.mockRejectedValue(new Error("relay down"));
    const { args, sendMail } = due("bus", "both");
    await sendDueReminder(args);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(mockSent).toHaveBeenCalled();
  });
});
