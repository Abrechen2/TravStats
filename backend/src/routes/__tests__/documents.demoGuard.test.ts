import fs from "fs";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { createDocument } from "../../services/documents/documentService";
import { documentPath } from "../../services/documents/documentStore";

/**
 * The demo guard on the document routes is the boundary — ownership is not.
 *
 * `POST /documents` carried `rejectDemo`; `PATCH /documents/:id` and
 * `DELETE /documents/:id` did not, and were safe only because the shared demo
 * account can own no document, so the service would find nothing to touch
 * (beta API audit of 2026-09-19, unlisted finding 4). That is a property of
 * the DATA, not of the route, and it stops holding the moment a restored dump,
 * a seed or a reassignment gives the demo account one.
 *
 * So the measurement here gives it exactly that: a real document, owned by the
 * shared demo account, with its bytes on disk. Before the guard was mounted,
 * the PATCH answered 200 and the DELETE 204 and the row was gone. A test that
 * only asserted 403 for a document the demo account does NOT own would have
 * passed on the old code too, and proved nothing.
 */
const PDF = Buffer.from("%PDF-1.4\n% demo guard\n%%EOF");

describe("documents — the shared demo account may not change or delete one", () => {
  const stamp = Date.now();
  const ids: string[] = [];
  let demoCookie: string;
  let userCookie: string;
  let demoDocumentId: string;
  let storedName: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "demo" } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: {
        username: `docs-demo-neighbour-${stamp}`,
        passwordHash: await hashPassword("test-password"),
      },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;

    // The state the route was relying on never happening.
    const { document } = await createDocument({
      userId: demo.id,
      buffer: PDF,
      originalName: "boarding-pass.pdf",
      declaredMime: "application/pdf",
      declaredFormat: "pdf",
      source: "upload",
      kind: null,
      issuedOn: null,
      entry: null,
    });
    demoDocumentId = document.id;
    storedName = document.storedName;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId: { in: ids } } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    fs.rmSync(documentPath(storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("refuses PATCH for the shared demo account, even on its own document", async () => {
    const res = await request(app)
      .patch(`/api/v1/documents/${demoDocumentId}`)
      .set("Cookie", demoCookie)
      .send({ kind: "boardingPass" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");

    // Refused before the lookup: nothing about the row moved.
    const row = await prisma.document.findUnique({ where: { id: demoDocumentId } });
    expect(row?.kind).toBeNull();
  });

  it("refuses DELETE for the shared demo account, even on its own document", async () => {
    const res = await request(app)
      .delete(`/api/v1/documents/${demoDocumentId}`)
      .set("Cookie", demoCookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");

    // The row and the bytes are both still there.
    expect(await prisma.document.findUnique({ where: { id: demoDocumentId } })).not.toBeNull();
    expect(fs.existsSync(documentPath(storedName))).toBe(true);
  });

  it("refuses before it looks anything up: an id that does not exist is 403, not 404", async () => {
    // The order is the whole claim. A guard mounted below the handler would
    // answer 404 here, because the lookup would run first and miss.
    for (const send of [
      request(app)
        .patch("/api/v1/documents/00000000-0000-0000-0000-000000000000")
        .set("Cookie", demoCookie)
        .send({ kind: "boardingPass" }),
      request(app)
        .delete("/api/v1/documents/00000000-0000-0000-0000-000000000000")
        .set("Cookie", demoCookie),
    ]) {
      const res = await send;
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    }
  });

  it("refuses nothing for an ordinary account", async () => {
    const patch = await request(app)
      .patch("/api/v1/documents/00000000-0000-0000-0000-000000000000")
      .set("Cookie", userCookie)
      .send({ kind: "boardingPass" });
    expect(patch.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");

    const del = await request(app)
      .delete("/api/v1/documents/00000000-0000-0000-0000-000000000000")
      .set("Cookie", userCookie);
    expect(del.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
  });

  it("still lets the shared demo account READ a document it owns", async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${demoDocumentId}`)
      .set("Cookie", demoCookie);
    expect(res.status).toBe(200);
  });
});
