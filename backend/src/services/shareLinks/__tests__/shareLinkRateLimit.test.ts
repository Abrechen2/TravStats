import { describe, expect, it, jest } from "@jest/globals";
import express from "express";
import request from "supertest";

/**
 * The public share-link limiters (forgejo#281, design §2 T4/T6): per address,
 * IPv6 masked to /56 through `ipKeyGenerator`, and silent when built.
 */
describe("share-link rate limits", () => {
  it("build without an ERR_ERL_KEY_GEN_IPV6 complaint", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jest.isolateModules(() => {
        require("../../../middleware/shareLinkRateLimit");
      });
      const complaints = spy.mock.calls
        .flat()
        .map(String)
        .filter((s) => s.includes("ERR_ERL"));
      expect(complaints).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("cuts a resolving client off after 30 a minute, and one /56 is one client", async () => {
    let limiter: express.RequestHandler | undefined;
    jest.isolateModules(() => {
      limiter = require("../../../middleware/shareLinkRateLimit").shareLinkViewLimiter;
    });
    const app = express();
    app.set("trust proxy", "loopback");
    app.post("/view", limiter!, (_req, res) => {
      res.status(404).json({ code: "SHARE_LINK_NOT_FOUND" });
    });
    const from = (ip: string) => request(app).post("/view").set("X-Forwarded-For", ip);

    for (let i = 0; i < 30; i++) {
      // Thirty different hosts of one /56 share the bucket.
      expect((await from(`2001:db8:0:12${i.toString(16).padStart(2, "0")}::${i + 1}`)).status).toBe(
        404
      );
    }
    const blocked = await from("2001:db8:0:1200::ffff");
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect((await from("2001:db8:0:1300::1")).status).toBe(404);
  });
});
