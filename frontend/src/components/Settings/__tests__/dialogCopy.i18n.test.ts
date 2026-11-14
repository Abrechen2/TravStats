import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../../i18n/config";
import { dialogCopyOf } from "../rowCopy";

/**
 * Runs the REAL translator: a key-echoing mock cannot tell a missing key from a
 * translation, which is how "dialogs.peerremove.word" reached the screen as the
 * word to type.
 */
const t = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options);
const exists = (key: string): boolean => i18n.exists(key);

describe("dialog copy against the real resources", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("de");
  });

  it("asks for no word where the dialog has none (peerremove, userlock)", () => {
    expect(dialogCopyOf(t, exists, "peerremove", { name: "a.example" }).word).toBeUndefined();
    expect(dialogCopyOf(t, exists, "userlock", { name: "ben" }).word).toBeUndefined();
  });

  it("asks for the word where the dialog names one", () => {
    expect(dialogCopyOf(t, exists, "userdel", { name: "ben", count: 2 }).word).toBe("ben");
  });
});
