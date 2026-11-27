import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

import MailboxScanSection from "../MailboxScanSection";
import { mailIntakeApi, type MailCandidateList } from "../../../lib/api/mailIntake";
import { waitForJob } from "../../../lib/api/jobs";
import { scanFailureReason } from "../../MailIntake/mailIntakeCopy";

vi.mock("../../../lib/api/mailIntake", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/mailIntake")>();
  return {
    ...actual,
    mailIntakeApi: {
      status: vi.fn(),
      candidates: vi.fn(),
      startScan: vi.fn(),
      cancelScan: vi.fn(),
      importCandidates: vi.fn(),
      ignoreCandidates: vi.fn(),
    },
  };
});
vi.mock("../../../lib/api/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/jobs")>();
  return { ...actual, waitForJob: vi.fn() };
});

const list = (over: Partial<MailCandidateList> = {}): MailCandidateList => ({
  scan: {
    status: "done",
    since: null,
    before: null,
    total: 12781,
    scanned: 12781,
    skipped: 12500,
    matched: 270,
    candidates: 2,
    error: null,
    startedAt: "2026-11-24T10:00:00Z",
    finishedAt: "2026-11-24T10:03:00Z",
  },
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      receivedAt: "2025-03-02T09:00:00Z",
      from: "noreply@lufthansa.com",
      subject: "Ihre Buchungsbestätigung",
      brand: "Lufthansa",
      guessedDomain: "flight",
      matchHint: null,
      status: "open",
      reason: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      receivedAt: "2025-04-02T09:00:00Z",
      from: "noreply@booking.com",
      subject: "Reservierung bestätigt",
      brand: "Booking.com",
      guessedDomain: "lodging",
      matchHint: "likely_present",
      status: "open",
      reason: null,
    },
  ],
  ignoredCount: 0,
  ...over,
});

describe("MailboxScanSection (Postfach durchsuchen)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mailIntakeApi.status).mockResolvedValue({
      off: null,
      source: { folder: "INBOX" },
    } as never);
    vi.mocked(mailIntakeApi.candidates).mockResolvedValue(list());
  });

  it("renders nothing without a mail folder", async () => {
    vi.mocked(mailIntakeApi.status).mockResolvedValue({ off: null, source: null } as never);
    const { container } = render(<MailboxScanSection />);
    await waitFor(() => expect(mailIntakeApi.status).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("lists probably missing mails apart from the likely-present ones, with the summary", async () => {
    render(<MailboxScanSection />);
    const rows = await screen.findAllByTestId("mail-scan-candidate");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("mailIntake:scan.missingTitle")).toBeTruthy();
    expect(screen.getByText("mailIntake:scan.likelyTitle")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("mailIntake:scan.summary");
  });

  it("'Importieren' imports exactly that mail and reports the result", async () => {
    vi.mocked(mailIntakeApi.importCandidates).mockResolvedValue("job-1");
    vi.mocked(waitForJob).mockResolvedValue({ imported: 1, proposed: 1, failed: 0 });
    render(<MailboxScanSection />);
    const [first] = await screen.findAllByTestId("mail-scan-candidate");
    fireEvent.click(within(first).getByText("mailIntake:scan.import"));
    await waitFor(() =>
      expect(mailIntakeApi.importCandidates).toHaveBeenCalledWith([
        "11111111-1111-4111-8111-111111111111",
      ])
    );
    expect(await screen.findByText("mailIntake:scan.importResult")).toBeTruthy();
  });

  it("bulk-ignores the selection", async () => {
    vi.mocked(mailIntakeApi.ignoreCandidates).mockResolvedValue(1);
    render(<MailboxScanSection />);
    await screen.findAllByTestId("mail-scan-candidate");
    fireEvent.click(screen.getByText("mailIntake:scan.selectAll"));
    fireEvent.click(screen.getByText("mailIntake:scan.ignoreSelected"));
    await waitFor(() =>
      expect(mailIntakeApi.ignoreCandidates).toHaveBeenCalledWith([
        "11111111-1111-4111-8111-111111111111",
      ])
    );
  });

  it("a failed scan start says why, visibly", async () => {
    vi.mocked(mailIntakeApi.startScan).mockRejectedValue({
      response: { data: { code: "MAIL_SCAN_RUNNING" } },
    });
    render(<MailboxScanSection />);
    await screen.findAllByTestId("mail-scan-candidate");
    fireEvent.click(screen.getByText("mailIntake:scan.start"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("mailIntake:scan.error");
  });

  it("an import that cannot open the mailbox says why, in the settings card's words", async () => {
    const { JobFailedError } = await import("../../../lib/api/jobs");
    vi.mocked(mailIntakeApi.importCandidates).mockResolvedValue("job-3");
    vi.mocked(waitForJob).mockRejectedValue(new JobFailedError("auth_failed", 502));
    render(<MailboxScanSection />);
    const [first] = await screen.findAllByTestId("mail-scan-candidate");
    fireEvent.click(within(first).getByText("mailIntake:scan.import"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("mailIntake:scan.error");
  });

  it("a failed scan shows its reason", async () => {
    vi.mocked(mailIntakeApi.candidates).mockResolvedValue(
      list({ scan: { ...list().scan!, status: "failed", error: "folder_missing" } })
    );
    render(<MailboxScanSection />);
    expect((await screen.findByRole("alert")).textContent).toContain("mailIntake:scan.error");
  });

  it("an interrupted scan offers 'Fortsetzen' and resumes", async () => {
    vi.mocked(mailIntakeApi.candidates).mockResolvedValue(
      list({ scan: { ...list().scan!, status: "interrupted" } })
    );
    vi.mocked(mailIntakeApi.startScan).mockResolvedValue("job-2");
    vi.mocked(waitForJob).mockResolvedValue(null);
    render(<MailboxScanSection />);
    fireEvent.click(await screen.findByText("mailIntake:scan.resume"));
    await waitFor(() => expect(mailIntakeApi.startScan).toHaveBeenCalledWith({ resume: true }));
  });

  it("words each mailbox failure kind distinctly", () => {
    const t = (key: string) => key;
    expect(scanFailureReason(t, "auth_failed")).toBe("mailIntake:errors.auth_failed");
    expect(scanFailureReason(t, "folder_missing")).toBe("mailIntake:errors.folder_missing");
    expect(scanFailureReason(t, "tls_error")).toBe("mailIntake:errors.tls_error");
    expect(scanFailureReason(t, "unreachable")).toBe("mailIntake:errors.unreachable");
    expect(scanFailureReason(t, "timeout")).toBe("mailIntake:errors.timeout");
    expect(scanFailureReason(t, "MAIL_SCAN_RUNNING")).toBe(
      "mailIntake:scan.errors.MAIL_SCAN_RUNNING"
    );
  });
});
