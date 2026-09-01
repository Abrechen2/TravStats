/**
 * Turning one emoji into a picture deck.gl can draw.
 *
 * WHY THIS EXISTS AT ALL: deck.gl's `TextLayer` renders through a font atlas
 * built from a monochrome canvas, which cannot produce colour emoji. A glyph
 * put through it comes out as an opaque black box drawn on top of the pin — the
 * place is not merely unlabelled, it is invisible. That shipped once and was
 * reverted; `placePinsLayer.ts` carries the full account. The way back is an
 * `IconLayer` fed real bitmaps, which is what this makes.
 *
 * The cost is bounded by lists, not by places: a list has one symbol, so a user
 * with six lists rasterises six images however many thousand pins they carry.
 * Results are cached by glyph for the lifetime of the tab.
 *
 * Rasterising can fail — a browser with a blocked canvas, a headless test
 * environment. It returns `null` then rather than a placeholder, and the pin
 * layer downgrades those places to their names. An unreadable box is worse than
 * a name, which is the entire lesson of the revert above.
 */

/** Drawn size in device-independent pixels. Twice the label height, so the
 *  glyph reads at a glance without crowding the dot it sits above. */
const SPRITE_PX = 44;
/** Rasterised at 2x so the sprite stays crisp on a retina display. */
const SUPERSAMPLE = 2;

export interface EmojiSprite {
  /** Stable per glyph — deck.gl keys its packed atlas on this. */
  id: string;
  url: string;
  width: number;
  height: number;
  /** Anchored at the bottom so the glyph sits ABOVE its dot, the way the name
   *  label does with its negative pixel offset. */
  anchorY: number;
  /** Never a mask: the whole point is that the colours survive. */
  mask: false;
}

const cache = new Map<string, EmojiSprite | null>();

/** Test seam: the cache would otherwise carry one test's stubbed canvas into
 *  the next test's expectations. */
export function clearEmojiSpriteCache(): void {
  cache.clear();
}

function rasterise(glyph: string): EmojiSprite | null {
  const size = SPRITE_PX * SUPERSAMPLE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  // No family is named: the platform's own emoji font is the one that has the
  // colour glyphs, and naming a family here is how you end up with the
  // monochrome fallback that started this whole problem.
  ctx.font = `${Math.round(size * 0.78)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, size / 2, size / 2);

  try {
    const url = canvas.toDataURL("image/png");
    if (!url.startsWith("data:image/png")) return null;
    return { id: `emoji:${glyph}`, url, width: size, height: size, anchorY: size, mask: false };
  } catch {
    // A tainted canvas cannot be exported. Nothing here draws foreign pixels,
    // but the call is allowed to throw and a thrown label must not take the
    // whole map down with it.
    return null;
  }
}

/** The sprite for one glyph, or `null` if this environment cannot draw it. */
export function emojiSprite(glyph: string): EmojiSprite | null {
  const key = glyph.trim();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const made = rasterise(key);
  cache.set(key, made);
  return made;
}
