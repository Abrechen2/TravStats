import { describe, expect, it } from "@jest/globals";

import {
  generateShareToken,
  looksLikeShareToken,
  shareTokenHash,
  shareTokenMatches,
} from "../token";

/** The secret of a public share link (forgejo#281, design §2 T4). */
describe("share tokens", () => {
  it("carry 256 random bits after a recognisable prefix", () => {
    const { token } = generateShareToken();
    expect(token).toMatch(/^ts_share_[A-Za-z0-9_-]{43}$/);
    const bytes = Buffer.from(token.slice("ts_share_".length), "base64url");
    expect(bytes).toHaveLength(32);
  });

  it("never repeat, and are stored only as their SHA-256", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const { token, tokenHash } = generateShareToken();
      expect(seen.has(token)).toBe(false);
      seen.add(token);
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenHash).not.toContain(token.slice(9));
      expect(tokenHash).toBe(shareTokenHash(token));
    }
  });

  it("are checked for shape before any lookup", () => {
    const { token } = generateShareToken();
    expect(looksLikeShareToken(token)).toBe(true);
    for (const bad of [
      undefined,
      42,
      "",
      "ts_share_",
      token.slice(0, -1),
      `${token}A`,
      token.replace("ts_share_", "ts_pat_"),
      `ts_share_${"!".repeat(43)}`,
    ]) {
      expect(looksLikeShareToken(bad)).toBe(false);
    }
  });

  it("compare against the stored hash", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(shareTokenMatches(a.token, a.tokenHash)).toBe(true);
    expect(shareTokenMatches(a.token, b.tokenHash)).toBe(false);
    expect(shareTokenMatches(a.token, "abc")).toBe(false);
  });
});
