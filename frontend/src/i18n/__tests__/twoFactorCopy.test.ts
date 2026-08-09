import { describe, it, expect } from "vitest";

import deAuth from "../resources/de/auth.json";
import enAuth from "../resources/en/auth.json";
import deSettings from "../resources/de/settings.json";
import enSettings from "../resources/en/settings.json";
import deCommon from "../resources/de/common.json";
import enCommon from "../resources/en/common.json";

/**
 * The two-factor UI reads every label through `t(...)` with no defaultValue, so
 * a key missing on one side renders the raw key path in that language rather
 * than falling back. DE and EN therefore have to move together.
 */
const keysOf = (obj: Record<string, unknown>): string[] => Object.keys(obj).sort();

describe("two-factor copy exists in both languages", () => {
  it("auth:twoFactor has the same keys in DE and EN", () => {
    expect(keysOf(deAuth.twoFactor)).toEqual(keysOf(enAuth.twoFactor));
  });

  it("settings:security has the same keys in DE and EN", () => {
    expect(keysOf(deSettings.security)).toEqual(keysOf(enSettings.security));
  });

  it("covers every label the challenge page asks for", () => {
    for (const key of [
      "title",
      "hint",
      "recoveryHint",
      "codeLabel",
      "recoveryLabel",
      "submit",
      "verifying",
      "useRecovery",
      "useCode",
      "rejected",
    ]) {
      expect(deAuth.twoFactor).toHaveProperty(key);
      expect(enAuth.twoFactor).toHaveProperty(key);
    }
  });

  it("covers every label the settings section asks for", () => {
    for (const key of [
      "title",
      "description",
      "enable",
      "scanHint",
      "manualHint",
      "codeLabel",
      "activate",
      "wrongCode",
      "setupFailed",
      "saveCodes",
      "enabled",
      "tokenWarning",
      "regenerate",
      "confirmRegenerate",
      "disable",
      "confirmDisable",
      "passwordLabel",
      "wrongPassword",
    ]) {
      expect(deSettings.security).toHaveProperty(key);
      expect(enSettings.security).toHaveProperty(key);
    }
  });

  // The section's "codes" stage closes on common:buttons.done, which did not
  // exist before this feature.
  it("has the done button both sides", () => {
    expect(deCommon.buttons).toHaveProperty("done");
    expect(enCommon.buttons).toHaveProperty("done");
  });

  it("states the PAT bypass rather than hiding it", () => {
    expect(deSettings.security.tokenWarning).toMatch(/API-Tokens/);
    expect(enSettings.security.tokenWarning).toMatch(/API tokens/);
  });
});
