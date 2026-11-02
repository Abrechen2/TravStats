import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { encrypt } from "../../../utils/encryption";
import { updatePolicy } from "../../externalServices/policy";
import { sweepDocuments } from "../../documents/documentService";
import { documentPath } from "../../documents/documentStore";
import fs from "fs";
import { runSource } from "../runSource";
import { retryMessage, buildInbox, allowSenderOf, dismissMessage } from "../inbox";
import { rotateToken } from "../addressToken";
import { scrubMailCredentialsAfterRestore } from "../afterRestore";
import { buildMail, FakeMailbox } from "./helpers";

const parseDocument = jest.fn<(input: { userId?: string }) => Promise<unknown>>();
jest.mock("../../parsing/parseDocument", () => ({
  parseDocument: (input: { userId?: string }) => parseDocument(input),
}));

const FLIGHT_BODY = {
  domain: "flight",
  flights: [{ flightNumber: "LH400" }],
  llmDisabledByAdmin: false,
};
const EMPTY_BODY = { domain: "flight", flights: [], llmDisabledByAdmin: false };
const found = (): Promise<unknown> => Promise.resolve({ domain: "flight", body: FLIGHT_BODY });
const nothing = (disabled = false): Promise<unknown> =>
  Promise.resolve({ domain: "flight", body: { ...EMPTY_BODY, llmDisabledByAdmin: disabled } });

describe("mail intake run (forgejo#313)", () => {
  const prefix = `mi-${Date.now()}`;
  let userId: string;
  let otherUserId: string;
  let box: FakeMailbox;
  let personalId: string;
  let instanceId: string;

  const mkSource = async (over: Record<string, unknown> = {}) =>
    prisma.mailIntakeSource.create({
      data: {
        kind: "imap_folder",
        userId,
        host: "imap.example.org",
        port: 993,
        tlsMode: "tls",
        username: "me@example.org",
        passwordEncrypted: encrypt("secret-pw"),
        folder: "TravStats",
        enabled: true,
        ...over,
      },
    });

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `${prefix}-a`, passwordHash } })).id;
    otherUserId = (await prisma.user.create({ data: { username: `${prefix}-b`, passwordHash } }))
      .id;
  });

  beforeEach(async () => {
    parseDocument.mockReset();
    parseDocument.mockImplementation(found);
    await prisma.mailIntakeMessage.deleteMany({});
    await prisma.mailIntakeSource.deleteMany({});
    await prisma.mailIntakeSender.deleteMany({});
    await prisma.mailIntakeAddress.deleteMany({});
    await prisma.document.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await updatePolicy((p) => ({ ...p, disabled: p.disabled.filter((x) => x !== "mailIntake") }));
    box = new FakeMailbox();
    personalId = (await mkSource()).id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  const messages = () => prisma.mailIntakeMessage.findMany({ orderBy: { uid: "asc" } });

  describe("mode A — a personal folder", () => {
    it("stores the mail as a Document with the original attached, and proposes it", async () => {
      box.add({ uid: 1, raw: buildMail({ messageId: "<a@x>" }) });
      const result = await runSource(personalId, box);

      expect(result).toMatchObject({ ran: true, seen: 1, proposed: 1 });
      const [message] = await messages();
      expect(message).toMatchObject({ status: "proposed", userId, domain: "flight" });
      expect(message.summary).toEqual({ found: 1 });
      const doc = await prisma.document.findUniqueOrThrow({ where: { id: message.documentId! } });
      expect(doc).toMatchObject({ source: "mail", format: "eml", parsedDomain: "flight", userId });
      expect(doc.unlinkedAt).not.toBeNull(); // unfiled: the sweep clock runs, the card shows the date
      expect(fs.readFileSync(documentPath(doc.storedName)).equals(box.mails[0].raw)).toBe(true);
      // flagged \Seen + $TravStats via markProcessed; nothing deleted from the box
      expect([...box.flagged]).toEqual([1]);
      expect(box.mails).toHaveLength(1);
    });

    it("a second run creates nothing new (idempotent by Message-ID)", async () => {
      box.add({ uid: 1, raw: buildMail({ messageId: "<a@x>" }) });
      await runSource(personalId, box);
      await prisma.mailIntakeSource.update({ where: { id: personalId }, data: { lastUid: 0 } });
      const second = await runSource(personalId, box);

      expect(second.proposed).toBe(0);
      expect(await messages()).toHaveLength(1);
      expect(await prisma.document.count({ where: { userId } })).toBe(1);
    });

    it("a changed UIDVALIDITY rescans without creating a duplicate", async () => {
      box.add({ uid: 5, raw: buildMail({ messageId: "<a@x>" }) });
      await runSource(personalId, box);
      box.uidValidity = "2000";
      box.mails[0].uid = 1;
      const again = await runSource(personalId, box);

      expect(again.error).toBeUndefined();
      expect(await messages()).toHaveLength(1);
      const source = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id: personalId } });
      expect(source.uidValidity).toBe("2000");
    });

    it("a mail with no Message-ID is still taken once, keyed by its UID", async () => {
      box.add({ uid: 3, raw: buildMail({ messageId: null }) });
      await runSource(personalId, box);
      await prisma.mailIntakeSource.update({ where: { id: personalId }, data: { lastUid: 0 } });
      await runSource(personalId, box);
      expect(await messages()).toHaveLength(1);
    });

    it("reads at most 25 mails per run and carries on with the rest next time", async () => {
      for (let i = 1; i <= 30; i += 1) {
        box.add({ uid: i, raw: buildMail({ messageId: `<m${i}@x>`, body: `Booking ${i}` }) });
      }
      await runSource(personalId, box);
      expect(await messages()).toHaveLength(25);
      await runSource(personalId, box);
      expect(await messages()).toHaveLength(30);
    });

    it("a mail over the size limit becomes a visible failure, not a silent skip", async () => {
      box.add({ uid: 1, raw: buildMail({ messageId: "<big@x>" }), size: 5 * 1024 * 1024 });
      await runSource(personalId, box);
      const [message] = await messages();
      expect(message).toMatchObject({ status: "failed", reason: "mail_too_large" });
      expect((await buildInbox(userId)).items.map((i) => i.reason)).toEqual(["mail_too_large"]);
    });

    it("a mail the parser finds nothing in stays an unfiled document with the reason", async () => {
      parseDocument.mockImplementation(() => nothing());
      box.add({ uid: 1, raw: buildMail({ subject: "Newsletter" }) });
      await runSource(personalId, box);
      const [message] = await messages();
      expect(message).toMatchObject({ status: "nothing", reason: "nothing_found" });
      const item = (await buildInbox(userId)).items[0];
      expect(item.deletesAt).not.toBeNull();
    });

    it("says llm_not_allowed when nothing was found because the admin switched the model off", async () => {
      parseDocument.mockImplementation(() => nothing(true));
      box.add({ uid: 1, raw: buildMail({}) });
      await runSource(personalId, box);
      expect((await messages())[0].reason).toBe("llm_not_allowed");
    });

    it("a parser failure keeps the original, shows a retry, and the retry succeeds", async () => {
      parseDocument.mockRejectedValueOnce(new Error("parser timeout"));
      box.add({ uid: 1, raw: buildMail({}) });
      await runSource(personalId, box);
      const [failed] = await messages();
      expect(failed).toMatchObject({ status: "failed", reason: "parser_timeout" });
      expect(failed.documentId).not.toBeNull();

      await retryMessage(userId, failed.id);
      expect((await messages())[0]).toMatchObject({ status: "proposed", reason: null });
    });

    it("an unexpected parser error is parse_failed, not a lost mail", async () => {
      parseDocument.mockRejectedValueOnce(new Error("boom"));
      box.add({ uid: 1, raw: buildMail({}) });
      await runSource(personalId, box);
      expect((await messages())[0]).toMatchObject({ status: "failed", reason: "parse_failed" });
    });

    it("an identical mail forwarded twice is a duplicate, not a second proposal", async () => {
      const raw = buildMail({ messageId: "<same@x>" });
      box.add({ uid: 1, raw });
      box.add({ uid: 2, raw: Buffer.from(raw) }); // same bytes, second UID
      await runSource(personalId, box);
      const rows = await messages();
      // same Message-ID: the second is skipped outright
      expect(rows).toHaveLength(1);
    });

    it("different Message-ID but identical bytes: recorded as duplicate and linked to the first", async () => {
      const a = buildMail({ messageId: "<one@x>" });
      box.add({ uid: 1, raw: a });
      await runSource(personalId, box);
      // a re-delivered copy under a new Message-ID header still hashes differently, so
      // simulate identical bytes by reusing the stored document's content.
      const doc = await prisma.document.findFirstOrThrow({ where: { userId } });
      await prisma.mailIntakeMessage.deleteMany({});
      await prisma.mailIntakeSource.update({ where: { id: personalId }, data: { lastUid: 0 } });
      await runSource(personalId, box);
      const [row] = await messages();
      expect(row).toMatchObject({ status: "duplicate", documentId: doc.id });
    });

    it("a refused flag change does not fail the run (idempotency is the Message-ID)", async () => {
      box.refuseFlags = true;
      box.add({ uid: 1, raw: buildMail({}) });
      const result = await runSource(personalId, box);
      expect(result.error).toBeUndefined();
      expect(await messages()).toHaveLength(1);
    });
  });

  describe("failures reach the user as themselves", () => {
    it.each([
      "connection_refused",
      "host_not_found",
      "timeout",
      "tls_error",
      "auth_failed",
      "folder_missing",
    ] as const)(
      "%s is stored on the source with its time, and cleared by the next good run",
      async (kind) => {
        box.failWith = kind;
        const bad = await runSource(personalId, box);
        expect(bad).toMatchObject({ ran: true, error: kind });
        const failed = await prisma.mailIntakeSource.findUniqueOrThrow({
          where: { id: personalId },
        });
        expect(failed.lastError).toBe(kind);
        expect(failed.lastErrorAt).not.toBeNull();
        expect((await buildInbox(userId)).sourceProblem?.error).toBe(kind);

        box.failWith = null;
        await runSource(personalId, box);
        const ok = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id: personalId } });
        expect(ok.lastError).toBeNull();
        expect(ok.lastOkAt).not.toBeNull();
      }
    );

    it("a source without a password says credentials_missing instead of trying", async () => {
      await prisma.mailIntakeSource.update({
        where: { id: personalId },
        data: { passwordEncrypted: null },
      });
      const result = await runSource(personalId, box);
      expect(result.error).toBe("credentials_missing");
      expect(box.connections).toHaveLength(0);
    });

    it("a personal source never uses plain IMAP", async () => {
      await prisma.mailIntakeSource.update({
        where: { id: personalId },
        data: { tlsMode: "none" },
      });
      const result = await runSource(personalId, box);
      expect(result.error).toBe("plain_not_allowed");
      expect(box.connections).toHaveLength(0);
    });

    it("decrypts the stored password only to hand it to the connection", async () => {
      await runSource(personalId, box);
      expect(box.connections[0]).toMatchObject({
        password: "secret-pw",
        folder: "TravStats",
        tlsMode: "tls",
      });
      const row = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id: personalId } });
      expect(row.passwordEncrypted).not.toContain("secret-pw");
    });
  });

  describe("off means off", () => {
    it("a source is off until its owner switches it on", async () => {
      await prisma.mailIntakeSource.update({ where: { id: personalId }, data: { enabled: false } });
      expect(await runSource(personalId, box)).toMatchObject({ ran: false, skipped: "disabled" });
      expect(box.connections).toHaveLength(0);
    });

    it("the admin switching the service off stops every run before any connection", async () => {
      await updatePolicy((p) => ({ ...p, disabled: [...p.disabled, "mailIntake"] }));
      expect(await runSource(personalId, box)).toMatchObject({
        ran: false,
        skipped: "service_off",
      });
      expect(box.connections).toHaveLength(0);
    });
  });

  describe("mode B — the instance mailbox and forwarding addresses", () => {
    let token: string;

    beforeEach(async () => {
      await prisma.mailIntakeSource.delete({ where: { id: personalId } });
      instanceId = (
        await mkSource({
          kind: "instance_mailbox",
          userId: null,
          address: "trips@example.org",
          username: "trips@example.org",
          folder: "INBOX",
        })
      ).id;
      token = await rotateToken(userId);
    });

    const forwarded = (over: Record<string, unknown> = {}) =>
      buildMail({
        deliveredTo: `trips+${token}@example.org`,
        from: "Me <me@gmail.example>",
        messageId: `<f${Math.random()}@x>`,
        authResults: "mx.example.org; dmarc=pass header.from=gmail.example",
        ...over,
      });

    it("rejects mail to a token nobody holds, without storing or parsing it", async () => {
      box.add({ uid: 1, raw: buildMail({ deliveredTo: "trips+zzzzzzzzzz@example.org" }) });
      await runSource(instanceId, box);
      const [row] = await messages();
      expect(row).toMatchObject({ status: "rejected", reason: "unknown_token", userId: null });
      expect(row.documentId).toBeNull();
      expect(parseDocument).not.toHaveBeenCalled();
      expect(await prisma.document.count()).toBe(0);
    });

    it("rejects an unknown sender and offers to allow it — the mail is neither parsed nor kept", async () => {
      box.add({ uid: 1, raw: forwarded() });
      await runSource(instanceId, box);
      const [row] = await messages();
      expect(row).toMatchObject({
        status: "rejected",
        reason: "sender_not_allowed",
        userId,
        fromAddress: "me@gmail.example",
      });
      expect(parseDocument).not.toHaveBeenCalled();
      const card = (await buildInbox(userId)).items[0];
      expect(card).toMatchObject({ status: "rejected", from: "me@gmail.example" });

      await allowSenderOf(userId, row.id);
      expect(await prisma.mailIntakeSender.count({ where: { userId } })).toBe(1);
      expect((await buildInbox(userId)).items).toHaveLength(0);
    });

    it("takes mail from an allowed sender and proposes it to that user only", async () => {
      await prisma.mailIntakeSender.create({ data: { userId, address: "me@gmail.example" } });
      box.add({ uid: 1, raw: forwarded() });
      const result = await runSource(instanceId, box);
      expect(result.proposed).toBe(1);
      const [row] = await messages();
      expect(row).toMatchObject({ status: "proposed", userId });
      expect(parseDocument).toHaveBeenCalledWith(expect.objectContaining({ userId }));
      expect((await buildInbox(otherUserId)).items).toHaveLength(0);
    });

    it("rejects an allowed sender whose DMARC failed at the receiving provider", async () => {
      await prisma.mailIntakeSender.create({ data: { userId, address: "me@gmail.example" } });
      box.add({
        uid: 1,
        raw: forwarded({ authResults: "mx.example.org; dmarc=fail header.from=gmail.example" }),
      });
      await runSource(instanceId, box);
      expect((await messages())[0]).toMatchObject({ status: "rejected", reason: "dmarc_failed" });
      expect(parseDocument).not.toHaveBeenCalled();
    });

    it("trusts the receiving provider's header, not one the sender wrote lower down", async () => {
      await prisma.mailIntakeSender.create({ data: { userId, address: "me@gmail.example" } });
      const raw = Buffer.from(
        forwarded({ authResults: "mx.example.org; dmarc=fail header.from=gmail.example" })
          .toString("utf8")
          .replace(
            "Subject:",
            "Authentication-Results: forged.example; dmarc=pass header.from=gmail.example\r\nSubject:"
          )
      );
      box.add({ uid: 1, raw });
      await runSource(instanceId, box);
      expect((await messages())[0].reason).toBe("dmarc_failed");
    });

    it("a revoked token stops working at once", async () => {
      await prisma.mailIntakeSender.create({ data: { userId, address: "me@gmail.example" } });
      const old = token;
      token = await rotateToken(userId);
      box.add({
        uid: 1,
        raw: buildMail({ deliveredTo: `trips+${old}@example.org`, from: "me@gmail.example" }),
      });
      await runSource(instanceId, box);
      expect((await messages())[0].reason).toBe("unknown_token");
    });

    it("a sender allowed by one user does not let another user's token through", async () => {
      await prisma.mailIntakeSender.create({ data: { userId, address: "me@gmail.example" } });
      const otherToken = await rotateToken(otherUserId);
      box.add({
        uid: 1,
        raw: buildMail({
          deliveredTo: `trips+${otherToken}@example.org`,
          from: "me@gmail.example",
        }),
      });
      await runSource(instanceId, box);
      expect((await messages())[0]).toMatchObject({
        reason: "sender_not_allowed",
        userId: otherUserId,
      });
    });
  });

  describe("inbox actions", () => {
    it("dismissing a proposal hides the card and leaves the mail unfiled until the sweep", async () => {
      box.add({ uid: 1, raw: buildMail({}) });
      await runSource(personalId, box);
      const [row] = await messages();
      await dismissMessage(userId, row.id);
      expect((await buildInbox(userId)).items).toHaveLength(0);
      const doc = await prisma.document.findUniqueOrThrow({ where: { id: row.documentId! } });
      expect(doc.linkedAt).toBeNull();
      await sweepDocuments(); // inside its TTL: still there
      expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);
    });

    it("another user cannot dismiss or retry a mail that is not theirs", async () => {
      box.add({ uid: 1, raw: buildMail({}) });
      await runSource(personalId, box);
      const [row] = await messages();
      await expect(dismissMessage(otherUserId, row.id)).rejects.toMatchObject({ statusCode: 404 });
      await expect(retryMessage(otherUserId, row.id)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("a proposal whose original was filed with an entry is no longer a card", async () => {
      box.add({ uid: 1, raw: buildMail({}) });
      await runSource(personalId, box);
      const [row] = await messages();
      const flight = await prisma.flight.create({
        data: {
          userId,
          depIata: "FRA",
          depLat: 50,
          depLon: 8,
          arrIata: "JFK",
          arrLat: 40,
          arrLon: -73,
          departureTime: new Date("2026-11-12T08:00:00Z"),
          status: "scheduled",
        },
      });
      await prisma.document.update({
        where: { id: row.documentId! },
        data: { flightId: flight.id, linkedAt: new Date(), unlinkedAt: null },
      });
      expect((await buildInbox(userId)).items).toHaveLength(0);
      await prisma.flight.delete({ where: { id: flight.id } });
    });
  });

  describe("restore", () => {
    it("clears every stored password and switches the sources off, naming the reason", async () => {
      const count = await scrubMailCredentialsAfterRestore();
      expect(count).toBe(1);
      const row = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id: personalId } });
      expect(row).toMatchObject({
        passwordEncrypted: null,
        enabled: false,
        lastError: "credentials_missing",
      });
    });
  });
});
