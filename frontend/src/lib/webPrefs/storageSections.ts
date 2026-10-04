/**
 * Small helpers for the web-prefs sections that live in raw localStorage keys
 * rather than in a Zustand store (forgejo#200). Kept apart from `registry.ts`
 * so the registry reads as the list of decisions it is.
 */

import { onLocalPrefWrite } from "./prefEvents";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the server value shows this page, it just is not kept.
  }
}

function storageKeys(prefix: string): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // Unreadable storage reads as "nothing stored".
  }
  return keys;
}

/**
 * Every `<prefix><id>` key as `{ id: value }`, keeping only entries `keep`
 * accepts — a family of per-table or per-tab keys read as one section.
 */
export function readPrefixed(
  prefix: string,
  keep: (value: unknown) => boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of storageKeys(prefix)) {
    const value = readJson(key);
    if (keep(value)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

/**
 * Replaces the `<prefix>*` family with `entries`: the server wins, so a key it
 * does not hold is removed here rather than left to resurface.
 */
export function replacePrefixed(
  prefix: string,
  entries: Record<string, unknown>,
  keep: (value: unknown) => boolean
): void {
  for (const key of storageKeys(prefix)) {
    if (!(key.slice(prefix.length) in entries)) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // see writeJson
      }
    }
  }
  for (const [id, value] of Object.entries(entries)) {
    if (keep(value)) writeJson(prefix + id, value);
  }
}

export function onKey(key: string) {
  return (onChange: () => void) => onLocalPrefWrite((k) => k === key, onChange);
}

export function onPrefixes(...prefixes: string[]) {
  return (onChange: () => void) =>
    onLocalPrefWrite((k) => prefixes.some((p) => k.startsWith(p)), onChange);
}

export const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

export const isNonEmptyStringList = (value: unknown): value is string[] =>
  isStringList(value) && value.length > 0;
