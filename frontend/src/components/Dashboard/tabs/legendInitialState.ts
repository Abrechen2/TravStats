/**
 * Whether the map key starts open.
 *
 * At 390×844 it opened by default and covered the pinned card's action button
 * — the one control the card exists to offer (browser verification,
 * beta.12). On a desktop it has room and the reader wants it there.
 *
 * So the DEFAULT depends on the width and the CHOICE does not: someone who
 * opens the key on a phone means it, and having it close again on the next
 * navigation is the same annoyance one page later, which is why the choice is
 * remembered at all.
 *
 * A pure function rather than an inline ternary, because "when does it open"
 * is a rule and rules get a test.
 */

/** The phone breakpoint the rest of the tree uses (`@media (max-width: 639px)`). */
export const PHONE_MAX_WIDTH_PX = 639;

export function initialLegendOpen(stored: string | null, isPhone: boolean): boolean {
  if (stored === "true") return true;
  if (stored === "false") return false;
  return !isPhone;
}

/** True on a viewport the design system treats as a phone. SSR answers false. */
export function isPhoneViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`).matches;
  } catch {
    // A jsdom or older engine without matchMedia support: assume the roomier
    // side, which is the state this had before the rule existed.
    return false;
  }
}
