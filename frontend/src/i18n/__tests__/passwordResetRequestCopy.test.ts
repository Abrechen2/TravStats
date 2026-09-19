import { describe, it, expect } from "vitest";

import deAuth from "../resources/de/auth.json";
import enAuth from "../resources/en/auth.json";
import deDataQuality from "../resources/de/dataQuality.json";
import enDataQuality from "../resources/en/dataQuality.json";

/**
 * forgejo#88, point 2 — the sentence the dialog says when the instance cannot
 * send mail, and the inbox block that makes it true.
 *
 * The copy is pinned rather than merely counted: the whole change is a PROMISE
 * to the person who forgot their password ("an administrator has been
 * notified"), and a promise that drifts into "contact an administrator" is the
 * bug this fixed. `localeKeyParity` already guarantees the keys exist on both
 * sides; what it cannot say is that either sentence still means this.
 */
const keysOf = (obj: Record<string, unknown>): string[] => Object.keys(obj).sort();

describe("password-reset-request copy (forgejo#88)", () => {
  it("has the same forgot-password dialog keys in DE and EN", () => {
    expect(keysOf(deAuth.login.forgotPasswordModal)).toEqual(
      keysOf(enAuth.login.forgotPasswordModal)
    );
  });

  it("promises the administrator was told, in both languages", () => {
    expect(deAuth.login.forgotPasswordModal.noSmtpNotified).toMatch(/Administrator/);
    expect(deAuth.login.forgotPasswordModal.noSmtpNotified).toMatch(/Posteingang/);
    expect(enAuth.login.forgotPasswordModal.noSmtpNotified).toMatch(/administrator/i);
    expect(enAuth.login.forgotPasswordModal.noSmtpNotified).toMatch(/inbox/i);
  });

  it("has the same inbox-block keys in DE and EN", () => {
    expect(keysOf(deDataQuality.passwordResets)).toEqual(keysOf(enDataQuality.passwordResets));
  });

  it("names the user and the time in the row, via placeholders", () => {
    for (const row of [deDataQuality.passwordResets.row, enDataQuality.passwordResets.row]) {
      expect(row).toContain("{{username}}");
      expect(row).toContain("{{when}}");
    }
  });
});
