/**
 * An ISO 3166-1 alpha-2 code in the reader's language.
 *
 * The server sends codes and never names — a country name belongs to the
 * reader's language and the server does not know it. Shared by the passport
 * card and its table so the two can only ever spell a country the same way.
 */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    // A locale the browser has no region names for. The code is still correct,
    // just terser — better than an empty cell.
    return code;
  }
}
