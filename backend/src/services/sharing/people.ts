/**
 * How another account appears in the sharing surfaces: its id, its username
 * and the name it gave itself. Nothing else of a user ever crosses accounts.
 */
export interface SharePerson {
  id: string;
  username: string;
  displayName: string;
}

export const PERSON_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
} as const;

export function toPerson(user: {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}): SharePerson {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return { id: user.id, username: user.username, displayName: name || user.username };
}
