/**
 * The account archive (forgejo#433): one account as a ZIP with every record and
 * file, to move it to another TravStats server, and its import into an empty account.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const job = {
  description: "The job to poll at `GET /jobs/{id}`",
  content: { "application/json": { schema: envelope(z.object({ jobId: z.string().uuid() })) } },
};
const tags = ["Account"];

registry.registerPath({
  method: "get",
  path: "/me/account-archive",
  summary: "Whether this account can take an account archive import",
  description:
    "`empty` is false once the account holds any record (its settings row aside): an import never " +
    "merges. `busy` while an export or import of this account runs. `maxBytes` is the size ceiling.",
  tags,
  responses: {
    200: {
      description: "Import readiness",
      content: {
        "application/json": {
          schema: envelope(
            z.object({ empty: z.boolean(), busy: z.boolean(), maxBytes: z.number().int() })
          ),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/me/account-archive/export",
  summary: "Start building this account's archive (background job)",
  description:
    "Starts a job (kind `accountArchive.export`) that writes a versioned ZIP: a manifest with " +
    "format and server version and every entry's sha256, the rows per table as JSON lines, the " +
    "catalogue rows they point at, shares as information only, and every uploaded file the " +
    "account owns. Photos only linked from Immich or PhotoPrism travel as links. Never credentials " +
    "or other accounts' data. The job's `result.exportId` names the download. 413 " +
    "`ACCOUNT_ARCHIVE_TOO_LARGE` past the ceiling, 409 `ACCOUNT_ARCHIVE_BUSY` while one runs.",
  tags,
  responses: {
    202: job,
    409: { description: "ACCOUNT_ARCHIVE_BUSY", content: errorContent },
    429: { description: "Too many archive requests", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/me/account-archive/export/{exportId}",
  summary: "Download a finished account archive",
  description:
    "The ZIP the export job wrote. Kept for six hours; 404 once expired or for another account.",
  tags,
  request: { params: z.object({ exportId: z.string().uuid() }) },
  responses: {
    200: {
      description: "The archive",
      content: { "application/zip": { schema: z.string().describe("ZIP bytes") } },
    },
    404: { description: "ACCOUNT_ARCHIVE_NOT_FOUND", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/me/account-archive/import",
  summary: "Import an account archive into this empty account (background job)",
  description:
    "multipart/form-data with the ZIP in `archive`. Starts a job (kind `accountArchive.import`): " +
    "the manifest and every checksum are verified first, then every id is re-keyed and the files " +
    "and rows are written in one transaction; a failure leaves the account as it was. A repeated " +
    "import of the same archive answers with the first outcome (`alreadyImported`). Refusals " +
    "(as the job's error code): `ACCOUNT_ARCHIVE_TARGET_NOT_EMPTY`, `ACCOUNT_ARCHIVE_FORMAT_TOO_NEW`, " +
    "`ACCOUNT_ARCHIVE_SCHEMA_TOO_NEW`, `ACCOUNT_ARCHIVE_CHECKSUM`, `ACCOUNT_ARCHIVE_INVALID`, " +
    "`ACCOUNT_ARCHIVE_ALREADY_IMPORTED`. Browser session only.",
  tags,
  request: {
    body: {
      content: {
        "multipart/form-data": { schema: z.object({ archive: z.string().describe("The ZIP") }) },
      },
      required: true,
    },
  },
  responses: {
    202: job,
    400: { description: "No archive uploaded", content: errorContent },
    403: { description: "API tokens may not import", content: errorContent },
    409: { description: "ACCOUNT_ARCHIVE_BUSY", content: errorContent },
    413: { description: "ACCOUNT_ARCHIVE_TOO_LARGE", content: errorContent },
    429: { description: "Too many archive requests", content: errorContent },
  },
});
