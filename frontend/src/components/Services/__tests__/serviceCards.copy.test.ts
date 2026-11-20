import { describe, expect, it } from "vitest";
import de from "../../../i18n/resources/de/settingsRows.json";
import en from "../../../i18n/resources/en/settingsRows.json";
import { SERVICE_CARDS } from "../serviceCards";

/**
 * Owner, 2026-11-20: the "Dienste" page showed the raw keys
 * `services.cards.tar1090.n/.p` — the copy sat at `services.tar1090`, beside
 * `cards`, where `ServiceCard` never looks. The parity test cannot see that:
 * both locales were equally wrong.
 */
type Cards = Record<string, { n?: string; p?: string } | undefined>;
const cardsOf = (locale: unknown): Cards =>
  (locale as { services: { cards: Cards } }).services.cards;

describe("service card copy", () => {
  it.each([
    ["de", de],
    ["en", en],
  ])("names and describes every card in %s", (_lang, locale) => {
    const cards = cardsOf(locale);
    const missing = SERVICE_CARDS.filter((c) => !cards[c.id]?.n || !cards[c.id]?.p).map(
      (c) => c.id
    );
    expect(missing).toEqual([]);
  });
});
