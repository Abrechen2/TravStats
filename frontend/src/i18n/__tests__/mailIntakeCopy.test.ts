import { describe, expect, it } from "vitest";

import de from "../resources/de/mailIntake.json";
import en from "../resources/en/mailIntake.json";
import { MAIL_REASONS, MAIL_SOURCE_ERRORS } from "../../lib/api/mailIntake";

/**
 * A reason or error kind without copy renders the key itself (react-i18next
 * returns it silently), so a kind the server can send needs words in both
 * languages. The parity test catches a one-sided key; this catches a missing one.
 */
describe.each([
  ["de", de],
  ["en", en],
])("mail intake copy (%s)", (_lang, copy) => {
  it("words every source error kind and every message reason", () => {
    const errors = copy.errors as Record<string, string>;
    const reasons = copy.reasons as Record<string, string>;
    expect(MAIL_SOURCE_ERRORS.filter((k) => !errors[k])).toEqual([]);
    expect(MAIL_REASONS.filter((k) => !reasons[k])).toEqual([]);
    expect(errors.MAIL_HOST_BLOCKED).toBeTruthy();
  });
});
