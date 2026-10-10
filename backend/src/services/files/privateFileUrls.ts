/**
 * Where a private file lives on the API, and the one shape its URL may take.
 *
 * A private file is served at a URL that ends in `/content`, never in the
 * file's own extension (forgejo#284). Reverse proxies and CDNs decide what to
 * cache by the LAST characters of the path — Nginx Proxy Manager's "Cache
 * Assets" switch caches every `\.(png|jpe?g|…)$` under a key of host + URI and
 * strips the app's `Cache-Control` on the way out, and Cloudflare caches `.pdf`,
 * `.png`, `.zip` and friends by default once that header is gone. A receipt
 * served at `…/receipts/<name>.png` was therefore handed to the next visitor
 * without a session, however carefully the route checked ownership: the proxy
 * never asked it.
 *
 * Older URLs — the ones stored in `flights.receipt_url`, `lodging_stays.receipt_url`
 * and the settings blob's `profile.profilePicture` — keep working: the API
 * answers them with a redirect to this form (`middleware/assetPathGuard.ts`),
 * and a cached redirect carries no data. Nothing is rewritten in the database:
 * the stored legacy form is what the cleanup sweep and the legacy-receipt
 * migration match on, and the readers below accept both.
 */

export const API_V1 = "/api/v1";

/** The suffix every private file URL ends in. */
export const FILE_CONTENT_SEGMENT = "content";

const RECEIPTS_PREFIX = `${API_V1}/uploads/receipts/`;
const PROFILE_PICTURE_PREFIX = `${API_V1}/settings/profile-picture/`;

/** A file name as the server minted it: one path segment, nothing that walks. */
const isPlainFileName = (name: string): boolean =>
  name.length > 0 && !name.includes("/") && !name.includes("\\") && name !== "." && name !== "..";

const contentUrl = (prefix: string, filename: string): string =>
  `${prefix}${encodeURIComponent(filename)}/${FILE_CONTENT_SEGMENT}`;

/**
 * The file name inside a URL of `prefix`, in either form — the legacy
 * `<prefix><name>` or the canonical `<prefix><name>/content`. Null for
 * anything else, including an external URL or a different route.
 */
const fileNameIn = (prefix: string, url: string | null | undefined): string | null => {
  if (!url || !url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length).split(/[?#]/, 1)[0];
  const suffix = `/${FILE_CONTENT_SEGMENT}`;
  const encoded = rest.endsWith(suffix) ? rest.slice(0, -suffix.length) : rest;
  let name: string;
  try {
    name = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  return isPlainFileName(name) ? name : null;
};

/** `GET` URL of a legacy (pre-document) receipt file. */
export const receiptContentUrl = (filename: string): string =>
  contentUrl(RECEIPTS_PREFIX, filename);

/**
 * Every form a stored `receiptUrl` may take for this file — the legacy one the
 * upload route wrote until 2026-09, and the canonical one. Matching on both
 * keeps the cleanup sweep and the migration correct whichever a client saved.
 */
export const receiptUrlForms = (filename: string): string[] => [
  `${RECEIPTS_PREFIX}${filename}`,
  receiptContentUrl(filename),
];

export const receiptFileNameFromUrl = (url: string | null | undefined): string | null =>
  fileNameIn(RECEIPTS_PREFIX, url);

/** `GET` URL of an uploaded avatar. */
export const profilePictureContentUrl = (filename: string): string =>
  contentUrl(PROFILE_PICTURE_PREFIX, filename);

export const profilePictureFileNameFromUrl = (url: string | null | undefined): string | null =>
  fileNameIn(PROFILE_PICTURE_PREFIX, url);

/**
 * The canonical form of a stored avatar URL; anything that is not one of ours
 * (an external `https://` picture, null) is returned unchanged.
 */
export const canonicalProfilePictureUrl = <T extends string | null | undefined>(url: T): T => {
  const filename = profilePictureFileNameFromUrl(url);
  return (filename ? profilePictureContentUrl(filename) : url) as T;
};
