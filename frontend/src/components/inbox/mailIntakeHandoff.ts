import type { ParseDomain } from "../../lib/api/parse";
import type { ImportDocument } from "../import/documentHandoff";

/**
 * A proposal's mail on its way from the inbox to the import dialog of its
 * domain (forgejo#313). Travels as router state to `/dashboard`, where
 * `DashboardLayout` opens the dialog with the mail already dropped into it.
 */
export interface MailIntakeHandoff {
  domain: ParseDomain;
  document: ImportDocument;
}

const OPENABLE: readonly ParseDomain[] = ["flight", "cruise", "lodging", "rail", "rental"];

/** The dialog that can take a mail of this domain, or null (package, place, bus, ferry). */
export function openableDomain(domain: string | null): ParseDomain | null {
  return OPENABLE.find((d) => d === domain) ?? null;
}

export function mailIntakeHandoffOf(state: unknown): MailIntakeHandoff | null {
  const handoff = (state as { mailIntakeHandoff?: unknown } | null)?.mailIntakeHandoff;
  if (typeof handoff !== "object" || handoff === null) return null;
  const { domain, document } = handoff as { domain?: unknown; document?: unknown };
  const target = openableDomain(typeof domain === "string" ? domain : null);
  const file = (document as { kind?: unknown; file?: unknown } | null)?.file;
  return target && (document as { kind?: unknown }).kind === "file" && file instanceof File
    ? { domain: target, document: document as ImportDocument }
    : null;
}
