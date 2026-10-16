/**
 * Public share links (forgejo#281, design
 * `docs/superpowers/specs/2026-10-10-share-links-design.md`): the owner's side
 * (`routes/shareLinks.ts`) and the unauthenticated side a link's page asks
 * (`routes/publicShareLinks.ts`). Both enveloped.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  ownerShareLinkSchema,
  publicShareResponseSchema,
  publicViewSchema,
  SHARE_LINK_FIELDS,
  SHARE_LINK_MAX_ACTIVE,
  SHARE_LINK_MAX_PHOTOS,
  shareLinkCreateSchema,
  shareLinkPhotoSchema,
  shareLinkPreviewSchema,
  shareLinkResolveSchema,
} from "../../../schemas/shareLinks";

const tags = ["Share links"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: {
    "application/json": { schema: z.object({ success: z.literal(true), data }) },
  },
});
const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { "application/json": { schema } },
});

const allowList = Object.entries(SHARE_LINK_FIELDS)
  .map(([kind, fields]) => `\`${kind}\`: ${fields.map((f) => `\`${f}\``).join(", ")}`)
  .join("; ");
const notFound = err(
  "`SHARE_LINK_NOT_FOUND`: no target or link of the caller under that id (another account's answers the same)"
);
const publicNotFound = err(
  "`SHARE_LINK_NOT_FOUND` — the one answer for every failure: malformed, unknown, expired, " +
    "revoked, the instance switch off, the owner or the target gone. Never 410, never a 400: " +
    "a guesser learns nothing about whether a token ever existed."
);

registry.registerPath({
  method: "get",
  path: "/share-links",
  summary: "The caller's live share links, and whether the instance allows them",
  description:
    "`enabled` is the instance switch (admin, off by default); a client offers sharing as a " +
    "link only while it is on. The token is not listed — only its hash is stored, so a link " +
    "is shown exactly once, when it is made. Links that have run out are not listed.",
  tags,
  responses: {
    200: ok(
      "Newest first",
      z.object({ enabled: z.boolean(), links: z.array(ownerShareLinkSchema) })
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/share-links/preview",
  summary: "Exactly what the public would see for this selection",
  description:
    "Built by the same serializer the public endpoint uses, from the chosen fields only. " +
    `Allow-list per kind — ${allowList}. For a trip, \`photos\` counts the first ` +
    `${SHARE_LINK_MAX_PHOTOS} photos in gallery order that can be served without metadata.`,
  tags,
  request: { body: json(shareLinkPreviewSchema) },
  responses: {
    200: ok(
      "The public view, and — for a trip with `photos` chosen — which photos stay out and why",
      z.object({
        view: publicViewSchema,
        photosOmitted: z
          .object({
            unsupportedType: z.number().int().describe("Not JPEG, PNG or HEIC"),
            unreadable: z
              .number()
              .int()
              .describe("Missing, unconvertible, or not what its stored type claims"),
            overLimit: z.number().int().describe(`Beyond the first ${SHARE_LINK_MAX_PHOTOS}`),
          })
          .nullable()
          .describe("Owner-only; null unless `photos` is chosen on a trip"),
      })
    ),
    400: err("A field outside the kind's allow-list, or a `wrapped` target that is not a year"),
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/share-links",
  summary: "Create a public, read-only share link for one flight, trip or year",
  description:
    "Returns the URL ONCE — `<public base>/share#<token>`; the token rides in the fragment, " +
    "which never reaches a server log. Anyone holding the URL reads the chosen fields until " +
    "the link expires or is revoked. A flight link also ends two hours after the arrival " +
    "(`effectiveExpiresAt`). Supply exactly one of expiresInDays (1–90, measured by the server) " +
    "or expiresAt (absolute timestamp, at most 90 days ahead). Limited to 30 an hour per user, " +
    `${SHARE_LINK_MAX_ACTIVE} live links per account.`,
  tags,
  request: { body: json(shareLinkCreateSchema) },
  responses: {
    201: ok(
      "The new link",
      z.object({
        id: z.string(),
        url: z.string().describe("Shown once — the token is not stored"),
        token: z.string().describe("The same token as in `url`, for a client building its own"),
        expiresAt: z.string().datetime(),
        effectiveExpiresAt: z.string().datetime(),
      })
    ),
    400: err(
      "`SHARE_LINK_EXPIRY_INVALID`: expiry in the past or too far ahead; or an unknown field"
    ),
    404: notFound,
    409: err(
      "`SHARE_LINKS_DISABLED`: the instance switch is off; `SHARE_LINK_FLIGHT_LANDED`: the " +
        "flight has landed; `SHARE_LINK_LIMIT`: too many live links"
    ),
  },
});

registry.registerPath({
  method: "delete",
  path: "/share-links/{id}",
  summary: "Revoke a share link",
  description:
    "The URL answers 404 from this request on. Nothing caches it: every public answer is no-store.",
  tags,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Revoked", z.object({ id: z.string() })), 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/public/share-links/view",
  summary: "Read a share link (public, no authentication)",
  description:
    "The token from the URL fragment goes in the body, never in a URL. Answers `no-store`, " +
    "`X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`. A member of the view is " +
    "absent when the owner did not choose it. Limited to 30 a minute per address.",
  tags,
  security: [],
  request: { body: json(shareLinkResolveSchema) },
  responses: {
    200: ok("The link's view", publicShareResponseSchema),
    404: publicNotFound,
    429: err("Too many requests from this address"),
  },
});

registry.registerPath({
  method: "post",
  path: "/public/share-links/photo",
  summary: "One photo of a trip share link (public, no authentication)",
  description:
    "Photo `index` of the ones the link carries (`view.trip.photos.count`). The bytes are the " +
    "display rendition with every metadata segment removed (GPS, time, device), orientation " +
    "kept. Limited to 60 a minute per address.",
  tags,
  security: [],
  request: { body: json(shareLinkPhotoSchema) },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    404: publicNotFound,
    429: err("Too many requests from this address"),
  },
});
