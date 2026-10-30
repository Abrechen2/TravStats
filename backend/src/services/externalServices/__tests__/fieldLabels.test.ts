/**
 * Every field key the catalogue emits needs a DE and an EN label (forgejo#392).
 * The page labels a field from `fields.<serviceId>.<key>` then `fields.common.<key>`;
 * a key with neither renders as the raw key, silently, in a green suite.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { SERVICES } from "../catalogue";

type Labels = { fields?: Record<string, Record<string, string>> };

function load(lang: "de" | "en"): Labels {
  const file = join(
    __dirname,
    "../../../../../frontend/src/i18n/resources",
    lang,
    "externalServices.json"
  );
  return JSON.parse(readFileSync(file, "utf8")) as Labels;
}

describe.each(["de", "en"] as const)("external services field labels (%s)", (lang) => {
  const labels = load(lang);
  it("labels every field key the catalogue emits, admin and account side", () => {
    const missing: string[] = [];
    for (const service of SERVICES) {
      for (const field of [...service.fields, ...service.accountFields]) {
        const label =
          labels.fields?.[service.id]?.[field.key] ?? labels.fields?.common?.[field.key];
        if (!label) missing.push(`${service.id}.${field.key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
