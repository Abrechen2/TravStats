/** Zod schema for the admin push-relay settings (`PUT /api/v1/admin/push`). */
import { z } from "./zod";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const MAX_URL_LENGTH = 500;

/**
 * The relay address as stored: `https://` only, plus plain `http://` for a
 * relay on the same machine (`localhost` / `127.0.0.1`, for development).
 * Credentials, a query or a fragment have no place in it. The trailing slash
 * is dropped because the relay client appends `/v1/...`.
 */
export function normalizeRelayUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const secure = url.protocol === "https:";
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (!secure && !local) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export const pushRelayUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .transform((value, ctx) => {
    const normalized = normalizeRelayUrl(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "Relay address must be https:// (or http://localhost)",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const pushSettingsUpdateSchema = z.object({
  pushEnabled: z.boolean().optional(),
  pushRelayUrl: pushRelayUrlSchema.optional(),
});
