import { describe, it, expect } from "vitest";
import de from "../../../i18n/resources/de/usageStats.json";
import en from "../../../i18n/resources/en/usageStats.json";
import deCommon from "../../../i18n/resources/de/common.json";
import enCommon from "../../../i18n/resources/en/common.json";

function resolve(bundle: unknown, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

const USAGE_STATS_KEYS = [
  "admin.title",
  "admin.description",
  "admin.enabled",
  "admin.disabled",
  "admin.installId",
  "admin.installIdHint",
  "admin.endpointDisabled"
];

const COMMON_KEYS = ["loading.title"];

describe("UsageStatsSettings i18n keys", () => {
  it.each(USAGE_STATS_KEYS)("resolves usageStats:%s to a string in DE and EN", (key) => {
    expect(typeof resolve(de, key)).toBe("string");
    expect(typeof resolve(en, key)).toBe("string");
  });

  it.each(COMMON_KEYS)("resolves common:%s to a string in DE and EN", (key) => {
    expect(typeof resolve(deCommon, key)).toBe("string");
    expect(typeof resolve(enCommon, key)).toBe("string");
  });
});
