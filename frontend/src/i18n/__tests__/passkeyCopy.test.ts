import { describe, it, expect } from "vitest";

import deAuth from "../resources/de/auth.json";
import enAuth from "../resources/en/auth.json";
import deSettings from "../resources/de/settings.json";
import enSettings from "../resources/en/settings.json";

/**
 * The passkey UI reads every label through `t(...)` with no defaultValue, so a
 * key missing on one side renders the raw key path instead of falling back.
 */
const keysOf = (obj: Record<string, unknown>): string[] => Object.keys(obj).sort();

describe("passkey copy exists in both languages", () => {
  it("settings:passkeys has the same keys in DE and EN", () => {
    expect(keysOf(deSettings.passkeys)).toEqual(keysOf(enSettings.passkeys));
  });

  it("covers every label the passkey section asks for", () => {
    for (const key of [
      "title",
      "description",
      "none",
      "add",
      "nameLabel",
      "namePlaceholder",
      "confirmAdd",
      "remove",
      "rpIdLabel",
      "lastUsed",
      "neverUsed",
      "addFailed",
      "removeFailed",
      "insecureOrigin",
      "notConfigured",
    ]) {
      expect(deSettings.passkeys).toHaveProperty(key);
      expect(enSettings.passkeys).toHaveProperty(key);
    }
  });

  it("covers the login-page passkey copy", () => {
    for (const key of ["or", "passkeySubmit", "passkeySubmitting", "passkeyFailed"]) {
      expect(deAuth.login).toHaveProperty(key);
      expect(enAuth.login).toHaveProperty(key);
    }
  });

  // The insecure-origin text is the one a self-hoster on a LAN IP will actually
  // hit, so it has to name the cause rather than just say "not available".
  it("explains the HTTPS requirement rather than shrugging", () => {
    expect(deSettings.passkeys.insecureOrigin).toMatch(/HTTPS/);
    expect(enSettings.passkeys.insecureOrigin).toMatch(/HTTPS/);
  });
});
