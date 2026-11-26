/**
 * The colours of the built-in travel purposes (shared/purposeCatalogue.ts; the same values as the
 * server's copy) and the colour a new custom purpose starts with. Purpose colours are data a user
 * can pick, so they are plain hex, kept here where the design warden allows literals.
 */
export const BUILTIN_PURPOSE_COLOR = {
  vacation: "#0EA5E9",
  business: "#475569",
  family_friends: "#DB2777",
  short_break: "#16A34A",
  event: "#9333EA",
  trade_fair: "#B45309",
  education: "#2563EB",
  health: "#DC2626",
  relocation: "#78716C",
  private_other: "#64748B",
} as const;

export const DEFAULT_CUSTOM_PURPOSE_COLOR = "#0EA5E9";
