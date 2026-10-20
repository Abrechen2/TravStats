/**
 * Headings that repeat the heading right before them, in document order
 * (forgejo#321: "Immich" over "Immich", "Benutzer" under "Benutzer"). Hidden
 * accordion panels count — their cards are on the page, only collapsed.
 */
export function repeatedHeadings(root: HTMLElement): string[] {
  const texts = [...root.querySelectorAll("h1, h2, h3, h4")].map((h) =>
    (h.textContent ?? "").trim()
  );
  return texts.filter((text, i) => i > 0 && text !== "" && text === texts[i - 1]);
}
