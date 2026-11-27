/**
 * Linking an existing copy of a trip (forgejo#440): on one server (`routes/sharing.ts`) and with
 * an offer from another server (`routes/sharingRemote.ts`). Enveloped.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  bulkLocalQuerySchema,
  bulkOfferBodySchema,
  bulkOfferCandidatesSchema,
  bulkOfferQuerySchema,
  bulkPairsSchema,
  linkBodySchema,
  linkCandidatesQuerySchema,
  linkCandidatesSchema,
  linkPreviewBodySchema,
  linkPreviewSchema,
  linkResultSchema,
  offerLinkBodySchema,
  offerLinkPreviewBodySchema,
} from "../../../schemas/sharingLink";

const tags = ["Sharing"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
});
const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });
const tripParams = z.object({ tripId: z.string() });
const offerParams = z.object({ id: z.string().uuid() });
const localRefusals = {
  403: err(
    "`SHARE_LINK_PROPOSAL_REQUIRED`: another account's trips are never read or linked from here without that account's own decision per trip (until local proposals exist, always)"
  ),
  404: err("`TRIP_NOT_FOUND` (either trip) or `SHARE_USER_NOT_FOUND`"),
  409: err(
    "`SHARE_TRIP_IN_OTHER_GROUP` (the other trip is shared elsewhere), `SHARE_REMOTE_NOT_HOME` (the trip came from another server)"
  ),
};
const remoteRefusals = {
  403: err("`SHARE_REMOTE_PEER_NOT_ADMITTED`"),
  404: err(
    "`SHARE_REMOTE_OFFER_NOT_FOUND`, `SHARE_REMOTE_TRIP_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`"
  ),
  409: err(
    "`SHARE_REMOTE_LINK_TRIP_SHARED`, `SHARE_REMOTE_LINK_TOO_LARGE`, `SHARE_REMOTE_PEER_OUTDATED`, `SHARE_REMOTE_CONSENT_MISSING`, `SHARE_REMOTE_REFUSED`"
  ),
  502: err("`SHARE_REMOTE_UNREACHABLE`: the other server did not answer usably"),
};

registry.registerPath({
  method: "get",
  path: "/sharing/trips/{tripId}/link-candidates",
  summary: "Trips of another account that may be the same trip",
  description:
    "Only trips with the same period, the same name or overlapping dates, at most five; the other account must have agreed to sharing.",
  tags,
  request: { params: tripParams, query: linkCandidatesQuerySchema },
  responses: { 200: ok("Candidate trips", linkCandidatesSchema), ...localRefusals },
});

registry.registerPath({
  method: "post",
  path: "/sharing/trips/{tripId}/link-preview",
  summary: "Dry run of linking a trip with another account's copy",
  description: "Matched entries, entries only one side holds, facts that differ. Writes nothing.",
  tags,
  request: { params: tripParams, body: json(linkPreviewBodySchema) },
  responses: { 200: ok("The dry run", linkPreviewSchema), ...localRefusals },
});

registry.registerPath({
  method: "post",
  path: "/sharing/trips/{tripId}/link",
  summary: "Link a trip with another account's copy",
  description:
    "Both trips join one share group and every matched pair takes one share key; nothing is created. `decision` settles differing facts: mine, theirs or both (each keeps its own). Repeatable; leaving the group undoes it.",
  tags,
  request: { params: tripParams, body: json(linkBodySchema) },
  responses: { 200: ok("What was linked", linkResultSchema), ...localRefusals },
});

registry.registerPath({
  method: "get",
  path: "/sharing/remote/offers/{id}/link-candidates",
  summary: "The caller's trips that may be the offered trip",
  tags,
  request: { params: offerParams },
  responses: { 200: ok("Candidate trips", linkCandidatesSchema), ...remoteRefusals },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/offers/{id}/link-preview",
  summary: "Dry run of linking an offered trip with one of the caller's trips",
  description: "Reads the offered entries from the other server; writes nothing on either.",
  tags,
  request: { params: offerParams, body: json(offerLinkPreviewBodySchema) },
  responses: { 200: ok("The dry run", linkPreviewSchema), ...remoteRefusals },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/offers/{id}/link",
  summary: "Accept an offered trip by linking it with one of the caller's trips",
  description:
    "The caller's trip joins the group and matched entries take the other server's keys; entries only the other server holds are not copied. `decision` settles differing facts.",
  tags,
  request: { params: offerParams, body: json(offerLinkBodySchema) },
  responses: { 200: ok("What was linked", linkResultSchema), ...remoteRefusals },
});

registry.registerPath({
  method: "get",
  path: "/sharing/link-bulk",
  summary: "Every trip of the caller that is the same as one of another account's",
  description:
    "The bulk link's list: one trip to one trip (same period, then name, then overlap), pairs already in one group as `linked`, two equally good matches as `ambiguous`. Nothing is compared or written; each pair is compared and linked through `link-preview` and `link`.",
  tags,
  request: { query: bulkLocalQuerySchema },
  responses: { 200: ok("The trip pairs", bulkPairsSchema), ...localRefusals },
});

registry.registerPath({
  method: "get",
  path: "/sharing/remote/link-bulk",
  summary: "Every open offer from another server paired with one of the caller's trips",
  description:
    "Offers whose sender has an accepted consent only; an offer with no trip of the caller to match comes with `trip: null`.",
  tags,
  responses: { 200: ok("The offer pairs", bulkPairsSchema), ...remoteRefusals },
});

registry.registerPath({
  method: "get",
  path: "/sharing/remote/link-bulk/offers",
  summary: "The caller's trips the person on another server travelled on, not shared with them yet",
  tags,
  request: { query: bulkOfferQuerySchema },
  responses: { 200: ok("Trips to offer", bulkOfferCandidatesSchema), ...remoteRefusals },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/link-bulk/offers",
  summary: "Offer one trip to a connected person on another server, as one step of a bulk run",
  description:
    "The same offer as `/sharing/remote/trips/{tripId}/offers`, under the bulk link's rate limit.",
  tags,
  request: { body: json(bulkOfferBodySchema) },
  responses: {
    201: {
      description: "The offer",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), data: z.object({}).passthrough() }),
        },
      },
    },
    ...remoteRefusals,
  },
});
