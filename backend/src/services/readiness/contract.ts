/**
 * The registry's own rules (spec 2026-11-14 §5, §9), as a function so a test can
 * run it over the real catalogue AND over broken fixtures — a guard that has
 * never been seen to fail proves nothing.
 */
import type { CheckCatalogueEntry, NoteCatalogueEntry } from "../../shared/readinessCatalogue";
import { isValidVersion } from "../parsers/templates/v2/version";

export function catalogueProblems(
  checks: readonly (CheckCatalogueEntry & { evaluate?: unknown; appliesWhen?: unknown })[],
  notes: readonly (NoteCatalogueEntry & { appliesWhen?: unknown })[]
): string[] {
  const problems: string[] = [];
  const checkIds = new Set<string>();
  const keys = new Set<string>();
  const claimKey = (owner: string, key: string): void => {
    if (!key) problems.push(`${owner}: empty copy key`);
    else if (keys.has(key)) problems.push(`${owner}: copy key "${key}" used twice`);
    keys.add(key);
  };

  for (const c of checks) {
    if (checkIds.has(c.id)) problems.push(`check id "${c.id}" is duplicated`);
    checkIds.add(c.id);
    if (typeof c.evaluate !== "function") problems.push(`check "${c.id}" has no evaluator`);
    if (typeof c.appliesWhen !== "function") problems.push(`check "${c.id}" has no appliesWhen`);
    if (!Number.isInteger(c.revision) || c.revision < 1)
      problems.push(`check "${c.id}": bad revision`);
    if (!c.action.startsWith("/settings/"))
      problems.push(`check "${c.id}": action is not a settings address`);
    if (c.id.split(".")[0] !== c.scope)
      problems.push(`check "${c.id}": id prefix does not match scope`);
    claimKey(`check "${c.id}"`, c.titleKey);
    claimKey(`check "${c.id}"`, c.consequenceKey);
  }
  for (const c of checks) {
    if (c.blockedBy === null) continue;
    const blocker = checks.find((b) => b.id === c.blockedBy);
    if (!blocker) problems.push(`check "${c.id}" is blocked by unknown "${c.blockedBy}"`);
    else if (blocker.scope !== "admin")
      problems.push(`check "${c.id}": blockedBy must be an admin item`);
    else if (c.scope !== "user") problems.push(`check "${c.id}": only a user item can be blocked`);
  }

  const noteIds = new Set<string>();
  for (const n of notes) {
    if (noteIds.has(n.id)) problems.push(`note id "${n.id}" is duplicated`);
    noteIds.add(n.id);
    if (!isValidVersion(n.version)) problems.push(`note "${n.id}": bad version "${n.version}"`);
    const hasAction = n.action !== null;
    const hasReason = n.noActionReason !== null && n.noActionReason.trim() !== "";
    if (hasAction === hasReason) {
      problems.push(`note "${n.id}" needs exactly one of action and noActionReason`);
    }
    if (n.action?.kind === "check" && !checkIds.has(n.action.checkId)) {
      problems.push(`note "${n.id}" references unknown check "${n.action.checkId}"`);
    }
    if (n.action?.kind === "address" && !n.action.address.startsWith("/settings/")) {
      problems.push(`note "${n.id}": address is not a settings address`);
    }
    if (typeof n.appliesWhen !== "function") problems.push(`note "${n.id}" has no appliesWhen`);
    claimKey(`note "${n.id}"`, n.beforeKey);
    claimKey(`note "${n.id}"`, n.afterKey);
  }
  return problems;
}
