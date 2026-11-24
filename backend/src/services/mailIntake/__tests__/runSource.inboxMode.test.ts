/**
 * The IMAP intake pointed at a PRIVATE main INBOX: a header-only pre-filter,
 * mails left unread, and a cursor that never starts at UID 0.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import dns from "dns";

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { encrypt } from "../../../utils/encryption";
import logger from "../../../utils/logger";
import { updatePolicy } from "../../externalServices/policy";
import { runSource } from "../runSource";
import { saveSource } from "../sourceSettings";
import { buildMail, FakeMailbox } from "./helpers";

const parseDocument = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock("../../parsing/parseDocument", () => ({
  parseDocument: (input: unknown) => parseDocument(input),
}));

const PRIVATE_SUBJECT = "Arztbefund Mama vertraulich";
const PRIVATE_FROM = "doktor@praxis-private.example";
const privateMail = (id: string) =>
  buildMail({ messageId: `<${id}@p>`, from: `Praxis <${PRIVATE_FROM}>`, subject: PRIVATE_SUBJECT });
const bookingMail = (id: string) =>
  buildMail({
    messageId: `<${id}@b>`,
    from: "Lufthansa <noreply@lufthansa.com>",
    subject: "Hallo",
  });

describe("mail intake on a private INBOX", () => {
  const prefix = `mib-${Date.now()}`;
  let userId: string;
  let box: FakeMailbox;
  let lookup: jest.SpiedFunction<typeof dns.promises.lookup>;

  const mkSource = (over: Record<string, unknown> = {}) =>
    prisma.mailIntakeSource.create({
      data: {
        kind: "imap_folder",
        userId,
        host: "imap.example.org",
        port: 993,
        tlsMode: "tls",
        username: "me@example.org",
        passwordEncrypted: encrypt("secret-pw"),
        folder: "INBOX",
        keepUnread: true,
        enabled: true,
        uidValidity: "1000",
        ...over,
      },
    });

  beforeAll(async () => {
    lookup = jest.spyOn(dns.promises, "lookup");
    lookup.mockImplementation((async () => [{ address: "93.184.216.34", family: 4 }]) as never);
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `${prefix}-a`, passwordHash } })).id;
  });

  beforeEach(async () => {
    parseDocument.mockReset();
    parseDocument.mockImplementation(() =>
      Promise.resolve({
        domain: "flight",
        body: { domain: "flight", flights: [{ flightNumber: "LH400" }], llmDisabledByAdmin: false },
      })
    );
    await prisma.mailIntakeMessage.deleteMany({});
    await prisma.mailIntakeSource.deleteMany({});
    await prisma.mailIntakeSender.deleteMany({});
    await prisma.document.deleteMany({ where: { userId } });
    await updatePolicy((p) => ({ ...p, disabled: p.disabled.filter((x) => x !== "mailIntake") }));
    box = new FakeMailbox();
  });

  afterAll(async () => {
    lookup.mockRestore();
    await prisma.document.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("a private mail stays untouched: no download, no flag, no row — only the counter", async () => {
    const { id } = await mkSource();
    box.add({ uid: 1, raw: privateMail("p1") });
    const result = await runSource(id, box);

    expect(result).toMatchObject({ ran: true, seen: 0, filtered: 1 });
    expect(box.headerFetches).toEqual([1]);
    expect(box.downloads).toEqual([]);
    expect(box.flags.size).toBe(0);
    expect(await prisma.mailIntakeMessage.count()).toBe(0);
    expect(await prisma.document.count({ where: { userId } })).toBe(0);
    const source = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id } });
    expect(source).toMatchObject({ skippedCount: 1, processedCount: 0, lastUid: 1 });
  });

  it("a booking mail goes through and is proposed", async () => {
    const { id } = await mkSource();
    box.add({ uid: 1, raw: privateMail("p1") });
    box.add({ uid: 2, raw: bookingMail("b1") });
    const result = await runSource(id, box);

    expect(result).toMatchObject({ seen: 1, proposed: 1, filtered: 1 });
    expect(box.downloads).toEqual([2]);
    const rows = await prisma.mailIntakeMessage.findMany();
    expect(rows.map((r) => r.uid)).toEqual([2]);
  });

  it("a mail from the user's own forwarding address with a private subject is not downloaded", async () => {
    const { id } = await mkSource();
    // The forwarding allowlist names the user's own addresses: it must not open the private INBOX.
    await prisma.mailIntakeSender.create({ data: { userId, address: "me@example.org" } });
    box.add({
      uid: 1,
      raw: buildMail({
        messageId: "<self@x>",
        from: "Me <me@example.org>",
        subject: PRIVATE_SUBJECT,
      }),
    });
    const result = await runSource(id, box);
    expect(box.downloads).toEqual([]);
    expect(box.flags.size).toBe(0);
    expect(result.filtered).toBe(1);
    expect(await prisma.mailIntakeMessage.count()).toBe(0);
  });

  it("the instance mailbox also starts 'ab jetzt', never at UID 0", async () => {
    const { id } = await prisma.mailIntakeSource.create({
      data: {
        kind: "instance_mailbox",
        userId: null,
        host: "imap.example.org",
        port: 993,
        tlsMode: "tls",
        username: "trips@example.org",
        address: "trips@example.org",
        passwordEncrypted: encrypt("pw"),
        folder: "INBOX",
        enabled: true,
      },
    });
    for (let uid = 1; uid <= 50; uid += 1) box.add({ uid, raw: bookingMail(`i${uid}`) });
    await runSource(id, box);
    expect(box.downloads).toEqual([]);
    expect((await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id } })).lastUid).toBe(50);
  });

  it("a custom subject word lets a mail through; a switched-off default does not", async () => {
    const { id } = await mkSource({
      subjectKeywords: ["Arztbefund"],
      removedSubjectKeywords: ["Ihre Buchung"],
    });
    box.add({ uid: 1, raw: privateMail("p1") });
    box.add({
      uid: 2,
      raw: buildMail({ messageId: "<x@y>", from: "a@shop.example", subject: "Ihre Buchung" }),
    });
    await runSource(id, box);
    expect(box.downloads).toEqual([1]);
  });

  describe("Mails nicht als gelesen markieren", () => {
    it("sets only $TravStats, never \\Seen", async () => {
      const { id } = await mkSource();
      box.add({ uid: 1, raw: bookingMail("b1") });
      await runSource(id, box);
      expect(box.flags.get(1)).toEqual(["$TravStats"]);
    });

    it("sets \\Seen and $TravStats when switched off", async () => {
      const { id } = await mkSource({ keepUnread: false });
      box.add({ uid: 1, raw: bookingMail("b1") });
      await runSource(id, box);
      expect(box.flags.get(1)).toEqual(["\\Seen", "$TravStats"]);
    });

    it("without keyword support it flags nothing and the cursor + dedupe keep it single", async () => {
      const { id } = await mkSource();
      box.supportsKeywords = false;
      box.add({ uid: 1, raw: bookingMail("b1") });
      await runSource(id, box);
      expect(box.flags.size).toBe(0);
      expect((await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id } })).lastUid).toBe(1);

      await prisma.mailIntakeSource.update({ where: { id }, data: { lastUid: 0 } });
      await runSource(id, box);
      expect(await prisma.mailIntakeMessage.count()).toBe(1);
      expect(await prisma.document.count({ where: { userId } })).toBe(1);
    });
  });

  describe("Ab wann abholen", () => {
    it("a new source on a folder with 10,000 mails processes zero old ones in 'ab jetzt'", async () => {
      const { id } = await mkSource({ uidValidity: null, lastUid: 0 });
      for (let uid = 1; uid <= 10_000; uid += 1) box.add({ uid, raw: bookingMail(`old${uid}`) });
      const first = await runSource(id, box);

      expect(first).toMatchObject({ seen: 0, filtered: 0 });
      expect(box.downloads).toEqual([]);
      expect(box.headerFetches).toEqual([]);
      const source = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id } });
      expect(source).toMatchObject({ lastUid: 10_000, uidValidity: "1000" });

      box.add({ uid: 10_001, raw: bookingMail("new") });
      const second = await runSource(id, box);
      expect(second.seen).toBe(1);
      expect(box.downloads).toEqual([10_001]);
    });

    it("a changed UIDVALIDITY repositions at UIDNEXT-1 instead of rescanning from 0", async () => {
      const { id } = await mkSource({ lastUid: 3 });
      box.uidValidity = "2000";
      for (let uid = 1; uid <= 5; uid += 1) box.add({ uid, raw: bookingMail(`m${uid}`) });
      await runSource(id, box);
      expect(box.downloads).toEqual([]);
      const source = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id } });
      expect(source).toMatchObject({ lastUid: 5, uidValidity: "2000" });
    });

    it("'last 30 days' starts at the first mail of the window, still pre-filtered", async () => {
      const { id } = await mkSource({ uidValidity: null, fetchFrom: "days_30" });
      const old = new Date(Date.now() - 60 * 86_400_000);
      const recent = new Date(Date.now() - 5 * 86_400_000);
      box.add({ uid: 1, raw: bookingMail("old"), internalDate: old });
      box.add({ uid: 2, raw: privateMail("p"), internalDate: recent });
      box.add({ uid: 3, raw: bookingMail("recent"), internalDate: recent });
      const result = await runSource(id, box);
      expect(box.downloads).toEqual([3]);
      expect(result).toMatchObject({ seen: 1, filtered: 1 });
    });
  });

  it("logs no subject, sender or body of a skipped mail", async () => {
    const lines: string[] = [];
    const spies = (["trace", "debug", "info", "warn", "error", "fatal"] as const).map((level) =>
      jest.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        lines.push(JSON.stringify(args));
      }) as never)
    );
    const consoleSpy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(JSON.stringify(args));
    });
    try {
      const { id } = await mkSource();
      box.add({ uid: 1, raw: privateMail("p1") });
      box.add({ uid: 2, raw: bookingMail("b1") });
      await runSource(id, box);
    } finally {
      spies.forEach((s) => s.mockRestore());
      consoleSpy.mockRestore();
    }
    const all = lines.join("\n");
    expect(all).not.toContain(PRIVATE_SUBJECT);
    expect(all).not.toContain(PRIVATE_FROM);
    expect(all).not.toContain("praxis-private");
    expect(all).not.toContain("p1@p");
  });

  describe("source settings", () => {
    const base = {
      host: "imap.example.org",
      port: 993,
      tlsMode: "tls" as const,
      username: "me@example.org",
      password: "pw",
    };

    it("a new INBOX source keeps mails unread, filters, and starts 'ab jetzt'; another folder marks read", async () => {
      const inbox = await saveSource(userId, { ...base, folder: "INBOX" });
      expect(inbox).toMatchObject({ keepUnread: true, prefilter: true, fetchFrom: "now" });
      await prisma.mailIntakeSource.deleteMany({});
      const other = await saveSource(userId, { ...base, folder: "TravStats" });
      expect(other.keepUnread).toBe(false);
    });

    it("stores the custom lists normalised, and a new starting point resets the cursor", async () => {
      await saveSource(userId, { ...base, folder: "INBOX" });
      await prisma.mailIntakeSource.updateMany({ data: { uidValidity: "1000", lastUid: 50 } });
      const saved = await saveSource(userId, {
        ...base,
        folder: "INBOX",
        fetchFrom: "days_90",
        senderDomains: ["@My-Agency.example", "my-agency.example"],
        subjectKeywords: [" Ihre Reise "],
        removedSubjectKeywords: ["Reservierung"],
      });
      expect(saved).toMatchObject({
        fetchFrom: "days_90",
        senderDomains: ["my-agency.example"],
        subjectKeywords: ["Ihre Reise"],
        removedSubjectKeywords: ["Reservierung"],
      });
      const row = await prisma.mailIntakeSource.findFirstOrThrow({ where: { userId } });
      expect(row).toMatchObject({ uidValidity: null, lastUid: 0 });
    });
  });
});
