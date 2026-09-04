import { readFileSync } from "fs";
import { join } from "path";

/**
 * Every limiter that sits behind `authenticate` must key its bucket by the
 * user, never by the address — a household, or every user behind one reverse
 * proxy, shares one address. Three limiters were added without the key
 * generator and shipped that way for weeks (forgejo#68), and a route test
 * per limiter is expensive (it burns the window), so this guard reads the
 * source: a `rateLimit({ … })` block either names `keyGenerator: userOrIpKey`
 * or is on the short list of limiters that run BEFORE authentication, where
 * the address is the only key there is.
 *
 * The list is checked in both directions. A limiter on it that grows a key
 * generator, or disappears, fails the test too — a source-scanning guard
 * with a stale allow-list is a guard that has stopped biting.
 */
const PRE_AUTH_LIMITERS = ["authLimiter", "passwordResetLimiter", "pairingClaimLimiter"];

const source = readFileSync(join(__dirname, "..", "rateLimit.ts"), "utf8");

/** Every `export const <name> = rateLimit({ … });` block, with its body. */
function limiterBlocks(): Array<{ name: string; body: string }> {
  const re = /export const (\w+) = rateLimit\(\{([\s\S]*?)\n\}\);/g;
  const out: Array<{ name: string; body: string }> = [];
  for (const m of source.matchAll(re)) out.push({ name: m[1], body: m[2] });
  return out;
}

describe("rateLimit.ts — post-auth limiters are keyed by user", () => {
  const blocks = limiterBlocks();

  it("finds the limiters at all — the scan must not silently match nothing", () => {
    expect(blocks.length).toBeGreaterThan(20);
  });

  it("gives every limiter outside the pre-auth list a user key", () => {
    const unkeyed = blocks
      .filter((b) => !PRE_AUTH_LIMITERS.includes(b.name))
      .filter((b) => !/keyGenerator:\s*userOrIpKey/.test(b.body))
      .map((b) => b.name);
    expect(unkeyed).toEqual([]);
  });

  it("keeps the pre-auth list honest: each entry exists and has no user key", () => {
    for (const name of PRE_AUTH_LIMITERS) {
      const block = blocks.find((b) => b.name === name);
      expect(block).toBeDefined();
      expect(/keyGenerator/.test(block!.body)).toBe(false);
    }
  });
});
