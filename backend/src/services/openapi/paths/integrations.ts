/**
 * The remaining surface: parsing, imports, Immich albums, chains and
 * memberships, uploads, and the odds and ends.
 *
 * Most of these turn something a user HAS — an email, a spreadsheet, a photo
 * library — into records. The shared rule across all of them is that nothing is
 * written by the call that reads: a parse or a preview returns a proposal, and
 * a second call commits it. That is what makes an import reviewable instead of
 * a leap.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { PARSER_SUPPORTED_DOMAINS } from "../../../shared/domains";

const badInput = { description: "Invalid input", content: errorContent };
const notFound = { description: "Not found", content: errorContent };
const deleted = { description: "Deleted" };
const uuid = z.string().uuid();

/**
 * Which domains a document can be read as.
 *
 * Taken from the same constant the routes validate against, so the docs cannot
 * claim a domain the server rejects — or, as happened, stay silent about one it
 * accepts. Naming the values is the whole point: "a `domain` field" does not
 * tell a reader that hotel confirmations are supported.
 *
 * WHAT IS DELIBERATELY ABSENT, because the question comes up:
 *
 * PLACES cannot be parsed. A booking confirmation describes a night, a flight
 * or a sailing; it rarely describes somewhere you want to go. Places arrive
 * through the map search, a Google Maps saved-list import, or the spreadsheet.
 *
 * TRIPS are not a parse target at all. A trip is the container, not the
 * content. One is made by hand, created alongside an import, or proposed from
 * flights that have none by POST /trips/detect.
 */
const parseDomain = z
  .enum(PARSER_SUPPORTED_DOMAINS)
  .default("flight")
  .describe("What to read the document as. Omitted means flight.");

const parseBody = {
  content: {
    "multipart/form-data": {
      schema: z.object({
        email: z.string().describe("The document itself"),
        domain: parseDomain,
      }),
    },
  },
  required: true,
};

// ------------------------------------------------------------- parsing

const parseTag = ["Parsing"];

registry.registerPath({
  method: "post",
  path: "/parse-email-file",
  summary: "Read a booking out of an email",
  description:
    "multipart/form-data with the .eml, plus a `domain` saying what to read it " +
    "as — flight, cruise or lodging. All three are supported; omitting the field " +
    "means flight. Returns candidates for review; nothing is stored. A document " +
    "it cannot read comes back as an empty result with a reason, not as an error " +
    "— 'no booking here' is an answer, not a failure.",
  tags: parseTag,
  request: { body: parseBody },
  responses: { 200: { description: "Parse result" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/parse-pdf",
  summary: "Read a booking out of a PDF",
  description:
    "Same three domains as the email route — flight, cruise or lodging — and the " +
    "same contract: a proposal, never a write.",
  tags: parseTag,
  request: { body: parseBody },
  responses: { 200: { description: "Parse result" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/parse-boardingpass/availability",
  summary: "Whether boarding-pass scanning can run here",
  tags: parseTag,
  responses: { 200: { description: "Availability" } },
});

registry.registerPath({
  method: "get",
  path: "/parse-boardingpass/providers",
  summary: "Which scanning providers are configured",
  tags: parseTag,
  responses: { 200: { description: "Providers" } },
});

registry.registerPath({
  method: "get",
  path: "/parse-boardingpass/check",
  summary: "Check one provider",
  tags: parseTag,
  responses: { 200: { description: "Result" } },
});

registry.registerPath({
  method: "post",
  path: "/boardingpass/propose",
  summary: "Propose a flight from a scanned boarding pass",
  description:
    "Duplicate detection compares against a window around the departure, in the " +
    "airport's own zone — comparing UTC instants declared the same flight twice " +
    "as two, either side of midnight.",
  tags: parseTag,
  responses: { 200: { description: "Proposal" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/flight-lookup/{flightNumber}",
  summary: "Look a flight up with a data provider",
  description:
    "The number is sent unpadded whatever the user typed: providers key on 'EK51' " +
    "and answer a padded 'EK051' with nothing at all. The stored spelling is kept " +
    "and the answer mapped back onto it.",
  tags: parseTag,
  request: { params: z.object({ flightNumber: z.string() }) },
  responses: { 200: { description: "Lookup result" }, 404: notFound, 503: { description: "No provider configured", content: errorContent } },
});

registry.registerPath({
  method: "post",
  path: "/flight-lookup/bulk",
  summary: "Look up several flights",
  tags: parseTag,
  responses: { 200: { description: "Results" }, 503: { description: "No provider configured", content: errorContent } },
});

// -------------------------------------------------------------- import

const importTag = ["Import"];

registry.registerPath({
  method: "post",
  path: "/import/parse",
  summary: "Read a spreadsheet without writing anything",
  tags: importTag,
  responses: { 200: { description: "Parsed" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/import/preview",
  summary: "What an import would change, per sheet",
  description:
    "Always available before a write. The replace-contents mode is the only one " +
    "that can lose data: it takes a full backup first, states how many entries " +
    "would disappear, and refuses to run if the backup fails.",
  tags: importTag,
  responses: { 200: { description: "Preview" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/lodging-import/preview",
  summary: "Preview a lodging import",
  tags: importTag,
  responses: { 200: { description: "Preview" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/lodging-import/suggest-mapping",
  summary: "Guess which column means what",
  tags: importTag,
  responses: { 200: { description: "Suggested mapping" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/lodging-import/commit",
  summary: "Write a previewed lodging import",
  tags: importTag,
  responses: { 200: { description: "Imported" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/lodging-import/batches",
  summary: "Lodging imports that have run",
  tags: importTag,
  responses: { 200: { description: "Batches" } },
});

registry.registerPath({
  method: "delete",
  path: "/lodging-import/batches/{id}",
  summary: "Undo a lodging import",
  tags: importTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

// -------------------------------------------------------------- immich

const immichTag = ["Immich"];

registry.registerPath({
  method: "get",
  path: "/trips/{id}/immich/albums",
  summary: "Albums linked to a trip",
  description:
    "A link is one of two modes. LINK stores no bytes: images stream through an " +
    "ownership-checked proxy. IMPORT copies the originals in as ordinary trip " +
    "photos, idempotent per asset.",
  tags: immichTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Linked albums" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/immich/albums",
  summary: "Link an album to a trip",
  tags: immichTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 201: { description: "Linked" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/immich/albums/{linkId}",
  summary: "Unlink an album",
  tags: immichTag,
  request: { params: z.object({ id: uuid, linkId: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/immich/albums/{linkId}/assets",
  summary: "What is in a linked album",
  tags: immichTag,
  request: { params: z.object({ id: uuid, linkId: uuid }) },
  responses: { 200: { description: "Assets" }, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/immich/albums/{linkId}/assets/{assetId}/file",
  summary: "Stream one asset through the proxy",
  description:
    "Ownership- and membership-checked, with browser ETag caching and its own " +
    "`Cache-Control: private` over the API-wide `no-store`.",
  tags: immichTag,
  request: { params: z.object({ id: uuid, linkId: uuid, assetId: z.string() }) },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/immich/albums/{linkId}/import-job",
  summary: "How an album import is going",
  tags: immichTag,
  request: { params: z.object({ id: uuid, linkId: uuid }) },
  responses: { 200: { description: "Job state" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/immich/albums/{linkId}/resync",
  summary: "Import the album again",
  description:
    "Refuses while an import is in flight, and checks that BEFORE resetting the " +
    "job — the other order clobbers a running job and then strands it, because a " +
    "fresh import will not start against a link that is already busy.",
  tags: immichTag,
  request: { params: z.object({ id: uuid, linkId: uuid }) },
  responses: { 202: { description: "Resync started" }, 409: { description: "Import already running", content: errorContent }, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/immich/estimate",
  summary: "How much an import would fetch",
  tags: immichTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Estimate" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/immich/cover",
  summary: "Use an Immich asset as the trip cover",
  tags: immichTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Cover set" }, 404: notFound },
});

// -------------------------------------------- chains, memberships, rest

const lodgingTag = ["Lodging"];

registry.registerPath({
  method: "get",
  path: "/lodging-chains",
  summary: "Hotel chains in the catalogue",
  tags: lodgingTag,
  responses: { 200: { description: "Chains" } },
});

registry.registerPath({
  method: "get",
  path: "/lodging-chains/{id}",
  summary: "One chain",
  tags: lodgingTag,
  request: { params: z.object({ id: z.coerce.number().int() }) },
  responses: { 200: { description: "Chain" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/lodging-chains",
  summary: "Add a chain the catalogue does not have",
  tags: lodgingTag,
  responses: { 201: { description: "Created" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/lodging-memberships",
  summary: "The user's loyalty programmes",
  tags: lodgingTag,
  responses: { 200: { description: "Memberships" } },
});

registry.registerPath({
  method: "post",
  path: "/lodging-memberships",
  summary: "Add a loyalty programme",
  tags: lodgingTag,
  responses: { 201: { description: "Created" }, 400: badInput },
});

registry.registerPath({
  method: "patch",
  path: "/lodging-memberships/{id}",
  summary: "Update a loyalty programme",
  tags: lodgingTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/lodging-memberships/{id}",
  summary: "Remove a loyalty programme",
  tags: lodgingTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

// ---------------------------------------------------------------- misc

const miscTag = ["Misc"];

registry.registerPath({
  method: "get",
  path: "/airline-logos/{code}",
  summary: "An airline's logo",
  description:
    "Resolved through four sources in order, each falling through on a miss. " +
    "The tile is served as it comes and is meant to be drawn BARE: it carries " +
    "its own background, and painting a plate behind it once shipped an " +
    "invisible logo. Cached on disk and served stale while a refresh runs.",
  tags: miscTag,
  request: {
    params: z.object({ code: z.string() }),
    query: z.object({ variant: z.string().optional() }),
  },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/uploads/receipt",
  summary: "Upload a receipt",
  tags: miscTag,
  responses: { 201: { description: "Uploaded" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/uploads/receipts/{filename}",
  summary: "Fetch a receipt",
  tags: miscTag,
  request: { params: z.object({ filename: z.string() }) },
  responses: {
    200: { description: "File", content: { "application/octet-stream": { schema: z.string() } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/uploads/receipts/{filename}",
  summary: "Delete a receipt",
  tags: miscTag,
  request: { params: z.object({ filename: z.string() }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/diagnostic-export",
  summary: "A support bundle about this instance",
  description: "Redacted: no keys, no passwords, no user content.",
  tags: miscTag,
  responses: { 200: { description: "Diagnostics" } },
});

registry.registerPath({
  method: "post",
  path: "/analytics/events",
  summary: "Report a usage event",
  description: "Only when the instance has usage statistics switched on.",
  tags: miscTag,
  responses: { 204: { description: "Recorded" } },
});

registry.registerPath({
  method: "get",
  path: "/photo-journeys",
  summary: "Journeys proposed from photo timestamps",
  tags: miscTag,
  responses: { 200: { description: "Photo journeys" } },
});

registry.registerPath({
  method: "post",
  path: "/photo-journeys/scan",
  summary: "Scan photos for journeys",
  tags: miscTag,
  responses: { 202: { description: "Scan started" } },
});

registry.registerPath({
  method: "patch",
  path: "/photo-journeys/{id}",
  summary: "Update a photo journey",
  tags: miscTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Updated" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/photos/{photoId}/cover",
  summary: "Use a trip photo as the cover",
  tags: miscTag,
  request: { params: z.object({ id: uuid, photoId: uuid }) },
  responses: { 200: { description: "Cover set" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/places/visits/{visitId}/photos",
  summary: "Attach photos to a visit",
  tags: ["Places"],
  request: { params: z.object({ visitId: uuid }) },
  responses: { 201: { description: "Uploaded" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/place-lists/curated/{key}/subscribe",
  summary: "Subscribe to a shipped checklist",
  tags: ["Places"],
  request: { params: z.object({ key: z.string() }) },
  responses: { 201: { description: "Subscribed" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/place-lists/curated/items/{itemId}/tick",
  summary: "Tick a checklist item",
  tags: ["Places"],
  request: { params: z.object({ itemId: z.string() }) },
  responses: { 200: { description: "Ticked" }, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/place-lists/curated/{key}/suggestions",
  summary: "Places from the catalogue this checklist would accept",
  tags: ["Places"],
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { description: "Suggestions" }, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/parser-templates",
  summary: "Parser templates",
  description: "The per-airline rules the built-in parser reads a booking with.",
  tags: parseTag,
  responses: { 200: { description: "Templates" } },
});

registry.registerPath({
  method: "get",
  path: "/parser-templates/{id}",
  summary: "One template",
  tags: parseTag,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "Template" }, 404: notFound },
});

registry.registerPath({
  method: "patch",
  path: "/parser-templates/{id}",
  summary: "Update a template",
  tags: parseTag,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/parser-templates/{id}",
  summary: "Delete a template",
  tags: parseTag,
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/template-status",
  summary: "Which parser templates are current",
  tags: parseTag,
  responses: { 200: { description: "Status" } },
});

registry.registerPath({
  method: "post",
  path: "/template-status/sync",
  summary: "Refresh the airline templates from GitHub (admin only)",
  description:
    "Replaces the instance-wide template registry every user parses with, so it is an operator action: a non-admin account is answered 403.",
  tags: parseTag,
  responses: {
    200: { description: "Synced" },
    403: { description: "Not an admin", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/training/upload",
  summary: "Upload a document to improve parsing",
  tags: parseTag,
  responses: { 201: { description: "Uploaded" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/training/{id}",
  summary: "One training document",
  tags: parseTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Document" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/training/{id}/annotate",
  summary: "Say what a training document should have produced",
  tags: parseTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Annotated" }, 400: badInput, 404: notFound },
});
