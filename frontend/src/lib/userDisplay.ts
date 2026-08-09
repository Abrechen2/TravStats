/** The parts of a user this module needs. Kept structural so both the auth
 *  store's user and the settings profile satisfy it. */
export interface DisplayableUser {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

const clean = (value: string | null | undefined): string => (value ?? "").trim();

/**
 * How to address someone in the UI (#241): first name if they gave one,
 * otherwise the username they log in with.
 *
 * The username is the fallback rather than an empty string on purpose — this
 * feeds the header, and a header that greets nobody looks broken. Surname alone
 * is never used: "Künzel" reads as a summons, not a greeting.
 */
export function displayName(user: DisplayableUser | null | undefined): string {
  if (!user) return "";
  return clean(user.firstName) || clean(user.username);
}

/** First and last name joined, falling back to whichever exists. Used where
 *  the full name belongs (profile page, exports), never in the header. */
export function fullName(user: DisplayableUser | null | undefined): string {
  if (!user) return "";
  const parts = [clean(user.firstName), clean(user.lastName)].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : clean(user.username);
}

/**
 * One or two letters for the avatar placeholder when no picture is set.
 *
 * First + last initial when both exist, otherwise the first character of
 * whatever is left. Uses `Array.from` rather than `charAt` so a name starting
 * with an emoji or a character outside the BMP yields that whole character
 * instead of half a surrogate pair.
 */
export function initials(user: DisplayableUser | null | undefined): string {
  if (!user) return "";
  const first = clean(user.firstName);
  const last = clean(user.lastName);
  const firstChar = (value: string): string => Array.from(value)[0] ?? "";

  if (first && last) return (firstChar(first) + firstChar(last)).toLocaleUpperCase();
  const single = first || last || clean(user.username);
  return firstChar(single).toLocaleUpperCase();
}
