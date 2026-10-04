import cors from "cors";
import express from "express";
import request from "supertest";

import { corsOriginCheck } from "../corsOrigin";
import { errorHandler } from "../errorHandler";

/**
 * forgejo#183: a refused origin answered 500 "Not allowed by CORS", an expected
 * refusal reported as a server failure.
 */
function appWith(corsOrigin: string): express.Express {
  const app = express();
  app.use(cors({ origin: corsOriginCheck(corsOrigin), credentials: true }));
  app.put("/api/v1/settings", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe("CORS origin check", () => {
  const app = appWith("http://127.0.0.1:3011, https://travstats.example");

  it("refuses a foreign origin with 403, not 500", async () => {
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Origin", "https://qa-cross-origin.invalid")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Not allowed by CORS");
  });

  it("lets a listed origin through, with its trimmed spelling", async () => {
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Origin", "https://travstats.example");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://travstats.example");
  });

  it("lets a request without an Origin header through (app, server-to-server)", async () => {
    expect((await request(app).put("/api/v1/settings")).status).toBe(200);
  });

  it("allows every origin under '*'", async () => {
    const res = await request(appWith("*"))
      .put("/api/v1/settings")
      .set("Origin", "https://any.example");
    expect(res.status).toBe(200);
  });
});
