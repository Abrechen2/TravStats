import { describe, it, expect } from "vitest";
import { FEDERATION_ERROR_CODES } from "../federationAdmin";
import { KNOWN_COMPARISON_CODES } from "../comparison";
import deAdmin from "../../../i18n/resources/de/admin.json";
import enAdmin from "../../../i18n/resources/en/admin.json";
import deCmp from "../../../i18n/resources/de/comparison.json";
import enCmp from "../../../i18n/resources/en/comparison.json";

const ADMISSION_CODES = [
  "FEDERATION_OFF",
  "FEDERATION_ADMISSION_DISABLED",
  "FEDERATION_ADMISSION_KEY_MISMATCH",
  "FEDERATION_ADMISSION_SUSPENDED",
  "FEDERATION_ADMISSION_FULL",
  "FEDERATION_ADMISSION_INVALID",
  "FEDERATION_ADMISSION_UNREACHABLE",
  "FEDERATION_ADMISSION_NOT_FOUND",
  "FEDERATION_ADMISSION_NOT_PENDING",
];

describe("federation error copy", () => {
  it("every admission code is known to the admin and the comparison mapping, in DE and EN", () => {
    for (const code of ADMISSION_CODES) {
      expect(FEDERATION_ERROR_CODES, code).toContain(code);
      expect(KNOWN_COMPARISON_CODES, code).toContain(code);
      for (const [name, copy] of [
        ["de admin", (deAdmin.federation.error as Record<string, string>)[code]],
        ["en admin", (enAdmin.federation.error as Record<string, string>)[code]],
        ["de comparison", (deCmp.error as Record<string, string>)[code]],
        ["en comparison", (enCmp.error as Record<string, string>)[code]],
      ] as const)
        expect(copy, `${name} ${code}`).toBeTruthy();
    }
  });

  it("every admin federation code has DE and EN copy", () => {
    for (const code of FEDERATION_ERROR_CODES) {
      expect((deAdmin.federation.error as Record<string, string>)[code], `de ${code}`).toBeTruthy();
      expect((enAdmin.federation.error as Record<string, string>)[code], `en ${code}`).toBeTruthy();
    }
  });
});
