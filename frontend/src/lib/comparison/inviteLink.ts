/**
 * The invitation link's payload on the reader's side (spec 2026-11-07 §6.3) — the frontend
 * mirror of `backend/src/schemas/inviteLink.ts`. Parsing happens here, before any request, so a
 * truncated paste or a foreign link is called damaged and sends nothing. The server checks the
 * same shape again, plus that the key and its fingerprint agree; this side cannot, so it never
 * claims more than "well formed".
 */
import { z } from "zod";

export const INVITE_PAYLOAD_MAX_CHARS = 1024;
export const INVITE_LINK_KIND = "travstats-friend-invite";

/** The same rule as `origin` on the server for what a browser can tell: a bare http(s) origin. */
const bareOrigin = z
  .string()
  .max(250)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin === value &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  });

export const inviteLinkPayloadSchema = z.strictObject({
  v: z.literal(1),
  kind: z.literal(INVITE_LINK_KIND),
  origin: bareOrigin,
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
});
export type InviteLinkPayload = z.infer<typeof inviteLinkPayloadSchema>;

export type DecodedInvite = { ok: true; payload: InviteLinkPayload } | { ok: false };

/** The text after `#` (or the bare payload), decoded and validated; any damage is `{ ok: false }`. */
export function decodeInvitePayload(text: string): DecodedInvite {
  const trimmed = text.trim().replace(/^#/, "");
  if (!trimmed || trimmed.length > INVITE_PAYLOAD_MAX_CHARS || !/^[A-Za-z0-9_-]+$/.test(trimmed))
    return { ok: false };
  try {
    const binary = atob(trimmed.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed = inviteLinkPayloadSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    );
    return parsed.success ? { ok: true, payload: parsed.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** The payload part of a pasted invitation link, or null when the text is not a link with one. */
export function payloadOfPastedLink(text: string): string | null {
  const at = text.trim().indexOf("#");
  if (at < 0) return null;
  const head = text.trim().slice(0, at);
  if (!/\/freunde\/einladung$/.test(head)) return null;
  return text.trim().slice(at + 1);
}

/** Whether the invitation is already past its end — the server decides, the page only warns. */
export const isExpired = (payload: InviteLinkPayload, now: number): boolean =>
  Date.parse(payload.expiresAt) <= now;
