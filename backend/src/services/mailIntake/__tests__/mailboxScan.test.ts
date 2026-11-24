/**
 * "Postfach durchsuchen": a header-only walk over a private folder that lists
 * the booking mails probably missing in TravStats.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import dns from "dns";

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { encrypt } from "../../../utils/encryption";
import { updatePolicy } from "../../externalServices/policy";
import { getJob, settleAllJobs, clearJobs } from "../../jobs/jobRegistry";
import { cancelScan, forgetActiveScans, getScan, startScan } from "../mailboxScan";
import { ignoreCandidates, listCandidates, startImport } from "../candidates";
import { buildMail, FakeMailbox } from "./helpers";

const parseDocument = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock("../../parsing/parseDocument", () => ({
  parseDocument: (input: unknown) => parseDocument(input),
}));

const privateMail = (uid: number) =>
  buildMail({
    messageId: `<p${uid}@private>`,
    from: "Tante <tante@family.example>",
    subject: `Fotos vom Geburtstag ${uid}`,
  });
const bookingMail = (uid: number, subject = "Ihre Buchungsbestätigung") =>
  buildMail({
    messageId: `<b${uid}@lh>`,
    from: "Lufthansa <noreply@lufthansa.com>",
    subject,
    date: "Mon, 02 Mar 2026 09:00:00 +0000",
  });

describe("mailbox scan (Postfach durchsuchen)", () => {
  const prefix = `mis-${Date.now()}`;
  let userId: string;
  let sourceId: string;
  let box: FakeMailbox;
  let lookup: jest.SpiedFunction<typeof dns.promises.lookup>;

  const scanAll = async (request = {}) => {
    const job = await startScan(userId, request, box, 0);
    await settleAllJobs();
    return getJob(job.id, userId)!;
  };

  beforeAll(async () => {
    lookup = jest.spyOn(dns.promises, "lookup");
    lookup.mockImplementation((async () => [{ address: "93.184.216.34", family: 4 }]) as never);
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `${prefix}-a`, passwordHash } })).id;
  });

  beforeEach(async () => {
    clearJobs();
    forgetActiveScans();
    parseDocument.mockReset();
    parseDocument.mockImplementation(() =>
      Promise.resolve({
        domain: "flight",
        body: { domain: "flight", flights: [{ flightNumber: "LH400" }], llmDisabledByAdmin: false },
      })
    );
    await prisma.mailIntakeCandidate.deleteMany({});
    await prisma.mailIntakeScan.deleteMany({});
    await prisma.mailIntakeMessage.deleteMany({});
    await prisma.mailIntakeSource.deleteMany({});
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.document.deleteMany({ where: { userId } });
    await updatePolicy((p) => ({ ...p, disabled: p.disabled.filter((x) => x !== "mailIntake") }));
    box = new FakeMailbox();
    sourceId = (
      await prisma.mailIntakeSource.create({
        data: {
          kind: "imap_folder",
          userId,
          host: "imap.example.org",
          port: 993,
          tlsMode: "tls",
          username: "me@example.org",
          passwordEncrypted: encrypt("pw"),
          folder: "INBOX",
          keepUnread: true,
          enabled: true,
          uidValidity: "1000",
        },
      })
    ).id;
  });

  afterAll(async () => {
    lookup.mockRestore();
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.document.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("fetches only headers, lists the booking mail, and a private mail leaves no row", async () => {
    box.add({ uid: 1, raw: privateMail(1) });
    box.add({ uid: 2, raw: bookingMail(2) });
    const job = await scanAll();

    expect(job.status).toBe("succeeded");
    expect(box.downloads).toEqual([]);
    expect(box.flags.size).toBe(0);
    expect(box.headerFetches.sort()).toEqual([1, 2]);
    const { items, scan } = await listCandidates(userId);
    expect(scan).toMatchObject({ status: "done", scanned: 2, skipped: 1, candidates: 1 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      brand: "Lufthansa",
      guessedDomain: "flight",
      matchHint: null,
    });
    const rows = await prisma.mailIntakeCandidate.findMany();
    expect(JSON.stringify(rows)).not.toContain("family.example");
    expect(JSON.stringify(rows)).not.toContain("Geburtstag");
    expect(await prisma.mailIntakeMessage.count()).toBe(0);
  });

  it("a mail whose PNR an entry already carries is not listed", async () => {
    await prisma.flight.create({
      data: { userId, bookingReference: "XK7Q2P", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 },
    });
    box.add({ uid: 1, raw: bookingMail(1, "Buchungsbestätigung XK7Q2P Frankfurt") });
    box.add({ uid: 2, raw: bookingMail(2, "Buchungsbestätigung ZZ9Y8X Berlin") });
    await scanAll();
    const { items, scan } = await listCandidates(userId);
    expect(items.map((i) => i.subject)).toEqual(["Buchungsbestätigung ZZ9Y8X Berlin"]);
    expect(scan).toMatchObject({ matched: 1, candidates: 1 });
  });

  it("brand plus a nearby date is only a hint, never hides the mail", async () => {
    await prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        departureTime: new Date("2026-04-01T08:00:00Z"),
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
    });
    box.add({ uid: 1, raw: bookingMail(1) });
    await scanAll();
    const { items } = await listCandidates(userId);
    expect(items[0].matchHint).toBe("likely_present");
  });

  it("a Message-ID the intake already took is not listed", async () => {
    await prisma.mailIntakeMessage.create({
      data: { sourceId, userId, messageId: "<b1@lh>", uid: 1, status: "proposed" },
    });
    box.add({ uid: 1, raw: bookingMail(1) });
    await scanAll();
    expect((await listCandidates(userId)).items).toHaveLength(0);
  });

  it("import downloads exactly one mail, runs the pipeline and sets only $TravStats", async () => {
    box.add({ uid: 1, raw: bookingMail(1) });
    box.add({ uid: 2, raw: bookingMail(2, "Your boarding pass") });
    await scanAll();
    const { items } = await listCandidates(userId);
    const target = items.find((i) => i.subject === "Your boarding pass")!;

    const job = await startImport(userId, [target.id], box);
    await settleAllJobs();
    expect(getJob(job.id, userId)).toMatchObject({
      status: "succeeded",
      result: { imported: 1, proposed: 1, failed: 0 },
    });
    expect(box.downloads).toEqual([2]);
    expect(box.flags.get(2)).toEqual(["$TravStats"]);
    expect(await prisma.mailIntakeMessage.count({ where: { status: "proposed" } })).toBe(1);
    expect((await listCandidates(userId)).items.map((i) => i.id)).not.toContain(target.id);
  });

  it("an import whose parse fails is counted as failed, not as a success", async () => {
    parseDocument.mockRejectedValue(new Error("parser timeout"));
    box.add({ uid: 1, raw: bookingMail(1) });
    await scanAll();
    const [item] = (await listCandidates(userId)).items;
    const job = await startImport(userId, [item.id], box);
    await settleAllJobs();
    expect(getJob(job.id, userId)?.result).toMatchObject({ failed: 1, proposed: 0 });
    expect(await prisma.mailIntakeMessage.count({ where: { status: "failed" } })).toBe(1);
  });

  it("an import that cannot open the mailbox says why (auth_failed), not just 'unreadable'", async () => {
    box.add({ uid: 1, raw: bookingMail(1) });
    await scanAll();
    const [item] = (await listCandidates(userId)).items;
    box.failWith = "auth_failed";
    const job = await startImport(userId, [item.id], box);
    await settleAllJobs();
    expect(getJob(job.id, userId)).toMatchObject({
      status: "failed",
      error: { code: "auth_failed", status: 502 },
    });
  });

  it("import refuses a UID that now holds another mail", async () => {
    box.add({ uid: 1, raw: bookingMail(1) });
    await scanAll();
    const [item] = (await listCandidates(userId)).items;
    box.mails[0] = { uid: 1, raw: privateMail(1) };
    await startImport(userId, [item.id], box);
    await settleAllJobs();
    expect(box.downloads).toEqual([]);
    expect((await listCandidates(userId)).items[0]).toMatchObject({
      status: "failed",
      reason: "mail_gone",
    });
  });

  it("an ignored mail is remembered and not listed by the next scan", async () => {
    box.add({ uid: 1, raw: bookingMail(1) });
    await scanAll();
    const [item] = (await listCandidates(userId)).items;
    expect(await ignoreCandidates(userId, [item.id])).toBe(1);
    await scanAll();
    const after = await listCandidates(userId);
    expect(after.items).toHaveLength(0);
    expect(after.ignoredCount).toBe(1);
  });

  it("can be cancelled, survives a restart as interrupted, and resumes from its cursor", async () => {
    for (let uid = 1; uid <= 1200; uid += 1) box.add({ uid, raw: privateMail(uid) });
    box.add({ uid: 1201, raw: bookingMail(1201) });
    let calls = 0;
    box.onFetchHeaders = async () => {
      calls += 1;
      if (calls === 1) await cancelScan(userId);
    };
    await scanAll();
    expect(await getScan(userId)).toMatchObject({ status: "cancelled", scanned: 500 });

    // a restart: the row says running but no process holds it
    await prisma.mailIntakeScan.updateMany({ data: { status: "running" } });
    forgetActiveScans();
    expect((await getScan(userId))?.status).toBe("interrupted");

    box.onFetchHeaders = null;
    box.headerFetches = [];
    await scanAll({ resume: true });
    expect(Math.min(...box.headerFetches)).toBe(501);
    expect(await getScan(userId)).toMatchObject({ status: "done", scanned: 1201, candidates: 1 });
  });

  it("walks 10,000 headers in batches, fast, without downloading a single mail", async () => {
    for (let uid = 1; uid <= 10_000; uid += 1) {
      box.add({ uid, raw: uid % 400 === 0 ? bookingMail(uid) : privateMail(uid) });
    }
    let batches = 0;
    box.onFetchHeaders = async () => {
      batches += 1;
    };
    const started = Date.now();
    await scanAll();
    const elapsed = Date.now() - started;

    expect(box.downloads).toEqual([]);
    expect(batches).toBe(20);
    expect(await getScan(userId)).toMatchObject({
      status: "done",
      scanned: 10_000,
      skipped: 9975,
      candidates: 25,
    });
    expect(await prisma.mailIntakeCandidate.count()).toBe(25);
    expect(elapsed).toBeLessThan(30_000);
  });
});
