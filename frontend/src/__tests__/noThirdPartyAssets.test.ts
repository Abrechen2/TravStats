import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flagImgHtml } from "../lib/countryFlag";
import { describe, expect, it } from "vitest";

// forgejo#413 (M4): the app must not hand a viewer's IP to a third-party CDN
// for assets it can serve itself. Map tiles are the one deliberate exception
// and are not part of these files.
const FORBIDDEN = ["flagcdn.com", "fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com"];
const read = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");

describe("no third-party asset hosts", () => {
  it.each(["index.html", "src/lib/countryFlag.tsx", "src/components/FlightCertificate.tsx"])(
    "%s loads flags, fonts and CSS from this instance only",
    (file) => {
      const source = read(file);
      for (const host of FORBIDDEN) {
        expect(source, `${file} references ${host}`).not.toContain(host);
      }
    }
  );

  it("a flag renders from a same-origin static file that is shipped, with no auth or rate limit in between", () => {
    const html = flagImgHtml("Deutschland");
    const src = html.match(/src="([^"]+)"/)?.[1] ?? "";
    expect(src).toBe("/flags/de.svg");
    expect(existsSync(resolve(__dirname, "../../public", src.slice(1)))).toBe(true);
  });

  it("the certificate's fonts are declared in the self-hosted font sheet", () => {
    const css = read("src/theme/fonts.css");
    for (const family of ["Fraunces", "Big Shoulders Display", "JetBrains Mono"]) {
      expect(css).toContain(`font-family: "${family}"`);
    }
  });
});
