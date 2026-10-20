/**
 * Sharing a workshop template with the community (forgejo#309).
 */
import { z } from "zod";
import { registry } from "../registry";
import { errorContent } from "./shared";

const personalLiteral = z.object({
  kind: z
    .string()
    .describe("The annotation label whose value was found, or `identity` / `email` / `number`"),
  path: z.string().describe("Where in the file, e.g. `match.anchors[0]`"),
});

registry.registerPath({
  method: "get",
  path: "/parser-templates/{id}/community-export",
  summary: "One of your templates as a file for the template repository",
  description:
    "Builds the repository's v2 envelope from an ACTIVE workshop template (cruise, place, package, " +
    "rail, rental, bus, ferry): a new id from the issuer's name, today's date as version, the " +
    "running app as `minAppVersion`, no `source` constant and no test cases — the only document " +
    "that proves the template is your own, which never travels. The file is scanned for every " +
    "value you marked on the sample (bar the issuer's own names), your names and addresses, " +
    "e-mail addresses and long numbers: a hit in a marker, anchor or sender domain is removed and " +
    "listed in `removed`; a hit in the extraction rules or the issuer's name refuses the export " +
    "(422 `TEMPLATE_EXPORT_PERSONAL_DATA`, `kinds` names what was found). Nothing is sent " +
    "anywhere: `githubUrl` is GitHub's new-file page in the domain's folder, where you paste or " +
    "upload the file and the repository owner reviews it.",
  tags: ["Parsers"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "The file, ready to download",
      content: {
        "application/json": {
          schema: z.object({
            template: z.record(z.string(), z.unknown()).describe("The v2 envelope"),
            filename: z.string(),
            domain: z.enum(["cruise", "place", "package", "rail", "rental", "bus", "ferry"]),
            githubUrl: z.string().url(),
            removed: z.array(personalLiteral),
          }),
        },
      },
    },
    404: { description: "Not your template", content: errorContent },
    409: { description: "TEMPLATE_EXPORT_NOT_ACTIVE", content: errorContent },
    422: {
      description: "TEMPLATE_EXPORT_PERSONAL_DATA or TEMPLATE_EXPORT_UNSUPPORTED",
      content: errorContent,
    },
  },
});
