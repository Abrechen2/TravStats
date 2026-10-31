/**
 * Every field key the catalogue emits needs a DE and an EN label (forgejo#392).
 * The page labels a field from `fields.<serviceId>.<key>` then `fields.common.<key>`;
 * a key with neither renders as the raw key, silently, in a green suite.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { SERVICES } from "../catalogue";
import { TEST_REASONS } from "../testRunner";
import { CATEGORY_ORDER } from "../types";

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

describe.each(["de", "en"] as const)("external services page copy (%s)", (lang) => {
  const raw = JSON.parse(
    readFileSync(
      join(__dirname, "../../../../../frontend/src/i18n/resources", lang, "externalServices.json"),
      "utf8"
    )
  ) as Record<string, Record<string, unknown>>;
  const has = (path: string): boolean => {
    let node: unknown = raw;
    for (const part of path.split(".")) {
      if (typeof node !== "object" || node === null || !(part in node)) return false;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "string" && node.length > 0;
  };

  it("words every test-failure code the server can store (a missing one shows as a raw code)", () => {
    expect(TEST_REASONS.filter((r) => !has(`test.reasons.${r}`))).toEqual([]);
  });

  it("names every category, level and recommendation the catalogue uses", () => {
    const missing: string[] = [];
    for (const c of CATEGORY_ORDER) if (!has(`categories.${c}`)) missing.push(`categories.${c}`);
    for (const s of SERVICES) {
      if (!has(`level.${s.level}`)) missing.push(`level.${s.level}`);
      if (s.recommended && !has(`recommended.${s.recommended}`))
        missing.push(`recommended.${s.recommended}`);
      for (const part of ["name", "purpose", "why", "cost", "dataOut"]) {
        if (!has(`services.${s.id}.${part}`)) missing.push(`services.${s.id}.${part}`);
      }
      if (s.quotaProvider && !has(`services.${s.id}.quotaLine`))
        missing.push(`services.${s.id}.quotaLine`);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
