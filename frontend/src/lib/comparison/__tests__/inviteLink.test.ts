import { describe, expect, it } from "vitest";
import { decodeInvitePayload, INVITE_LINK_KIND } from "../inviteLink";

const encode = (o: unknown): string =>
  btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const base = {
  kind: INVITE_LINK_KIND,
  origin: "https://a.example",
  publicKey: "A".repeat(43),
  fingerprint: "a".repeat(64),
  token: "b".repeat(64),
  expiresAt: "2026-12-01T00:00:00.000Z",
};

describe("decodeInvitePayload", () => {
  it("accepts a v1 link", () => {
    expect(decodeInvitePayload(encode({ v: 1, ...base })).ok).toBe(true);
  });
  it("accepts a v2 link that carries the inviter's switches (v2 links were rejected as damaged)", () => {
    const switches = {
      plans: true,
      stats: "overview",
      achievements: true,
      leaderboard: true,
      tripOffers: false,
    };
    expect(decodeInvitePayload(encode({ v: 2, ...base, switches })).ok).toBe(true);
  });
  it("still rejects an unknown version", () => {
    expect(decodeInvitePayload(encode({ v: 3, ...base })).ok).toBe(false);
  });
});
