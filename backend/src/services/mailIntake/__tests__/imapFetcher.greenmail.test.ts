/**
 * The real IMAP client against a real server (GreenMail). Skipped unless
 * GREENMAIL_HOST is set, so the suite stays runnable without Docker:
 *
 *   docker run -d --name gm -p 127.0.0.1:13143:3143 -p 127.0.0.1:13993:3993 \
 *     -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 \
 *     -Dgreenmail.users=trips:pw123@example.org" greenmail/standalone:2.1.3
 *   GREENMAIL_HOST=127.0.0.1 GREENMAIL_IMAP_PORT=13143 GREENMAIL_IMAPS_PORT=13993 npx jest <this file>
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { ImapFlow } from "imapflow";

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { encrypt } from "../../../utils/encryption";
import { imapFetcher, PROCESSED_KEYWORD } from "../mailFetcher";
import { runSource } from "../runSource";
import { rotateToken } from "../addressToken";
import { buildMail } from "./helpers";

const HOST = process.env.GREENMAIL_HOST;
const PORT = Number(process.env.GREENMAIL_IMAP_PORT ?? 3143);
const TLS_PORT = Number(process.env.GREENMAIL_IMAPS_PORT ?? 3993);
const suite = HOST ? describe : describe.skip;

const parseDocument = jest.fn<(input: object) => Promise<unknown>>();
jest.mock("../../parsing/parseDocument", () => ({
  parseDocument: (input: object) => parseDocument(input),
}));

suite("IMAP fetcher against GreenMail", () => {
  const prefix = `gm-${Date.now()}`;
  let userId: string;
  let token: string;
  let folder: string;
  let n = 0;

  const admin = (): ImapFlow =>
    new ImapFlow({
      host: HOST!,
      port: PORT,
      secure: false,
      doSTARTTLS: false,
      auth: { user: "trips", pass: "pw123" },
      logger: false,
    });

  async function append(raw: Buffer, to = folder): Promise<void> {
    const client = admin();
    await client.connect();
    try {
      await client.mailboxCreate(to).catch(() => undefined);
      await client.append(to, raw);
    } finally {
      await client.logout();
    }
  }

  const connection = (over: Record<string, unknown> = {}) => ({
    host: HOST!,
    port: PORT,
    tlsMode: "none" as const,
    username: "trips",
    password: "pw123",
    folder,
    ...over,
  });

  const mkSource = (over: Record<string, unknown> = {}) =>
    prisma.mailIntakeSource.create({
      data: {
        kind: "instance_mailbox",
        userId: null,
        host: HOST!,
        port: PORT,
        tlsMode: "none",
        username: "trips",
        address: "trips@example.org",
        passwordEncrypted: encrypt("pw123"),
        folder,
        enabled: true,
        ...over,
      },
    });

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: prefix, passwordHash: await hashPassword("password123") },
      })
    ).id;
    token = await rotateToken(userId);
    await prisma.mailIntakeSender.create({ data: { userId, address: "me@gmail.example" } });
  });

  beforeEach(async () => {
    n += 1;
    folder = `TS-${Date.now()}-${n}`;
    parseDocument.mockReset();
    parseDocument.mockResolvedValue({
      domain: "flight",
      body: { domain: "flight", flights: [{}], llmDisabledByAdmin: false },
    });
    await prisma.mailIntakeMessage.deleteMany({});
    await prisma.mailIntakeSource.deleteMany({});
    await prisma.document.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists only what is above afterUid, hands over the raw bytes and never deletes", async () => {
    const first = buildMail({ messageId: "<one@x>" });
    await append(first);
    await append(buildMail({ messageId: "<two@x>" }));

    await imapFetcher.withFolder(connection(), async (session) => {
      expect(session.uidValidity).toMatch(/^\d+$/);
      const all = await session.listNew(0);
      expect(all.map((m) => m.uid)).toEqual([1, 2]);
      // `N:*` returns the last message even when it is below N; the fetcher must not.
      expect(await session.listNew(2)).toEqual([]);
      const fetched = await session.fetchSource(1, 1024 * 1024);
      expect(fetched && "raw" in fetched && fetched.raw.toString("utf8")).toContain(
        "Message-ID: <one@x>"
      );
      expect(await session.markProcessed(1)).toBe(true);
    });

    const client = admin();
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const rows = await client.fetchAll("1:*", { uid: true, flags: true });
      expect(rows).toHaveLength(2); // nothing deleted, nothing moved
      const flagged = rows.find((r) => r.uid === 1)!;
      expect([...flagged.flags!]).toEqual(expect.arrayContaining(["\\Seen", PROCESSED_KEYWORD]));
      expect([...rows.find((r) => r.uid === 2)!.flags!]).not.toContain(PROCESSED_KEYWORD);
    } finally {
      lock.release();
      await client.logout();
    }
  });

  it("stops reading a mail that outgrows the cap, whatever size was announced", async () => {
    await append(buildMail({ messageId: "<big@x>", body: "y".repeat(300_000) }));
    await imapFetcher.withFolder(connection(), async (session) => {
      expect(await session.fetchSource(1, 100_000)).toEqual({ tooLarge: true });
      const whole = await session.fetchSource(1, 1_000_000);
      expect(whole && "raw" in whole && whole.raw.length).toBeGreaterThan(300_000);
    });
  });

  it("an empty folder is an empty run, not an error", async () => {
    await append(buildMail({}), folder).then(async () => {
      const client = admin();
      await client.connect();
      await client.mailboxDelete(folder).catch(() => undefined);
      await client.mailboxCreate(folder);
      await client.logout();
    });
    const source = await mkSource();
    expect(await runSource(source.id)).toMatchObject({ ran: true, seen: 0 });
  });

  it("end to end: a forwarded mail from an allowed sender becomes a proposal and is flagged", async () => {
    await append(
      buildMail({
        deliveredTo: `trips+${token}@example.org`,
        from: "me@gmail.example",
        messageId: "<fw@x>",
        authResults: "mx.example.org; dmarc=pass header.from=gmail.example",
      })
    );
    const source = await mkSource();
    expect(await runSource(source.id)).toMatchObject({ ran: true, seen: 1, proposed: 1 });
    expect(await runSource(source.id)).toMatchObject({ ran: true, seen: 0 });
    const [row] = await prisma.mailIntakeMessage.findMany();
    expect(row).toMatchObject({ status: "proposed", userId });
    const stored = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(stored).toMatchObject({ lastError: null, lastUid: 1 });
  });

  it("IDLE reports new mail within seconds and stops when told to", async () => {
    await append(buildMail({ messageId: "<seed@x>" }));
    const controller = new AbortController();
    let notified = 0;
    const watching = imapFetcher.watch(connection(), () => (notified += 1), controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await append(buildMail({ messageId: "<late@x>" }));
    const deadline = Date.now() + 8000;
    while (notified === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    controller.abort();
    await watching.catch(() => undefined);
    expect(notified).toBeGreaterThan(0);
  });

  describe("each failure kind, from the real client", () => {
    const failure = async (over: Record<string, unknown>) => {
      await append(buildMail({}));
      const source = await mkSource(over);
      const result = await runSource(source.id);
      const stored = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id: source.id } });
      return { result, stored };
    };

    it("wrong password → auth_failed", async () => {
      const { result, stored } = await failure({ passwordEncrypted: encrypt("wrong") });
      expect(result.error).toBe("auth_failed");
      expect(stored.lastError).toBe("auth_failed");
    });

    it("missing folder → folder_missing", async () => {
      expect((await failure({ folder: "does/not/exist" })).result.error).toBe("folder_missing");
    });

    it("closed port → connection_refused", async () => {
      expect((await failure({ port: 1 })).result.error).toBe("connection_refused");
    });

    it("unknown host → host_not_found", async () => {
      expect((await failure({ host: "no-such-host.invalid" })).result.error).toBe("host_not_found");
    });

    it("TLS spoken to a plain port → tls_error", async () => {
      expect((await failure({ tlsMode: "tls" })).result.error).toBe("tls_error");
    });

    it("a self-signed certificate is refused → tls_error (verification is never switched off)", async () => {
      expect((await failure({ tlsMode: "tls", port: TLS_PORT })).result.error).toBe("tls_error");
    });
  });
});
