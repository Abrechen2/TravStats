import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";

/** forgejo#412 N1 — the unauthenticated status route handed out an admin's address. */
describe("GET /auth/smtp-status", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "smtpStatusAdmin" } });
    await prisma.$disconnect();
  });
  it("does not expose an admin contact address to anonymous callers", async () => {
    await prisma.user.deleteMany({ where: { username: "smtpStatusAdmin" } });
    await prisma.user.create({
      data: {
        username: "smtpStatusAdmin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
        notificationEmail: "secret-admin@example.com",
      },
    });
    const res = await request(app).get("/api/v1/auth/smtp-status");
    expect(res.status).toBe(200);
    expect(typeof res.body.smtpEnabled).toBe("boolean");
    expect(JSON.stringify(res.body)).not.toContain("secret-admin@example.com");
    expect(res.body).not.toHaveProperty("adminContactEmail");
  });
});
