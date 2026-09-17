import { parseCruiseBookingText } from "../cruiseBookingParser";

/**
 * The deterministic path runs BEFORE the model, and reaching it must not
 * depend on a model being there.
 *
 * Until this landed, `parseCruiseBookingText` asked whether Ollama answered
 * and threw if it did not — so an instance without a local model could not
 * import a cruise booking at all, whatever the document said. Measured on the
 * sample set, every cruise confirmation failed for that reason alone.
 *
 * The fixture is invented; the real confirmations stay out of the repository.
 */

const TUI_CONFIRMATION = `
TUI Cruises GmbH • Musterweg 1 • 20097 Hamburg
Mein Schiff 9\tIhr Schiff:
Ihre Reise: 2 Nächte - Testland - ab/bis Musterhafen
www.meinschiff.com
Vorgang-Nr.: 1234567/2
Mein Schiff 9
Innenkabine (2er Belegung)
Deck 8 - Welle - Kabine 8042
Änderungen der Termine, Route, Tendern, Liegezeiten
vorbehalten
01.05.2027 Musterhafen - 02.05.2027 Seetag - 03.05.2027 Musterhafen
Premium Alles Inklusive
2 x Kreuzfahrtpreis 4.198,00 €\t2.099,00 €\t1-2
`;

/** Port 9 is the discard port: nothing listens, so the check cannot pass. */
const NO_OLLAMA = { url: "http://127.0.0.1:9", model: "does-not-matter" };

describe("parseCruiseBookingText — the template path comes first", () => {
  it("parses a TUI confirmation with no model reachable at all", async () => {
    const result = await parseCruiseBookingText(TUI_CONFIRMATION, NO_OLLAMA);

    expect(result.parserUsed).toBe("template");
    expect(result.ollamaAvailable).toBe(false);
    expect(result.cruises).toHaveLength(1);
    expect(result.cruises[0].shipName).toBe("Mein Schiff 9");
    expect(result.cruises[0].stops).toHaveLength(3);
  });

  // The fall-back must still fall back: a document no template recognises has
  // to reach the model, and say so plainly when the model is not there.
  //
  // "Plainly" stopped meaning "by throwing" on 2026-09-17. The route turned a
  // throw into HTTP 503, so a cruise line no template covers met an ERROR on
  // an instance with no model — while a hotel in exactly the same position got
  // an empty result and the offer to type it in. Same situation, two answers,
  // and the wrong one belonged to the domain with fewer templates.
  it("abstains for a document no template recognises, and says why", async () => {
    const result = await parseCruiseBookingText(
      "Ihre Buchung bei einer anderen Reederei",
      NO_OLLAMA
    );

    expect(result.parserUsed).toBe("none");
    expect(result.cruises).toEqual([]);
    expect(result.ollamaAvailable).toBe(false);
    expect(result.fallbackReason).toMatch(/Ollama is not reachable/);
  });
});
