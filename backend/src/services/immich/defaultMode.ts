import type { ImmichMode } from "./types";

/**
 * The mode an album is linked in when the picker does not name one. Fixed at
 * "link" since settings v3 S6 (Part A: the account's default mode was a setting
 * nobody needed — the picker offers both modes per album). The stored
 * `immichDefaultMode` is no longer read; it stays in the table and in the
 * all-data export until the Companion version that stops sending it is named.
 */
export const IMMICH_DEFAULT_MODE: ImmichMode = "link";
