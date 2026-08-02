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
  // Master data was two combined pages before each catalogue became its own
  // sub-section. Land old links on the first catalogue of the same tab.
  cruiseMasterData: "shipsMasterData",
  airlineAircraftMasterData: "airlinesMasterData",
};

export function normalizeSectionId(raw: string | null): string | null {
  if (raw === null) return null;
  // A plain `SECTION_ALIASES[raw]` lookup resolves prototype members (e.g.
  // "constructor", "toString") through Object.prototype and returns a
  // FUNCTION instead of `undefined`, violating this function's `string | null`
  // return type. Guard with an own-property check first.
  if (!Object.prototype.hasOwnProperty.call(SECTION_ALIASES, raw)) return raw;
  return SECTION_ALIASES[raw];
}
