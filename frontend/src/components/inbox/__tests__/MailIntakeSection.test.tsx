import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import MailIntakeSection from "../MailIntakeSection";
import { mailIntakeHandoffOf } from "../mailIntakeHandoff";
import { mailIntakeApi, type MailInboxItem } from "../../../lib/api/mailIntake";
import { api } from "../../../lib/api/client";

vi.mock("../../../lib/api/mailIntake", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/mailIntake")>();
  return {
    ...actual,
    mailIntakeApi: {
      inbox: vi.fn(),
      dismiss: vi.fn(),
      retry: vi.fn(),
      allowSender: vi.fn(),
    },
  };
});
vi.mock("../../../lib/api/client", () => ({ api: { get: vi.fn() } }));

const item = (over: Partial<MailInboxItem>): MailInboxItem => ({
  id: "m1",
  status: "proposed",
  reason: null,
  from: "me@gmail.example",
  subject: "Ihre Buchung",
  receivedAt: "2026-11-02T09:00:00Z",
  domain: "flight",
  found: 2,
  documentId: "d1",
  deletesAt: null,
  ...over,
});

let seenState: unknown = null;
function Probe(): null {
  seenState = useLocation().state;
  return null;
}
const renderSection = () =>
  render(
    <MemoryRouter>
      <MailIntakeSection />
      <Probe />
    </MemoryRouter>
  );

describe("MailIntakeSection (forgejo#313)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seenState = null;
  });

  it("renders nothing when there is nothing to act on", async () => {
    vi.mocked(mailIntakeApi.inbox).mockResolvedValue({ items: [], sourceProblem: null });
    const { container } = renderSection();
    await waitFor(() => expect(mailIntakeApi.inbox).toHaveBeenCalled());
    expect(container.querySelector("[data-testid='mail-intake-card']")).toBeNull();
  });

  it("a proposal hands the ORIGINAL mail to the import dialog of its domain — it creates no entry itself", async () => {
    vi.mocked(mailIntakeApi.inbox).mockResolvedValue({ items: [item({})], sourceProblem: null });
    vi.mocked(api.get).mockResolvedValue({ data: new Blob(["raw mail"]) });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "mailIntake:inbox.review" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/documents/d1/file", { responseType: "blob" })
    );
    await waitFor(() => expect(mailIntakeHandoffOf(seenState)?.domain).toBe("flight"));
  });

  it("a rejected mail says why in words, never as a raw code, and can allow the sender", async () => {
    vi.mocked(mailIntakeApi.inbox).mockResolvedValue({
      items: [
        item({
          status: "rejected",
          reason: "sender_not_allowed",
          domain: null,
          found: null,
          documentId: null,
        }),
      ],
      sourceProblem: null,
    });
    vi.mocked(mailIntakeApi.allowSender).mockResolvedValue();
    renderSection();
    expect(await screen.findByText("mailIntake:reasons.sender_not_allowed")).toBeTruthy();
    expect(screen.queryByText("sender_not_allowed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "mailIntake:inbox.allowSender" }));
    await waitFor(() => expect(mailIntakeApi.allowSender).toHaveBeenCalledWith("m1"));
  });

  it("a failed mail offers a retry and names its reason", async () => {
    vi.mocked(mailIntakeApi.inbox).mockResolvedValue({
      items: [item({ status: "failed", reason: "parser_timeout", found: null })],
      sourceProblem: null,
    });
    vi.mocked(mailIntakeApi.retry).mockResolvedValue();
    renderSection();
    expect(await screen.findByText("mailIntake:reasons.parser_timeout")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mailIntake:inbox.retry" }));
    await waitFor(() => expect(mailIntakeApi.retry).toHaveBeenCalledWith("m1"));
  });

  it("a mailbox that cannot be read reaches the inbox as an alert with its reason", async () => {
    vi.mocked(mailIntakeApi.inbox).mockResolvedValue({
      items: [],
      sourceProblem: { error: "auth_failed", at: "2026-11-02T09:00:00Z" },
    });
    renderSection();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("mailIntake:errors.auth_failed");
  });

  it("a failing action says so instead of staying silent", async () => {
    vi.mocked(mailIntakeApi.inbox).mockResolvedValue({ items: [item({})], sourceProblem: null });
    vi.mocked(mailIntakeApi.dismiss).mockRejectedValue(new Error("boom"));
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "mailIntake:inbox.dismiss" }));
    expect(await screen.findByText("mailIntake:inbox.actionError")).toBeTruthy();
  });
});

describe("mailIntakeHandoffOf", () => {
  it("accepts only an openable domain with a real file", () => {
    const file = new File(["x"], "mail.eml");
    expect(
      mailIntakeHandoffOf({
        mailIntakeHandoff: { domain: "rail", document: { kind: "file", file } },
      })?.domain
    ).toBe("rail");
    expect(
      mailIntakeHandoffOf({
        mailIntakeHandoff: { domain: "bus", document: { kind: "file", file } },
      })
    ).toBeNull();
    expect(
      mailIntakeHandoffOf({
        mailIntakeHandoff: { domain: "flight", document: { kind: "text", text: "x" } },
      })
    ).toBeNull();
    expect(mailIntakeHandoffOf(null)).toBeNull();
  });
});
