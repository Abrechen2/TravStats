import { describe, it, expect } from "vitest";
import { PHONE_MAX_WIDTH_PX, initialLegendOpen } from "../legendInitialState";

/**
 * At 390×844 the map key opened by default and covered the pinned card's
 * action button — the one control the card exists to offer (browser
 * verification, beta.12). On a desktop it has room and the reader wants it.
 *
 * So the DEFAULT is width-dependent and the CHOICE is not: someone who opens
 * the key on a phone means it, and having it close again on the next
 * navigation is the same annoyance one page later (the reason it is
 * remembered at all).
 */
describe("whether the map key starts open", () => {
  it("opens on a desktop, where it has room", () => {
    expect(initialLegendOpen(null, false)).toBe(true);
  });

  it("stays closed on a phone, where it covers the card's own button", () => {
    expect(initialLegendOpen(null, true)).toBe(false);
  });

  it("respects a reader who opened it on a phone anyway", () => {
    expect(initialLegendOpen("true", true)).toBe(true);
  });

  it("respects a reader who closed it on a desktop", () => {
    expect(initialLegendOpen("false", false)).toBe(false);
  });

  it("uses the breakpoint the rest of the design system uses", () => {
    // Every other phone rule in this tree is `max-width: 639px`.
    expect(PHONE_MAX_WIDTH_PX).toBe(639);
  });
});
