/**
 * The extension-less form of a private file URL (forgejo#284).
 *
 * Older receipt and avatar URLs end in the file's own extension
 * (`/api/v1/uploads/receipts/<name>.png`). Proxies that cache by extension —
 * Nginx Proxy Manager's "Cache Assets", Cloudflare's default list — keep such
 * a response and hand it to the next visitor without a session. The server
 * serves the file at `<url>/content` and only redirects the old form; asking
 * for the new form directly means the cacheable URL is never requested at all.
 *
 * Anything else — an external `https://` picture, a document URL, an already
 * canonical one — is returned unchanged.
 */
const LEGACY_FILE_URL = /^(\/api\/v1\/(?:uploads\/receipts|settings\/profile-picture)\/[^/?#]+)$/;

export function canonicalPrivateFileUrl(url: string): string {
  const match = LEGACY_FILE_URL.exec(url);
  return match ? `${match[1]}/content` : url;
}
