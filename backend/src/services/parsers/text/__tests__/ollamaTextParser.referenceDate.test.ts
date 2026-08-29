import { describe, it, expect } from "@jest/globals";
import { buildSystemPrompt } from "../ollamaTextParser";

/**
 * Which year a year-less date belongs to.
 *
 * Booking confirmations of a certain age often write "16 JUL" and nothing
 * more, because the year was obvious to the person reading it that week. The
 * prompt has to name a reference point, and it used to name TODAY — so an
 * email from 2005 came back as a 2026 flight, silently, with the wrong year
 * written into the logbook (#285).
 *
 * Today is still the fallback, and it is the right one: for a confirmation
 * that just arrived, today IS the reference. What was missing is any way for
 * a caller who knows better — someone importing a mailbox export, who has the
 * message's own Date: header — to say so.
 */
describe("buildSystemPrompt — the year a bare date belongs to", () => {
  it("anchors on the date it is given, not on today", () => {
    const prompt = buildSystemPrompt(new Date("2005-07-16T09:50:00Z"));

    expect(prompt).toContain("2005-07-16");
    expect(prompt).not.toContain(new Date().toISOString().slice(0, 10));
    // The example ISO string must move with the anchor, or the model is shown
    // one year and told another.
    expect(prompt).toContain("2005-06-10T12:35");
  });

  it("falls back to today when no reference date is given", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain(new Date().toISOString().slice(0, 10));
  });
});
