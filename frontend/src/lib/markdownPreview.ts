/**
 * Reduce Markdown source to the bare text a compact preview should show.
 *
 * Used where a diary entry has to appear as a single short run of text — the
 * timeline card's headline — and rendered Markdown would be wrong rather than
 * merely unstyled: a heading or a list inside a one-line headline is noise.
 * Where the preview has room to render (the card's body), render it instead.
 */
export function stripMarkdown(markdown: string): string {
  return (
    markdown
      // Fenced blocks first, so their content cannot be mistaken for markers.
      .replace(/```[\s\S]*?```/g, " ")
      // An image carries no text worth previewing — drop it whole. Must run
      // before the link rule, which would otherwise consume the "[…](…)" tail
      // and leave a stray "!" behind.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      // Emphasis needs a non-space beside the marker, so arithmetic like
      // "3 * 4" survives; underscore emphasis additionally needs whitespace
      // around the pair, so an identifier like trip_photo_id survives too --
      // which is also how Markdown itself treats intra-word underscores.
      .replace(/\*(\S(?:[^*]*\S)?)\*/g, "$1")
      .replace(/(^|\s)_(\S(?:[^_]*\S)?)_(?=\s|$)/gm, "$1$2")
      // Line-leading structure, stripped while the newlines still exist.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, " ")
      .replace(/^\s{0,3}[-*+]\s+/gm, "")
      .replace(/^\s{0,3}\d+\.\s+/gm, "")
      // A preview is one run of text: newlines become ordinary spaces.
      .replace(/\s+/g, " ")
      .trim()
  );
}
