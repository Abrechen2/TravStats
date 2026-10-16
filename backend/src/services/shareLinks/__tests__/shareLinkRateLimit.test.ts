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

  /** A stand-in for the public route: a token-shaped body is a live link, anything else is not. */
  function viewApp() {
    let limiter: express.RequestHandler | undefined;
    jest.isolateModules(() => {
      limiter = require("../../../middleware/shareLinkRateLimit").shareLinkViewLimiter;
    });
    const app = express();
    app.set("trust proxy", "loopback");
    app.use(express.json());
    app.post("/view", limiter!, (req, res) => {
      const live = String(req.body?.token ?? "").startsWith("ts_share_live");
      res.status(live ? 200 : 404).json({});
    });
    return (token: string, ip = "203.0.113.7") =>
      request(app).post("/view").set("X-Forwarded-For", ip).send({ token });
  }
  const token = (name: string) => `ts_share_${name.padEnd(43, "x")}`;

  it("keys a link per address: one link's viewers do not use up another link", async () => {
    // Behind a reverse proxy every viewer is one address; one busy link must
    // not close every other link of the instance.
    const view = viewApp();
    for (let i = 0; i < 30; i++) expect((await view(token("liveA"))).status).toBe(200);
    expect((await view(token("liveA"))).status).toBe(429);
    expect((await view(token("liveB"))).status).toBe(200);
  });

  it("still cuts off an address that keeps asking for links that do not exist", async () => {
    const view = viewApp();
    for (let i = 0; i < 30; i++) expect((await view(token(`guess${i}`))).status).toBe(404);
    expect((await view(token("guessmore"))).status).toBe(429);
    expect((await view(token("guessmore"), "198.51.100.9")).status).toBe(404);
  });
});
