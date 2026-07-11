/**
 * The section hosting external integrations used to be called "API keys" —
 * `apiKeys` on the admin page, `apikeys` (lowercase k) in user settings. It was
 * renamed to `externalServices` when the global Immich connection moved in,
 * because nobody looks for an Immich instance under "API keys" (see #182).
 *
 * Both pages read the active section out of the URL — from `?section=`, and in
 * user settings also from the hash. Bookmarks and copy-pasted links still carry
 * the old ids, so every read site funnels through `normalizeSectionId`;
 * otherwise an old link silently drops the user on the default section.
 */
const SECTION_ALIASES: Readonly<Record<string, string>> = {
  apiKeys: "externalServices",
  apikeys: "externalServices",
};

export function normalizeSectionId(raw: string | null): string | null {
  if (raw === null) return null;
  return SECTION_ALIASES[raw] ?? raw;
}
