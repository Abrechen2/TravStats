import { describe, it, expect, jest, beforeAll, afterAll } from "@jest/globals";

const parseBookingEmail = jest.fn<
  (
    subject?: string,
    text?: string,
    html?: string,
    settings?: { userId?: string; referenceDate?: Date },
  ) => Promise<unknown>
>();

jest.mock("../../services/bookingParser", () => ({
  parseBookingEmail: (...args: unknown[]) =>
    parseBookingEmail(...(args as Parameters<typeof parseBookingEmail>)),
}));

import fs from "fs";
import path from "path";

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The email's own date has to REACH the parser, not merely be accepted by the
 * schema.
 *
 * A test that only checked the field was allowed would have passed against the
 * broken version too: the route parsed the body all along and then dropped
 * everything it did not name. What matters is the value arriving as a Date at
 * the one place that can act on it (#285).
 */
describe("POST /api/v1/parse-email — the email's own date", () => {
  let user: { id: string };
  let authCookie: string;

  beforeAll(async () => {
    user = await prisma.user.create({
      data: {
        username: `parse-email-refdate-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;
    parseBookingEmail.mockResolvedValue({ flights: [], parserUsed: "regex" });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it("hands the given date to the parser", async () => {
    parseBookingEmail.mockClear();
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", authCookie)
      .send({ emailContent: "Flug LH1234 am 16 JUL", referenceDate: "2005-07-16" });

    expect(res.status).toBe(200);
    const settings = parseBookingEmail.mock.calls[0]?.[3];
    expect(settings?.referenceDate).toBeInstanceOf(Date);
    expect(settings?.referenceDate?.toISOString().slice(0, 10)).toBe("2005-07-16");
  });

  it("passes no date when the caller gave none, leaving today as the anchor", async () => {
    parseBookingEmail.mockClear();
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", authCookie)
      .send({ emailContent: "Flug LH1234 am 16 JUL" });

    expect(res.status).toBe(200);
    expect(parseBookingEmail.mock.calls[0]?.[3]).not.toHaveProperty("referenceDate");
  });

  /**
   * The FILE path, which is where the damage actually happened.
   *
   * The mechanism shipped wired to the JSON body only, and no client sends the
   * field — so on the one route people really use, an uploaded mailbox, the
   * anchor was never set and every year-less date was read against today. A
   * 2007 Germanwings confirmation imported as two 2026 flights and built a trip
   * in the wrong decade (Forgejo #18).
   *
   * THE FIXTURE IS WRITTEN BY THE TEST, and that is a correction rather than a
   * shortcut. The first version of this test uploaded a real `.msg` from
   * `test-samples/` and asserted `fs.existsSync()` on it. Those samples are the
   * owner's actual booking mail and are gitignored for that reason — 7 of the
   * 189 files there are tracked, all of them `.gitkeep` and a README. So the
   * test passed on the one machine that has the mailbox and could NEVER pass on
   * a fresh clone or in CI. A test that only works where the private data lives
   * is not a regression test; it is a local ritual.
   *
   * `.eml` carries the same information in a form that can be committed: the
   * send date sits in a `Date:` header, the extractor reads it through the same
   * `toDate` guard as the binary path, and the route treats both identically.
   * The `.msg` half is covered separately below, where it can be skipped
   * without pretending it ran.
   */
  it("anchors an uploaded message to the date the message itself carries", async () => {
    parseBookingEmail.mockClear();

    const eml = [
      "From: noreply@germanwings.com",
      "To: traveller@example.org",
      "Subject: Buchungsbestaetigung S5IZHP",
      "Date: Mon, 16 Jul 2007 09:12:00 +0200",
      "",
      "Ihr Flug 4U0081 am 26.07. von MUC nach CGN.",
      "",
    ].join("\r\n");

    const res = await request(app)
      .post("/api/v1/parse-email-file")
      .set("Cookie", authCookie)
      .attach("email", Buffer.from(eml, "utf-8"), "buchung.eml");

    expect(res.status).toBe(200);

    const settings = parseBookingEmail.mock.calls[0]?.[3];
    expect(settings?.referenceDate).toBeInstanceOf(Date);
    // 2007, not the current year — the whole point of the report.
    expect(settings?.referenceDate?.toISOString().slice(0, 10)).toBe("2007-07-16");
  });

  it("carries no anchor when the message has no date to give", async () => {
    // The route must degrade to the previous behaviour rather than refuse the
    // import: plenty of pasted or malformed mail has no usable header.
    parseBookingEmail.mockClear();

    const eml = ["Subject: Ohne Datum", "", "Flug LH400 am 15.01."].join("\r\n");

    await request(app)
      .post("/api/v1/parse-email-file")
      .set("Cookie", authCookie)
      .attach("email", Buffer.from(eml, "utf-8"), "ohne-datum.eml")
      .expect(200);

    expect(parseBookingEmail.mock.calls[0]?.[3]?.referenceDate).toBeUndefined();
  });

  /**
   * The binary path, on machines that have the owner's mailbox.
   *
   * Deliberately NOT a hard failure when the samples are absent, and
   * deliberately NOT silent about it either: a skipped test that reports
   * success is the exact trap Forgejo #28 describes. When the file is missing
   * this logs why, so a green run cannot be mistaken for a verified one.
   */
  it("reads the send date out of a real Outlook file when one is available", async () => {
    const sample = path.join(
      __dirname,
      "../../../../test-samples/Flug-emails/Buchungsdetails _ 23 November 2023_.msg"
    );
    if (!fs.existsSync(sample)) {
      // eslint-disable-next-line no-console
      console.warn(
        "[skipped] no .msg sample present — test-samples/ is gitignored private mail. " +
          "The .eml assertions above still cover the route; the binary reader does not."
      );
      return;
    }

    parseBookingEmail.mockClear();
    const res = await request(app)
      .post("/api/v1/parse-email-file")
      .set("Cookie", authCookie)
      .attach("email", sample);

    expect(res.status).toBe(200);
    const settings = parseBookingEmail.mock.calls[0]?.[3];
    expect(settings?.referenceDate?.toISOString().slice(0, 10)).toBe("2023-08-26");
  });

});
