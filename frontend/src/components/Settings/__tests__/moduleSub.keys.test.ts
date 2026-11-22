import { describe, it, expect } from "vitest";

import de from "../../../i18n/resources/de/common.json";
import en from "../../../i18n/resources/en/common.json";
import { DOMAINS } from "../../../shared/domains";

/** ModuleSection prints `settings.modules.sub.<domain>` for every available domain; a missing key shows raw. */
describe("settings module subtitles", () => {
  it.each(Object.entries(DOMAINS).filter(([, d]) => d.available))(
    "%s has a German and an English subtitle",
    (key) => {
      const sub = (j: unknown): Record<string, string> =>
        (j as { settings: { modules: { sub: Record<string, string> } } }).settings.modules.sub;
      expect(sub(de)[key]).toBeTruthy();
      expect(sub(en)[key]).toBeTruthy();
    }
  );
});
