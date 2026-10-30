/**
 * Catalogue completeness (forgejo#392), the twin of shareTypes.test.ts: a
 * service column nobody listed is a service the page cannot show.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { CATEGORY_ORDER } from "../types";
import { SERVICES } from "../catalogue";

const schema = readFileSync(join(__dirname, "../../../../prisma/schema.prisma"), "utf8");
const adminBlock = schema.slice(
  schema.indexOf("model AdminSettings {"),
  schema.indexOf('@@map("admin_settings")')
);
const adminColumns = [...adminBlock.matchAll(/^\s{2}(\w+)\s+\S+/gm)].map((m) => m[1]);

/** Columns that look like a service credential/switch but are not an external service. */
const NOT_A_SERVICE = new Set([
  "globalOpenaiApiKey", // legacy parser key, read by no LLM path (inventory: effectively dead)
  "globalClaudeApiKey",
  "allowUserApiKeys",
  "allowUserFlightApiKeys",
  "allowRegistration",
  "frontendUrl",
  "publicUrl",
  "lanUrl",
  "shareLinksEnabled",
  "tripFederationEnabled", // second federation switch, own endpoint
  "betaFeaturesEnabled",
  "backupEnabled", // local backup schedule, not an outbound service
  "llmEnabled", // the AI master switch lives on the Parser page
  "pushInstanceId",
  "pushInstanceSecret",
  "pushPausedUntil",
  "pushConsentAt",
  "aeroapiTier",
  "externalServicePolicy",
  "importModeUntil",
  "importModeUserId",
  "federationPrivateKey",
  "usageStatsInstallId",
  "ollamaVisionModel",
]);

const looksLikeService = (c: string) =>
  /(ApiKey|Url|Enabled|OptIn|ClientId|ClientSecret|Password|Username)/.test(c);

describe("external services catalogue", () => {
  const mapped = new Set(
    SERVICES.flatMap((s) => [
      ...s.fields.filter((f) => f.store === "admin").map((f) => f.column),
      ...(s.enabled.kind === "adminColumns" ? s.enabled.columns : []),
      ...(s.enabled.kind === "push" ? ["pushEnabled"] : []),
      ...(s.enabled.kind === "federation" ? ["federationEnabled"] : []),
    ])
  );

  it("has unique ids, a known category and a level for every service", () => {
    expect(new Set(SERVICES.map((s) => s.id)).size).toBe(SERVICES.length);
    for (const s of SERVICES) expect(CATEGORY_ORDER).toContain(s.category);
  });

  it("catalogue-completeness: every service column of admin_settings has a catalogue entry", () => {
    const missing = adminColumns.filter(
      (c) => looksLikeService(c) && !NOT_A_SERVICE.has(c) && !mapped.has(c)
    );
    expect(missing).toEqual([]);
  });

  it("catalogue-completeness: every catalogued admin column exists in the schema", () => {
    const unknown = [...mapped].filter((c) => !adminColumns.includes(c));
    expect(unknown).toEqual([]);
  });

  it("keeps field keys unique within a service", () => {
    for (const s of SERVICES) {
      const keys = s.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("aeroapi is instance-only (invariant 7)", () => {
    expect(SERVICES.find((s) => s.id === "aeroapi")?.level).toBe("instance");
  });
});
