import request from "supertest";
import fs from "fs";
import path from "path";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

// No mocking of the lodging parser here — this file drives the real
// template parser end-to-end through the actual route, proving the wiring
// works with a REAL Booking.com confirmation, not just a synthetic mock.

// The owner's REAL booking confirmations. Gitignored, present only on his
// machine — the suite skips itself everywhere else so CI stays green. We
// assert on extracted VALUES only; the raw file content is never printed
// or logged.
const SAMPLE_DIR = path.resolve(__dirname, "../../..", "test-samples", "Hotel Buchungen");
const hasSamples = fs.existsSync(SAMPLE_DIR);
const describeSamples = hasSamples ? describe : describe.skip;

function findSample(nameFragment: string): Buffer {
  const file = fs.readdirSync(SAMPLE_DIR).find((f) => f.includes(nameFragment) && f.endsWith(".msg"));
  if (!file) throw new Error(`No sample matching "${nameFragment}"`);
  return fs.readFileSync(path.join(SAMPLE_DIR, file));
}

describeSamples("POST /api/v1/parse-email-file (domain=lodging, real sample, unmocked parser)", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    const user = await prisma.user.create({
      data: {
        username: `lodging-real-sample-test-${timestamp}`,
        passwordHash: await hashPassword("pw123456"),
        isAdmin: false,
        isActive: true,
      },
    });
    userId = user.id;
    token = generateToken(userId);
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("parses a real Booking.com .msg into a candidate with hotel, dates and price", async () => {
    const buffer = findSample("Bastion");

    const res = await request(app)
      .post("/api/v1/parse-email-file")
      .set("Cookie", [`auth_token=${token}`])
      .attach("email", buffer, "bastion.msg")
      .field("domain", "lodging");

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("lodging");
    expect(res.body.parserUsed).toBe("template");
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].lodging.name).toBe("Bastion Hotel Zoetermeer");
    expect(res.body.candidates[0].stay.checkIn).toBe("2026-06-04");
    expect(res.body.candidates[0].stay.checkOut).toBe("2026-06-07");
    expect(res.body.candidates[0].stay.totalPrice).toBeCloseTo(451.7, 2);
    expect(res.body.candidates[0].stay.externalRef).toBe("booking:6546766578");
  });
});
