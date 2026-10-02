import { describe, it, expect } from "vitest";
import de from "../../../i18n/resources/de/pushRelay.json";
import en from "../../../i18n/resources/en/pushRelay.json";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  );
}

describe("pushRelay i18n", () => {
  it("DE and EN carry the same keys", () => {
    expect(flatten(en).sort()).toEqual(flatten(de).sort());
  });
  it("the consent label is the agreed German copy", () => {
    expect(de.enable).toBe("Push-Benachrichtigungen an die Companion-App einschalten");
  });
});
