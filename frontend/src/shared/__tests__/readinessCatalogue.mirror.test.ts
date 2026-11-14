import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { CHECK_CATALOGUE, NOTE_CATALOGUE } from "../readinessCatalogue";
import { resolveAddress } from "../../pages/Settings/area/redirects";
import de from "../../i18n/resources/de/readiness.json";
import en from "../../i18n/resources/en/readiness.json";

// The server owns ids, revisions and addresses; the web owns the copy. Neither
// side can see the other's half, so a renamed key rendered as raw key text and a
// guessed address silently fell back to the default settings page.

const lookup = (tree: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);

const keys = [
  ...CHECK_CATALOGUE.flatMap((c) => [c.titleKey, c.consequenceKey]),
  ...NOTE_CATALOGUE.flatMap((n) => [n.beforeKey, n.afterKey]),
];

const addresses = [
  ...CHECK_CATALOGUE.map((c) => c.action),
  ...NOTE_CATALOGUE.flatMap((n) => (n.action?.kind === "address" ? [n.action.address] : [])),
];

describe("readiness catalogue", () => {
  it("is byte-identical on both sides", () => {
    const read = (file: string) => fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
    const front = read(path.join(__dirname, "..", "readinessCatalogue.ts"));
    const back = read(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "backend",
        "src",
        "shared",
        "readinessCatalogue.ts"
      )
    );
    expect(front).toBe(back);
  });

  it.each(keys)("has DE and EN copy for %s", (key) => {
    expect(typeof lookup(de, key)).toBe("string");
    expect(typeof lookup(en, key)).toBe("string");
  });

  it.each(addresses)("lands %s on the page it names", (address) => {
    const url = new URL(address, "http://x");
    const { to, adminOnly } = resolveAddress({
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      isAdmin: true,
      isDomainOn: () => true,
      lastPage: null,
    });
    expect(adminOnly).toBe(false);
    expect(new URL(to, "http://x").pathname).toBe(url.pathname);
  });
});
