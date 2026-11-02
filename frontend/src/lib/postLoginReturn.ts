/**
 * Where to go after signing in, for the one flow that sends a visitor to the login form on a
 * detour: the guest's own server asked to vouch for them (`/federation/vouch`, forgejo#404).
 * Only that path is ever remembered, so the key cannot be used to bounce a user anywhere else.
 */
const KEY = "travstats.postLoginReturn";
const ALLOWED = /^\/federation\/vouch\?[A-Za-z0-9=&%._~:/-]{1,600}$/;

export function rememberReturn(path: string): void {
  try {
    if (ALLOWED.test(path)) sessionStorage.setItem(KEY, path);
  } catch {
    // Private mode: the user signs in and opens the link again.
  }
}

/**
 * The remembered path, else the start page. It does not consume the entry: a render may run
 * twice, and the page it leads to calls `clearReturn()` once it has arrived.
 */
export function postLoginTarget(): string {
  try {
    const path = sessionStorage.getItem(KEY);
    if (path && ALLOWED.test(path)) return path;
  } catch {
    // Fall through to the start page.
  }
  return "/";
}

export function clearReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
