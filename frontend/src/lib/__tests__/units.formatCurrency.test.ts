/**
 * #264 — an amount must be written in the UI's language, not in whatever
 * locale the machine happens to run under.
 *
 * `Intl.NumberFormat(undefined, …)` resolves to the RUNTIME locale. Only
 * seven currencies carried a locale hint, so for the other 148 the amount
 * followed the browser while the exchange rate one line below followed the UI
 * language — two number formats in the same card. These tests force the
 * question by asserting the German grouping separator, which is exactly what
 * a host running under an English locale would get wrong.
 */
import { describe, it, expect } from "vitest";
import { formatCurrency } from "../units";

describe("formatCurrency and the UI language", () => {
  it("writes a currency without a locale hint in German when the UI is German", () => {
    // AED is one of the 148 currencies that carried no hint.
    const out = formatCurrency(11662, "AED", { language: "de" });
    expect(out).toContain("11.662");
    expect(out).not.toContain("11,662");
  });

  it("writes the same amount in English when the UI is English", () => {
    const out = formatCurrency(11662, "AED", { language: "en" });
    expect(out).toContain("11,662");
  });

  it("honours the language for a hinted currency too", () => {
    // EUR used to be pinned to de-DE regardless of the UI language, so an
    // English UI got German grouping on its most common currency.
    expect(formatCurrency(1234.5, "EUR", { language: "en" })).toContain("1,234");
    expect(formatCurrency(1234.5, "EUR", { language: "de" })).toContain("1.234");
  });

  it("keeps the currency's own digit count", () => {
    // JPY has no minor unit, KWD has three — the language must not change that.
    expect(formatCurrency(1000, "JPY", { language: "de" })).not.toMatch(/[.,]\d\d(?!\d)/);
    expect(formatCurrency(1.234, "KWD", { language: "de" })).toContain("234");
  });

  it("is deterministic without a language instead of following the host", () => {
    // No language and no initialised i18n must still produce ONE stable
    // answer — the whole point of #264 is that the host locale stops leaking.
    const a = formatCurrency(11662, "AED");
    const b = formatCurrency(11662, "AED");
    expect(a).toBe(b);
    expect(a).not.toBe("");
  });

  it("still degrades to a readable string for a malformed code", () => {
    expect(formatCurrency(12, "NOTACODE", { language: "de" })).toContain("NOTACODE");
  });

  it("compact drops the decimals", () => {
    expect(formatCurrency(1234.56, "EUR", { compact: true, language: "de" })).not.toContain("56");
  });
});
