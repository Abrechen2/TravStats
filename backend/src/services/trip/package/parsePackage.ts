/**
 * Reading a package-tour document — template or nothing.
 *
 * The active v2 `package` templates are tried in order; the first whose
 * matcher accepts the document AND whose reading satisfies the contract wins.
 * No operator is compiled in (owner ruling 1, 2026-10-09): without a matching
 * template the answer is an empty reading with a code saying why, never a
 * model's guess at an itinerary — a package spans weeks and a dozen bookings,
 * and a misread one would be a dozen wrong rows.
 *
 * A template that recognises the document but reads values the contract
 * refuses is not passed over in silence: when no other template succeeds,
 * the answer is `invalidReading` with that template's id and the paths that
 * failed, which is what the template's author needs to fix it.
 */
import type { TemplateEnvelope } from "../../parsers/templates/v2/envelope";
import { applyTemplate } from "../../parsers/templates/v2/runners";
import { validatePackageValues, type PackageContract } from "./contract";

export type PackageFallbackCode = "noTemplate" | "invalidReading";

export interface PackageTemplateRef {
  id: string;
  version: string;
  issuer: string;
}

export interface PackageParseResult {
  reading: PackageContract | null;
  template: PackageTemplateRef | null;
  fallbackCode?: PackageFallbackCode;
  /** English, for the log and the template author — the client words the code. */
  fallbackReason?: string;
  issues?: string[];
}

const refOf = (t: TemplateEnvelope): PackageTemplateRef => ({
  id: t.id,
  version: t.version,
  issuer: t.issuer.name,
});

export function parsePackageText(
  text: string,
  templates: readonly TemplateEnvelope[]
): PackageParseResult {
  let refused: { template: TemplateEnvelope; issues: string[] } | null = null;
  for (const template of templates) {
    if (template.domain !== "package") continue;
    const applied = applyTemplate(template, text);
    if (!applied.matched) continue;
    const checked = validatePackageValues(applied.values);
    if (checked.ok) return { reading: checked.contract, template: refOf(template) };
    refused ??= { template, issues: checked.issues };
  }
  if (refused) {
    return {
      reading: null,
      template: refOf(refused.template),
      fallbackCode: "invalidReading",
      fallbackReason: `Template ${refused.template.id} read values the package contract refuses`,
      issues: refused.issues,
    };
  }
  return {
    reading: null,
    template: null,
    fallbackCode: "noTemplate",
    fallbackReason: "No package template recognises this document",
  };
}
