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
});
