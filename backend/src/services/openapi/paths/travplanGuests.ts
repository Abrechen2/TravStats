import { z } from "zod";
import { registry } from "../registry";
import { writeSchema, bookingSchema } from "../../travplan/schema";
import { errorContent } from "./shared";
import { member, result as planView } from "./travplan";

/**
 * TravPlan guests and plan documents (forgejo#404, spec 2026-10-17 §6.5, §6.8, D6).
 *
 * The guest paths are a door of their own: a `ts_gpat_` token (or the `ts_guest` cookie of the
 * web), scoped to ONE plan, never a user token. They are listed here because the Companion
 * drives them with a phone token.
 */
const uuid = z.string().uuid();
const json = (schema: z.ZodType) => ({ "application/json": { schema } });
const guestAuth = registry.registerComponent("securitySchemes", "GuestAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "ts_gpat_<token>",
  description:
    "Guest phone token (`ts_gpat_…`) for ONE plan, minted from a browser guest session. " +
    "Send as `Authorization: Bearer ts_gpat_…`. A user token is refused here (401 PLAN_GUEST_REQUIRED) " +
    "and a guest token is refused everywhere else.",
});
void guestAuth;

const documentDto = z.object({
  id: uuid,
  displayName: z.string(),
  mimetype: z.string(),
  format: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string().datetime(),
  uploadedBy: z.object({ memberId: uuid, displayName: z.string() }).nullable(),
  bookingId: uuid.nullable(),
  attached: z.boolean(),
  url: z.string(),
});
const planDocuments = z.object({ documents: z.array(documentDto) });
const invite = z.object({ member, link: z.string().url(), expiresAt: z.string().datetime() });
const refresh = z.object({ clientRef: uuid, baseRevision: z.number().int().min(1) });

type Method = "get" | "post" | "delete";
function reg(
  method: Method,
  path: string,
  description: string,
  success: z.ZodType,
  options: {
    guest?: boolean;
    status?: 200 | 201;
    body?: z.ZodType;
    params?: z.ZodRawShape;
    query?: z.ZodRawShape;
    tag?: string;
  } = {}
) {
  const params = options.params ? z.object(options.params) : undefined;
  registry.registerPath({
    method,
    path,
    tags: [options.tag ?? (options.guest ? "TravPlan guests" : "TravPlan")],
    description,
    security: [options.guest ? { GuestAuth: [] } : { BearerAuth: [] }],
    request: {
      ...(params ? { params } : {}),
      ...(options.query ? { query: z.object(options.query) } : {}),
      ...(options.body ? { body: { content: json(options.body) } } : {}),
    },
    responses: {
      [options.status ?? 200]: { description: "Success", content: json(success) },
      400: { description: "Invalid input", content: errorContent },
      401: {
        description:
          "No, expired or ended guest credential (PLAN_GUEST_REQUIRED / _EXPIRED / _REVOKED)",
        content: errorContent,
      },
      403: { description: "Owner-only act, refused vouch or admission", content: errorContent },
      404: { description: "Not found, or not on this plan", content: errorContent },
      409: { description: "Conflict or limit", content: errorContent },
      429: { description: "Rate limit", content: errorContent },
    },
  });
}

const planId = { planId: uuid };
const tripId = { tripId: uuid };

// ---- Owner and co-planner side (user token) --------------------------------------------------
reg(
  "post",
  "/trips/{tripId}/plan/guests",
  "Owner: invite a person on a connected (admin-pinned, verified) server. `username` is display only. The answer carries the join link once (single use, seven days). 403 PLAN_GUEST_PEER_NOT_ADMITTED, 409 PLAN_GUEST_FEDERATION_OFF / PLAN_GUEST_LIMIT / PLAN_MEMBER_LIMIT.",
  invite,
  {
    status: 201,
    params: tripId,
    body: z.object({ origin: z.string().url(), username: z.string() }),
  }
);
reg(
  "post",
  "/trips/{tripId}/plan/guests/{memberId}/invite",
  "Owner: a fresh join link for a guest who has not joined yet; the old link dies.",
  invite,
  { status: 201, params: { ...tripId, memberId: uuid } }
);
reg(
  "get",
  "/trips/{tripId}/plan/documents",
  "The documents of the plan the caller may see: the plan's booking documents and the ones members uploaded for the plan. A co-planner never sees the owner's other documents; the owner sees the whole trip.",
  planDocuments,
  { params: tripId }
);
reg(
  "post",
  "/trips/{tripId}/plan/documents",
  "Upload a document for the plan (multipart field `file`, optional `bookingId`). At most 20 MB and 50 documents per member. The same bytes as one of the owner's private documents are stored as a separate plan document, answered exactly like a new file.",
  documentDto,
  { status: 201, params: tripId, body: z.object({ bookingId: uuid.optional() }) }
);
reg(
  "get",
  "/trips/{tripId}/plan/documents/{documentId}/file",
  "The bytes of a document the caller may see, as an attachment. 404 PLAN_DOCUMENT_NOT_FOUND for any other document.",
  z.string().describe("The file"),
  { params: { ...tripId, documentId: uuid } }
);
reg(
  "get",
  "/federation/vouch/check",
  "On the guest's own server: whether this server would vouch for `host` (pinned and verified by its admin). 403 PLAN_GUEST_HOST_NOT_ADMITTED. Browser session only.",
  z.object({ host: z.string() }),
  { query: { host: z.string().url() } }
);
reg(
  "post",
  "/federation/vouch",
  "On the guest's own server, after the person agreed on screen: signs a vouch (valid two minutes) for the invitation at `host` and returns the redirect, with the vouch in the URL fragment. Browser session only.",
  z.object({ redirectUrl: z.string().url(), expiresAt: z.string().datetime(), as: z.string() }),
  {
    body: z.object({
      host: z.string().url(),
      invite: uuid,
      nonce: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  }
);

// ---- The guest door ---------------------------------------------------------------------------
reg(
  "post",
  "/guest/join/start",
  "No credential. The holder of the invitation link proves its secret; the host binds a fresh nonce to this browser (HttpOnly cookie `ts_guest_join`) and says where to be vouched for. 404 PLAN_GUEST_INVITE_INVALID is the one answer for an unknown, used, expired or withdrawn invitation.",
  z.object({ vouchUrl: z.string().url(), guestOrigin: z.string(), host: z.string() }),
  { guest: true, body: z.object({ inviteId: uuid, secret: z.string() }) }
);
reg(
  "post",
  "/guest/join/complete",
  "No credential. Verifies the vouch (signature by the pinned key of its issuer, audience, window, nonce bound to this browser, single use) and opens the `ts_guest` session for the one plan. 403 PLAN_GUEST_VOUCH_INVALID is the one answer for every verification failure.",
  z.object({ planId: uuid, tripId: uuid, expiresAt: z.string().datetime() }),
  { guest: true, status: 201, body: z.object({ vouch: z.string() }) }
);
reg(
  "get",
  "/guest/session",
  "Who the credential is and which plan it opens.",
  z.object({
    planId: uuid,
    tripId: uuid,
    planName: z.string(),
    hostName: z.string(),
    ownerName: z.string().nullable(),
    expiresAt: z.string().datetime(),
    memberId: uuid,
    displayName: z.string(),
    origin: z.string(),
    credential: z.enum(["session", "pat"]),
  }),
  { guest: true }
);
reg("post", "/guest/logout", "Ends this credential.", z.object({ loggedOut: z.literal(true) }), {
  guest: true,
});
reg(
  "post",
  "/guest/leave",
  "The guest leaves the plan: the member is closed and every credential dies.",
  z.object({ left: z.literal(true) }),
  { guest: true }
);
reg(
  "post",
  "/guest/plans/{planId}/pat",
  "Mint a phone token for this plan (browser session only, five at most). Shown once. The token lives 90 days (`expiresAt`); a phone should prefer the claim-code flow below.",
  z.object({ token: z.string(), expiresAt: z.string().datetime() }),
  { guest: true, status: 201, params: planId }
);
reg(
  "post",
  "/guest/plans/{planId}/pat/code",
  "Mint a one-time pairing code for the Companion's QR (browser session only; a phone token gets 403 PLAN_GUEST_REQUIRED). Single use, valid five minutes, stored hashed; a new code retires the member's earlier unused one.",
  z.object({ code: z.string(), expiresAt: z.string().datetime() }),
  { guest: true, status: 201, params: planId }
);
reg(
  "post",
  "/guest/plans/{planId}/pat/claim",
  "No credential. Redeems a pairing code once for a phone token (90 days). 400 PLAN_GUEST_CLAIM_INVALID is the one answer for an unknown, used, expired or other plan's code and for a member who is no longer active. Rate limited per address.",
  z.object({ token: z.string(), expiresAt: z.string().datetime() }),
  { guest: true, status: 201, params: planId, body: z.object({ code: z.string() }) }
);
reg(
  "get",
  "/guest/plans/{planId}",
  "The plan, drawn for this guest (ETag = revision and member).",
  planView,
  {
    guest: true,
    params: planId,
  }
);
reg(
  "post",
  "/guest/plans/{planId}/mutations",
  "Apply an operation. A guest may do everything but delete the plan, manage members, change the AI policy and write the owner's logbook (403 PLAN_OWNER_ONLY).",
  planView,
  { guest: true, params: planId, body: writeSchema }
);
reg(
  "get",
  "/guest/plans/{planId}/collab",
  "Roster as a member sees it and the unread notices.",
  z.object({
    self: z.object({
      memberId: uuid,
      kind: z.enum(["owner", "local", "remote"]),
      isOwner: z.boolean(),
    }),
    members: z.array(member),
    notices: z.array(
      z.object({
        id: uuid,
        actorName: z.string(),
        summary: z.string(),
        createdAt: z.string().datetime(),
      })
    ),
  }),
  { guest: true, params: planId }
);
reg(
  "post",
  "/guest/plans/{planId}/notices/read",
  "Marks the guest's notices read.",
  z.object({ read: z.number().int() }),
  {
    guest: true,
    params: planId,
  }
);
reg(
  "post",
  "/guest/plans/{planId}/forecast",
  "Refresh the forecast; counts against the OWNER's daily limit.",
  planView,
  {
    guest: true,
    params: planId,
    body: refresh,
  }
);
reg(
  "post",
  "/guest/plans/{planId}/stations/{stationId}/climate",
  "Refresh a station's climate means; counts against the owner's daily limit.",
  planView,
  { guest: true, params: { ...planId, stationId: uuid }, body: refresh }
);
reg(
  "post",
  "/guest/plans/{planId}/stages/{stageId}/route",
  "Route one stage and record its metrics.",
  planView,
  { guest: true, params: { ...planId, stageId: uuid }, body: refresh }
);
reg(
  "post",
  "/guest/plans/{planId}/placeholder-matches",
  "Which open placeholders a booking would fill. Read-only.",
  z.object({ matches: z.array(z.record(z.string(), z.unknown())) }),
  { guest: true, params: planId, body: z.object({ booking: bookingSchema }) }
);
reg(
  "get",
  "/guest/plans/{planId}/packing-suggestions",
  "Packing suggestions derived from the plan.",
  z.object({ suggestions: z.array(z.string()) }),
  { guest: true, params: planId }
);
reg(
  "get",
  "/guest/plans/{planId}/locations",
  "Location search for the weather location; counts against the owner's limit.",
  z.object({ locations: z.array(z.record(z.string(), z.unknown())) }),
  {
    guest: true,
    params: planId,
    query: { q: z.string(), language: z.enum(["de", "en"]).optional() },
  }
);
reg(
  "get",
  "/guest/plans/{planId}/places",
  "Place search for stations.",
  z.record(z.string(), z.unknown()),
  {
    guest: true,
    params: planId,
    query: {
      q: z.string(),
      language: z.enum(["de", "en"]).optional(),
      kind: z.enum(["any", "port"]).optional(),
    },
  }
);
reg(
  "get",
  "/guest/plans/{planId}/export",
  "The plan's trip as a `.travstats` file (format version 4 when it holds a roadtrip): the route and the " +
    "confirmed entries in their public half — no journal, notes, prices, photos or documents. For the " +
    "guest's own logbook and as the file to take along before leaving.",
  z.string().describe("The ZIP"),
  { guest: true, params: planId }
);
reg(
  "get",
  "/guest/plans/{planId}/documents",
  "The plan's documents this guest may see.",
  planDocuments,
  {
    guest: true,
    params: planId,
  }
);
reg(
  "post",
  "/guest/plans/{planId}/documents",
  "Upload a document for the plan (multipart field `file`); at most 20 MB, 50 per guest.",
  documentDto,
  { guest: true, status: 201, params: planId, body: z.object({ bookingId: uuid.optional() }) }
);
reg(
  "get",
  "/guest/plans/{planId}/documents/{documentId}/file",
  "A visible document's bytes, as an attachment.",
  z.string().describe("The file"),
  { guest: true, params: { ...planId, documentId: uuid } }
);
