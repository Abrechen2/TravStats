import { putChallenge, takeChallenge, CHALLENGE_TTL_MS } from "../challengeStore";

describe("challengeStore", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns what was put in", () => {
    putChallenge("k1", "abc");
    expect(takeChallenge("k1")).toBe("abc");
  });

  // A challenge answers exactly one ceremony. Replaying it is the attack this
  // whole mechanism exists to prevent.
  it("hands a challenge out only once", () => {
    putChallenge("k2", "abc");
    expect(takeChallenge("k2")).toBe("abc");
    expect(takeChallenge("k2")).toBeNull();
  });

  it("returns null for a key that was never used", () => {
    expect(takeChallenge("never")).toBeNull();
  });

  it("expires", () => {
    jest.useFakeTimers();
    putChallenge("k3", "abc");
    jest.advanceTimersByTime(CHALLENGE_TTL_MS + 1000);
    expect(takeChallenge("k3")).toBeNull();
  });

  it("replaces an earlier challenge for the same key", () => {
    putChallenge("k4", "first");
    putChallenge("k4", "second");
    expect(takeChallenge("k4")).toBe("second");
  });
});
