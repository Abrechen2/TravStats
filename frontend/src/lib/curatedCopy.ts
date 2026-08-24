/**
 * Locale pick for catalog copy.
 *
 * `CuratedList` / `CuratedPlace` carry German and English side by side in the
 * TABLE, because a database row cannot go through the i18n resource files the
 * way UI copy does. So the choice happens at render time, here, in one place —
 * not with a ternary at each of the dozen sites that show a wonder's name.
 *
 * German is primary and is the fallback: `nameEn` is deliberately null wherever
 * the two are identical ("Petra", "Machu Picchu"), so an English reader falls
 * through to a name that is already correct rather than to a duplicated row.
 */
export function curatedText(
  de: string,
  en: string | null | undefined,
  language: string
): string {
  return language.toLowerCase().startsWith("en") && en ? en : de;
}
