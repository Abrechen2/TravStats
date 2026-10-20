/**
 * A trip-share code and a leaderboard code are mutually unredeemable (spec 2026-10-20 F1): the
 * `trip:` tag tells them apart, each parser refuses the other's form, and this one names the
 * mix-up so the screen can say "that is a leaderboard code" instead of "invalid".
 */
import { parseInviteCode } from "../../../comparison/remote";
import { formatTripInviteCode, parseTripInviteCode } from "../inviteCode";

const ORIGIN = "https://a.invite-code.test";
const SECRET = "ab".repeat(32);

it("round-trips a code it formatted, tolerating surrounding whitespace", () => {
  const code = formatTripInviteCode(ORIGIN, SECRET);
  expect(code).toBe(`${ORIGIN}#trip:${SECRET}`);
  expect(parseTripInviteCode(`  ${code}\n`)).toEqual({ ok: true, origin: ORIGIN, secret: SECRET });
});

it("names a leaderboard code as the wrong kind, not as invalid", () => {
  expect(parseTripInviteCode(`${ORIGIN}#${SECRET}`)).toEqual({
    ok: false,
    reason: "leaderboardCode",
  });
});

it("is refused by the leaderboard's parser in turn", () => {
  expect(parseInviteCode(formatTripInviteCode(ORIGIN, SECRET))).toBeNull();
  expect(parseInviteCode(`${ORIGIN}#${SECRET}`)).toEqual({ origin: ORIGIN, secret: SECRET });
});

it.each([
  ["no origin", `trip:${SECRET}`],
  ["the local placeholder", `local#trip:${SECRET}`],
  ["plain http", `http://a.invite-code.test#trip:${SECRET}`],
  ["a port", `https://a.invite-code.test:8443#trip:${SECRET}`],
  ["a path", `https://a.invite-code.test/x#trip:${SECRET}`],
  ["a short secret", `${ORIGIN}#trip:abc`],
  ["upper-case hex", `${ORIGIN}#trip:${SECRET.toUpperCase()}`],
  ["another tag", `${ORIGIN}#ride:${SECRET}`],
])("refuses %s as invalid", (_name, code) => {
  expect(parseTripInviteCode(code)).toEqual({ ok: false, reason: "invalid" });
});
