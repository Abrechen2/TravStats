/**
 * Backups, pending updates, import batches and the remaining flight and
 * airport calls.
 *
 * What these have in common is that none of them is CRUD over a record the
 * user typed. They are operations on the logbook as a whole, and each one has
 * a rule that only shows up when it goes wrong — which is what the
 * descriptions here are for.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const badInput = { description: "Invalid input", content: errorContent };
const notFound = { description: "Not found", content: errorContent };
const deleted = { description: "Deleted" };
const uuid = z.string().uuid();

// ----------------------------------------------------------------- backup

const backupTag = ["Backup"];

registry.registerPath({
  method: "get",
  path: "/backup",
  summary: "List backups",
  tags: backupTag,
  responses: { 200: { description: "Backups" } },
});

registry.registerPath({
  method: "get",
  path: "/backup/status",
  summary: "Whether a backup is running, and when the last one finished",
  tags: backupTag,
  responses: { 200: { description: "Status" } },
});

registry.registerPath({
  method: "get",
  path: "/backup/{id}",
  summary: "One backup's details",
  tags: backupTag,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "Backup" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/backup",
  summary: "Take a backup now",
  description:
    "Covers the database AND every upload directory. Which directories those are " +
    "is one list in the code with a test that the backup actually uses it — a " +
    "backup that carried the rows but not the files looked complete and was not.",
  tags: backupTag,
  responses: { 202: { description: "Started" }, 409: { description: "Already running", content: errorContent } },
});

registry.registerPath({
  method: "get",
  path: "/backup/{id}/download",
  summary: "Download a backup archive",
  tags: backupTag,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Archive", content: { "application/octet-stream": { schema: z.string() } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/backup/{id}/restore",
  summary: "Restore from a backup",
  description:
    "REPLACES everything. This is the one call in the API that can lose data the " +
    "backup does not contain, so a client should confirm in words rather than " +
    "with a button that looks like the others.",
  tags: backupTag,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    202: { description: "Restore started" },
    400: { description: "Backup is not completed", content: errorContent },
    404: notFound,
    409: { description: "Another operation is running", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/backup/{id}",
  summary: "Delete a backup",
  tags: backupTag,
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/backup/cleanup",
  summary: "Delete backups past the retention setting",
  tags: backupTag,
  responses: { 200: { description: "Cleaned up" } },
});

registry.registerPath({
  method: "post",
  path: "/backup/{id}/sync",
  summary: "Copy one backup to the configured cloud target",
  tags: backupTag,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    202: { description: "Sync started" },
    400: { description: "Backup is not completed", content: errorContent },
    404: notFound,
    409: { description: "WebDAV sync is not enabled", content: errorContent },
    502: { description: "The WebDAV share did not answer as expected", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/backup/cloud/list",
  summary: "List backups on the cloud target",
  tags: backupTag,
  responses: {
    200: { description: "Remote backups" },
    409: { description: "WebDAV sync is not enabled", content: errorContent },
    502: { description: "The WebDAV share did not answer as expected", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/backup/cloud/download",
  summary: "Fetch a backup back from the cloud target",
  tags: backupTag,
  responses: {
    202: { description: "Download started" },
    400: badInput,
    404: { description: "No such backup on the share", content: errorContent },
    409: { description: "WebDAV sync is not enabled", content: errorContent },
    502: { description: "The WebDAV share did not answer as expected", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/backup/cloud/test",
  summary: "Try the cloud target",
  description: "Writes and removes a probe file — the only honest test of a write target.",
  tags: backupTag,
  responses: { 200: { description: "Reachable and writable" }, 400: badInput },
});

// --------------------------------------------------------- pending updates

const pendingTag = ["Pending updates"];

registry.registerPath({
  method: "get",
  path: "/pending-updates",
  summary: "Changes proposed by live flight data, awaiting a decision",
  description:
    "Automatic lookups do not overwrite a flight. They propose, and the proposal " +
    "waits here until it is applied or rejected — which is what keeps a wrong " +
    "match from silently rewriting a flight that was recorded correctly.",
  tags: pendingTag,
  responses: { 200: { description: "Pending updates" } },
});

registry.registerPath({
  method: "get",
  path: "/pending-updates/statistics",
  summary: "How many proposals are waiting, applied and rejected",
  tags: pendingTag,
  responses: { 200: { description: "Statistics" } },
});

registry.registerPath({
  method: "get",
  path: "/pending-updates/{id}",
  summary: "One proposal",
  tags: pendingTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Proposal" }, 404: notFound },
});

registry.registerPath({
  method: "put",
  path: "/pending-updates/{id}",
  summary: "Edit a proposal before applying it",
  tags: pendingTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/pending-updates/{id}/preview",
  summary: "What applying this proposal would change",
  description: "Field by field, before anything is written.",
  tags: pendingTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Diff" }, 404: notFound },
});

// Bulk counterparts (Forgejo #33). Both answer with a per-id outcome list, not
// a single flag: partial success is the normal case, and collapsing it would
// hide proposals the caller believes were accepted.
registry.registerPath({
  method: "post",
  path: "/pending-updates/apply",
  summary: "Apply several proposals at once",
  tags: pendingTag,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ ids: z.array(z.string()).min(1).max(200) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Per-id outcome",
      content: {
        "application/json": {
          schema: z.object({
            requested: z.number(),
            applied: z.number(),
            failed: z.number(),
            results: z.array(
              z.object({
                id: z.string(),
                status: z.enum(["applied", "rejected", "failed"]),
                error: z.string().optional(),
              })
            ),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/pending-updates/reject",
  summary: "Reject several proposals at once",
  tags: pendingTag,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ ids: z.array(z.string()).min(1).max(200) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Per-id outcome",
      content: {
        "application/json": {
          schema: z.object({
            requested: z.number(),
            rejected: z.number(),
            failed: z.number(),
            results: z.array(
              z.object({
                id: z.string(),
                status: z.enum(["applied", "rejected", "failed"]),
                error: z.string().optional(),
              })
            ),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/pending-updates/{id}/apply",
  summary: "Apply a proposal to its flight",
  tags: pendingTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Applied" }, 404: notFound, 410: { description: "Expired", content: errorContent } },
});

registry.registerPath({
  method: "post",
  path: "/pending-updates/{id}/reject",
  summary: "Reject a proposal",
  tags: pendingTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Rejected" }, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/pending-updates/{id}",
  summary: "Delete a proposal",
  tags: pendingTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

// -------------------------------------------------------- import batches

const importTag = ["Import"];

registry.registerPath({
  method: "get",
  path: "/import-batches",
  summary: "Every import that has run",
  description:
    "The log an import writes so it can be undone. A batch groups whatever one " +
    "file created, across domains.",
  tags: importTag,
  responses: { 200: { description: "Batches" } },
});

registry.registerPath({
  method: "post",
  path: "/import-batches",
  summary: "Start a batch",
  tags: importTag,
  responses: { 201: { description: "Created" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/import-batches/{id}/items",
  summary: "What one import created",
  description:
    "Rows from every domain the batch touched. Flights and cruises are keyed by " +
    "`importBatchId`, lodging by `batchId` — both are queried, which is the sort " +
    "of difference a consumer should not have to discover.",
  tags: importTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Items" }, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/import-batches/{id}",
  summary: "Undo an import",
  description: "Deletes what the batch created, and nothing that existed before it.",
  tags: importTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

// -------------------------------------------------------------- flights

const flightsTag = ["Flights"];

registry.registerPath({
  method: "get",
  path: "/flights/next",
  summary: "The next flight that has not departed",
  tags: flightsTag,
  responses: { 200: { description: "Next flight, or nothing" } },
});

registry.registerPath({
  method: "get",
  path: "/flights/geo",
  summary: "Flights as geometry for the map",
  description:
    "Paginated. Route lines come from `geometry.coordinates`, not from the " +
    "airports' own coordinates — those are not populated on this payload.",
  tags: flightsTag,
  request: {
    query: z.object({ page: z.coerce.number().int().optional(), limit: z.coerce.number().int().optional() }),
  },
  responses: { 200: { description: "GeoJSON features" } },
});

registry.registerPath({
  method: "get",
  path: "/flights/{id}/route-estimation",
  summary: "An estimated route for a flight with no recorded track",
  tags: flightsTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Estimated route" }, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/flights/enrichment-candidates",
  summary: "Flights that could still gain data from a lookup",
  tags: flightsTag,
  responses: { 200: { description: "Candidates" } },
});

registry.registerPath({
  method: "post",
  path: "/flights/{id}/enrich-historical",
  summary: "Fill in one historical flight from a provider",
  tags: flightsTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Enriched" }, 404: notFound, 503: { description: "No provider configured", content: errorContent } },
});

registry.registerPath({
  method: "get",
  path: "/flights/refresh-historical-bulk/preview",
  summary: "What a bulk refresh would touch, and what it would cost",
  description:
    "Provider calls are metered, so the count matters before the run rather than " +
    "after it.",
  tags: flightsTag,
  responses: { 200: { description: "Preview" } },
});

registry.registerPath({
  method: "post",
  path: "/flights/refresh-historical-bulk",
  summary: "Refresh many historical flights",
  tags: flightsTag,
  responses: { 202: { description: "Started" }, 503: { description: "No provider configured", content: errorContent } },
});

// ------------------------------------------------------------- airports

const airportsTag = ["Airports"];

registry.registerPath({
  method: "get",
  path: "/airports/{code}",
  summary: "One airport by IATA or ICAO",
  description:
    "IATA codes are not unique across closed and active airports, so a closed " +
    "predecessor and its successor can share one. The catalogue keys on the code " +
    "AND whether it is closed.",
  tags: airportsTag,
  request: { params: z.object({ code: z.string() }) },
  responses: { 200: { description: "Airport" }, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/airports/coords/nearest",
  summary: "The nearest airport to a position",
  tags: airportsTag,
  request: { query: z.object({ lat: z.coerce.number(), lon: z.coerce.number() }) },
  responses: { 200: { description: "Nearest airport" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/airports",
  summary: "Add an airport the catalogue does not have",
  description:
    "User-added rows survive a catalogue re-seed: re-seeding skips a code it " +
    "already holds and never overwrites what a user entered.",
  tags: airportsTag,
  responses: { 201: { description: "Created" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/airports/enrich",
  summary: "Fill in missing airport details from a provider",
  tags: airportsTag,
  responses: { 200: { description: "Enriched" }, 503: { description: "No provider configured", content: errorContent } },
});

// ----------------------------------------------------------------- auth

const authTag = ["Auth"];

registry.registerPath({
  method: "post",
  path: "/auth/login",
  summary: "Sign in",
  description:
    "The session is an HttpOnly cookie, not a bearer token in the body — a token " +
    "a script can read is a token a script can steal.\n\n" +
    "A correct password does not always mean a session. With two-factor enabled " +
    "the answer is `{requiresTwoFactor: true}` plus a short-lived cookie for the " +
    "second step, and that branch is checked BEFORE the must-change-password one: " +
    "an account carrying both flags would otherwise get a password-change token " +
    "on the password alone, which is a full takeover.",
  tags: authTag,
  responses: {
    200: { description: "Signed in, or a second factor is required" },
    401: { description: "Wrong credentials", content: errorContent },
    429: { description: "Too many attempts", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  summary: "Sign out",
  tags: authTag,
  responses: { 200: { description: "Signed out" } },
});

registry.registerPath({
  method: "post",
  path: "/auth/register",
  summary: "Create an account",
  description: "Refused when the instance has registration switched off.",
  tags: authTag,
  responses: {
    201: { description: "Created" },
    400: badInput,
    403: { description: "Registration is closed", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/auth/me",
  summary: "Who the caller is",
  tags: authTag,
  responses: { 200: { description: "The current user" }, 401: { description: "Not signed in", content: errorContent } },
});

registry.registerPath({
  method: "post",
  path: "/auth/change-password",
  summary: "Change the password",
  tags: authTag,
  responses: { 200: { description: "Changed" }, 400: badInput, 401: { description: "Wrong current password", content: errorContent } },
});
