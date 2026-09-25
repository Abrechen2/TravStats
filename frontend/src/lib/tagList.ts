/**
 * Tag list arithmetic for the tag input. "Beach" and "beach" are one tag —
 * the backend's vocabulary merges them the same way — so the spelling that
 * arrived first is kept and later ones are dropped.
 */

const key = (tag: string): string => tag.trim().toLowerCase();

export function hasTag(tags: readonly string[], tag: string): boolean {
  const k = key(tag);
  return tags.some((t) => key(t) === k);
}

/** `tags` plus every new, non-blank entry of `incoming`, in order. */
export function addTags(tags: readonly string[], incoming: readonly string[]): string[] {
  return incoming.reduce<string[]>(
    (acc, raw) => {
      const tag = raw.trim();
      return tag && !hasTag(acc, tag) ? [...acc, tag] : acc;
    },
    [...tags]
  );
}

/** "a, b,,c " -> ["a", "b", "c"]; the shape every tagged form stored before. */
export function splitTagText(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
