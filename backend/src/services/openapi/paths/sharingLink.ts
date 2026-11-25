/**
 * Linking an existing copy of a trip (forgejo#440): on one server (`routes/sharing.ts`) and with
 * an offer from another server (`routes/sharingRemote.ts`). Enveloped.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
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
  403: err("`SHARE_CONSENT_REQUIRED` or `SHARE_GROUP_CONSENT_REQUIRED`"),
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
