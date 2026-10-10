import { afterAll, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";

/**
 * Found in the browser check of forgejo#281: the /share page POSTs to its own
 * server, the browser sends an Origin with it, and on an instance whose
 * CORS_ORIGIN did not name that address the request died with 403 before it
 * reached the route — every link opened there showed "no connection". The
 * public share API is left out of the CORS refusal and gets no CORS headers,
 * so a foreign page still cannot read it.
 */
describe("public share links and CORS", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("answers a page on an unlisted origin with the link's own answer, not a CORS 403", async () => {
    const res = await request(app)
      .post("/api/v1/public/share-links/view")
      .set("Origin", "http://lan-name.example:8040")
      .send({ token: "ts_share_" + "A".repeat(43) });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SHARE_LINK_NOT_FOUND");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("still refuses that origin everywhere else", async () => {
    const res = await request(app)
      .get("/api/v1/share-links")
      .set("Origin", "http://lan-name.example:8040");
    expect(res.status).toBe(403);
  });
});
