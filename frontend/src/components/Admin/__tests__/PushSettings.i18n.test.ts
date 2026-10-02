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
  it("says the relay also keeps the instance name with this server's hostname", () => {
    // travstats-push stores the name sent at registration ("TravStats <hostname>").
    expect(de.explanation.stores).toContain("Hostname");
    expect(en.explanation.stores).toContain("hostname");
    expect(de.explanation.stores).not.toMatch(
      /nur eine Instanz-ID, ein Hash ihres Geheimnisses und/
    );
  });
  it("names who runs the relay for the default and for a custom address", () => {
    expect(de.explanation.operator).toContain("push.travstats.de");
    expect(de.explanation.operator).toContain("Relay-Adresse");
    expect(en.explanation.operator).toContain("push.travstats.de");
    expect(en.explanation.operator).toContain("relay address");
  });
  it("the consent label is the agreed German copy", () => {
    expect(de.enable).toBe("Push-Benachrichtigungen an die Companion-App einschalten");
  });
});
